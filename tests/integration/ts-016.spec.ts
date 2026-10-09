// @trace TS-016 RNF-007 RF-001 ENT-012 (ADR-001 v1.5 OA-002; AGENTS.md QG-004)
// Falha do despachante: o Outbox preserva o trabalho. Produtor: createAccount (os planos ainda nao
// existem). Com o pg-boss fora, o cadastro responde 201 e o evento fica pendente; na retomada, o
// evento vira exatamente 1 job, sem perda nem duplicata, mesmo com despachantes concorrentes
// (DC-017). PostgreSQL 17 real.
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import type { Clock } from '../../apps/api/src/platform/clock.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import {
  OUTBOX_QUEUES,
  OutboxDispatcher,
  type JobPublisher,
} from '../../apps/api/src/platform/outbox/dispatcher.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

const NOW = '2026-10-05T11:05:15Z';
let currentNow = NOW;
const clock: Clock = { now: () => currentNow };

let db: PostgresHandle;
let pool: pg.Pool;
let app: NestFastifyApplication;
let boss: PgBoss;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
  await migrate(pool);
  boss = new PgBoss({ connectionString: db.url });
  boss.on('error', () => undefined);
  await boss.start();
  for (const queue of OUTBOX_QUEUES) await boss.createQueue(queue);
  app = await createApp({
    clock,
    database: pool,
    logger: false,
    allowedOrigins: ['https://app.example.invalid'],
    secrets: {
      requestHashKey: randomBytes(32),
      emailPepper: randomBytes(32),
      csrfKey: randomBytes(32),
    },
  });
});

afterAll(async () => {
  await app.close();
  await boss.stop({ graceful: false });
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  currentNow = NOW;
  await pool.query(
    'TRUNCATE users, idempotency_records, outbox_events, rate_limit_counters CASCADE',
  );
  await pool.query('DELETE FROM pgboss.job');
});

let sequence = 0;
async function createAccount(): Promise<string> {
  sequence += 1;
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'content-type': 'application/json', 'idempotency-key': `k-${String(sequence)}` },
      remoteAddress: `198.51.100.${String((sequence % 200) + 1)}`,
      payload: JSON.stringify({
        name: 'Ana Silva',
        email: `ana.silva+${String(sequence)}@example.com`,
        password: 'Senha-Sintetica-2026',
        account_timezone: 'America/Sao_Paulo',
        terms_version: '2026-10',
        privacy_notice_version: '2026-10',
        terms_accepted: true,
        privacy_notice_acknowledged: true,
      }),
    });
  expect(response.statusCode).toBe(201);
  return response.json<{ user_id: string }>().user_id;
}

const failing: JobPublisher = {
  send: () =>
    Promise.reject(Object.assign(new Error('pg-boss fora do ar'), { code: 'ECONNREFUSED' })),
};

interface OutboxRow {
  id: string;
  dispatched_at: Date | null;
  attempts: number;
  last_error_code: string | null;
  available_at: Date;
}

const outbox = async (): Promise<OutboxRow[]> =>
  (
    await pool.query<OutboxRow>(
      'SELECT id, dispatched_at, attempts, last_error_code, available_at FROM outbox_events ORDER BY created_at',
    )
  ).rows;

const jobs = async (): Promise<{ id: string; name: string; data: unknown }[]> =>
  (
    await pool.query<{ id: string; name: string; data: unknown }>(
      'SELECT id, name, data FROM pgboss.job',
    )
  ).rows;

describe('TS-016 falha do despachante', () => {
  it('com o pg-boss fora, o cadastro responde 201 e o evento fica pendente com a falha registrada', async () => {
    await createAccount();
    const dispatcher = new OutboxDispatcher(pool, failing, clock);
    expect(await dispatcher.dispatchOnce()).toBe(0);
    const [event] = await outbox();
    expect(event).toMatchObject({
      dispatched_at: null,
      attempts: 1,
      last_error_code: 'ECONNREFUSED',
    });
    expect(await jobs()).toEqual([]);
  });

  it('a falha adia a nova tentativa com backoff exponencial (DC-017)', async () => {
    await createAccount();
    const dispatcher = new OutboxDispatcher(pool, failing, clock);
    await dispatcher.dispatchOnce();
    const [first] = await outbox();
    expect(first?.available_at.toISOString()).toBe('2026-10-05T11:05:17.000Z');
    // Antes do novo prazo, o evento nao e reivindicado.
    expect(await dispatcher.dispatchOnce()).toBe(0);
    expect((await outbox())[0]?.attempts).toBe(1);
    currentNow = '2026-10-05T11:05:17Z';
    await dispatcher.dispatchOnce();
    expect((await outbox())[0]?.available_at.toISOString()).toBe('2026-10-05T11:05:21.000Z');
  });

  it('na retomada, o evento vira exatamente 1 job com o mesmo id, uma unica vez', async () => {
    const userId = await createAccount();
    await new OutboxDispatcher(pool, failing, clock).dispatchOnce();
    currentNow = '2026-10-05T11:10:00Z';
    const dispatcher = new OutboxDispatcher(pool, boss, clock);
    expect(await dispatcher.dispatchOnce()).toBe(1);
    expect(await dispatcher.dispatchOnce()).toBe(0);
    const [event] = await outbox();
    expect(event?.dispatched_at?.toISOString()).toBe('2026-10-05T11:10:00.000Z');
    expect(await jobs()).toEqual([
      {
        id: event?.id,
        name: 'identity.verification_requested',
        data: { event_id: event?.id, user_id: userId },
      },
    ]);
  });

  it('despachantes concorrentes nao perdem nem duplicam eventos', async () => {
    for (let i = 0; i < 12; i += 1) await createAccount();
    const dispatchers = Array.from({ length: 4 }, () => new OutboxDispatcher(pool, boss, clock, 3));
    let total = 0;
    for (let round = 0; round < 5; round += 1) {
      const counts = await Promise.all(dispatchers.map((d) => d.dispatchOnce()));
      total += counts.reduce((sum, n) => sum + n, 0);
    }
    expect(total).toBe(12);
    const events = await outbox();
    expect(events.every((e) => e.dispatched_at !== null)).toBe(true);
    const enqueued = await jobs();
    expect(enqueued).toHaveLength(12);
    expect(new Set(enqueued.map((j) => j.id))).toEqual(new Set(events.map((e) => e.id)));
  });

  it('o job e enfileirado na mesma transacao: falha ao marcar o evento desfaz o job', async () => {
    await createAccount();
    // Publica de verdade e, em seguida, quebra a transacao antes do COMMIT.
    const breaking: JobPublisher = {
      send: async (name, data, options) => {
        const id = await boss.send(name, data, options);
        await options.db.executeSql('SELECT 1/0');
        return id;
      },
    };
    expect(await new OutboxDispatcher(pool, breaking, clock).dispatchOnce()).toBe(0);
    expect(await jobs()).toEqual([]);
    expect((await outbox())[0]).toMatchObject({ dispatched_at: null, attempts: 1 });
  });
});

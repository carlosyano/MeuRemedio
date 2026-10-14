// @trace RF-010 RN-012 RN-019 ENT-014 FL-001 requestAccountDeletion
// Expurgo da conta contra PostgreSQL 17 real (DC-046): o job do worker remove, ate purge_due_at
// (30 dias apos o pedido, RN-012), todos os dados do titular, inclusive os PDFs no armazenamento
// privado, os snapshots de idempotencia, os eventos do Outbox e o contador de login; grava o
// tombstone minimizado (user_id + HMAC do e-mail, 180 dias, RN-019); o mesmo e-mail pode criar
// conta nova. A trilha de auditoria permanece (sem FK, ENT-013).
import { createHmac } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleExportRequested } from '../../apps/api/src/modules/exports/application/process-export.js';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import {
  PURGE_SWEEP_CRON,
  PURGE_SWEEP_QUEUE,
  handlePurgeSweep,
} from '../../apps/api/src/modules/privacy/application/account-purge.js';
import type { ObjectStorage } from '../../apps/api/src/platform/storage/object-storage.js';
import { startWorker } from '../../apps/api/src/worker.js';
import { PASSWORD, login, startHarness, type Harness, type LoggedIn } from './support/http.js';

const NOW = '2026-10-05T11:05:15Z';
// purge_due_at do pedido feito em NOW.
const DUE = '2026-11-04T11:05:15Z';
const DAY_MS = 24 * 3_600_000;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

let ana: LoggedIn;
let anaId: string;
let brunoId: string;
let bruno: LoggedIn;
let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.pool.query('TRUNCATE purge_tombstones');
  anaId = await h.activeUser('ana.silva@example.com');
  brunoId = await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

const shift = (instant: string, ms: number): string =>
  new Date(Date.parse(instant) + ms).toISOString().replace('.000Z', 'Z');

const sweep = (storage: ObjectStorage = h.storage) =>
  handlePurgeSweep({
    pool: h.pool,
    clock: { now: () => h.now },
    storage,
    emailPepper: h.emailPepper,
  });

const emailHmac = (email: string): Buffer =>
  createHmac('sha256', h.emailPepper).update(email).digest();

/** Plano com ocorrencias, exportacao concluida (PDF no armazenamento) e falha de login. */
async function titularData(session: LoggedIn, email: string): Promise<string> {
  const created = await h.call('createPlan', 'POST', '/plans', {
    body: {
      medication_name: 'Comprimido',
      dose_text: '1 comprimido',
      medication_form: 'TABLET',
      administration_route: 'ORAL',
      start_date: '2026-10-01',
      schedule_times: ['08:00'],
    },
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(created.status).toBe(201);
  const planId = (created.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  const exported = await h.call('createExport', 'POST', '/exports', {
    body: { start_date: '2026-10-01', end_date: '2026-10-31' },
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(exported.status).toBe(202);
  const exportId = (exported.body as { export_id: string }).export_id;
  await handleExportRequested(
    { pool: h.pool, clock: { now: () => h.now }, storage: h.storage },
    { event_id: '00000000-0000-4000-8000-000000000001', export_id: exportId },
  );
  const failed = await h.call('createSession', 'POST', '/sessions', {
    body: { email, password: 'Senha-Errada-2026' },
  });
  expect(failed.status).toBe(401);
  return exportId;
}

const requestDeletion = async (session: LoggedIn) => {
  const response = await h.call('requestAccountDeletion', 'POST', '/account-deletions', {
    body: { password: PASSWORD, confirmation: 'EXCLUIR MINHA CONTA' },
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(202);
};

const exportKey = (userId: string, exportId: string) => `exports/${userId}/${exportId}.pdf`;

/** Linhas que ainda referenciam o titular, por tabela. */
async function leftovers(userId: string): Promise<Record<string, number>> {
  const count = async (sql: string): Promise<number> =>
    Number((await h.pool.query<{ n: string }>(sql, [userId])).rows[0]?.n);
  return {
    users: await count('SELECT count(*) AS n FROM users WHERE id = $1'),
    sessions: await count('SELECT count(*) AS n FROM sessions WHERE user_id = $1'),
    medication_plans: await count('SELECT count(*) AS n FROM medication_plans WHERE user_id = $1'),
    occurrences: await count('SELECT count(*) AS n FROM occurrences WHERE user_id = $1'),
    export_requests: await count('SELECT count(*) AS n FROM export_requests WHERE user_id = $1'),
    idempotency_records: await count(
      'SELECT count(*) AS n FROM idempotency_records WHERE scope_key = $1',
    ),
    outbox_events: await count(
      `SELECT count(*) AS n FROM outbox_events
        WHERE aggregate_id = $1
           OR aggregate_id IN (SELECT id FROM medication_plans WHERE user_id = $1)
           OR aggregate_id IN (SELECT id FROM export_requests WHERE user_id = $1)
           OR payload->>'user_id' = $1::text`,
    ),
  };
}

const NOTHING_LEFT = {
  users: 0,
  sessions: 0,
  medication_plans: 0,
  occurrences: 0,
  export_requests: 0,
  idempotency_records: 0,
  outbox_events: 0,
};

const tombstones = async () =>
  (
    await h.pool.query<{ user_id: string; email_hmac: Buffer; purged_at: Date; expires_at: Date }>(
      'SELECT user_id, email_hmac, purged_at, expires_at FROM purge_tombstones ORDER BY purged_at',
    )
  ).rows;

describe('expurgo da conta (RN-012, DC-046)', () => {
  it('antes do prazo (com folga maior que 1 h) nada muda', async () => {
    await titularData(ana, 'ana.silva@example.com');
    await requestDeletion(ana);
    h.now = shift(DUE, -2 * 3_600_000);
    expect(await sweep()).toMatchObject({ purged: 0 });
    expect((await leftovers(anaId)).users).toBe(1);
    expect(await tombstones()).toEqual([]);
  });

  it('no prazo: remove todos os dados do titular, o PDF e o contador de login, e grava o tombstone', async () => {
    const exportId = await titularData(ana, 'ana.silva@example.com');
    const brunoExport = await titularData(bruno, 'bruno.costa@example.com');
    expect(await h.storage.get(exportKey(anaId, exportId))).toBeDefined();
    await requestDeletion(ana);
    h.now = DUE;

    expect(await sweep()).toMatchObject({ purged: 1 });

    expect(await leftovers(anaId)).toEqual(NOTHING_LEFT);
    expect(await h.storage.get(exportKey(anaId, exportId))).toBeUndefined();
    const counters = await h.pool.query(
      'SELECT 1 FROM login_failure_counters WHERE email_hash = $1',
      [emailHmac('ana.silva@example.com')],
    );
    expect(counters.rowCount).toBe(0);

    const stones = await tombstones();
    expect(stones).toHaveLength(1);
    expect(stones[0]?.user_id).toBe(anaId);
    expect(stones[0]?.email_hmac.equals(emailHmac('ana.silva@example.com'))).toBe(true);
    expect(stones[0]?.purged_at.toISOString()).toBe('2026-11-04T11:05:15.000Z');
    expect(stones[0]?.expires_at.toISOString()).toBe('2027-05-03T11:05:15.000Z');
    const dump = await h.pool.query<{ dump: string }>(
      'SELECT row_to_json(t)::text AS dump FROM purge_tombstones t',
    );
    expect(dump.rows[0]?.dump).not.toContain('ana.silva');

    // O outro titular nao e afetado.
    const brunoLeft = await leftovers(brunoId);
    expect(brunoLeft.users).toBe(1);
    expect(brunoLeft.medication_plans).toBe(1);
    expect(await h.storage.get(exportKey(brunoId, brunoExport))).toBeDefined();
    const brunoCounter = await h.pool.query(
      'SELECT 1 FROM login_failure_counters WHERE email_hash = $1',
      [emailHmac('bruno.costa@example.com')],
    );
    expect(brunoCounter.rowCount).toBe(1);
  });

  it('ate 1 h antes do prazo o expurgo ja ocorre: nunca depois dos 30 dias', async () => {
    await requestDeletion(ana);
    h.now = shift(DUE, -3_600_000);
    expect(await sweep()).toMatchObject({ purged: 1 });
    expect((await leftovers(anaId)).users).toBe(0);
  });

  it('a trilha de auditoria permanece, sem FK para a conta', async () => {
    await requestDeletion(ana);
    h.now = DUE;
    await sweep();
    const audit = await h.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'account.deletion_requested' AND actor_user_id = $1",
      [anaId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('reexecutar nao repete nem duplica o tombstone', async () => {
    await requestDeletion(ana);
    h.now = DUE;
    await sweep();
    expect(await sweep()).toMatchObject({ purged: 0 });
    expect(await tombstones()).toHaveLength(1);
  });

  it('falha no armazenamento: nada e removido e a proxima passada refaz', async () => {
    const exportId = await titularData(ana, 'ana.silva@example.com');
    await requestDeletion(ana);
    h.now = DUE;
    const broken: ObjectStorage = {
      put: () => Promise.reject(new Error('armazenamento indisponivel')),
      get: (key) => h.storage.get(key),
      delete: () => Promise.reject(new Error('armazenamento indisponivel')),
    };
    await expect(sweep(broken)).rejects.toThrow(/armazenamento/);
    expect((await leftovers(anaId)).users).toBe(1);
    expect(await tombstones()).toEqual([]);
    expect(await sweep()).toMatchObject({ purged: 1 });
    expect(await h.storage.get(exportKey(anaId, exportId))).toBeUndefined();
  });

  it('o mesmo e-mail pode criar conta nova depois do expurgo (RN-019)', async () => {
    await requestDeletion(ana);
    h.now = DUE;
    await sweep();
    const response = await h.call('createAccount', 'POST', '/accounts', {
      body: {
        name: 'Ana Silva',
        email: 'ana.silva@example.com',
        password: PASSWORD,
        account_timezone: 'America/Sao_Paulo',
        terms_version: '2026-10',
        privacy_notice_version: '2026-10',
        terms_accepted: true,
        privacy_notice_acknowledged: true,
      },
      headers: { 'idempotency-key': nextKey() },
    });
    expect(response.status).toBe(201);
    expect(await tombstones()).toHaveLength(1);
  });

  it('tombstone expira 180 dias depois do expurgo', async () => {
    await requestDeletion(ana);
    h.now = DUE;
    await sweep();
    h.now = shift(DUE, 180 * DAY_MS - 1000);
    expect(await sweep()).toMatchObject({ tombstonesExpired: 0 });
    h.now = shift(DUE, 180 * DAY_MS);
    expect(await sweep()).toMatchObject({ tombstonesExpired: 1 });
    expect(await tombstones()).toEqual([]);
  });

  it('conta ACTIVE nunca e expurgada', async () => {
    h.now = shift(NOW, 400 * DAY_MS);
    expect(await sweep()).toMatchObject({ purged: 0 });
    expect((await leftovers(anaId)).users).toBe(1);
  });
});

describe('worker: expurgo agendado', () => {
  it('agenda a fila a cada 15 minutos e o consumidor expurga', async () => {
    await requestDeletion(ana);
    const boss = new PgBoss({ connectionString: h.url });
    boss.on('error', () => undefined);
    h.now = DUE;
    const worker = await startWorker({
      pool: h.pool,
      boss,
      clock: { now: () => h.now },
      email: { send: () => Promise.resolve(undefined) },
      storage: h.storage,
      webBaseUrl: 'https://app.example.invalid',
      emailPepper: h.emailPepper,
      pollIntervalMs: 100,
    });
    try {
      const schedules = await boss.getSchedules(PURGE_SWEEP_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual([PURGE_SWEEP_CRON]);
      expect(PURGE_SWEEP_CRON).toBe('*/15 * * * *');
      await boss.send(PURGE_SWEEP_QUEUE, {});
      const limit = Date.now() + 20_000;
      while ((await leftovers(anaId)).users !== 0 && Date.now() < limit) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect((await leftovers(anaId)).users).toBe(0);
    } finally {
      await worker.stop();
    }
  });
});

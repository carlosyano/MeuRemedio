// @trace RF-001 CA-001 TS-038 RN-017 RNF-006 DEC-009 DEC-023 DEC-029 DEC-030 ERR-001 ERR-006 ERR-007 ERR-010 createAccount
// createAccount por HTTP real (inject do Fastify) contra PostgreSQL 17 real: conta PENDING_VERIFICATION
// com Argon2id, evento de verificacao no Outbox (DC-008), idempotencia com escopo public, e-mail ja
// cadastrado (DEC-030), senha comprometida (DEC-029), fuso IANA canonico (DEC-023) e rate limit por IP.
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import type { Clock } from '../../apps/api/src/platform/clock.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../apps/api/src/platform/contract/openapi-contract.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

const NOW = '2026-10-05T11:05:15Z';
const contract = OpenApiContract.load(locateNormativeOpenApi());

let db: PostgresHandle;
let pool: pg.Pool;
let app: NestFastifyApplication;
let currentNow = NOW;
const clock: Clock = { now: () => currentNow };

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
  await migrate(pool);
  app = await createApp({
    clock,
    database: pool,
    logger: false,
    secrets: { requestHashKey: randomBytes(32) },
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  currentNow = NOW;
  await pool.query(
    'TRUNCATE users, idempotency_records, outbox_events, rate_limit_counters CASCADE',
  );
});

let ip = 0;
/** IP de documentacao distinto por teste, para o rate limit nao vazar entre cenarios. */
const nextIp = (): string => {
  ip += 1;
  return `198.51.100.${String(ip)}`;
};

const account = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Ana Silva',
  email: 'ana.silva@example.com',
  password: 'Senha-Sintetica-2026',
  account_timezone: 'America/Sao_Paulo',
  terms_version: '2026-10',
  privacy_notice_version: '2026-10',
  terms_accepted: true,
  privacy_notice_acknowledged: true,
  ...over,
});

async function post(
  body: unknown,
  options: { key?: string | null; remoteAddress?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null)
    headers['idempotency-key'] = options.key ?? `k-${randomBytes(6).toString('hex')}`;
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/accounts',
      headers,
      payload: JSON.stringify(body),
      remoteAddress: options.remoteAddress ?? nextIp(),
    });
  const result = {
    status: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
    ),
    body: response.json<unknown>(),
  };
  expect(contract.validateResponse('createAccount', result), JSON.stringify(result.body)).toEqual(
    [],
  );
  return result;
}

const count = async (sql: string): Promise<number> =>
  Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`)).rows[0]?.n);

describe('createAccount: cadastro (CA-001)', () => {
  it('201 com AccountSummary e conta PENDING_VERIFICATION', async () => {
    const response = await post(account({ email: '  Ana.Silva@Example.COM ' }));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      user_id: expect.any(String) as unknown,
      status: 'PENDING_VERIFICATION',
      account_timezone: 'America/Sao_Paulo',
      created_at: NOW,
    });
    const row = (
      await pool.query<{
        id: string;
        email_normalized: string;
        password_hash: string;
        status: string;
        name: string;
        terms_accepted_at: Date;
        privacy_acknowledged_at: Date;
        created_at: Date;
      }>('SELECT * FROM users')
    ).rows;
    expect(row).toHaveLength(1);
    const user = row[0];
    expect(user?.id).toBe((response.body as { user_id: string }).user_id);
    expect(user?.email_normalized).toBe('ana.silva@example.com');
    expect(user?.status).toBe('PENDING_VERIFICATION');
    expect(user?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user?.password_hash).not.toContain('Senha-Sintetica-2026');
    for (const instant of [
      user?.terms_accepted_at,
      user?.privacy_acknowledged_at,
      user?.created_at,
    ]) {
      expect(instant?.toISOString()).toBe('2026-10-05T11:05:15.000Z');
    }
  });

  it('grava o evento de verificacao no Outbox, so com identificadores (DC-008)', async () => {
    const response = await post(account());
    const userId = (response.body as { user_id: string }).user_id;
    const events = await pool.query<{
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      payload: unknown;
      dispatched_at: Date | null;
    }>(
      'SELECT aggregate_type, aggregate_id, event_type, payload, dispatched_at FROM outbox_events',
    );
    expect(events.rows).toEqual([
      {
        aggregate_type: 'user',
        aggregate_id: userId,
        event_type: 'identity.verification_requested',
        payload: { user_id: userId },
        dispatched_at: null,
      },
    ]);
  });

  it('nome com espacos nas pontas e gravado aparado', async () => {
    await post(account({ name: '  Ana Silva  ' }));
    expect((await pool.query<{ name: string }>('SELECT name FROM users')).rows[0]?.name).toBe(
      'Ana Silva',
    );
  });
});

describe('createAccount: idempotencia (TS-038, escopo public)', () => {
  it('replay identico devolve o mesmo 201 sem novo efeito', async () => {
    const first = await post(account(), { key: 'K1' });
    currentNow = '2026-10-05T11:07:00Z';
    const replay = await post(account(), { key: 'K1' });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await count('users')).toBe(1);
    expect(await count('outbox_events')).toBe(1);
  });

  it('mesma chave com payload divergente: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    await post(account(), { key: 'K2' });
    const response = await post(account({ name: 'Outra Pessoa' }), { key: 'K2' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await count('users')).toBe(1);
  });

  it('sem Idempotency-Key: 400 VALIDATION_FAILED', async () => {
    const response = await post(account(), { key: null });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [{ field: 'Idempotency-Key', code: 'REQUIRED' }],
    });
    expect(await count('users')).toBe(0);
  });

  it('chamadas simultaneas com a mesma chave criam uma unica conta', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(account(), { key: 'K3' })),
    );
    for (const result of results) expect(result.status).toBe(201);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(await count('users')).toBe(1);
  });

  it('o request_hash nao e o SHA-256 simples do corpo (HMAC, DC-012)', async () => {
    await post(account(), { key: 'K4' });
    const stored = await pool.query<{ ok: boolean }>(
      `SELECT request_hash <> sha256(convert_to($1, 'UTF8')) AS ok FROM idempotency_records`,
      [JSON.stringify({ body: account() })],
    );
    expect(stored.rows[0]?.ok).toBe(true);
  });
});

describe('createAccount: regras de cadastro', () => {
  it('e-mail ja cadastrado (qualquer caixa): 409 STATE_CONFLICT sem novo efeito (DEC-030)', async () => {
    await post(account());
    const response = await post(account({ email: 'ANA.SILVA@example.com', name: 'Outra' }));
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await count('users')).toBe(1);
    expect(await count('outbox_events')).toBe(1);
  });

  it('cadastros simultaneos do mesmo e-mail com chaves diferentes: um 201 e o resto 409', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => post(account())));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await count('users')).toBe(1);
  });

  it('senha da lista local: 400 com PASSWORD_COMPROMISED (DEC-029)', async () => {
    const response = await post(account({ password: 'Password123' }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [{ field: 'password', code: 'PASSWORD_COMPROMISED' }],
    });
    expect(await count('users')).toBe(0);
  });

  it('senha fora do padrao do contrato: 400 no campo password', async () => {
    const response = await post(account({ password: 'semmaiuscula1' }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'password' }] });
  });

  it.each([
    ['inexistente', 'America/Sao_Paul0'],
    ['alias nao canonico', 'Brazil/East'],
  ])('fuso %s: 400 no campo account_timezone (DEC-023)', async (_nome, zone) => {
    const response = await post(account({ account_timezone: zone }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'account_timezone' }] });
    expect(await count('users')).toBe(0);
  });

  it('nome so com espacos: 400 no campo name', async () => {
    const response = await post(account({ name: '   ' }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'name' }] });
  });

  it('termos nao aceitos: 400 pelo contrato', async () => {
    const response = await post(account({ terms_accepted: false }));
    expect(response.status).toBe(400);
    expect(await count('users')).toBe(0);
  });

  it('a resposta nunca devolve a senha', async () => {
    const response = await post(account());
    expect(JSON.stringify(response.body)).not.toContain('Senha-Sintetica-2026');
  });
});

describe('createAccount: rate limit por IP (RNF-006)', () => {
  it('a 21a requisicao do mesmo IP no minuto recebe 429 com Retry-After', async () => {
    const remoteAddress = nextIp();
    for (let i = 0; i < 20; i += 1) {
      const response = await post(account({ email: `ana.silva+${String(i)}@example.com` }), {
        remoteAddress,
      });
      expect(response.status).toBe(201);
    }
    const limited = await post(account({ email: 'ana.silva+21@example.com' }), { remoteAddress });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('45');
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await count('users')).toBe(20);
  });

  it('outro IP segue livre', async () => {
    const remoteAddress = nextIp();
    for (let i = 0; i < 21; i += 1) {
      await post(account({ email: `bruno.costa+${String(i)}@example.com` }), { remoteAddress });
    }
    expect((await post(account({ email: 'ana.silva@example.com' }))).status).toBe(201);
  });
});

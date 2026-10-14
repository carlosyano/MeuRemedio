// @trace TS-028 RF-001 RF-010 RN-012 ENT-001 ENT-002 FL-001
// TS-028 (Conta pendente antiga) contra PostgreSQL 17 real (DC-051): a passada do expurgo remove a
// conta que segue PENDING_VERIFICATION 30 dias depois do cadastro, sem deixar orfaos (tokens,
// eventos do Outbox, snapshot de idempotencia do createAccount e contador de login). Nao grava
// tombstone: a conta nunca foi ativada, e uma copia restaurada continua pendente e antiga.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleVerificationRequested } from '../../apps/api/src/modules/identity/application/issue-verification.js';
import { handlePurgeSweep } from '../../apps/api/src/modules/privacy/application/account-purge.js';
import { startHarness, type Harness } from './support/http.js';

const NOW = '2026-10-05T11:05:15Z';
const DAY_MS = 24 * 3_600_000;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.pool.query('TRUNCATE purge_tombstones');
});

const shift = (ms: number): string =>
  new Date(Date.parse(NOW) + ms).toISOString().replace('.000Z', 'Z');

const sweep = () =>
  handlePurgeSweep({
    pool: h.pool,
    clock: { now: () => h.now },
    storage: h.storage,
    emailPepper: h.emailPepper,
  });

/** Cadastro por HTTP (snapshot de idempotencia e evento no Outbox), token emitido e uma falha de
 * login registrada para o e-mail. */
async function pendingAccount(email: string, key: string): Promise<string> {
  const created = await h.call('createAccount', 'POST', '/accounts', {
    body: {
      name: 'Ana Silva',
      email,
      password: 'Senha-Sintetica-2026',
      account_timezone: 'America/Sao_Paulo',
      terms_version: '2026-10',
      privacy_notice_version: '2026-10',
      terms_accepted: true,
      privacy_notice_acknowledged: true,
    },
    headers: { 'idempotency-key': key },
  });
  expect(created.status).toBe(201);
  const userId = (created.body as { user_id: string }).user_id;
  const events = await h.pool.query<{ id: string }>(
    "SELECT id FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'identity.verification_requested'",
    [userId],
  );
  await handleVerificationRequested(
    {
      pool: h.pool,
      clock: { now: () => h.now },
      email: { send: () => Promise.resolve(undefined) },
      webBaseUrl: 'https://app.example.invalid',
    },
    { event_id: events.rows[0]?.id ?? '', user_id: userId },
  );
  const failed = await h.call('createSession', 'POST', '/sessions', {
    body: { email, password: 'Senha-Errada-2026' },
  });
  expect(failed.status).toBe(401);
  return userId;
}

/** Linhas ligadas a conta, por tabela. */
async function leftovers(userId: string, email: string) {
  const count = async (sql: string, value: unknown): Promise<number> =>
    Number((await h.pool.query<{ n: string }>(sql, [value])).rows[0]?.n);
  return {
    users: await count('SELECT count(*) AS n FROM users WHERE id = $1', userId),
    verification_tokens: await count(
      'SELECT count(*) AS n FROM verification_tokens WHERE user_id = $1',
      userId,
    ),
    outbox_events: await count(
      'SELECT count(*) AS n FROM outbox_events WHERE aggregate_id = $1',
      userId,
    ),
    idempotency_records: await count(
      "SELECT count(*) AS n FROM idempotency_records WHERE response_body->>'user_id' = $1::text",
      userId,
    ),
    login_failure_counters: await count(
      'SELECT count(*) AS n FROM login_failure_counters WHERE email_hash = $1',
      createHmac('sha256', h.emailPepper).update(email).digest(),
    ),
  };
}

describe('TS-028 conta pendente antiga', () => {
  it('30 dias depois do cadastro, ainda pendente: removida sem orfaos e sem tombstone', async () => {
    const userId = await pendingAccount('ana.silva@example.com', 'k-ana');
    const before = await leftovers(userId, 'ana.silva@example.com');
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    h.now = shift(30 * DAY_MS);
    expect(await sweep()).toMatchObject({ pendingRemoved: 1 });

    expect(await leftovers(userId, 'ana.silva@example.com')).toEqual({
      users: 0,
      verification_tokens: 0,
      outbox_events: 0,
      idempotency_records: 0,
      login_failure_counters: 0,
    });
    expect((await h.pool.query('SELECT 1 FROM purge_tombstones')).rowCount).toBe(0);
  });

  it('antes dos 30 dias a conta pendente fica', async () => {
    const userId = await pendingAccount('ana.silva@example.com', 'k-ana');
    h.now = shift(30 * DAY_MS - 1000);
    expect(await sweep()).toMatchObject({ pendingRemoved: 0 });
    expect((await leftovers(userId, 'ana.silva@example.com')).users).toBe(1);
  });

  it('conta verificada nunca e removida por idade', async () => {
    const userId = await pendingAccount('ana.silva@example.com', 'k-ana');
    await h.pool.query("UPDATE users SET status = 'ACTIVE', verified_at = $2 WHERE id = $1", [
      userId,
      NOW,
    ]);
    h.now = shift(400 * DAY_MS);
    expect(await sweep()).toMatchObject({ pendingRemoved: 0 });
    expect((await leftovers(userId, 'ana.silva@example.com')).users).toBe(1);
  });

  it('remove so a conta antiga; outra pendente recente e outro titular ficam', async () => {
    const old = await pendingAccount('ana.silva@example.com', 'k-ana');
    h.now = shift(20 * DAY_MS);
    const recent = await pendingAccount('bruno.costa@example.com', 'k-bruno');
    h.now = shift(30 * DAY_MS);
    expect(await sweep()).toMatchObject({ pendingRemoved: 1 });
    expect((await leftovers(old, 'ana.silva@example.com')).users).toBe(0);
    expect(await leftovers(recent, 'bruno.costa@example.com')).toMatchObject({
      users: 1,
      verification_tokens: 1,
      idempotency_records: 1,
      login_failure_counters: 1,
    });
  });

  it('o e-mail fica livre para novo cadastro (DEC-030 so vale com a conta existente)', async () => {
    await pendingAccount('ana.silva@example.com', 'k-ana');
    h.now = shift(30 * DAY_MS);
    await sweep();
    await pendingAccount('ana.silva@example.com', 'k-ana-2');
  });
});

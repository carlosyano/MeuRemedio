// @trace TS-033 RF-001 RF-002 RN-005 CA-004 ERR-004 DEC-016 createSession
// Bloqueio de login contra PostgreSQL 17 real: 5 falhas em 15 min por HMAC do e-mail normalizado,
// inclusive de e-mails inexistentes, bloqueiam por 15 min com 423 e Retry-After, sem enumerar conta.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, startHarness, type Harness } from '../integration/support/http.js';

const NOW = '2026-10-05T11:05:15Z';
const MINUTE = 60_000;
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
});

const at = (offsetMs: number): string => new Date(Date.parse(NOW) + offsetMs).toISOString();
const attempt = (email: string, password: string) =>
  h.call('createSession', 'POST', '/sessions', { body: { email, password } });

async function fail(email: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    expect((await attempt(email, 'Senha-Errada-2026')).status).toBe(401);
  }
}

describe('TS-033 bloqueio de login', () => {
  it('apos 5 falhas, a tentativa seguinte recebe 423 com Retry-After, mesmo com a senha certa', async () => {
    await h.activeUser('ana.silva@example.com');
    await fail('ana.silva@example.com', 5);
    h.now = at(MINUTE);
    const locked = await attempt('ana.silva@example.com', PASSWORD);
    expect(locked.status).toBe(423);
    expect(locked.body).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    expect(locked.headers['retry-after']).toBe('840');
    expect((await h.pool.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
  });

  it('e-mail inexistente bloqueia igual, sem revelar que a conta nao existe', async () => {
    await h.activeUser('ana.silva@example.com');
    await fail('ana.silva@example.com', 5);
    await fail('ninguem@example.com', 5);
    const existing = await attempt('ana.silva@example.com', PASSWORD);
    const missing = await attempt('ninguem@example.com', PASSWORD);
    expect(existing.status).toBe(423);
    expect(missing.status).toBe(423);
    expect(existing.headers['retry-after']).toBe(missing.headers['retry-after']);
  });

  it('o bloqueio dura 15 min a partir da 5a falha', async () => {
    await h.activeUser('ana.silva@example.com');
    await fail('ana.silva@example.com', 5);
    h.now = at(15 * MINUTE - 1_000);
    expect((await attempt('ana.silva@example.com', PASSWORD)).status).toBe(423);
    h.now = at(15 * MINUTE);
    expect((await attempt('ana.silva@example.com', PASSWORD)).status).toBe(201);
  });

  it('falhas espalhadas por mais de 15 min nao bloqueiam', async () => {
    await h.activeUser('ana.silva@example.com');
    await fail('ana.silva@example.com', 4);
    h.now = at(16 * MINUTE);
    await fail('ana.silva@example.com', 1);
    expect((await attempt('ana.silva@example.com', PASSWORD)).status).toBe(201);
  });

  it('login bem-sucedido zera as falhas (DC-024)', async () => {
    await h.activeUser('ana.silva@example.com');
    await fail('ana.silva@example.com', 4);
    expect((await attempt('ana.silva@example.com', PASSWORD)).status).toBe(201);
    await fail('ana.silva@example.com', 4);
    expect((await attempt('ana.silva@example.com', PASSWORD)).status).toBe(201);
  });

  it('a caixa do e-mail nao contorna o bloqueio', async () => {
    await h.activeUser('ana.silva@example.com');
    await fail('Ana.Silva@example.com', 3);
    await fail('ANA.SILVA@EXAMPLE.COM', 2);
    expect((await attempt('ana.silva@example.com', PASSWORD)).status).toBe(423);
  });

  it('o contador guarda so o HMAC do e-mail', async () => {
    await fail('ana.silva@example.com', 1);
    const rows = await h.pool.query<{ dump: string; email_hash: Buffer }>(
      'SELECT row_to_json(c)::text AS dump, email_hash FROM login_failure_counters c',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.email_hash).toHaveLength(32);
    expect(rows.rows[0]?.dump).not.toContain('ana.silva');
  });
});

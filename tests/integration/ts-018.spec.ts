// @trace TS-018 RF-001 RF-002 CA-003 ERR-013 createSession
// Limite de 3 sessoes ativas (ENT-004; DATA_MODEL: bloqueio do titular + contagem na mesma
// transacao) contra PostgreSQL 17 real: a 4a sessao recebe 409 SESSION_LIMIT_REACHED; sessoes
// revogadas ou expiradas nao contam; logins simultaneos nao passam do limite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, login, startHarness, type Harness } from './support/http.js';

const NOW = '2026-10-05T11:05:15Z';
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

const createSession = () =>
  h.call('createSession', 'POST', '/sessions', {
    body: { email: 'ana.silva@example.com', password: PASSWORD },
  });

const activeSessions = async (): Promise<number> =>
  Number(
    (
      await h.pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM sessions WHERE revoked_at IS NULL',
      )
    ).rows[0]?.n,
  );

describe('TS-018 quarta sessao', () => {
  it('com 2 sessoes, a 3a e criada e a 4a recebe 409 SESSION_LIMIT_REACHED', async () => {
    await h.activeUser('ana.silva@example.com');
    await login(h, 'ana.silva@example.com');
    await login(h, 'ana.silva@example.com');
    expect((await createSession()).status).toBe(201);
    const fourth = await createSession();
    expect(fourth.status).toBe(409);
    expect(fourth.body).toMatchObject({ code: 'SESSION_LIMIT_REACHED' });
    expect(fourth.cookies).toEqual([]);
    expect(await activeSessions()).toBe(3);
  });

  it('sessao encerrada libera uma vaga', async () => {
    await h.activeUser('ana.silva@example.com');
    const first = await login(h, 'ana.silva@example.com');
    await login(h, 'ana.silva@example.com');
    await login(h, 'ana.silva@example.com');
    await h.call('deleteCurrentSession', 'DELETE', '/sessions/current', {
      headers: first.mutation,
    });
    expect((await createSession()).status).toBe(201);
  });

  it('sessao expirada nao conta', async () => {
    await h.activeUser('ana.silva@example.com');
    for (let i = 0; i < 3; i += 1) await login(h, 'ana.silva@example.com');
    h.now = '2026-10-05T11:40:00Z';
    expect((await createSession()).status).toBe(201);
  });

  it('logins simultaneos criam no maximo 3 sessoes', async () => {
    await h.activeUser('ana.silva@example.com');
    const results = await Promise.all(Array.from({ length: 6 }, () => createSession()));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await activeSessions()).toBe(3);
  });
});

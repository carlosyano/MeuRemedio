// @trace TS-041 CA-018 RF-002 ERR-015 deleteCurrentSession (ADR-001 v1.5 OA-008)
// CSRF nas mutacoes autenticadas contra PostgreSQL 17 real: double-submit (cookie mr_csrf +
// X-CSRF-Token com HMAC vinculado a sessao) e validacao de Origin (ou Sec-Fetch-Site). Falha:
// 403 CSRF_VALIDATION_FAILED sem efeito. Nesta etapa, deleteCurrentSession e a unica mutacao
// autenticada implementada; as demais entram com seus modulos.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, startHarness, type Harness, type LoggedIn } from '../integration/support/http.js';

let h: Harness;

/** Cabecalhos sem o Origin. */
const withoutOrigin = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'origin'));

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.truncate();
});

const logout = (headers: Record<string, string>) =>
  h.call('deleteCurrentSession', 'DELETE', '/sessions/current', { headers });

const revoked = async (session: LoggedIn): Promise<boolean> =>
  (
    await h.pool.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE id = $1',
      [session.sessionId],
    )
  ).rows[0]?.revoked ?? false;

let sequence = 0;
async function session(): Promise<LoggedIn> {
  sequence += 1;
  const email = `ana.silva+${String(sequence)}@example.com`;
  await h.activeUser(email);
  return login(h, email);
}

describe('TS-041 CSRF em deleteCurrentSession', () => {
  it('mutacao com cookie, X-CSRF-Token e Origin validos passa', async () => {
    const s = await session();
    expect((await logout(s.mutation)).status).toBe(204);
  });

  it.each([
    [
      'sem X-CSRF-Token',
      (s: LoggedIn) => ({ cookie: s.read['cookie'] ?? '', origin: s.mutation['origin'] ?? '' }),
    ],
    [
      'X-CSRF-Token errado',
      (s: LoggedIn) => ({ ...s.mutation, 'x-csrf-token': 'AAAA' + s.csrf.slice(4) }),
    ],
    [
      'sem cookie mr_csrf',
      (s: LoggedIn) => ({ ...s.mutation, cookie: `mr_session=${s.sessionCookie}` }),
    ],
    ['Origin nao permitida', (s: LoggedIn) => ({ ...s.mutation, origin: 'https://evil.example' })],
    ['sem Origin e sem Sec-Fetch-Site', (s: LoggedIn) => withoutOrigin(s.mutation)],
    [
      'sem Origin e Sec-Fetch-Site cross-site',
      (s: LoggedIn) => ({ ...withoutOrigin(s.mutation), 'sec-fetch-site': 'cross-site' }),
    ],
  ])('%s: 403 CSRF_VALIDATION_FAILED sem efeito', async (_nome, headersFor) => {
    const s = await session();
    const response = await logout(headersFor(s));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    expect(await revoked(s)).toBe(false);
  });

  it('token CSRF de outra sessao nao serve', async () => {
    const a = await session();
    const b = await session();
    const response = await logout({
      ...a.mutation,
      'x-csrf-token': b.csrf,
      cookie: `mr_session=${a.sessionCookie}; mr_csrf=${b.csrf}`,
    });
    expect(response.status).toBe(403);
    expect(await revoked(a)).toBe(false);
  });

  it('sem Origin, Sec-Fetch-Site same-origin e aceito', async () => {
    const s = await session();
    expect(
      (await logout({ ...withoutOrigin(s.mutation), 'sec-fetch-site': 'same-origin' })).status,
    ).toBe(204);
  });

  it('sem sessao, a resposta e 401 antes da verificacao de CSRF', async () => {
    expect((await logout({ origin: 'https://evil.example' })).status).toBe(401);
  });

  it.todo('as demais 10 mutacoes autenticadas (CA-018) entram com seus modulos');
});

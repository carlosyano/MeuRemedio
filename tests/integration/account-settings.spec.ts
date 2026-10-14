// @trace DEC-032 RF-001 RF-002 RF-009 RN-005 CA-015 TS-015 TS-022 TS-038 TS-044 ERR-002 ERR-006 updateCurrentAccount getAccessibilityPreferences updateAccessibilityPreferences revokeAllSessions
// Conta, preferencias e revogacao global por HTTP contra PostgreSQL 17 real: so o nome da conta
// muda (fuso imutavel, RN-013); preferencias de acessibilidade substituidas por inteiro (RF-009);
// revokeAllSessions exige a senha e a Idempotency-Key, recusa senha errada sem revogar e revoga
// todas as sessoes, inclusive a atual (TS-044), com o replay apos a revogacao em 401 (TS-038);
// falhas de reautenticacao entram no bloqueio do login (DC-043).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, login, startHarness, type Harness, type LoggedIn } from './support/http.js';

const NOW = '2026-10-05T11:05:15Z';
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

let ana: LoggedIn;
let anaId: string;
let bruno: LoggedIn;

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  anaId = await h.activeUser('ana.silva@example.com');
  await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

const at = (offsetMs: number): string =>
  new Date(Date.parse(NOW) + offsetMs).toISOString().replace('.000Z', 'Z');

describe('updateCurrentAccount (RF-001, CA-015)', () => {
  const update = (body: unknown, session: LoggedIn = ana) =>
    h.call('updateCurrentAccount', 'PUT', '/accounts/me', { body, headers: session.mutation });

  it('200 com o perfil e o nome novo sem espacos nas pontas; fuso e e-mail intactos', async () => {
    const response = await update({ name: '  Ana Souza  ' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user_id: anaId,
      name: 'Ana Souza',
      email: 'ana.silva@example.com',
      account_timezone: 'America/Sao_Paulo',
    });
    const me = await h.call('getCurrentAccount', 'GET', '/accounts/me', { headers: ana.read });
    expect(me.body).toMatchObject({ name: 'Ana Souza' });
    const row = await h.pool.query<{ row_version: string }>(
      'SELECT row_version FROM users WHERE id = $1',
      [anaId],
    );
    expect(row.rows[0]?.row_version).toBe('2');
  });

  it('nome so com espacos: 400 VALIDATION_FAILED em name', async () => {
    const response = await update({ name: '   ' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'name' }] });
  });

  it('fuso no corpo: 400 (o fuso e imutavel no MVP)', async () => {
    const response = await update({ name: 'Ana', account_timezone: 'Europe/Lisbon' });
    expect(response.status).toBe(400);
  });

  it('nao altera a conta de outro titular', async () => {
    await update({ name: 'Bruno Alterado' }, bruno);
    const me = await h.call('getCurrentAccount', 'GET', '/accounts/me', { headers: ana.read });
    expect(me.body).toMatchObject({ name: 'Ana Silva' });
  });
});

describe('preferencias de acessibilidade (RF-009, TS-022)', () => {
  const get = (session: LoggedIn = ana) =>
    h.call('getAccessibilityPreferences', 'GET', '/preferences/accessibility', {
      headers: session.read,
    });
  const put = (body: unknown, session: LoggedIn = ana) =>
    h.call('updateAccessibilityPreferences', 'PUT', '/preferences/accessibility', {
      body,
      headers: session.mutation,
    });

  it('padrao: texto 100% e sem alto contraste', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ text_scale: 100, high_contrast: false });
  });

  it('substitui as duas preferencias e as devolve', async () => {
    const response = await put({ text_scale: 175, high_contrast: true });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ text_scale: 175, high_contrast: true });
    expect((await get()).body).toEqual({ text_scale: 175, high_contrast: true });
    expect((await get(bruno)).body).toEqual({ text_scale: 100, high_contrast: false });
  });

  it.each([
    ['escala fora da lista', { text_scale: 130, high_contrast: false }],
    ['campo ausente', { text_scale: 150 }],
  ])('%s: 400 VALIDATION_FAILED sem alterar', async (_caso, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect((await get()).body).toEqual({ text_scale: 100, high_contrast: false });
  });
});

describe('revokeAllSessions (RF-002, TS-044)', () => {
  const revokeAll = (session: LoggedIn, password: string, key: string | null = 'k-1') =>
    h.call('revokeAllSessions', 'POST', '/sessions/revocations', {
      body: { password },
      headers: key === null ? session.mutation : { ...session.mutation, 'idempotency-key': key },
    });

  const active = async (userId: string): Promise<number> =>
    Number(
      (
        await h.pool.query<{ n: string }>(
          'SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
          [userId],
        )
      ).rows[0]?.n,
    );

  it('senha correta: 204, limpa os cookies e revoga todas as sessoes do titular (REVOKE_ALL)', async () => {
    const other = await login(h, 'ana.silva@example.com');
    const response = await revokeAll(ana, PASSWORD);
    expect(response.status).toBe(204);
    expect(
      response.cookies.some((c) => c.startsWith('mr_session=;') && c.includes('Max-Age=0')),
    ).toBe(true);
    expect(await active(anaId)).toBe(0);
    const reasons = await h.pool.query<{ revoked_reason: string }>(
      'SELECT DISTINCT revoked_reason FROM sessions WHERE user_id = $1',
      [anaId],
    );
    expect(reasons.rows).toEqual([{ revoked_reason: 'REVOKE_ALL' }]);
    for (const session of [ana, other]) {
      const me = await h.call('getCurrentAccount', 'GET', '/accounts/me', {
        headers: session.read,
      });
      expect(me.status).toBe(401);
    }
    const brunoMe = await h.call('getCurrentAccount', 'GET', '/accounts/me', {
      headers: bruno.read,
    });
    expect(brunoMe.status).toBe(200);
  });

  it('senha errada: 401 sem revogar nenhuma sessao', async () => {
    const response = await revokeAll(ana, 'senha-errada');
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(await active(anaId)).toBe(1);
  });

  it('DC-043: 5 senhas erradas bloqueiam a reautenticacao e o login por 15 min', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await revokeAll(ana, `errada-${String(i)}`, `k-e${String(i)}`)).status).toBe(401);
    }
    const blocked = await revokeAll(ana, PASSWORD, 'k-certa');
    expect(blocked.status).toBe(401);
    expect(await active(anaId)).toBe(1);
    const loginAttempt = await h.call('createSession', 'POST', '/sessions', {
      body: { email: 'ana.silva@example.com', password: PASSWORD },
    });
    expect(loginAttempt.status).toBe(423);
    h.now = at(15 * 60_000 + 1000);
    expect((await revokeAll(ana, PASSWORD, 'k-depois')).status).toBe(204);
  });

  it('TS-038 passo 4: sem Idempotency-Key: 400 sem revogar (DEC-032)', async () => {
    const response = await revokeAll(ana, PASSWORD, null);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'Idempotency-Key' }] });
    expect(await active(anaId)).toBe(1);
  });

  it('corpo sem senha: 400 sem revogar (DEC-032)', async () => {
    const response = await h.call('revokeAllSessions', 'POST', '/sessions/revocations', {
      body: {},
      headers: { ...ana.mutation, 'idempotency-key': 'k-sem-senha' },
    });
    expect(response.status).toBe(400);
    expect(await active(anaId)).toBe(1);
  });

  it('TS-038 passos 2, 3, 5 e 6: replay, payload divergente, expiracao e replay apos a revogacao', async () => {
    expect((await revokeAll(ana, PASSWORD, 'kx')).status).toBe(204);
    // Passo 6: a sessao revogada repete a chamada -> 401 (a autenticacao vem antes).
    expect((await revokeAll(ana, PASSWORD, 'kx')).status).toBe(401);
    // Passo 2: nova sessao, mesma chave e mesmo payload -> snapshot, sem nova revogacao.
    const again = await login(h, 'ana.silva@example.com');
    expect((await revokeAll(again, PASSWORD, 'kx')).status).toBe(204);
    expect(await active(anaId)).toBe(1);
    // Passo 3: mesma chave com payload divergente -> 409.
    const divergent = await revokeAll(again, 'outra-senha', 'kx');
    expect(divergent.status).toBe(409);
    expect(divergent.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await active(anaId)).toBe(1);
    // Passo 5: 7 dias + 1 s depois, a chave e nova e revoga de novo.
    h.now = at(7 * 24 * 3_600_000 + 1000);
    const later = await login(h, 'ana.silva@example.com');
    expect((await revokeAll(later, PASSWORD, 'kx')).status).toBe(204);
    expect(await active(anaId)).toBe(0);
  });
});

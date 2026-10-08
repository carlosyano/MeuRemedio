// @trace RF-002 CA-015 RN-005 ERR-002 createSession deleteCurrentSession getCurrentAccount
// Sessao server-side (ADR-001 v1.5 secao 7 e OA-008) contra PostgreSQL 17 real: login com cookies
// mr_session (HttpOnly) e mr_csrf, falhas indistinguiveis (401), expiracao por inatividade (30 min,
// deslizante) e absoluta (24 h), logout que revoga e limpa os cookies, e leitura autenticada.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  cookieAttributes,
  cookieValue,
  login,
  startHarness,
  type Harness,
} from './support/http.js';

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

const at = (offsetMs: number): string => new Date(Date.parse(NOW) + offsetMs).toISOString();
const MINUTE = 60_000;

const createSession = (email: string, password: string) =>
  h.call('createSession', 'POST', '/sessions', { body: { email, password } });
const me = (headers: Record<string, string>) =>
  h.call('getCurrentAccount', 'GET', '/accounts/me', { headers });
const logout = (headers: Record<string, string>) =>
  h.call('deleteCurrentSession', 'DELETE', '/sessions/current', { headers });

/** Corpo do Problem sem os campos que variam por requisicao. */
const stable = (body: unknown): unknown => {
  const { correlation_id: _c, ...rest } = body as Record<string, unknown>;
  return rest;
};

describe('createSession', () => {
  it('201 com Session, expiracoes de 30 min e 24 h, e cookies com os atributos do OA-008', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    const response = await createSession('ANA.SILVA@example.com', PASSWORD);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      session_id: expect.any(String) as unknown,
      idle_expires_at: '2026-10-05T11:35:15.000Z',
      absolute_expires_at: '2026-10-06T11:05:15.000Z',
    });
    expect(cookieAttributes(response.cookies, 'mr_session').sort()).toEqual(
      ['httponly', 'max-age=86400', 'path=/', 'samesite=lax', 'secure'].sort(),
    );
    expect(cookieAttributes(response.cookies, 'mr_csrf').sort()).toEqual(
      ['max-age=86400', 'path=/', 'samesite=lax', 'secure'].sort(),
    );
    const secret = cookieValue(response.cookies, 'mr_session') ?? '';
    expect(secret.length).toBeGreaterThanOrEqual(43);
    const stored = await h.pool.query<{ user_id: string; secret_hash: Buffer }>(
      'SELECT user_id, secret_hash FROM sessions',
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.user_id).toBe(userId);
    expect(stored.rows[0]?.secret_hash.equals(createHash('sha256').update(secret).digest())).toBe(
      true,
    );
  });

  it('senha errada, e-mail inexistente e conta nao verificada: o mesmo 401', async () => {
    await h.activeUser('ana.silva@example.com');
    await h.pool.query(
      `INSERT INTO users (name, email_normalized, password_hash, account_timezone, terms_version,
         privacy_notice_version, terms_accepted_at, privacy_acknowledged_at)
       SELECT 'Bruno Costa', 'bruno.costa@example.com', password_hash, 'America/Sao_Paulo', '2026-10',
              '2026-10', now(), now() FROM users WHERE email_normalized = 'ana.silva@example.com'`,
    );
    const wrong = await createSession('ana.silva@example.com', 'Outra-Senha-2026');
    const missing = await createSession('ninguem@example.com', PASSWORD);
    const pending = await createSession('bruno.costa@example.com', PASSWORD);
    for (const response of [wrong, missing, pending]) {
      expect(response.status).toBe(401);
      expect(response.cookies).toEqual([]);
    }
    expect(stable(wrong.body)).toEqual(stable(missing.body));
    expect(stable(wrong.body)).toEqual(stable(pending.body));
    expect(wrong.body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED', instance: '/sessions' });
    expect((await h.pool.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
  });
});

describe('getCurrentAccount', () => {
  it('200 com o perfil do titular autenticado', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    const response = await me(session.read);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user_id: userId,
      name: 'Ana Silva',
      email: 'ana.silva@example.com',
      status: 'ACTIVE',
      account_timezone: 'America/Sao_Paulo',
      created_at: expect.any(String) as unknown,
    });
  });

  it.each([
    ['sem cookie', {}],
    ['cookie desconhecido', { cookie: 'mr_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['cookie malformado', { cookie: 'mr_session=%%%' }],
  ])('%s: 401 AUTHENTICATION_REQUIRED', async (_nome, headers) => {
    const response = await me(headers);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
});

describe('expiracao da sessao', () => {
  it('30 min sem atividade: 401', async () => {
    await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    h.now = at(30 * MINUTE);
    expect((await me(session.read)).status).toBe(401);
  });

  it('atividade antes de 30 min estende a inatividade (deslizante)', async () => {
    await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    h.now = at(20 * MINUTE);
    expect((await me(session.read)).status).toBe(200);
    h.now = at(45 * MINUTE);
    expect((await me(session.read)).status).toBe(200);
    const row = await h.pool.query<{ idle_expires_at: Date; last_activity_at: Date }>(
      'SELECT idle_expires_at, last_activity_at FROM sessions',
    );
    expect(row.rows[0]?.last_activity_at.toISOString()).toBe(at(45 * MINUTE));
    expect(row.rows[0]?.idle_expires_at.toISOString()).toBe(at(75 * MINUTE));
  });

  it('a atividade e gravada no maximo 1 vez por minuto (DC-025)', async () => {
    await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    h.now = at(30_000);
    await me(session.read);
    const row = await h.pool.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM sessions',
    );
    expect(row.rows[0]?.last_activity_at.toISOString()).toBe(at(0));
  });

  it('24 h de duracao absoluta, mesmo com atividade continua', async () => {
    await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    for (let minutes = 25; minutes < 24 * 60; minutes += 25) {
      h.now = at(minutes * MINUTE);
      expect((await me(session.read)).status).toBe(200);
    }
    h.now = at(24 * 60 * MINUTE);
    expect((await me(session.read)).status).toBe(401);
  });

  it('conta que deixou de ser ACTIVE perde o acesso', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    await h.pool.query(
      `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = now(),
              purge_due_at = now() + interval '30 days' WHERE id = $1`,
      [userId],
    );
    expect((await me(session.read)).status).toBe(401);
  });
});

describe('deleteCurrentSession', () => {
  it('204, revoga a sessao (LOGOUT) e limpa os dois cookies', async () => {
    await h.activeUser('ana.silva@example.com');
    const session = await login(h, 'ana.silva@example.com');
    const response = await logout(session.mutation);
    expect(response.status).toBe(204);
    for (const name of ['mr_session', 'mr_csrf']) {
      expect(cookieValue(response.cookies, name)).toBe('');
      expect(cookieAttributes(response.cookies, name)).toContain('max-age=0');
    }
    const row = await h.pool.query<{ revoked_reason: string; revoked_at: Date }>(
      'SELECT revoked_reason, revoked_at FROM sessions',
    );
    expect(row.rows[0]).toMatchObject({ revoked_reason: 'LOGOUT' });
    expect(row.rows[0]?.revoked_at.toISOString()).toBe(at(0));
    expect((await me(session.read)).status).toBe(401);
  });

  it('sem sessao valida: 401', async () => {
    expect((await logout({})).status).toBe(401);
  });

  it('as demais sessoes do titular continuam validas', async () => {
    await h.activeUser('ana.silva@example.com');
    const first = await login(h, 'ana.silva@example.com');
    const second = await login(h, 'ana.silva@example.com');
    await logout(first.mutation);
    expect((await me(second.read)).status).toBe(200);
  });
});

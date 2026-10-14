// @trace RF-002 RN-017 TS-009 ERR-007 ERR-008 ENT-003 requestPasswordReset confirmPasswordReset
// Redefinicao de senha contra PostgreSQL 17 real (DC-044): o pedido responde de forma neutra e grava
// identity.password_reset_requested no Outbox; o worker emite o token (60 min, so o hash e
// persistido) e envia o e-mail; a confirmacao troca a senha, consome o token e revoga todas as
// sessoes da conta. Token usado, expirado, substituido ou desconhecido: 410 sem efeito (TS-009).
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RESET_MESSAGE,
  handlePasswordResetRequested,
} from '../../apps/api/src/modules/identity/application/request-password-reset.js';
import type { Clock } from '../../apps/api/src/platform/clock.js';
import type { EmailMessage, EmailSender } from '../../apps/api/src/platform/email/email-sender.js';
import { PASSWORD, login, startHarness, type Harness } from './support/http.js';

const WEB = 'https://app.example.invalid';
const NEW_PASSWORD = 'Outra-Senha-Sintetica-77';

class FakeEmail implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNext = false;
  send(message: EmailMessage): Promise<undefined> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('provedor indisponivel'));
    }
    this.sent.push(message);
    return Promise.resolve(undefined);
  }
}

let h: Harness;
let email: FakeEmail;
const clock: Clock = { now: () => h.now };

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = '2026-10-05T11:05:15Z';
  email = new FakeEmail();
  await h.truncate();
});

const requestReset = (address: string) =>
  h.call('requestPasswordReset', 'POST', '/password-reset-requests', { body: { email: address } });

const confirmReset = (token: string, password = NEW_PASSWORD) =>
  h.call('confirmPasswordReset', 'POST', '/password-resets', {
    body: { token, new_password: password },
  });

const pendingEvents = async () =>
  (
    await h.pool.query<{ id: string; payload: { user_id: string } }>(
      `SELECT id, payload FROM outbox_events
        WHERE event_type = 'identity.password_reset_requested' AND dispatched_at IS NULL
        ORDER BY created_at`,
    )
  ).rows;

/** Processa os eventos pendentes chamando o consumidor diretamente. */
async function runPendingResets(): Promise<void> {
  for (const event of await pendingEvents()) {
    await handlePasswordResetRequested(
      { pool: h.pool, clock, email, webBaseUrl: WEB },
      { event_id: event.id, user_id: event.payload.user_id },
    );
    await h.pool.query('UPDATE outbox_events SET dispatched_at = now() WHERE id = $1', [event.id]);
  }
}

/** Token do ultimo e-mail enviado (fragmento #token= do link). */
function lastToken(): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(email.sent.at(-1)?.text ?? '');
  if (!match?.[1]) throw new Error('e-mail sem token');
  return match[1];
}

/** Conta ACTIVE com um token de redefinicao emitido; devolve o id e o token. */
async function issuedToken(address = 'ana.silva@example.com') {
  const userId = await h.activeUser(address);
  await requestReset(address);
  await runPendingResets();
  return { userId, token: lastToken() };
}

const passwordHash = async (userId: string) =>
  (
    await h.pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
      userId,
    ])
  ).rows[0]?.password_hash;

const createSession = (address: string, password: string) =>
  h.call('createSession', 'POST', '/sessions', { body: { email: address, password } });

describe('requestPasswordReset (RF-002)', () => {
  it('conta ACTIVE: 202 neutro e evento no Outbox, sem token ainda', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    const response = await requestReset('ana.silva@example.com');
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ message: RESET_MESSAGE });
    const events = await pendingEvents();
    expect(events.map((event) => event.payload)).toEqual([{ user_id: userId }]);
    expect((await h.pool.query('SELECT 1 FROM password_reset_tokens')).rowCount).toBe(0);
  });

  it('e-mail normalizado: maiusculas e espacos nas pontas', async () => {
    await h.activeUser('ana.silva@example.com');
    expect((await requestReset('  Ana.Silva@Example.com ')).status).toBe(202);
    expect(await pendingEvents()).toHaveLength(1);
  });

  it('e-mail sem conta: mesma resposta e nenhum efeito', async () => {
    const response = await requestReset('bruno.costa@example.com');
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ message: RESET_MESSAGE });
    expect(await pendingEvents()).toEqual([]);
  });

  it('conta PENDING_VERIFICATION ou DELETION_SCHEDULED: mesma resposta e nenhum efeito (DC-044)', async () => {
    const pending = await h.activeUser('ana.silva@example.com');
    await h.pool.query(
      "UPDATE users SET status = 'PENDING_VERIFICATION', verified_at = NULL WHERE id = $1",
      [pending],
    );
    const scheduled = await h.activeUser('bruno.costa@example.com');
    await h.pool.query(
      `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = now(),
              purge_due_at = now() + interval '30 days' WHERE id = $1`,
      [scheduled],
    );
    for (const address of ['ana.silva@example.com', 'bruno.costa@example.com']) {
      const response = await requestReset(address);
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ message: RESET_MESSAGE });
    }
    expect(await pendingEvents()).toEqual([]);
  });

  it('novo pedido invalida o token anterior ja na requisicao (RN-017)', async () => {
    const { token } = await issuedToken();
    await requestReset('ana.silva@example.com');
    const response = await confirmReset(token);
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});

describe('emissao do token pelo worker', () => {
  it('envia 1 e-mail com link de redefinicao e guarda so o hash, com validade de 60 min', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    await requestReset('ana.silva@example.com');
    await runPendingResets();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe('ana.silva@example.com');
    expect(email.sent[0]?.text).toContain(`${WEB}/conta/redefinir-senha#token=`);
    const token = lastToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    const rows = await h.pool.query<{ token_hash: Buffer; issued_at: Date; expires_at: Date }>(
      'SELECT token_hash, issued_at, expires_at FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.token_hash.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(rows.rows[0]?.issued_at.toISOString()).toBe('2026-10-05T11:05:15.000Z');
    expect(rows.rows[0]?.expires_at.toISOString()).toBe('2026-10-05T12:05:15.000Z');
    const stored = await h.pool.query<{ dump: string }>(
      'SELECT row_to_json(t)::text AS dump FROM password_reset_tokens t',
    );
    expect(stored.rows[0]?.dump).not.toContain(token);
  });

  it('conta que deixou de estar ACTIVE nao recebe token nem e-mail', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    await requestReset('ana.silva@example.com');
    await h.pool.query(
      `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = now(),
              purge_due_at = now() + interval '30 days' WHERE id = $1`,
      [userId],
    );
    await runPendingResets();
    expect(email.sent).toEqual([]);
    expect((await h.pool.query('SELECT 1 FROM password_reset_tokens')).rowCount).toBe(0);
  });

  it('falha no envio propaga o erro (o pg-boss refaz) e a nova tentativa substitui o token', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    await requestReset('ana.silva@example.com');
    email.failNext = true;
    await expect(runPendingResets()).rejects.toThrow(/provedor/);
    await runPendingResets();
    expect(email.sent).toHaveLength(1);
    const open = await h.pool.query(
      'SELECT 1 FROM password_reset_tokens WHERE user_id = $1 AND superseded_at IS NULL',
      [userId],
    );
    expect(open.rowCount).toBe(1);
  });
});

describe('confirmPasswordReset (RF-002, TS-009)', () => {
  it('token valido: 204, senha trocada, token consumido e sessoes revogadas', async () => {
    const { userId, token } = await issuedToken();
    const session = await login(h, 'ana.silva@example.com');
    h.now = '2026-10-05T11:30:00Z';
    expect((await confirmReset(token)).status).toBe(204);

    expect((await createSession('ana.silva@example.com', PASSWORD)).status).toBe(401);
    expect((await createSession('ana.silva@example.com', NEW_PASSWORD)).status).toBe(201);
    const revoked = await h.pool.query<{ revoked_reason: string; revoked_at: Date }>(
      'SELECT revoked_reason, revoked_at FROM sessions WHERE id = $1',
      [session.sessionId],
    );
    expect(revoked.rows[0]?.revoked_reason).toBe('PASSWORD_RESET');
    expect(revoked.rows[0]?.revoked_at.toISOString()).toBe('2026-10-05T11:30:00.000Z');
    const me = await h.call('getCurrentAccount', 'GET', '/accounts/me', { headers: session.read });
    expect(me.status).toBe(401);
    const used = await h.pool.query<{ used_at: Date }>(
      'SELECT used_at FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
    expect(used.rows[0]?.used_at.toISOString()).toBe('2026-10-05T11:30:00.000Z');
  });

  it('nova senha guardada como Argon2id, nunca em claro', async () => {
    const { userId, token } = await issuedToken();
    await confirmReset(token);
    const hash = await passwordHash(userId);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(NEW_PASSWORD);
  });

  it('libera o bloqueio de login da conta (RN-005)', async () => {
    const { token } = await issuedToken();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await createSession('ana.silva@example.com', 'Senha-Errada-2026');
    }
    expect((await createSession('ana.silva@example.com', PASSWORD)).status).toBe(423);
    expect((await confirmReset(token)).status).toBe(204);
    expect((await createSession('ana.silva@example.com', NEW_PASSWORD)).status).toBe(201);
  });

  it('token ja usado: 410 TOKEN_EXPIRED e senha preservada (TS-009)', async () => {
    const { userId, token } = await issuedToken();
    await confirmReset(token);
    const before = await passwordHash(userId);
    const response = await confirmReset(token, 'Terceira-Senha-Sintetica-9');
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(await passwordHash(userId)).toBe(before);
  });

  it('token expirado (60 min): 410 TOKEN_EXPIRED sem efeito (TS-009)', async () => {
    const { userId, token } = await issuedToken();
    const before = await passwordHash(userId);
    h.now = '2026-10-05T12:05:15Z';
    const response = await confirmReset(token);
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(await passwordHash(userId)).toBe(before);
  });

  it('um instante antes do fim da validade ainda vale', async () => {
    const { token } = await issuedToken();
    h.now = '2026-10-05T12:05:14Z';
    expect((await confirmReset(token)).status).toBe(204);
  });

  it('token desconhecido: 410 TOKEN_EXPIRED', async () => {
    const response = await confirmReset(randomBytes(32).toString('base64url'));
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('token de verificacao de conta nao serve para redefinir a senha', async () => {
    const userId = await h.activeUser('ana.silva@example.com');
    const token = randomBytes(32).toString('base64url');
    await h.pool.query(
      `INSERT INTO verification_tokens (user_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, '2026-10-05T11:00:00Z', '2026-10-06T11:00:00Z')`,
      [userId, createHash('sha256').update(token).digest()],
    );
    expect((await confirmReset(token)).status).toBe(410);
  });

  it('conta fora de ACTIVE com token valido: 409 STATE_CONFLICT e token preservado', async () => {
    const { userId, token } = await issuedToken();
    await h.pool.query(
      `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = now(),
              purge_due_at = now() + interval '30 days' WHERE id = $1`,
      [userId],
    );
    const response = await confirmReset(token);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
    const open = await h.pool.query(
      'SELECT 1 FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
    expect(open.rowCount).toBe(1);
  });

  it('confirmacoes simultaneas do mesmo token: uma 204 e as demais 410', async () => {
    const { token } = await issuedToken();
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        confirmReset(token, `Senha-Paralela-${String(index)}A`),
      ),
    );
    expect(results.filter((result) => result.status === 204)).toHaveLength(1);
    expect(results.filter((result) => result.status === 410)).toHaveLength(3);
  });

  it('senha fora do padrao do contrato: 400 em new_password sem consumir o token', async () => {
    const { userId, token } = await issuedToken();
    const response = await confirmReset(token, 'semmaiuscula1');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'new_password' }] });
    const open = await h.pool.query(
      'SELECT 1 FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
    expect(open.rowCount).toBe(1);
  });
});

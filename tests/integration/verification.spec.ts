// @trace RF-001 CA-001 CA-002 TS-009 TS-021 RN-017 ERR-007 ERR-008 verifyAccount resendVerification
// Ciclo de verificacao de conta contra PostgreSQL 17 real e pg-boss: o worker consome
// identity.verification_requested, emite o token (so o hash e persistido) e envia o e-mail (DC-008,
// DC-020, DC-021); verifyAccount ativa a conta de forma atomica e idempotente (DC-019);
// resendVerification responde de forma neutra e invalida o token anterior (TS-021).
import { createHash, randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { handleVerificationRequested } from '../../apps/api/src/modules/identity/application/issue-verification.js';
import type { Clock } from '../../apps/api/src/platform/clock.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../apps/api/src/platform/contract/openapi-contract.js';
import type { EmailMessage, EmailSender } from '../../apps/api/src/platform/email/email-sender.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startWorker } from '../../apps/api/src/worker.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

const NOW = '2026-10-05T11:05:15Z';
const WEB = 'https://app.example.invalid';
const contract = OpenApiContract.load(locateNormativeOpenApi());
let currentNow = NOW;
const clock: Clock = { now: () => currentNow };

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

let db: PostgresHandle;
let pool: pg.Pool;
let app: NestFastifyApplication;
let email: FakeEmail;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
  await migrate(pool);
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
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  currentNow = NOW;
  email = new FakeEmail();
  await pool.query(
    'TRUNCATE users, idempotency_records, outbox_events, rate_limit_counters CASCADE',
  );
});

let sequence = 0;
const nextIp = (): string => `198.51.100.${String((sequence % 200) + 1)}`;

async function call(operationId: string, method: 'POST', url: string, body: unknown) {
  sequence += 1;
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { 'content-type': 'application/json', 'idempotency-key': `k-${String(sequence)}` },
      remoteAddress: nextIp(),
      payload: JSON.stringify(body),
    });
  const result = {
    status: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
    ),
    body: response.body === '' ? undefined : response.json<unknown>(),
  };
  expect(contract.validateResponse(operationId, result), JSON.stringify(result.body)).toEqual([]);
  return result;
}

async function createAccount(address = 'ana.silva@example.com'): Promise<string> {
  const response = await call('createAccount', 'POST', '/accounts', {
    name: 'Ana Silva',
    email: address,
    password: 'Senha-Sintetica-2026',
    account_timezone: 'America/Sao_Paulo',
    terms_version: '2026-10',
    privacy_notice_version: '2026-10',
    terms_accepted: true,
    privacy_notice_acknowledged: true,
  });
  expect(response.status).toBe(201);
  return (response.body as { user_id: string }).user_id;
}

/** Processa os eventos pendentes do Outbox chamando o consumidor diretamente. */
async function runPendingVerifications(): Promise<void> {
  const events = await pool.query<{ id: string; payload: { user_id: string } }>(
    `SELECT id, payload FROM outbox_events
      WHERE event_type = 'identity.verification_requested' AND dispatched_at IS NULL
      ORDER BY created_at`,
  );
  for (const event of events.rows) {
    await handleVerificationRequested(
      { pool, clock, email, webBaseUrl: WEB },
      { event_id: event.id, user_id: event.payload.user_id },
    );
    await pool.query('UPDATE outbox_events SET dispatched_at = now() WHERE id = $1', [event.id]);
  }
}

/** Token do ultimo e-mail enviado (fragmento #token= do link). */
function lastToken(): string {
  const message = email.sent.at(-1);
  const match = /#token=([A-Za-z0-9_-]+)/.exec(message?.text ?? '');
  if (!match?.[1]) throw new Error('e-mail sem token');
  return match[1];
}

const verify = (token: string) => call('verifyAccount', 'POST', '/accounts/verify', { token });
const resend = (address: string) =>
  call('resendVerification', 'POST', '/accounts/verification-resends', { email: address });

const userRow = async (id: string) =>
  (
    await pool.query<{ status: string; verified_at: Date | null }>(
      'SELECT status, verified_at FROM users WHERE id = $1',
      [id],
    )
  ).rows[0];

describe('emissao do token pelo worker (DC-008)', () => {
  it('envia 1 e-mail ao titular com link de verificacao e guarda so o hash do token', async () => {
    const userId = await createAccount();
    await runPendingVerifications();
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0];
    expect(message?.to).toBe('ana.silva@example.com');
    expect(message?.text).toContain(`${WEB}/conta/verificar#token=`);
    const token = lastToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    const rows = await pool.query<{ token_hash: Buffer; expires_at: Date; issued_at: Date }>(
      'SELECT token_hash, issued_at, expires_at FROM verification_tokens WHERE user_id = $1',
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.token_hash.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(rows.rows[0]?.issued_at.toISOString()).toBe('2026-10-05T11:05:15.000Z');
    expect(rows.rows[0]?.expires_at.toISOString()).toBe('2026-10-06T11:05:15.000Z');
    const stored = await pool.query<{ dump: string }>(
      'SELECT row_to_json(t)::text AS dump FROM verification_tokens t',
    );
    expect(stored.rows[0]?.dump).not.toContain(token);
  });

  it('conta que ja nao esta pendente nao recebe token nem e-mail', async () => {
    const userId = await createAccount();
    await pool.query("UPDATE users SET status = 'ACTIVE', verified_at = now() WHERE id = $1", [
      userId,
    ]);
    await runPendingVerifications();
    expect(email.sent).toEqual([]);
    expect((await pool.query('SELECT 1 FROM verification_tokens')).rowCount).toBe(0);
  });

  it('falha no envio propaga o erro (o pg-boss refaz) e a nova tentativa substitui o token', async () => {
    const userId = await createAccount();
    email.failNext = true;
    await expect(runPendingVerifications()).rejects.toThrow(/provedor/);
    await runPendingVerifications();
    expect(email.sent).toHaveLength(1);
    const open = await pool.query(
      'SELECT 1 FROM verification_tokens WHERE user_id = $1 AND superseded_at IS NULL',
      [userId],
    );
    expect(open.rowCount).toBe(1);
  });
});

describe('verifyAccount (CA-002, TS-009)', () => {
  it('token valido: 204 e conta ACTIVE com verified_at', async () => {
    const userId = await createAccount();
    await runPendingVerifications();
    currentNow = '2026-10-05T12:00:00Z';
    expect((await verify(lastToken())).status).toBe(204);
    const user = await userRow(userId);
    expect(user?.status).toBe('ACTIVE');
    expect(user?.verified_at?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });

  it('token ja consumido: 204 sem novo efeito', async () => {
    const userId = await createAccount();
    await runPendingVerifications();
    const token = lastToken();
    await verify(token);
    currentNow = '2026-10-05T13:00:00Z';
    expect((await verify(token)).status).toBe(204);
    expect((await userRow(userId))?.verified_at?.toISOString()).toBe('2026-10-05T11:05:15.000Z');
  });

  it('verificacoes simultaneas do mesmo token ativam a conta uma unica vez', async () => {
    const userId = await createAccount();
    await runPendingVerifications();
    const token = lastToken();
    const results = await Promise.all(Array.from({ length: 5 }, () => verify(token)));
    for (const result of results) expect(result.status).toBe(204);
    expect((await userRow(userId))?.status).toBe('ACTIVE');
  });

  it('token expirado (24 h): 410 TOKEN_EXPIRED e conta pendente', async () => {
    const userId = await createAccount();
    await runPendingVerifications();
    currentNow = '2026-10-06T11:05:15Z';
    const response = await verify(lastToken());
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect((await userRow(userId))?.status).toBe('PENDING_VERIFICATION');
  });

  it('token desconhecido: 410 TOKEN_EXPIRED (DC-019)', async () => {
    const response = await verify(randomBytes(32).toString('base64url'));
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('conta fora de PENDING_VERIFICATION com token valido: 409 STATE_CONFLICT', async () => {
    const userId = await createAccount();
    await runPendingVerifications();
    await pool.query(
      `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = now(),
              purge_due_at = now() + interval '30 days' WHERE id = $1`,
      [userId],
    );
    const response = await verify(lastToken());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('token curto demais: 400 pelo contrato', async () => {
    expect((await verify('curto')).status).toBe(400);
  });
});

describe('resendVerification (TS-021)', () => {
  const NEUTRAL = {
    message:
      'Se houver uma conta aguardando verificação para este e-mail, enviaremos um novo link.',
  };

  it('conta pendente: 202 neutro, invalida o token anterior e gera novo e-mail', async () => {
    await createAccount();
    await runPendingVerifications();
    const old = lastToken();
    const response = await resend('ana.silva@example.com');
    expect(response).toMatchObject({ status: 202, body: NEUTRAL });
    expect((await verify(old)).status).toBe(410);
    await runPendingVerifications();
    expect(email.sent).toHaveLength(2);
    expect((await verify(lastToken())).status).toBe(204);
  });

  it('e-mail sem conta ou conta ja ativa: o mesmo 202, sem evento nem e-mail', async () => {
    const userId = await createAccount('bruno.costa@example.com');
    await pool.query("UPDATE users SET status = 'ACTIVE', verified_at = now() WHERE id = $1", [
      userId,
    ]);
    await pool.query('DELETE FROM outbox_events');
    for (const address of ['ninguem@example.com', 'BRUNO.COSTA@example.com']) {
      expect(await resend(address)).toMatchObject({ status: 202, body: NEUTRAL });
    }
    expect((await pool.query('SELECT 1 FROM outbox_events')).rowCount).toBe(0);
  });
});

describe('processo do worker (DC-022)', () => {
  it('despacha o Outbox e o consumidor envia o e-mail de verificacao', async () => {
    const boss = new PgBoss({ connectionString: db.url });
    boss.on('error', () => undefined);
    const worker = await startWorker({
      pool,
      boss,
      clock,
      email,
      webBaseUrl: WEB,
      emailPepper: Buffer.alloc(32, 7),
      pollIntervalMs: 100,
    });
    try {
      await createAccount();
      const deadline = Date.now() + 20_000;
      while (email.sent.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(email.sent).toHaveLength(1);
      const pending = await pool.query('SELECT 1 FROM outbox_events WHERE dispatched_at IS NULL');
      expect(pending.rowCount).toBe(0);
    } finally {
      await worker.stop();
    }
  });
});

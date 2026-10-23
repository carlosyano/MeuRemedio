// Sessoes server-side (RF-002; ENT-004; ADR-001 v1.5 secao 7 e OA-008):
//   - login: falhas indistinguiveis (401) para senha errada, e-mail inexistente ou conta nao ACTIVE,
//     com verificacao Argon2id tambem para e-mail inexistente (tempo semelhante) (DC-023);
//     bloqueio por falhas (LoginThrottle); limite de 3 sessoes ativas com o titular bloqueado na
//     transacao (TS-018);
//   - expiracao: 30 min de inatividade (deslizante, gravada no maximo 1 vez por minuto) e 24 h
//     absolutas (DC-025);
//   - logout: revoga a sessao atual (LOGOUT).
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { asKeyring, type Keyring } from '../../../platform/crypto/keyring.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import {
  csrfTokensFor,
  hashSessionToken,
  isSessionToken,
  newSessionToken,
} from '../infrastructure/session-cookies.js';
import type { LoginThrottle } from './login-throttle.js';

const IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 24 * 3_600_000;
const ACTIVITY_WRITE_MS = 60_000;
const MAX_ACTIVE_SESSIONS = 3;

export interface CreatedSession {
  readonly body: { session_id: string; idle_expires_at: string; absolute_expires_at: string };
  readonly token: string;
  readonly csrf: string;
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly userId: string;
}

const iso = (epochMs: number): string => new Date(epochMs).toISOString();

export class Sessions {
  private dummyHash: Promise<string> | undefined;
  private readonly csrfKey: Keyring;

  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly passwords: PasswordHasher,
    private readonly throttle: LoginThrottle,
    csrfKey: Buffer | Keyring,
  ) {
    this.csrfKey = asKeyring(csrfKey);
  }

  async create(email: string, password: string): Promise<CreatedSession> {
    const normalized = email.trim().toLowerCase();
    const emailHash = this.throttle.emailHash(normalized);
    const now = this.clock.now();

    const lockedFor = await this.throttle.lockedFor(emailHash, now);
    if (lockedFor !== undefined) {
      throw new ProblemError('ACCOUNT_TEMPORARILY_LOCKED', [], {
        'retry-after': String(lockedFor),
      });
    }

    const user = (
      await this.pool.query<{ id: string; password_hash: string; status: string }>(
        'SELECT id, password_hash, status FROM users WHERE email_normalized = $1',
        [normalized],
      )
    ).rows[0];
    const matches = await this.passwords.verify(
      user?.password_hash ?? (await this.dummy()),
      password,
    );
    if (user === undefined || !matches || user.status !== 'ACTIVE') {
      await this.throttle.recordFailure(emailHash, now);
      throw new ProblemError('AUTHENTICATION_REQUIRED');
    }
    await this.throttle.reset(emailHash);

    const nowMs = Date.parse(now);
    const token = newSessionToken();
    const sessionId = await withTransaction(this.pool, async (client) => {
      await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const active = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL
            AND idle_expires_at > $2 AND absolute_expires_at > $2`,
        [user.id, now],
      );
      if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_SESSIONS) {
        throw new ProblemError('SESSION_LIMIT_REACHED');
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sessions (user_id, secret_hash, last_activity_at, idle_expires_at,
                               absolute_expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $3)
         RETURNING id`,
        [user.id, hashSessionToken(token), now, iso(nowMs + IDLE_MS), iso(nowMs + ABSOLUTE_MS)],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error('INSERT em sessions nao retornou id');
      return id;
    });

    return {
      body: {
        session_id: sessionId,
        idle_expires_at: iso(nowMs + IDLE_MS),
        absolute_expires_at: iso(nowMs + ABSOLUTE_MS),
      },
      token,
      csrf: this.csrfTokenFor(sessionId),
    };
  }

  /** Sessao valida do cookie, ou undefined (ausente, desconhecida, revogada, expirada ou conta inativa). */
  async authenticate(token: string | undefined): Promise<AuthenticatedSession | undefined> {
    if (!isSessionToken(token)) return undefined;
    const now = this.clock.now();
    const nowMs = Date.parse(now);
    const row = (
      await this.pool.query<{
        id: string;
        user_id: string;
        last_activity_at: Date;
        idle_expires_at: Date;
        absolute_expires_at: Date;
        revoked_at: Date | null;
        status: string;
      }>(
        `SELECT s.id, s.user_id, s.last_activity_at, s.idle_expires_at, s.absolute_expires_at,
                s.revoked_at, u.status
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.secret_hash = $1`,
        [hashSessionToken(token)],
      )
    ).rows[0];
    if (
      row === undefined ||
      row.revoked_at !== null ||
      row.status !== 'ACTIVE' ||
      row.idle_expires_at.getTime() <= nowMs ||
      row.absolute_expires_at.getTime() <= nowMs
    ) {
      return undefined;
    }
    if (nowMs - row.last_activity_at.getTime() >= ACTIVITY_WRITE_MS) {
      await this.pool.query(
        `UPDATE sessions SET last_activity_at = $2, idle_expires_at = LEAST($3::timestamptz, absolute_expires_at)
          WHERE id = $1 AND revoked_at IS NULL`,
        [row.id, now, iso(nowMs + IDLE_MS)],
      );
    }
    return { sessionId: row.id, userId: row.user_id };
  }

  /** Token CSRF emitido para a sessao (chave atual). */
  csrfTokenFor(sessionId: string): string {
    return this.acceptedCsrfTokens(sessionId)[0] ?? '';
  }

  /** Tokens CSRF aceitos para a sessao: o atual e os das chaves anteriores (TS-031). */
  acceptedCsrfTokens(sessionId: string): string[] {
    return csrfTokensFor(sessionId, this.csrfKey);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = $2, revoked_reason = 'LOGOUT', row_version = row_version + 1
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, this.clock.now()],
    );
  }

  /** Hash Argon2id de referencia para e-mail inexistente (tempo de resposta semelhante). */
  private dummy(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(newSessionToken());
    return this.dummyHash;
  }
}

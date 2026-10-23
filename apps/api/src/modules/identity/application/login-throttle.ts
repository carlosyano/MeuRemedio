// Bloqueio de login (RN-005, DEC-016, CA-004): 5 falhas em 15 min, contadas por HMAC do e-mail
// normalizado (inclusive de e-mails inexistentes), bloqueiam por 15 min a partir da 5a falha.
// Durante o bloqueio, toda tentativa recebe 423 com Retry-After e nao conta nova falha.
// Login bem-sucedido zera o contador (DC-024).
// Rotacao do pepper (TS-031, DC-065): o bloqueio gravado pelo HMAC de um pepper anterior continua
// valendo e o login bem-sucedido o remove; falhas novas contam so pelo pepper atual.
import type { Pool } from 'pg';
import {
  acceptedDigests,
  asKeyring,
  hmacDigest,
  type KeyedDigest,
  type Keyring,
} from '../../../platform/crypto/keyring.js';
import { withTransaction } from '../../../platform/db/transaction.js';

const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_FAILURES = 5;

export class LoginThrottle {
  private readonly pepper: Keyring;

  constructor(
    private readonly pool: Pool,
    pepper: Buffer | Keyring,
  ) {
    this.pepper = asKeyring(pepper);
  }

  emailHash(normalizedEmail: string): KeyedDigest {
    return hmacDigest(this.pepper, normalizedEmail);
  }

  /** Segundos ate o fim do bloqueio, ou undefined se nao houver bloqueio. */
  async lockedFor(emailHash: KeyedDigest, now: string): Promise<number | undefined> {
    const row = (
      await this.pool.query<{ locked_until: Date | null }>(
        'SELECT max(locked_until) AS locked_until FROM login_failure_counters WHERE email_hash = ANY($1::bytea[])',
        [acceptedDigests(emailHash)],
      )
    ).rows[0];
    const remaining = (row?.locked_until?.getTime() ?? 0) - Date.parse(now);
    return remaining > 0 ? Math.ceil(remaining / 1_000) : undefined;
  }

  async recordFailure(emailHash: Buffer, now: string): Promise<void> {
    const nowMs = Date.parse(now);
    await withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO login_failure_counters (email_hash, window_start, failures)
         VALUES ($1, $2, 1) ON CONFLICT (email_hash) DO NOTHING`,
        [emailHash, now],
      );
      if (inserted.rowCount === 1) return;
      const row = (
        await client.query<{ window_start: Date; failures: number }>(
          'SELECT window_start, failures FROM login_failure_counters WHERE email_hash = $1 FOR UPDATE',
          [emailHash],
        )
      ).rows[0];
      if (row === undefined) return;
      const expired = row.window_start.getTime() + WINDOW_MS <= nowMs;
      const failures = expired ? 1 : row.failures + 1;
      await client.query(
        `UPDATE login_failure_counters SET window_start = $2, failures = $3, locked_until = $4
          WHERE email_hash = $1`,
        [
          emailHash,
          expired ? now : row.window_start.toISOString(),
          failures,
          failures >= MAX_FAILURES ? new Date(nowMs + LOCK_MS).toISOString() : null,
        ],
      );
    });
  }

  async reset(emailHash: KeyedDigest): Promise<void> {
    await this.pool.query(
      'DELETE FROM login_failure_counters WHERE email_hash = ANY($1::bytea[])',
      [acceptedDigests(emailHash)],
    );
  }
}

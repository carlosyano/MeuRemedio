// verifyAccount (RF-001, CA-002, TS-009; DC-019): consome o token e ativa a conta de forma atomica.
//   - token ja consumido: 204 sem novo efeito;
//   - token desconhecido, expirado (24 h) ou substituido: 410 TOKEN_EXPIRED;
//   - conta fora de PENDING_VERIFICATION: 409 STATE_CONFLICT.
// A linha do token e a da conta ficam bloqueadas na transacao: verificacoes simultaneas ativam
// uma unica vez.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import { hashToken } from './issue-verification.js';

interface TokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  superseded_at: Date | null;
  status: string;
}

export class VerifyAccount {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<void> {
    const now = this.clock.now();
    await withTransaction(this.pool, async (client) => {
      const row = (
        await client.query<TokenRow>(
          `SELECT t.id, t.user_id, t.expires_at, t.used_at, t.superseded_at, u.status
             FROM verification_tokens t
             JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = $1
            FOR UPDATE OF t, u`,
          [hashToken(token)],
        )
      ).rows[0];
      if (row === undefined) throw new ProblemError('TOKEN_EXPIRED');
      if (row.used_at !== null) return;
      if (row.superseded_at !== null || row.expires_at.getTime() <= Date.parse(now)) {
        throw new ProblemError('TOKEN_EXPIRED');
      }
      if (row.status !== 'PENDING_VERIFICATION') throw new ProblemError('STATE_CONFLICT');
      await client.query('UPDATE verification_tokens SET used_at = $2 WHERE id = $1', [
        row.id,
        now,
      ]);
      await client.query(
        `UPDATE users SET status = 'ACTIVE', verified_at = $2, updated_at = $2,
                          row_version = row_version + 1
          WHERE id = $1`,
        [row.user_id, now],
      );
    });
  }
}

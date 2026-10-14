// confirmPasswordReset (RF-002, RN-017, TS-009, TS-036; DC-044): troca a senha com token valido.
//   - nova senha na lista local (DEC-029): 400 PASSWORD_COMPROMISED, sem consumir o token;
//   - token desconhecido, usado, expirado (60 min) ou substituido: 410 TOKEN_EXPIRED, sem
//     distinguir os casos (DC-019) e sem efeito;
//   - conta fora de ACTIVE: 409 STATE_CONFLICT, token preservado;
//   - sucesso: grava o hash Argon2id, consome o token, invalida os demais abertos, revoga todas as
//     sessoes da conta (PASSWORD_RESET) e zera o contador de falhas de login (RN-005).
// A linha do token e a da conta ficam bloqueadas na transacao: confirmacoes simultaneas do mesmo
// token trocam a senha uma unica vez.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import type { CompromisedPasswords } from '../infrastructure/compromised-passwords.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import { hashToken } from './issue-verification.js';
import type { LoginThrottle } from './login-throttle.js';

interface TokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  superseded_at: Date | null;
  status: string;
  email_normalized: string;
}

export class ConfirmPasswordReset {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly passwords: PasswordHasher,
    private readonly compromised: CompromisedPasswords,
    private readonly throttle: LoginThrottle,
  ) {}

  async execute(input: { token: string; newPassword: string }): Promise<void> {
    if (this.compromised.has(input.newPassword)) {
      throw new ProblemError('VALIDATION_FAILED', [
        {
          field: 'new_password',
          code: 'PASSWORD_COMPROMISED',
          message: 'Esta senha aparece em listas de senhas vazadas. Escolha outra.',
        },
      ]);
    }
    const now = this.clock.now();
    const passwordHash = await this.passwords.hash(input.newPassword);
    const email = await withTransaction(this.pool, async (client) => {
      const row = (
        await client.query<TokenRow>(
          `SELECT t.id, t.user_id, t.expires_at, t.used_at, t.superseded_at, u.status,
                  u.email_normalized
             FROM password_reset_tokens t
             JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = $1
            FOR UPDATE OF t, u`,
          [hashToken(input.token)],
        )
      ).rows[0];
      if (
        row === undefined ||
        row.used_at !== null ||
        row.superseded_at !== null ||
        row.expires_at.getTime() <= Date.parse(now)
      ) {
        throw new ProblemError('TOKEN_EXPIRED');
      }
      if (row.status !== 'ACTIVE') throw new ProblemError('STATE_CONFLICT');
      await client.query('UPDATE password_reset_tokens SET used_at = $2 WHERE id = $1', [
        row.id,
        now,
      ]);
      await client.query(
        `UPDATE password_reset_tokens SET superseded_at = $2
          WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
        [row.user_id, now],
      );
      await client.query(
        `UPDATE users SET password_hash = $2, updated_at = $3, row_version = row_version + 1
          WHERE id = $1`,
        [row.user_id, passwordHash, now],
      );
      await client.query(
        `UPDATE sessions
            SET revoked_at = $2, revoked_reason = 'PASSWORD_RESET', row_version = row_version + 1
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [row.user_id, now],
      );
      return row.email_normalized;
    });
    // Fora da transacao (outra conexao), como no login: a senha ja foi trocada.
    await this.throttle.reset(this.throttle.emailHash(email));
  }
}

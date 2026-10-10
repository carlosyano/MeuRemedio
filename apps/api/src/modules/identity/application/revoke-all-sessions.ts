// revokeAllSessions (RF-002, TS-044, TS-038; DC-043): revoga todas as sessoes do titular, inclusive
// a atual, depois da reautenticacao pela senha.
//   - Idempotency-Key no escopo do titular, consultada antes da senha (replay e payload divergente
//     seguem o TS-038); o replay apos a revogacao nem chega aqui: a autenticacao vem antes (401);
//   - senha errada -> 401 sem revogar; a falha conta no bloqueio do login (RN-005) e, com o
//     bloqueio ativo, a reautenticacao recebe 401 sem conferir a senha (DC-043);
//   - sucesso zera o contador de falhas, como o login.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import type { LoginThrottle } from './login-throttle.js';

export class RevokeAllSessions {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
    private readonly passwords: PasswordHasher,
    private readonly throttle: LoginThrottle,
  ) {}

  async execute(input: {
    userId: string;
    idempotencyKey: string;
    password: string;
  }): Promise<IdempotentResponse> {
    const now = this.clock.now();
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'revokeAllSessions',
          scopeKey: input.userId,
          key: input.idempotencyKey,
          requestHash: this.hashRequest({ password: input.password }),
          now,
        },
        async () => {
          const user = (
            await client.query<{ email_normalized: string; password_hash: string }>(
              'SELECT email_normalized, password_hash FROM users WHERE id = $1',
              [input.userId],
            )
          ).rows[0];
          if (user === undefined) throw new ProblemError('AUTHENTICATION_REQUIRED');
          const emailHash = this.throttle.emailHash(user.email_normalized);
          if ((await this.throttle.lockedFor(emailHash, now)) !== undefined) {
            throw new ProblemError('AUTHENTICATION_REQUIRED');
          }
          if (!(await this.passwords.verify(user.password_hash, input.password))) {
            // Fora desta transacao (outra conexao): a falha fica gravada mesmo com o 401.
            await this.throttle.recordFailure(emailHash, now);
            throw new ProblemError('AUTHENTICATION_REQUIRED');
          }
          await this.throttle.reset(emailHash);
          await client.query(
            `UPDATE sessions
                SET revoked_at = $2, revoked_reason = 'REVOKE_ALL', row_version = row_version + 1
              WHERE user_id = $1 AND revoked_at IS NULL`,
            [input.userId, now],
          );
          return { status: 204, headers: {}, body: undefined };
        },
      ),
    );
    return response;
  }
}

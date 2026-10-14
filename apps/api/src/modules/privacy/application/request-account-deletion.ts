// requestAccountDeletion (RF-010, RN-012, TS-038; DC-045): agenda a exclusao da conta depois da
// reautenticacao pela senha e da confirmacao textual (validada pelo contrato).
//   - Idempotency-Key no escopo do titular, consultada antes da senha, como no revokeAllSessions
//     (DC-043); o replay apos a exclusao nem chega aqui: a autenticacao vem antes (401);
//   - senha errada -> 401 sem efeito; a falha conta no bloqueio do login (RN-005) e, com o bloqueio
//     ativo, a reautenticacao recebe 401 sem conferir a senha;
//   - conta fora de ACTIVE (pedido concorrente ja agendou) -> 409 STATE_CONFLICT;
//   - sucesso: conta DELETION_SCHEDULED com expurgo em 30 dias (RN-012), todas as sessoes revogadas
//     com ACCOUNT_DELETION e evento account.deletion_requested na auditoria, cujo id e o
//     deletion_request_id da resposta.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import type { LoginThrottle } from '../../identity/application/login-throttle.js';
import type { PasswordHasher } from '../../identity/infrastructure/password-hasher.js';

export const ACCOUNT_PURGE_DAYS = 30;
const PURGE_DELAY_MS = ACCOUNT_PURGE_DAYS * 24 * 3_600_000;
export const DELETION_CONFIRMATION = 'EXCLUIR MINHA CONTA';

const toInstant = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class RequestAccountDeletion {
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
    correlationId: string;
  }): Promise<IdempotentResponse> {
    const now = this.clock.now();
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'requestAccountDeletion',
          scopeKey: input.userId,
          key: input.idempotencyKey,
          requestHash: this.hashRequest({
            password: input.password,
            confirmation: DELETION_CONFIRMATION,
          }),
          now,
        },
        async () => {
          const user = (
            await client.query<{ email_normalized: string; password_hash: string; status: string }>(
              'SELECT email_normalized, password_hash, status FROM users WHERE id = $1 FOR UPDATE',
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
          if (user.status !== 'ACTIVE') throw new ProblemError('STATE_CONFLICT');
          await this.throttle.reset(emailHash);

          const requestedAt = toInstant(Date.parse(now));
          const purgeDueAt = toInstant(Date.parse(now) + PURGE_DELAY_MS);
          await client.query(
            `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = $2,
                              purge_due_at = $3, updated_at = $2, row_version = row_version + 1
              WHERE id = $1`,
            [input.userId, requestedAt, purgeDueAt],
          );
          await client.query(
            `UPDATE sessions
                SET revoked_at = $2, revoked_reason = 'ACCOUNT_DELETION',
                    row_version = row_version + 1
              WHERE user_id = $1 AND revoked_at IS NULL`,
            [input.userId, now],
          );
          const deletionRequestId = randomUUID();
          await recordAudit(client, {
            id: deletionRequestId,
            occurredAt: now,
            actorUserId: input.userId,
            action: 'account.deletion_requested',
            resourceType: 'user_account',
            resourceId: input.userId,
            outcome: 'SUCCESS',
            correlationId: input.correlationId,
          });
          return {
            status: 202,
            headers: {},
            body: {
              deletion_request_id: deletionRequestId,
              status: 'DELETION_SCHEDULED',
              requested_at: requestedAt,
              purge_due_at: purgeDueAt,
            },
          };
        },
      ),
    );
    return response;
  }
}

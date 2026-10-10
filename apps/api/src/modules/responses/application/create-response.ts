// createResponse (RF-006, CA-007, CA-013; RN-008, RN-009; TS-001, TS-007, TS-038).
// O contrato ja validou o corpo (TAKEN exige reason null) e a Idempotency-Key; aqui ficam:
//   - Idempotency-Key com escopo no titular; o occurrence_id entra no hash (TS-038);
//   - a linha da ocorrencia fica bloqueada (FOR UPDATE): respostas concorrentes se serializam e so
//     a primeira encontra a ocorrencia aberta; as demais recebem 409 STATE_CONFLICT (RN-008);
//   - aceita PROGRAMMED ou NO_RESPONSE ja alcancada (scheduled_at <= instante da acao); futura,
//     respondida ou CANCELED -> 409 STATE_CONFLICT (DC-037);
//   - inexistente, de plano excluido ou de outro titular -> 404 identico; o de outro titular e
//     auditado (DC-032), com a auditoria confirmada mesmo com o 404, sem snapshot;
//   - is_late quando o prazo ja foi atingido (deadline_at <= instante da acao); o marco
//     no_response_reached_at fica como estava (RN-009, TS-007).
import type { Pool, PoolClient } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';

export type NotTakenReason =
  'FORGOT' | 'UNAVAILABLE' | 'SIDE_EFFECT_CONCERN' | 'CHOSE_NOT_TO_TAKE' | 'OTHER';

export interface CreateResponseRequest {
  readonly type: 'TAKEN' | 'NOT_TAKEN';
  readonly reason: NotTakenReason | null;
}

export interface CreateResponseInput {
  readonly userId: string;
  readonly occurrenceId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly request: CreateResponseRequest;
}

/** Resposta interna do 404: nao vira snapshot, mas a transacao confirma a auditoria. */
const NOT_FOUND: IdempotentResponse = { status: 404, headers: {}, body: undefined };

const OPEN_STATUSES = new Set(['PROGRAMMED', 'NO_RESPONSE']);

export class CreateResponse {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
  ) {}

  async execute(input: CreateResponseInput): Promise<IdempotentResponse> {
    const now = this.clock.now();
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'createResponse',
          scopeKey: input.userId,
          key: input.idempotencyKey,
          requestHash: this.hashRequest({
            occurrence_id: input.occurrenceId,
            body: input.request,
          }),
          now,
        },
        () => this.respond(client, input, now),
      ),
    );
    if (response.status === NOT_FOUND.status) throw new ProblemError('RESOURCE_NOT_FOUND');
    return response;
  }

  private async respond(
    client: PoolClient,
    input: CreateResponseInput,
    now: string,
  ): Promise<IdempotentResponse> {
    const occurrence = (
      await client.query<{
        user_id: string;
        status: string;
        scheduled_at: Date;
        deadline_at: Date;
        plan_status: string;
      }>(
        `SELECT o.user_id, o.status, o.scheduled_at, o.deadline_at, p.status AS plan_status
           FROM occurrences o JOIN medication_plans p ON p.id = o.plan_id
          WHERE o.id = $1
          FOR UPDATE OF o`,
        [input.occurrenceId],
      )
    ).rows[0];
    if (occurrence === undefined) return NOT_FOUND;
    if (occurrence.user_id !== input.userId) {
      await recordAudit(client, {
        occurredAt: now,
        actorUserId: input.userId,
        action: 'ownership.denied',
        resourceType: 'occurrence',
        resourceId: input.occurrenceId,
        outcome: 'DENIED',
        correlationId: input.correlationId,
      });
      return NOT_FOUND;
    }
    if (occurrence.plan_status !== 'ACTIVE') return NOT_FOUND;

    const nowMs = Date.parse(now);
    if (!OPEN_STATUSES.has(occurrence.status) || occurrence.scheduled_at.getTime() > nowMs) {
      throw new ProblemError('STATE_CONFLICT');
    }
    const isLate = occurrence.deadline_at.getTime() <= nowMs;

    const { type, reason } = input.request;
    const inserted = (
      await client.query<{ id: string }>(
        `INSERT INTO responses (occurrence_id, user_id, type, reason, captured_at, is_late)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.occurrenceId, input.userId, type, reason, now, isLate],
      )
    ).rows[0];
    if (inserted === undefined) throw new Error('Resposta nao gravada');
    await client.query(
      `UPDATE occurrences
          SET status = $2, is_late = $3, row_version = row_version + 1, updated_at = $4
        WHERE id = $1`,
      [input.occurrenceId, type, isLate, now],
    );
    return {
      status: 201,
      headers: {},
      body: {
        response_id: inserted.id,
        occurrence_id: input.occurrenceId,
        type,
        reason,
        captured_at: now,
        is_late: isLate,
      },
    };
  }
}

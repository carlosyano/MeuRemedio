// updatePlan (RF-003, CA-006; Especificacao 02.33 RN-006, RN-018, DEC-009; TS-004, TS-014, TS-027).
// O contrato ja validou o corpo (PlanWrite, sem duplicate_confirmation_token) e o formato do
// If-Match ("N"); aqui ficam:
//   - Idempotency-Key com escopo no titular; o If-Match e o plan_id entram no hash (TS-038);
//   - plano inexistente, DELETED ou de outro titular -> 404 (o de outro titular e auditado,
//     DC-032; a auditoria e confirmada mesmo com o 404, sem snapshot);
//   - plano cancelado ou interrompido -> 409 STATE_CONFLICT (DEC-036): so retomar ou excluir;
//   - If-Match diferente da row_version -> 409 VERSION_CONFLICT; sucesso incrementa a versao 1x;
//   - horarios retirados ganham removed_at (preserva a FK das ocorrencias); os novos sao incluidos;
//   - ocorrencias PROGRAMMED com scheduled_at > instante da acao sao canceladas; as iniciadas e as
//     respondidas ficam; o evento plans.occurrences_requested regera o horizonte (RN-018);
//   - a linha do plano fica bloqueada (FOR UPDATE), o que serializa com o gerador (FOR SHARE).
//   Duplicidade (RN-016) nao se aplica a edicao.
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import { recurrenceColumns } from './plan-recurrence.js';
import { etagOf, findPlan, toPlanView } from './plan-view.js';
import {
  addScheduleTimes,
  cancelFutureOccurrences,
  lockOwnPlan,
  requestOccurrences,
  validatePlanWrite,
  type NormalizedPlanText,
  type PlanWriteRequest,
} from './plan-write.js';

export interface UpdatePlanInput {
  readonly userId: string;
  readonly planId: string;
  /** If-Match ja no formato "N" (validado pelo contrato). */
  readonly ifMatch: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly request: PlanWriteRequest;
}

/** Resposta interna do 404: nao vira snapshot, mas a transacao confirma a auditoria. */
const NOT_FOUND: IdempotentResponse = { status: 404, headers: {}, body: undefined };

export class UpdatePlan {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
  ) {}

  async execute(input: UpdatePlanInput): Promise<IdempotentResponse> {
    const normalized = validatePlanWrite(input.request);
    const now = this.clock.now();
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'updatePlan',
          scopeKey: input.userId,
          key: input.idempotencyKey,
          requestHash: this.hashRequest({
            plan_id: input.planId,
            if_match: input.ifMatch,
            body: input.request,
          }),
          now,
        },
        () => this.update(client, input, normalized, now),
      ),
    );
    if (response.status === NOT_FOUND.status) throw new ProblemError('RESOURCE_NOT_FOUND');
    return response;
  }

  private async update(
    client: PoolClient,
    input: UpdatePlanInput,
    normalized: NormalizedPlanText,
    now: string,
  ): Promise<IdempotentResponse> {
    const { planId, request } = input;
    const recurrence = recurrenceColumns(request.recurrence);
    const plan = await lockOwnPlan(client, { ...input, now });
    if (plan === undefined || plan.status === 'DELETED') return NOT_FOUND;
    if (etagOf(Number(plan.row_version)) !== input.ifMatch) {
      throw new ProblemError('VERSION_CONFLICT');
    }
    if (plan.status !== 'ACTIVE') throw new ProblemError('STATE_CONFLICT');

    await client.query(
      `UPDATE medication_plans
          SET medication_name = $2, medication_name_norm = $3, dose_text = $4, dose_text_norm = $5,
              medication_form = $6, administration_route = $7, instructions = $8,
              prescriber_name = $9, prescriber_crm = $10, start_date = $11, end_date = $12,
              recurrence_kind = $14, recurrence_weekdays = $15, recurrence_interval_days = $16,
              row_version = row_version + 1, updated_at = $13
        WHERE id = $1`,
      [
        planId,
        normalized.medicationName,
        normalized.medicationNameNorm,
        normalized.doseText,
        normalized.doseTextNorm,
        request.medication_form,
        request.administration_route,
        request.instructions ?? null,
        request.prescriber_name ?? null,
        request.prescriber_crm ?? null,
        request.start_date,
        request.end_date ?? null,
        now,
        recurrence.kind,
        recurrence.weekdays,
        recurrence.intervalDays,
      ],
    );
    // Retira primeiro, para o limite de 10 horarios ativos (RN-006) valer sobre o conjunto final.
    await client.query(
      `UPDATE schedule_times SET removed_at = $3
        WHERE plan_id = $1 AND removed_at IS NULL
          AND NOT (to_char(time_of_day, 'HH24:MI') = ANY ($2::text[]))`,
      [planId, request.schedule_times, now],
    );
    await addScheduleTimes(client, planId, request.schedule_times, now);
    await cancelFutureOccurrences(client, planId, now);
    await requestOccurrences(client, planId, now);

    const updated = await findPlan(client, planId);
    if (updated === undefined) throw new Error('Plano editado nao encontrado');
    return {
      status: 200,
      headers: { etag: etagOf(Number(updated.row_version)) },
      body: toPlanView(updated),
    };
  }
}

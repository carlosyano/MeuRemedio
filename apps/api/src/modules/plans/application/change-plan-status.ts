// changePlanStatus (RF-003; Especificacao 02.33 DEC-036; TS-008, TS-038): cancelar, interromper e
// retomar o plano, sempre com motivo. O contrato ja validou o corpo (ChangePlanStatusRequest) e o
// formato do If-Match ("N"); aqui ficam:
//   - Idempotency-Key com escopo no titular; o If-Match e o plan_id entram no hash (TS-038);
//   - plano inexistente, DELETED ou de outro titular -> 404 (o de outro titular e auditado, DC-032);
//   - If-Match diferente da row_version -> 409 VERSION_CONFLICT;
//   - transicao pela data de hoje no fuso da conta; fora das regras -> 409 STATE_CONFLICT:
//       CANCEL    so do ACTIVE antes da data de inicio (definitivo);
//       INTERRUPT so do ACTIVE entre o inicio e o termino;
//       RESUME    so do INTERRUPTED que ainda nao terminou;
//   - cancelar e interromper cancelam as ocorrencias PROGRAMMED futuras; retomar pede a geracao
//     pelo Outbox, e o gerador ignora os horarios anteriores a retomada (status_changed_at);
//   - o plano guarda so a ultima mudanca (motivo, observacao e instante).
import { civilDateAt } from '@meuremedio/domain';
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import {
  etagOf,
  findPlan,
  toPlanView,
  type PlanStatus,
  type PlanStatusReason,
} from './plan-view.js';
import { cancelFutureOccurrences, lockOwnPlan, requestOccurrences } from './plan-write.js';

export type PlanStatusAction = 'CANCEL' | 'INTERRUPT' | 'RESUME';

export interface ChangePlanStatusRequest {
  readonly action: PlanStatusAction;
  readonly reason: PlanStatusReason;
  readonly note?: string | null;
}

export interface ChangePlanStatusInput {
  readonly userId: string;
  readonly planId: string;
  /** If-Match ja no formato "N" (validado pelo contrato). */
  readonly ifMatch: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly request: ChangePlanStatusRequest;
}

// O dominio so aceita instantes em segundos; o relogio do sistema traz milissegundos.
const toSeconds = (instant: string): string => `${instant.slice(0, 19)}Z`;

/** Situacao resultante de cada acao. */
const TARGET: Readonly<Record<PlanStatusAction, PlanStatus>> = {
  CANCEL: 'CANCELED',
  INTERRUPT: 'INTERRUPTED',
  RESUME: 'ACTIVE',
};

/** Resposta interna do 404: nao vira snapshot, mas a transacao confirma a auditoria. */
const NOT_FOUND: IdempotentResponse = { status: 404, headers: {}, body: undefined };

interface PlanPeriod {
  readonly status: PlanStatus;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly today: string;
}

/** A acao e permitida na situacao e no periodo do plano, na data de hoje da conta? */
export function canChangeStatus(action: PlanStatusAction, plan: PlanPeriod): boolean {
  const notFinished = plan.endDate === null || plan.today <= plan.endDate;
  switch (action) {
    case 'CANCEL':
      return plan.status === 'ACTIVE' && plan.today < plan.startDate;
    case 'INTERRUPT':
      return plan.status === 'ACTIVE' && plan.startDate <= plan.today && notFinished;
    case 'RESUME':
      return plan.status === 'INTERRUPTED' && notFinished;
  }
}

export class ChangePlanStatus {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
  ) {}

  async execute(input: ChangePlanStatusInput): Promise<IdempotentResponse> {
    const now = this.clock.now();
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'changePlanStatus',
          scopeKey: input.userId,
          key: input.idempotencyKey,
          requestHash: this.hashRequest({
            plan_id: input.planId,
            if_match: input.ifMatch,
            body: input.request,
          }),
          now,
        },
        () => this.change(client, input, now),
      ),
    );
    if (response.status === NOT_FOUND.status) throw new ProblemError('RESOURCE_NOT_FOUND');
    return response;
  }

  private async change(
    client: PoolClient,
    input: ChangePlanStatusInput,
    now: string,
  ): Promise<IdempotentResponse> {
    const { planId, request } = input;
    const plan = await lockOwnPlan(client, { ...input, now });
    if (plan === undefined || plan.status === 'DELETED') return NOT_FOUND;
    if (etagOf(Number(plan.row_version)) !== input.ifMatch) {
      throw new ProblemError('VERSION_CONFLICT');
    }
    const period = (
      await client.query<{ start_date: string; end_date: string | null; account_timezone: string }>(
        `SELECT to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
                to_char(p.end_date, 'YYYY-MM-DD') AS end_date, u.account_timezone
           FROM medication_plans p JOIN users u ON u.id = p.user_id
          WHERE p.id = $1`,
        [planId],
      )
    ).rows[0];
    if (period === undefined) throw new Error('Plano bloqueado nao encontrado');
    const allowed = canChangeStatus(request.action, {
      status: plan.status,
      startDate: period.start_date,
      endDate: period.end_date,
      today: civilDateAt(toSeconds(now), period.account_timezone),
    });
    if (!allowed) throw new ProblemError('STATE_CONFLICT');

    await client.query(
      `UPDATE medication_plans
          SET status = $2, status_reason = $3, status_note = $4, status_changed_at = $5,
              row_version = row_version + 1, updated_at = $5
        WHERE id = $1`,
      [planId, TARGET[request.action], request.reason, request.note ?? null, now],
    );
    if (request.action === 'RESUME') {
      await requestOccurrences(client, planId, now);
    } else {
      await cancelFutureOccurrences(client, planId, now);
    }

    const updated = await findPlan(client, planId);
    if (updated === undefined) throw new Error('Plano alterado nao encontrado');
    return {
      status: 200,
      headers: { etag: etagOf(Number(updated.row_version)) },
      body: toPlanView(updated),
    };
  }
}

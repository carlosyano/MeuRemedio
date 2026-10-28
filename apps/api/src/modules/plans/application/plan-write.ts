// Regras comuns a createPlan e updatePlan (schema PlanWrite; RN-006, RN-016, RN-018, DC-029):
// validacao do texto e do periodo, gravacao dos horarios, cancelamento das ocorrencias futuras,
// evento de geracao no Outbox e negacao de acesso com auditoria (DC-032).
import { normalizePlanText } from '@meuremedio/domain';
import type { PoolClient } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import { ProblemError, type FieldError } from '../../../platform/http/problem-catalog.js';
import type { PlanRecurrence } from './plan-recurrence.js';
import type { PlanStatus } from './plan-view.js';

export interface PlanWriteRequest {
  readonly medication_name: string;
  readonly dose_text: string;
  readonly medication_form: string;
  readonly administration_route: string;
  readonly instructions?: string | null;
  readonly prescriber_name?: string | null;
  readonly prescriber_crm?: string | null;
  readonly start_date: string;
  readonly end_date?: string | null;
  readonly schedule_times: readonly string[];
  /** Periodicidade (DEC-037); omitida vale DAILY. */
  readonly recurrence?: PlanRecurrence;
  /** Motivo do tratamento (DEC-038); omitido ou null, sem motivo. */
  readonly treatment_reason?: string | null;
}

export interface NormalizedPlanText {
  readonly medicationName: string;
  readonly doseText: string;
  readonly medicationNameNorm: string;
  readonly doseTextNorm: string;
}

export const OCCURRENCES_REQUESTED = 'plans.occurrences_requested';

/** Apara e normaliza nome e dose (400 se vazios) e exige end_date >= start_date (422). */
export function validatePlanWrite(request: PlanWriteRequest): NormalizedPlanText {
  const medicationName = request.medication_name.trim();
  const doseText = request.dose_text.trim();
  const medicationNameNorm = normalizePlanText(medicationName);
  const doseTextNorm = normalizePlanText(doseText);
  const errors: FieldError[] = [];
  // Texto so com espacos ou marcas combinantes fica vazio depois de normalizado.
  if (medicationNameNorm.length === 0) {
    errors.push({ field: 'medication_name', code: 'REQUIRED', message: 'Informe o medicamento.' });
  }
  if (doseTextNorm.length === 0) {
    errors.push({ field: 'dose_text', code: 'REQUIRED', message: 'Informe a dose.' });
  }
  if (errors.length > 0) throw new ProblemError('VALIDATION_FAILED', errors);
  if (request.end_date != null && request.end_date < request.start_date) {
    throw new ProblemError('BUSINESS_RULE_VIOLATION', [
      {
        field: 'end_date',
        code: 'BEFORE_START_DATE',
        message: 'A data de término deve ser igual ou posterior à data de início.',
      },
    ]);
  }
  return { medicationName, doseText, medicationNameNorm, doseTextNorm };
}

/** Inclui os horarios que ainda nao estao ativos (os ativos mantem o id). */
export async function addScheduleTimes(
  client: PoolClient,
  planId: string,
  times: readonly string[],
  now: string,
): Promise<void> {
  await client.query(
    `INSERT INTO schedule_times (plan_id, time_of_day, created_at)
     SELECT $1, t, $3 FROM unnest($2::time[]) AS t
      WHERE NOT EXISTS (SELECT 1 FROM schedule_times s
                         WHERE s.plan_id = $1 AND s.time_of_day = t AND s.removed_at IS NULL)
      ORDER BY t`,
    [planId, [...times].sort(), now],
  );
}

/**
 * Cancela as ocorrencias PROGRAMMED do plano com scheduled_at depois de `now` (TS-004, TS-027):
 * as iniciadas (scheduled_at <= now) e as ja respondidas ficam.
 */
export async function cancelFutureOccurrences(
  client: PoolClient,
  planId: string,
  now: string,
): Promise<void> {
  await client.query(
    `UPDATE occurrences
        SET status = 'CANCELED', row_version = row_version + 1, updated_at = $2
      WHERE plan_id = $1 AND status = 'PROGRAMMED' AND scheduled_at > $2`,
    [planId, now],
  );
}

export async function requestOccurrences(
  client: PoolClient,
  planId: string,
  now: string,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, available_at,
                                created_at)
     VALUES ('medication_plan', $1, $2, $3, $4, $4)`,
    [planId, OCCURRENCES_REQUESTED, JSON.stringify({ plan_id: planId }), now],
  );
}

/**
 * Plano bloqueado para escrita, se for do titular. Plano de outro titular grava ownership.denied
 * e devolve undefined, como o inexistente (TS-008, DC-032).
 */
export async function lockOwnPlan(
  client: PoolClient,
  input: { userId: string; planId: string; correlationId: string; now: string },
): Promise<{ status: PlanStatus; row_version: string } | undefined> {
  const row = (
    await client.query<{ user_id: string; status: PlanStatus; row_version: string }>(
      'SELECT user_id, status, row_version FROM medication_plans WHERE id = $1 FOR UPDATE',
      [input.planId],
    )
  ).rows[0];
  if (row === undefined) return undefined;
  if (row.user_id !== input.userId) {
    await recordAudit(client, {
      occurredAt: input.now,
      actorUserId: input.userId,
      action: 'ownership.denied',
      resourceType: 'medication_plan',
      resourceId: input.planId,
      outcome: 'DENIED',
      correlationId: input.correlationId,
    });
    return undefined;
  }
  return { status: row.status, row_version: row.row_version };
}

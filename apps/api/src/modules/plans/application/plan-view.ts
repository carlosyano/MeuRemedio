// Leitura de um plano no formato do schema Plan (OpenAPI 02.33.10) e ETag derivado de row_version.
import type { Pool, PoolClient } from 'pg';
import {
  RECURRENCE_COLUMNS,
  toPlanRecurrence,
  type PlanRecurrence,
  type RecurrenceRow,
} from './plan-recurrence.js';

/** Situacao do plano (DEC-036); DELETED nunca chega ao titular. */
export type PlanStatus = 'ACTIVE' | 'CANCELED' | 'INTERRUPTED' | 'DELETED';

/** Motivo da ultima mudanca de situacao (PlanStatusReason, DEC-036). */
export type PlanStatusReason =
  'MEDICAL_ADVICE' | 'SIDE_EFFECT' | 'IMPROVED' | 'COST_OR_ACCESS' | 'OWN_DECISION' | 'OTHER';

export interface PlanView {
  readonly plan_id: string;
  readonly status: PlanStatus;
  readonly medication_name: string;
  readonly dose_text: string;
  readonly medication_form: string;
  readonly administration_route: string;
  readonly instructions: string | null;
  readonly prescriber_name: string | null;
  readonly prescriber_crm: string | null;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly schedule_times: string[];
  readonly recurrence: PlanRecurrence;
  readonly treatment_reason: { readonly treatment_reason_id: string; readonly name: string } | null;
  readonly status_reason: PlanStatusReason | null;
  readonly status_note: string | null;
  readonly status_changed_at: string | null;
  readonly row_version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** ETag forte com a versao da linha (CA-006): row_version 7 -> "7". */
export const etagOf = (rowVersion: number): string => `"${String(rowVersion)}"`;

export interface PlanRow extends RecurrenceRow {
  id: string;
  user_id: string;
  status: PlanStatus;
  medication_name: string;
  dose_text: string;
  medication_form: string;
  administration_route: string;
  instructions: string | null;
  prescriber_name: string | null;
  prescriber_crm: string | null;
  start_date: string;
  end_date: string | null;
  schedule_times: string[] | null;
  status_reason: PlanStatusReason | null;
  status_note: string | null;
  treatment_reason_id: string | null;
  treatment_reason_name: string | null;
  status_changed_at: Date | null;
  row_version: string;
  created_at: Date;
  updated_at: Date;
  /** created_at em UTC com microssegundos, para o cursor de listPlans. */
  created_at_us: string;
}

/** Colunas de PlanRow a partir de medication_plans com alias p. */
export const PLAN_COLUMNS = `
  p.id, p.user_id, p.status, p.medication_name, p.dose_text, p.medication_form,
  p.administration_route, p.instructions, p.prescriber_name, p.prescriber_crm,
  to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(p.end_date, 'YYYY-MM-DD') AS end_date,
  (SELECT array_agg(to_char(s.time_of_day, 'HH24:MI') ORDER BY s.time_of_day)
     FROM schedule_times s
    WHERE s.plan_id = p.id AND s.removed_at IS NULL) AS schedule_times,
  p.status_reason, p.status_note, p.status_changed_at, ${RECURRENCE_COLUMNS},
  p.treatment_reason_id,
  (SELECT tr.name FROM treatment_reasons tr WHERE tr.id = p.treatment_reason_id)
    AS treatment_reason_name,
  p.row_version, p.created_at, p.updated_at,
  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_us`;

export function toPlanView(row: PlanRow): PlanView {
  return {
    plan_id: row.id,
    status: row.status,
    medication_name: row.medication_name,
    dose_text: row.dose_text,
    medication_form: row.medication_form,
    administration_route: row.administration_route,
    instructions: row.instructions,
    prescriber_name: row.prescriber_name,
    prescriber_crm: row.prescriber_crm,
    start_date: row.start_date,
    end_date: row.end_date,
    schedule_times: row.schedule_times ?? [],
    recurrence: toPlanRecurrence(row),
    treatment_reason:
      row.treatment_reason_id === null || row.treatment_reason_name === null
        ? null
        : { treatment_reason_id: row.treatment_reason_id, name: row.treatment_reason_name },
    status_reason: row.status_reason,
    status_note: row.status_note,
    status_changed_at: row.status_changed_at?.toISOString().replace('.000Z', 'Z') ?? null,
    row_version: Number(row.row_version),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Plano pelo id, de qualquer titular e status; o chamador aplica ownership e status. */
export async function findPlan(
  db: Pool | PoolClient,
  planId: string,
): Promise<PlanRow | undefined> {
  return (
    await db.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM medication_plans p WHERE p.id = $1`, [
      planId,
    ])
  ).rows[0];
}

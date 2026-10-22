// Leitura de um plano no formato do schema Plan (OpenAPI 02.33.6) e ETag derivado de row_version.
import type { Pool, PoolClient } from 'pg';

export interface PlanView {
  readonly plan_id: string;
  readonly status: 'ACTIVE' | 'DELETED';
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
  readonly row_version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** ETag forte com a versao da linha (CA-006): row_version 7 -> "7". */
export const etagOf = (rowVersion: number): string => `"${String(rowVersion)}"`;

export interface PlanRow {
  id: string;
  user_id: string;
  status: 'ACTIVE' | 'DELETED';
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

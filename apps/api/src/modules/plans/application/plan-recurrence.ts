// Periodicidade do plano (DEC-037): conversao entre o schema PlanRecurrence (OpenAPI 02.33.9), as
// colunas de medication_plans (migracao 0015). O contrato ja validou o formato (oneOf com kind);
// omitida no corpo, vale DAILY.
// Dias da semana no banco em mascara de bits (weekdayMask e weekdaysFromMask do dominio).
import { weekdayMask, weekdaysFromMask, type Weekday } from '@meuremedio/domain';

/** Corpo do contrato. */
export type PlanRecurrence =
  | { readonly kind: 'DAILY' }
  | { readonly kind: 'WEEKDAYS'; readonly weekdays: readonly Weekday[] }
  | { readonly kind: 'EVERY_N_DAYS'; readonly interval_days: number };

export type PlanRecurrenceKind = PlanRecurrence['kind'];

export interface RecurrenceColumns {
  readonly kind: PlanRecurrenceKind;
  readonly weekdays: number | null;
  readonly intervalDays: number | null;
}

/** Colunas lidas: recurrence_kind, recurrence_weekdays e recurrence_interval_days. */
export interface RecurrenceRow {
  readonly recurrence_kind: PlanRecurrenceKind;
  readonly recurrence_weekdays: number | null;
  readonly recurrence_interval_days: number | null;
}

export function recurrenceColumns(recurrence: PlanRecurrence | undefined): RecurrenceColumns {
  if (recurrence === undefined || recurrence.kind === 'DAILY') {
    return { kind: 'DAILY', weekdays: null, intervalDays: null };
  }
  if (recurrence.kind === 'WEEKDAYS') {
    return { kind: 'WEEKDAYS', weekdays: weekdayMask(recurrence.weekdays), intervalDays: null };
  }
  return { kind: 'EVERY_N_DAYS', weekdays: null, intervalDays: recurrence.interval_days };
}

/** Periodicidade no formato do contrato, com os dias de segunda a domingo. */
export function toPlanRecurrence(row: RecurrenceRow): PlanRecurrence {
  if (row.recurrence_kind === 'WEEKDAYS' && row.recurrence_weekdays !== null) {
    return { kind: 'WEEKDAYS', weekdays: weekdaysFromMask(row.recurrence_weekdays) };
  }
  if (row.recurrence_kind === 'EVERY_N_DAYS' && row.recurrence_interval_days !== null) {
    return { kind: 'EVERY_N_DAYS', interval_days: row.recurrence_interval_days };
  }
  return { kind: 'DAILY' };
}

/** Colunas de RecurrenceRow a partir de medication_plans com alias p. */
export const RECURRENCE_COLUMNS =
  'p.recurrence_kind, p.recurrence_weekdays, p.recurrence_interval_days';

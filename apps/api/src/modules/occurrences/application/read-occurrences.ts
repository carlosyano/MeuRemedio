// listOccurrences (RF-004, RF-005; TS-023): ocorrencias acionaveis do titular (DC-036).
//   - so as ja alcancadas (scheduled_at <= instante da consulta) de planos ACTIVE do titular;
//   - com local_date, as daquele dia civil no fuso da conta, alcancadas ou nao (DEC-035);
//   - sem filtro, todos os estados menos CANCELED; com status, exatamente os estados pedidos;
//   - da mais recente para a mais antiga (scheduled_at, id), com cursor opaco (DC-030).
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { decodeCursor, pageOf, type PageMeta } from '../../../platform/http/keyset-cursor.js';

export type OccurrenceStatus = 'PROGRAMMED' | 'NO_RESPONSE' | 'TAKEN' | 'NOT_TAKEN' | 'CANCELED';

const DEFAULT_STATUSES: readonly OccurrenceStatus[] = [
  'PROGRAMMED',
  'NO_RESPONSE',
  'TAKEN',
  'NOT_TAKEN',
];

export interface OccurrenceView {
  readonly occurrence_id: string;
  readonly plan_id: string;
  readonly local_scheduled_date: string;
  readonly local_time: string;
  readonly scheduled_at: string;
  readonly deadline_at: string;
  readonly status: OccurrenceStatus;
  readonly medication_name_snapshot: string;
  readonly dose_text_snapshot: string;
  readonly treatment_reason_snapshot: string | null;
  readonly is_late: boolean;
  readonly no_response_reached_at: string | null;
  readonly row_version: number;
}

export interface OccurrencePage {
  readonly items: OccurrenceView[];
  readonly page: PageMeta;
}

export interface OccurrenceRow {
  id: string;
  plan_id: string;
  local_scheduled_date: string;
  local_time: string;
  scheduled_at: Date;
  deadline_at: Date;
  status: OccurrenceStatus;
  medication_name_snapshot: string;
  dose_text_snapshot: string;
  treatment_reason_snapshot: string | null;
  is_late: boolean;
  no_response_reached_at: Date | null;
  row_version: string;
}

/** Colunas de OccurrenceRow, com a ocorrencia no alias o. */
export const OCCURRENCE_COLUMNS = `o.id, o.plan_id,
  to_char(o.local_scheduled_date, 'YYYY-MM-DD') AS local_scheduled_date,
  to_char(o.local_time, 'HH24:MI') AS local_time, o.scheduled_at, o.deadline_at, o.status,
  o.medication_name_snapshot, o.dose_text_snapshot, o.treatment_reason_snapshot, o.is_late,
  o.no_response_reached_at,
  o.row_version`;

/** Instante UTC sem a fracao vazia (.000). */
export const instantOf = (value: Date): string => value.toISOString().replace('.000Z', 'Z');

export const toOccurrenceView = (row: OccurrenceRow): OccurrenceView => ({
  occurrence_id: row.id,
  plan_id: row.plan_id,
  local_scheduled_date: row.local_scheduled_date,
  local_time: row.local_time,
  scheduled_at: instantOf(row.scheduled_at),
  deadline_at: instantOf(row.deadline_at),
  status: row.status,
  medication_name_snapshot: row.medication_name_snapshot,
  dose_text_snapshot: row.dose_text_snapshot,
  treatment_reason_snapshot: row.treatment_reason_snapshot,
  is_late: row.is_late,
  no_response_reached_at:
    row.no_response_reached_at === null ? null : instantOf(row.no_response_reached_at),
  row_version: Number(row.row_version),
});

export class ReadOccurrences {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
  ) {}

  async list(
    userId: string,
    filter: {
      statuses: readonly OccurrenceStatus[] | undefined;
      cursor: string | undefined;
      localDate?: string | undefined;
    },
    limit: number,
  ): Promise<OccurrencePage> {
    const after = filter.cursor === undefined ? null : decodeCursor(filter.cursor);
    const rows = (
      await this.pool.query<OccurrenceRow>(
        `SELECT ${OCCURRENCE_COLUMNS}
           FROM occurrences o
           JOIN medication_plans p ON p.id = o.plan_id AND p.status = 'ACTIVE'
          WHERE o.user_id = $1
            AND ($7::date IS NOT NULL OR o.scheduled_at <= $2)
            AND ($7::date IS NULL OR o.local_scheduled_date = $7::date)
            AND o.status = ANY ($3::occurrence_status[])
            AND ($4::timestamptz IS NULL OR (o.scheduled_at, o.id) < ($4::timestamptz, $5::uuid))
          ORDER BY o.scheduled_at DESC, o.id DESC
          LIMIT $6`,
        [
          userId,
          this.clock.now(),
          filter.statuses ?? DEFAULT_STATUSES,
          after?.t ?? null,
          after?.i ?? null,
          limit + 1,
          filter.localDate ?? null,
        ],
      )
    ).rows;
    return pageOf(rows, limit, toOccurrenceView, (row) => ({
      t: instantOf(row.scheduled_at),
      i: row.id,
    }));
  }
}

// getHistory (RF-007, RN-010, CA-009; TS-005, TS-037; DC-041).
//   - periodo civil inclusivo de ate 12 meses, aplicado como intervalo semiaberto sobre
//     scheduled_at no fuso da conta (historyWindow); fora disso -> 400 VALIDATION_FAILED em end;
//   - so ocorrencias do titular ja alcancadas (scheduled_at <= agora), sem as CANCELED; as de plano
//     excluido continuam (o historico e preservado);
//   - da mais recente para a mais antiga (scheduled_at, id), com o cursor da DC-030, e a resposta
//     de cada ocorrencia (ou null).
import { historyWindow } from '@meuremedio/domain';
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { decodeCursor, pageOf, type PageMeta } from '../../../platform/http/keyset-cursor.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  OCCURRENCE_COLUMNS,
  instantOf,
  toOccurrenceView,
  type OccurrenceRow,
  type OccurrenceView,
} from '../../occurrences/application/read-occurrences.js';

export interface ResponseView {
  readonly response_id: string;
  readonly occurrence_id: string;
  readonly type: 'TAKEN' | 'NOT_TAKEN';
  readonly reason: string | null;
  readonly captured_at: string;
  readonly is_late: boolean;
}

export interface HistoryItem {
  readonly occurrence: OccurrenceView;
  readonly response: ResponseView | null;
}

export interface HistoryPage {
  readonly items: HistoryItem[];
  readonly page: PageMeta;
}

interface HistoryRow extends OccurrenceRow {
  response_id: string | null;
  response_type: 'TAKEN' | 'NOT_TAKEN' | null;
  response_reason: string | null;
  response_captured_at: Date | null;
  response_is_late: boolean | null;
}

const MESSAGES = {
  BEFORE_START: 'A data final deve ser igual ou posterior à inicial.',
  PERIOD_TOO_LONG: 'O período pode ter no máximo 12 meses.',
} as const;

const toHistoryItem = (row: HistoryRow): HistoryItem => ({
  occurrence: toOccurrenceView(row),
  response:
    row.response_id === null ||
    row.response_type === null ||
    row.response_captured_at === null ||
    row.response_is_late === null
      ? null
      : {
          response_id: row.response_id,
          occurrence_id: row.id,
          type: row.response_type,
          reason: row.response_reason,
          captured_at: instantOf(row.response_captured_at),
          is_late: row.response_is_late,
        },
});

export class ReadHistory {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
  ) {}

  async list(
    userId: string,
    filter: { start: string; end: string; cursor: string | undefined },
    limit: number,
  ): Promise<HistoryPage> {
    const after = filter.cursor === undefined ? null : decodeCursor(filter.cursor);
    const account = (
      await this.pool.query<{ account_timezone: string }>(
        'SELECT account_timezone FROM users WHERE id = $1',
        [userId],
      )
    ).rows[0];
    if (account === undefined) throw new Error('Titular da sessao nao encontrado');
    const window = historyWindow({
      start: filter.start,
      end: filter.end,
      timeZone: account.account_timezone,
    });
    if (!window.ok) {
      throw new ProblemError('VALIDATION_FAILED', [
        { field: window.field, code: window.code, message: MESSAGES[window.code] },
      ]);
    }

    const rows = (
      await this.pool.query<HistoryRow>(
        `SELECT ${OCCURRENCE_COLUMNS}, r.id AS response_id, r.type AS response_type,
                r.reason AS response_reason, r.captured_at AS response_captured_at,
                r.is_late AS response_is_late
           FROM occurrences o
           LEFT JOIN responses r ON r.occurrence_id = o.id
          WHERE o.user_id = $1 AND o.status <> 'CANCELED'
            AND o.scheduled_at >= $2 AND o.scheduled_at < $3 AND o.scheduled_at <= $4
            AND ($5::timestamptz IS NULL OR (o.scheduled_at, o.id) < ($5::timestamptz, $6::uuid))
          ORDER BY o.scheduled_at DESC, o.id DESC
          LIMIT $7`,
        [
          userId,
          window.fromInstant,
          window.toInstant,
          this.clock.now(),
          after?.t ?? null,
          after?.i ?? null,
          limit + 1,
        ],
      )
    ).rows;
    return pageOf(rows, limit, toHistoryItem, (row) => ({
      t: instantOf(row.scheduled_at),
      i: row.id,
    }));
  }
}

// Janela do historico (RF-007, RN-010; DC-041): periodo civil inclusivo de ate 12 meses, aplicado
// como intervalo semiaberto [inicio do dia start, inicio do dia seguinte a end) no fuso da conta.
//   - "12 meses" inclusivos: end vai no maximo ate a vespera de start + 12 meses; quando o dia de
//     start nao existe no mes de chegada (29/02), vale o ultimo dia desse mes;
//   - o inicio de cada dia segue resolveCivilInstant (meia-noite inexistente avanca, DST).
import { civilDate, dayNumber } from './calendar.js';
import { resolveCivilInstant } from './civil-time.js';

export const HISTORY_MAX_MONTHS = 12;

export interface HistoryWindowInput {
  readonly start: string;
  readonly end: string;
  /** Fuso IANA da conta (RN-013). */
  readonly timeZone: string;
}

export type HistoryWindow =
  | { readonly ok: true; readonly fromInstant: string; readonly toInstant: string }
  | {
      readonly ok: false;
      readonly field: 'end';
      readonly code: 'BEFORE_START' | 'PERIOD_TOO_LONG';
    };

/** Mesma data civil N meses depois, com o dia limitado ao ultimo dia do mes de chegada. */
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function historyWindow(input: HistoryWindowInput): HistoryWindow {
  const start = dayNumber(input.start, 'Data inicial');
  const end = dayNumber(input.end, 'Data final');
  if (end < start) return { ok: false, field: 'end', code: 'BEFORE_START' };
  const limit = dayNumber(addMonths(input.start, HISTORY_MAX_MONTHS), 'Data limite') - 1;
  if (end > limit) return { ok: false, field: 'end', code: 'PERIOD_TOO_LONG' };
  return {
    ok: true,
    fromInstant: resolveCivilInstant(input.start, '00:00', input.timeZone).instantUtc,
    toInstant: resolveCivilInstant(civilDate(end + 1), '00:00', input.timeZone).instantUtc,
  };
}

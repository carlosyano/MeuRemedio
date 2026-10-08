// Horizonte de geracao de ocorrencias e estado inicial de cada ocorrencia gerada.
// Regra normativa: Especificacao 02.33, DEC-027 (RF-004, RN-018):
//   - a janela vai da data civil atual no fuso da conta (ou de start_date, se posterior) ate a data
//     atual + 30 dias, inclusive, limitada a end_date;
//   - horario cujo deadline_at ja foi atingido na geracao nasce NO_RESPONSE, com
//     no_response_reached_at igual ao instante da geracao; antes do prazo, nasce PROGRAMMED.
import { civilDate, dayNumber } from './calendar.js';
import { civilDateAt, parseInstant } from './civil-time.js';

/** Dias apos a data atual cobertos pelo horizonte (a data atual + 30, inclusive). */
export const GENERATION_HORIZON_DAYS = 30;

export interface GenerationHorizonInput {
  /** Instante da geracao, UTC (YYYY-MM-DDTHH:MM:SSZ). */
  readonly now: string;
  /** Fuso IANA da conta (RN-013). */
  readonly timeZone: string;
  readonly planStartDate: string;
  readonly planEndDate: string | null;
}

export interface GenerationWindow {
  /** Primeira data civil (inclusiva). */
  readonly fromDate: string;
  /** Ultima data civil (inclusiva). */
  readonly toDate: string;
}

/** Janela de datas civis a gerar, ou null quando o plano nao tem dias dentro do horizonte. */
export function generationHorizon(input: GenerationHorizonInput): GenerationWindow | null {
  const today = dayNumber(civilDateAt(input.now, input.timeZone), 'Data atual');
  const start = dayNumber(input.planStartDate, 'Data de inicio do plano');
  const end =
    input.planEndDate === null
      ? Number.POSITIVE_INFINITY
      : dayNumber(input.planEndDate, 'Data de termino do plano');

  const from = Math.max(today, start);
  const to = Math.min(today + GENERATION_HORIZON_DAYS, end);
  return from > to ? null : { fromDate: civilDate(from), toDate: civilDate(to) };
}

export type InitialOccurrenceState =
  | { readonly status: 'PROGRAMMED'; readonly noResponseReachedAt: null }
  | { readonly status: 'NO_RESPONSE'; readonly noResponseReachedAt: string };

/** Estado com que a ocorrencia nasce: prazo ja atingido (deadline_at <= now) -> NO_RESPONSE. */
export function initialOccurrenceState(deadlineAt: string, now: string): InitialOccurrenceState {
  return parseInstant(deadlineAt) <= parseInstant(now)
    ? { status: 'NO_RESPONSE', noResponseReachedAt: now }
    : { status: 'PROGRAMMED', noResponseReachedAt: null };
}

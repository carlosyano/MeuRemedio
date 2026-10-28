// Slots de ocorrencia de um plano em uma janela de datas civis (parte pura do gerador, RF-004).
// Regras normativas: Especificacao 02.33 (RN-007, RN-009, RN-013) e ADR-001 v1.5 (OA-003):
//   - no maximo 1 slot por (data civil, horario civil); local_time preserva o horario pedido;
//   - scheduled_at segue resolveCivilInstant (lacuna avanca; ambiguo usa o primeiro instante);
//   - deadline_at = scheduled_at + 60 minutos;
//   - periodicidade (DEC-037): todos os dias (padrao), dias da semana escolhidos ou a cada N dias
//     contados da data de inicio, sempre no calendario civil.
// A janela [fromDate, toDate] e explicita e inclusiva; o horizonte movel de 30 dias (DEC-027) e
// calculado por generationHorizon.
import {
  InvalidCivilInputError,
  deadlineFor,
  resolveCivilInstant,
  type CivilResolution,
} from './civil-time.js';
import { civilDate, dayNumber } from './calendar.js';

export interface ScheduleTimeInput {
  readonly id: string;
  /** Horario civil HH:MM. */
  readonly timeOfDay: string;
}

export type Weekday =
  'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

/** Dias da semana na ordem de segunda a domingo (indice 0 = segunda). */
export const WEEKDAYS: readonly Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

/** Periodicidade do plano (PlanRecurrence, DEC-037). */
export type Recurrence =
  | { readonly kind: 'DAILY' }
  | { readonly kind: 'WEEKDAYS'; readonly weekdays: readonly Weekday[] }
  | { readonly kind: 'EVERY_N_DAYS'; readonly intervalDays: number };

export const MIN_INTERVAL_DAYS = 2;
export const MAX_INTERVAL_DAYS = 365;

export interface OccurrenceSlotsInput {
  /** Fuso IANA da conta (RN-013). */
  readonly timeZone: string;
  readonly planStartDate: string;
  readonly planEndDate: string | null;
  readonly times: readonly ScheduleTimeInput[];
  /** Periodicidade; omitida vale todos os dias. */
  readonly recurrence?: Recurrence;
  /** Primeira data civil da janela (inclusiva). */
  readonly fromDate: string;
  /** Ultima data civil da janela (inclusiva). */
  readonly toDate: string;
}

export interface OccurrenceSlot {
  readonly scheduleTimeId: string;
  readonly localDate: string;
  readonly localTime: string;
  readonly scheduledAt: string;
  readonly deadlineAt: string;
  readonly resolution: CivilResolution;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function occurrenceSlots(input: OccurrenceSlotsInput): OccurrenceSlot[] {
  const from = dayNumber(input.fromDate, 'Data inicial da janela');
  const to = dayNumber(input.toDate, 'Data final da janela');
  const start = dayNumber(input.planStartDate, 'Data de inicio do plano');
  const end =
    input.planEndDate === null
      ? Number.POSITIVE_INFINITY
      : dayNumber(input.planEndDate, 'Data de termino do plano');

  const seen = new Set<string>();
  for (const time of input.times) {
    if (!TIME_PATTERN.test(time.timeOfDay)) {
      throw new InvalidCivilInputError(`Horario fora do formato: "${time.timeOfDay}"`);
    }
    if (seen.has(time.timeOfDay)) {
      throw new InvalidCivilInputError(`Horario repetido no plano: "${time.timeOfDay}"`);
    }
    seen.add(time.timeOfDay);
  }
  const inRecurrence = recurrenceFilter(input.recurrence ?? { kind: 'DAILY' }, start);
  // Valida o fuso mesmo quando a janela nao produz slots.
  resolveCivilInstant(input.fromDate, '00:00', input.timeZone);

  const times = [...input.times].sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
  const slots: OccurrenceSlot[] = [];
  for (let day = Math.max(from, start); day <= Math.min(to, end); day += 1) {
    if (!inRecurrence(day)) continue;
    const localDate = civilDate(day);
    for (const time of times) {
      const { instantUtc, resolution } = resolveCivilInstant(
        localDate,
        time.timeOfDay,
        input.timeZone,
      );
      slots.push({
        scheduleTimeId: time.id,
        localDate,
        localTime: time.timeOfDay,
        scheduledAt: instantUtc,
        deadlineAt: deadlineFor(instantUtc),
        resolution,
      });
    }
  }
  return slots;
}

/** Dia da semana de um numero de dia civil: 1970-01-01 (dia 0) foi uma quinta-feira. */
export const weekdayOfDay = (day: number): Weekday =>
  WEEKDAYS[(((day + 3) % 7) + 7) % 7] as Weekday;

/** Valida a periodicidade e devolve o teste "o dia civil entra?". */
function recurrenceFilter(recurrence: Recurrence, start: number): (day: number) => boolean {
  switch (recurrence.kind) {
    case 'DAILY':
      return () => true;
    case 'WEEKDAYS': {
      const chosen = new Set(recurrence.weekdays);
      if (
        recurrence.weekdays.length === 0 ||
        chosen.size !== recurrence.weekdays.length ||
        recurrence.weekdays.some((weekday) => !WEEKDAYS.includes(weekday))
      ) {
        throw new InvalidCivilInputError(
          `Dias da semana invalidos: ${JSON.stringify(recurrence.weekdays)}`,
        );
      }
      return (day) => chosen.has(weekdayOfDay(day));
    }
    case 'EVERY_N_DAYS': {
      const n = recurrence.intervalDays;
      if (!Number.isInteger(n) || n < MIN_INTERVAL_DAYS || n > MAX_INTERVAL_DAYS) {
        throw new InvalidCivilInputError(`Intervalo em dias invalido: ${String(n)}`);
      }
      // So dias a partir do inicio chegam aqui, entao a diferenca nunca e negativa.
      return (day) => (day - start) % n === 0;
    }
  }
}

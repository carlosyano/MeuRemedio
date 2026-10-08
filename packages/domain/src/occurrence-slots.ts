// Slots de ocorrencia de um plano em uma janela de datas civis (parte pura do gerador, RF-004).
// Regras normativas: Especificacao 02.33 (RN-007, RN-009, RN-013) e ADR-001 v1.5 (OA-003):
//   - no maximo 1 slot por (data civil, horario civil); local_time preserva o horario pedido;
//   - scheduled_at segue resolveCivilInstant (lacuna avanca; ambiguo usa o primeiro instante);
//   - deadline_at = scheduled_at + 60 minutos.
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

export interface OccurrenceSlotsInput {
  /** Fuso IANA da conta (RN-013). */
  readonly timeZone: string;
  readonly planStartDate: string;
  readonly planEndDate: string | null;
  readonly times: readonly ScheduleTimeInput[];
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
  // Valida o fuso mesmo quando a janela nao produz slots.
  resolveCivilInstant(input.fromDate, '00:00', input.timeZone);

  const times = [...input.times].sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
  const slots: OccurrenceSlot[] = [];
  for (let day = Math.max(from, start); day <= Math.min(to, end); day += 1) {
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

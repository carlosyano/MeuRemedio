// Gerador de ocorrencias de um plano em uma janela de datas civis (RF-004, RN-007, RN-013).
// - idempotente: reexecutar nao insere nem altera linhas (ON CONFLICT no indice parcial
//   occurrences_slot_active_unique, que e a garantia de RN-007 no banco);
// - execucoes simultaneas nao duplicam: inserem os slots na mesma ordem e o conflito e absorvido;
// - so plano ACTIVE gera (DELETED, CANCELED, INTERRUPTED ou inexistente nao gera nada); horarios
//   removidos sao ignorados;
// - plano retomado (DEC-036) so gera os horarios posteriores a retomada (status_changed_at): o
//   periodo interrompido nao renasce;
// - so os dias da periodicidade do plano geram slots (DEC-037): todos os dias, dias da semana
//   escolhidos ou a cada N dias contados do inicio;
// - a linha do plano fica bloqueada (FOR SHARE) durante a geracao, serializando com a edicao;
// - horario com prazo ja atingido em `now` nasce NO_RESPONSE (DEC-027).
// generateOccurrencesForHorizon aplica o horizonte de 30 dias da DEC-027; generateOccurrences
// recebe a janela explicita. O disparo (Outbox e job horario) fica com quem chama.
import {
  generationHorizon,
  initialOccurrenceState,
  occurrenceSlots,
  weekdaysFromMask,
  type GenerationWindow,
  type Recurrence,
} from '@meuremedio/domain';
import type { Pool } from 'pg';

export interface GenerateOccurrencesForHorizonInput {
  readonly planId: string;
  /** Instante da geracao, UTC (YYYY-MM-DDTHH:MM:SSZ). */
  readonly now: string;
}

export interface GenerateOccurrencesInput extends GenerateOccurrencesForHorizonInput {
  /** Primeira data civil da janela, no fuso da conta (inclusiva). */
  readonly fromDate: string;
  /** Ultima data civil da janela, no fuso da conta (inclusiva). */
  readonly toDate: string;
}

export interface GenerateOccurrencesResult {
  readonly inserted: number;
}

interface PlanRow {
  user_id: string;
  start_date: string;
  end_date: string | null;
  medication_name: string;
  dose_text: string;
  account_timezone: string;
  /** Instante da retomada, se houve (num plano ACTIVE, so a retomada grava status_changed_at). */
  status_changed_at: Date | null;
  recurrence_kind: Recurrence['kind'];
  /** Mascara de bits dos dias da semana (migracao 0015). */
  recurrence_weekdays: number | null;
  recurrence_interval_days: number | null;
  /** Nome do motivo do tratamento, copiado como snapshot (DEC-038). */
  treatment_reason_name: string | null;
}

/** Periodicidade gravada no plano, no formato do dominio. */
function recurrenceOf(plan: PlanRow): Recurrence {
  if (plan.recurrence_kind === 'WEEKDAYS' && plan.recurrence_weekdays !== null) {
    return { kind: 'WEEKDAYS', weekdays: weekdaysFromMask(plan.recurrence_weekdays) };
  }
  if (plan.recurrence_kind === 'EVERY_N_DAYS' && plan.recurrence_interval_days !== null) {
    return { kind: 'EVERY_N_DAYS', intervalDays: plan.recurrence_interval_days };
  }
  return { kind: 'DAILY' };
}

/** Gera as ocorrencias do horizonte de 30 dias (DEC-027) a partir de `now`, no fuso da conta. */
export function generateOccurrencesForHorizon(
  pool: Pool,
  input: GenerateOccurrencesForHorizonInput,
): Promise<GenerateOccurrencesResult> {
  return generate(pool, input.planId, input.now, (plan) =>
    generationHorizon({
      now: input.now,
      timeZone: plan.account_timezone,
      planStartDate: plan.start_date,
      planEndDate: plan.end_date,
    }),
  );
}

/** Gera as ocorrencias de uma janela explicita de datas civis. */
export function generateOccurrences(
  pool: Pool,
  input: GenerateOccurrencesInput,
): Promise<GenerateOccurrencesResult> {
  return generate(pool, input.planId, input.now, () => ({
    fromDate: input.fromDate,
    toDate: input.toDate,
  }));
}

async function generate(
  pool: Pool,
  planId: string,
  now: string,
  windowFor: (plan: PlanRow) => GenerationWindow | null,
): Promise<GenerateOccurrencesResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = (
      await client.query<PlanRow>(
        `SELECT p.user_id,
                to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
                to_char(p.end_date, 'YYYY-MM-DD') AS end_date,
                p.medication_name, p.dose_text, u.account_timezone, p.status_changed_at,
                p.recurrence_kind, p.recurrence_weekdays, p.recurrence_interval_days,
                (SELECT tr.name FROM treatment_reasons tr WHERE tr.id = p.treatment_reason_id)
                  AS treatment_reason_name
           FROM medication_plans p
           JOIN users u ON u.id = p.user_id
          WHERE p.id = $1 AND p.status = 'ACTIVE'
            FOR SHARE OF p`,
        [planId],
      )
    ).rows[0];
    if (!plan) {
      await client.query('COMMIT');
      return { inserted: 0 };
    }
    const times = await client.query<{ id: string; time_of_day: string }>(
      `SELECT id, to_char(time_of_day, 'HH24:MI') AS time_of_day
         FROM schedule_times
        WHERE plan_id = $1 AND removed_at IS NULL`,
      [planId],
    );
    const window = windowFor(plan);
    if (!window) {
      await client.query('COMMIT');
      return { inserted: 0 };
    }
    const resumedAt = plan.status_changed_at?.getTime() ?? null;
    const slots = occurrenceSlots({
      timeZone: plan.account_timezone,
      planStartDate: plan.start_date,
      planEndDate: plan.end_date,
      times: times.rows.map((row) => ({ id: row.id, timeOfDay: row.time_of_day })),
      recurrence: recurrenceOf(plan),
      fromDate: window.fromDate,
      toDate: window.toDate,
    }).filter((slot) => resumedAt === null || Date.parse(slot.scheduledAt) > resumedAt);
    if (slots.length === 0) {
      await client.query('COMMIT');
      return { inserted: 0 };
    }
    const states = slots.map((slot) => initialOccurrenceState(slot.deadlineAt, now));
    const result = await client.query(
      `INSERT INTO occurrences (user_id, plan_id, schedule_time_id, local_scheduled_date, local_time,
                                scheduled_at, deadline_at, status, no_response_reached_at,
                                medication_name_snapshot, dose_text_snapshot,
                                treatment_reason_snapshot)
       SELECT $1, $2, s.schedule_time_id, s.local_date, s.local_time, s.scheduled_at, s.deadline_at,
              s.status, s.no_response_reached_at, $3, $4, $12
         FROM unnest($5::uuid[], $6::date[], $7::time[], $8::timestamptz[], $9::timestamptz[],
                     $10::occurrence_status[], $11::timestamptz[])
              AS s (schedule_time_id, local_date, local_time, scheduled_at, deadline_at, status,
                    no_response_reached_at)
       ON CONFLICT (plan_id, local_scheduled_date, local_time) WHERE status <> 'CANCELED' DO NOTHING`,
      [
        plan.user_id,
        planId,
        plan.medication_name,
        plan.dose_text,
        slots.map((slot) => slot.scheduleTimeId),
        slots.map((slot) => slot.localDate),
        slots.map((slot) => slot.localTime),
        slots.map((slot) => slot.scheduledAt),
        slots.map((slot) => slot.deadlineAt),
        states.map((state) => state.status),
        states.map((state) => state.noResponseReachedAt),
        plan.treatment_reason_name,
      ],
    );
    await client.query('COMMIT');
    return { inserted: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

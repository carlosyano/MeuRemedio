// Lembretes por e-mail (RF-005, RN-018, FL-004, DEC-005; TS-017, TS-034, TS-035; DC-040).
//   - varredura a cada minuto: cria 1 lembrete REQUESTED por ocorrencia PROGRAMMED alcancada
//     (scheduled_at <= agora < deadline_at) de plano ACTIVE e conta ACTIVE, com o evento
//     reminders.email_requested no Outbox na mesma transacao; o UNIQUE(occurrence_id) impede o
//     segundo lembrete;
//   - consumidor: com o lembrete bloqueado, suprime (FAILED SUPPRESSED_RESPONDED ou
//     SUPPRESSED_DELETION) ou registra a tentativa como DELIVERY_UNKNOWN e confirma ANTES de chamar
//     o provedor. So um lembrete REQUESTED e enviado: reentrega, retomada ou erro incerto nunca
//     reenviam (sem reenvio cego). Aceite -> SENT com a evidencia; recusa definitiva -> FAILED
//     PROVIDER_REJECTED; qualquer outro erro mantem DELIVERY_UNKNOWN;
//   - conciliacao: evidencia positiva do provedor -> SENT; janela de 24 h encerrada -> FAILED
//     DELIVERY_UNCONFIRMED;
//   - o e-mail informa o nome do medicamento (snapshot da ocorrencia) e o horario local previsto,
//     sem dose nem link com token (RN-018, DEC-031).
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { EmailRejectedError, type EmailSender } from '../../../platform/email/email-sender.js';

export const REMINDERS_SWEEP_QUEUE = 'reminders.sweep';
export const REMINDERS_SWEEP_CRON = '* * * * *';
export const REMINDER_REQUESTED = 'reminders.email_requested';

/** Janela de conciliacao de DELIVERY_UNKNOWN (DC-040). */
const RECONCILE_WINDOW_MS = 24 * 3_600_000;

export interface ReminderRequested {
  readonly event_id: string;
  readonly reminder_id: string;
}

export interface ReminderDeps {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly email: EmailSender;
  readonly webBaseUrl: string;
}

/** Cria os lembretes das ocorrencias que chegaram ao horario, com o evento do Outbox. */
export async function requestDueReminders(
  pool: Pool,
  input: { now: string },
): Promise<{ requested: number }> {
  const result = await pool.query(
    `WITH due AS (
       INSERT INTO email_reminders (occurrence_id, user_id, requested_at, created_at, updated_at)
       SELECT o.id, o.user_id, $1, $1, $1
         FROM occurrences o
         JOIN medication_plans p ON p.id = o.plan_id AND p.status = 'ACTIVE'
         JOIN users u ON u.id = o.user_id AND u.status = 'ACTIVE'
        WHERE o.status = 'PROGRAMMED' AND o.scheduled_at <= $1 AND o.deadline_at > $1
       ON CONFLICT (occurrence_id) DO NOTHING
       RETURNING id
     )
     INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, available_at,
                                created_at)
     SELECT 'email_reminder', id, $2, jsonb_build_object('reminder_id', id), $1, $1 FROM due`,
    [input.now, REMINDER_REQUESTED],
  );
  return { requested: result.rowCount ?? 0 };
}

/** Encerra a conciliacao dos envios incertos cuja janela terminou. */
export async function expireUnconfirmedReminders(
  pool: Pool,
  input: { now: string },
): Promise<{ failed: number }> {
  const result = await pool.query(
    `UPDATE email_reminders
        SET status = 'FAILED', failure_code = 'DELIVERY_UNCONFIRMED', updated_at = $1
      WHERE status = 'DELIVERY_UNKNOWN' AND reconcile_until <= $1`,
    [input.now],
  );
  return { failed: result.rowCount ?? 0 };
}

/**
 * Conciliacao positiva (evidencia do provedor para um envio incerto). Devolve false quando o
 * lembrete nao esta mais DELIVERY_UNKNOWN ou a janela ja terminou.
 */
export async function confirmReminderDelivery(
  pool: Pool,
  input: { reminderId: string; providerMessageId: string; now: string },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE email_reminders
        SET status = 'SENT', provider_message_id = $2, sent_at = $3, updated_at = $3
      WHERE id = $1 AND status = 'DELIVERY_UNKNOWN' AND reconcile_until > $3`,
    [input.reminderId, input.providerMessageId, input.now],
  );
  return result.rowCount === 1;
}

/** Consumidor da fila agendada: solicita os lembretes do minuto e encerra conciliacoes vencidas. */
export async function handleRemindersSweep(deps: { pool: Pool; clock: Clock }): Promise<void> {
  const now = deps.clock.now();
  await requestDueReminders(deps.pool, { now });
  await expireUnconfirmedReminders(deps.pool, { now });
}

interface Claimed {
  readonly to: string;
  readonly medicationName: string;
  readonly localTime: string;
}

/** Consumidor de reminders.email_requested. */
export async function handleReminderRequested(
  deps: ReminderDeps,
  event: ReminderRequested,
): Promise<void> {
  const now = deps.clock.now();
  const claimed = await withTransaction(deps.pool, async (client): Promise<Claimed | undefined> => {
    const row = (
      await client.query<{
        status: string;
        occurrence_status: string;
        plan_status: string;
        user_status: string;
        email: string;
        medication_name: string;
        local_time: string;
      }>(
        `SELECT r.status, o.status AS occurrence_status, p.status AS plan_status,
                u.status AS user_status, u.email_normalized AS email,
                o.medication_name_snapshot AS medication_name,
                to_char(o.local_time, 'HH24:MI') AS local_time
           FROM email_reminders r
           JOIN occurrences o ON o.id = r.occurrence_id
           JOIN medication_plans p ON p.id = o.plan_id
           JOIN users u ON u.id = r.user_id
          WHERE r.id = $1
          FOR UPDATE OF r`,
        [event.reminder_id],
      )
    ).rows[0];
    // Ja tentado, concluido ou inexistente: nunca reenviar.
    if (row?.status !== 'REQUESTED') return undefined;

    const suppression =
      row.occurrence_status === 'TAKEN' || row.occurrence_status === 'NOT_TAKEN'
        ? 'SUPPRESSED_RESPONDED'
        : row.occurrence_status === 'CANCELED' ||
            row.plan_status !== 'ACTIVE' ||
            row.user_status !== 'ACTIVE'
          ? 'SUPPRESSED_DELETION'
          : undefined;
    if (suppression !== undefined) {
      await client.query(
        `UPDATE email_reminders SET status = 'FAILED', failure_code = $2, updated_at = $3
          WHERE id = $1`,
        [event.reminder_id, suppression, now],
      );
      return undefined;
    }

    // Registro da tentativa confirmado antes do envio: uma queda daqui em diante deixa o envio
    // incerto, e nao pendente de novo envio.
    await client.query(
      `UPDATE email_reminders
          SET status = 'DELIVERY_UNKNOWN', attempts = attempts + 1, last_attempt_at = $2,
              reconcile_until = $3, updated_at = $2
        WHERE id = $1`,
      [event.reminder_id, now, new Date(Date.parse(now) + RECONCILE_WINDOW_MS).toISOString()],
    );
    return { to: row.email, medicationName: row.medication_name, localTime: row.local_time };
  });
  if (claimed === undefined) return;

  try {
    const receipt = await deps.email.send({
      to: claimed.to,
      subject: `Lembrete: ${claimed.medicationName} às ${claimed.localTime}`,
      text: [
        'Olá!',
        '',
        `Chegou o horário de ${claimed.medicationName}, previsto para as ${claimed.localTime}.`,
        'Abra o MeuRemedio para registrar se você tomou:',
        '',
        `${deps.webBaseUrl.replace(/\/+$/, '')}/`,
        '',
        'Você recebe este e-mail porque cadastrou a rotina no MeuRemedio.',
      ].join('\n'),
      reference: event.reminder_id,
    });
    const sentAt = deps.clock.now();
    await deps.pool.query(
      `UPDATE email_reminders
          SET status = 'SENT', provider_message_id = $2, sent_at = $3, updated_at = $3
        WHERE id = $1 AND status = 'DELIVERY_UNKNOWN'`,
      [event.reminder_id, receipt?.providerMessageId ?? null, sentAt],
    );
  } catch (error) {
    if (error instanceof EmailRejectedError) {
      await deps.pool.query(
        `UPDATE email_reminders
            SET status = 'FAILED', failure_code = 'PROVIDER_REJECTED', updated_at = $2
          WHERE id = $1 AND status = 'DELIVERY_UNKNOWN'`,
        [event.reminder_id, deps.clock.now()],
      );
    }
    // Erro incerto: fica DELIVERY_UNKNOWN para a conciliacao (DEC-005), sem relancar, para o
    // pg-boss nao reentregar a toa.
  }
}

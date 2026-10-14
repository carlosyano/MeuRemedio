// @trace RF-005 RN-009 RN-018 TS-017 TS-034 TS-035 ENT-009 DEC-031 (DEC-005; ADR-001 v1.5 OA-002)
// Lembretes por e-mail contra PostgreSQL 17 real: 1 e-mail por ocorrencia em scheduled_at, com o
// nome do medicamento e o horario local previsto, sem dose nem link com token (RN-018, DEC-031);
// supressao depois da resposta ou da
// exclusao (TS-034); entrega incerta fica DELIVERY_UNKNOWN sem reenvio cego e expira em FAILED
// DELIVERY_UNCONFIRMED (DEC-005, TS-035); retomada do worker sem e-mail duplicado (TS-017).
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markReachedDeadlines } from '../../apps/api/src/modules/occurrences/application/deadline-sweep.js';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import {
  REMINDERS_SWEEP_QUEUE,
  confirmReminderDelivery,
  expireUnconfirmedReminders,
  handleReminderRequested,
  requestDueReminders,
} from '../../apps/api/src/modules/reminders/application/email-reminders.js';
import {
  EmailRejectedError,
  type EmailMessage,
  type EmailReceipt,
  type EmailSender,
} from '../../apps/api/src/platform/email/email-sender.js';
import { startWorker } from '../../apps/api/src/worker.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 08:00 local = 11:00Z (prazo 12:00Z); 20:00 local = 23:00Z.
const NOW = '2026-10-05T10:30:00Z';
const WEB = 'https://app.example.invalid';
let h: Harness;

/** Provedor falso: conta os envios e simula aceite, rejeicao, incerteza ou queda do processo. */
class FakeProvider implements EmailSender {
  readonly sent: EmailMessage[] = [];
  mode: 'accept' | 'reject' | 'timeout' | 'crash-after-send' | 'crash-before-send' = 'accept';
  private sequence = 0;

  send(message: EmailMessage): Promise<EmailReceipt> {
    switch (this.mode) {
      case 'reject':
        return Promise.reject(new EmailRejectedError('MessageRejected'));
      case 'timeout':
        this.sent.push(message);
        return Promise.reject(new Error('timeout de 30 s sem resposta do provedor'));
      case 'crash-after-send':
        // Aceito pelo provedor, mas o processo cai antes de registrar o SENT.
        this.sent.push(message);
        return Promise.reject(new Error('processo encerrado'));
      case 'crash-before-send':
        return Promise.reject(new Error('processo encerrado'));
      default:
        this.sequence += 1;
        this.sent.push(message);
        return Promise.resolve({ providerMessageId: `ses-${String(this.sequence)}` });
    }
  }
}

let email: FakeProvider;
let ana: LoggedIn;
let anaId: string;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  email = new FakeProvider();
  anaId = await h.activeUser('ana.silva@example.com');
  ana = await login(h, 'ana.silva@example.com');
});

const PLAN = {
  medication_name: 'Losartana Sintetica',
  dose_text: '50 mg',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

async function planWithOccurrences(medicationName: string = PLAN.medication_name): Promise<string> {
  const response = await h.call('createPlan', 'POST', '/plans', {
    body: { ...PLAN, medication_name: medicationName },
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(201);
  const planId = (response.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  return planId;
}

const occurrenceId = async (planId: string, time: string): Promise<string> => {
  const row = (
    await h.pool.query<{ id: string }>(
      `SELECT id FROM occurrences
        WHERE plan_id = $1 AND local_scheduled_date = '2026-10-05' AND local_time = $2`,
      [planId, time],
    )
  ).rows[0];
  if (row === undefined) throw new Error(`ocorrencia ${time} ausente`);
  return row.id;
};

interface ReminderRow {
  id: string;
  occurrence_id: string;
  status: string;
  attempts: number;
  provider_message_id: string | null;
  sent_at: Date | null;
  last_attempt_at: Date | null;
  reconcile_until: Date | null;
  failure_code: string | null;
}

const reminders = async (): Promise<ReminderRow[]> =>
  (
    await h.pool.query<ReminderRow>(
      `SELECT id, occurrence_id, status, attempts, provider_message_id, sent_at, last_attempt_at,
              reconcile_until, failure_code
         FROM email_reminders ORDER BY requested_at, id`,
    )
  ).rows;

const deps = () => ({ pool: h.pool, clock: { now: () => h.now }, email, webBaseUrl: WEB });

/** Consome o evento do Outbox do lembrete como o worker faria. */
async function deliver(reminderId: string): Promise<void> {
  await handleReminderRequested(deps(), {
    event_id: '00000000-0000-4000-8000-000000000001',
    reminder_id: reminderId,
  });
}

/** Chega a 08:00 local, solicita o lembrete e devolve o id. */
async function requestAtEight(planId: string): Promise<string> {
  h.now = '2026-10-05T11:00:00Z';
  expect(await requestDueReminders(h.pool, { now: h.now })).toEqual({ requested: 1 });
  const [row] = await reminders();
  expect(row?.occurrence_id).toBe(await occurrenceId(planId, '08:00'));
  return row?.id ?? '';
}

describe('requestDueReminders: 1 lembrete por ocorrencia em scheduled_at (RN-018)', () => {
  it('antes do horario nada; no horario cria o lembrete REQUESTED e o evento do Outbox', async () => {
    const planId = await planWithOccurrences();
    expect(await requestDueReminders(h.pool, { now: '2026-10-05T10:59:59Z' })).toEqual({
      requested: 0,
    });
    const id = await requestAtEight(planId);
    expect((await reminders())[0]).toMatchObject({ status: 'REQUESTED', attempts: 0 });
    const events = await h.pool.query<{ payload: { reminder_id: string } }>(
      `SELECT payload FROM outbox_events WHERE event_type = 'reminders.email_requested'`,
    );
    expect(events.rows.map((row) => row.payload.reminder_id)).toEqual([id]);
  });

  it('reexecutar nao cria segundo lembrete nem segundo evento', async () => {
    const planId = await planWithOccurrences();
    await requestAtEight(planId);
    expect(await requestDueReminders(h.pool, { now: '2026-10-05T11:01:00Z' })).toEqual({
      requested: 0,
    });
    const events = await h.pool.query(
      `SELECT 1 FROM outbox_events WHERE event_type = 'reminders.email_requested'`,
    );
    expect(events.rowCount).toBe(1);
  });

  it('prazo ja atingido (worker parado ate depois do prazo): nao solicita (DC-040)', async () => {
    await planWithOccurrences();
    expect(await requestDueReminders(h.pool, { now: '2026-10-05T12:00:00Z' })).toEqual({
      requested: 0,
    });
  });

  it('TS-034: respondida, cancelada, de plano excluido ou de conta em exclusao: nao solicita', async () => {
    const planId = await planWithOccurrences();
    h.now = '2026-10-05T11:00:00Z';
    ana = await login(h, 'ana.silva@example.com');
    const eight = await occurrenceId(planId, '08:00');
    const response = await h.call('createResponse', 'POST', `/occurrences/${eight}/responses`, {
      body: { type: 'TAKEN', reason: null },
      headers: { ...ana.mutation, 'idempotency-key': nextKey() },
    });
    expect(response.status).toBe(201);
    expect(await requestDueReminders(h.pool, { now: h.now })).toEqual({ requested: 0 });

    const other = await planWithOccurrences('Outro Sintetico');
    await h.pool.query(
      `UPDATE occurrences SET status = 'CANCELED'
        WHERE plan_id = $1 AND local_scheduled_date = '2026-10-05' AND local_time = '08:00'`,
      [other],
    );
    expect(await requestDueReminders(h.pool, { now: h.now })).toEqual({ requested: 0 });

    const third = await planWithOccurrences('Terceiro Sintetico');
    expect(
      (await h.call('deletePlan', 'DELETE', `/plans/${third}`, { headers: ana.mutation })).status,
    ).toBe(204);
    await h.pool.query(`UPDATE users SET status = 'DELETION_SCHEDULED' WHERE id = $1`, [anaId]);
    expect(await requestDueReminders(h.pool, { now: '2026-10-05T23:00:00Z' })).toEqual({
      requested: 0,
    });
  });
});

describe('handleReminderRequested: envio minimizado e estados (FL-004)', () => {
  it('DEC-031: envia 1 e-mail com nome e horario, sem dose nem token, e registra SENT', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    await deliver(id);
    expect(email.sent).toHaveLength(1);
    const [message] = email.sent;
    expect(message?.to).toBe('ana.silva@example.com');
    expect(message?.reference).toBe(id);
    expect(message?.subject).toBe('Lembrete: Losartana Sintetica às 08:00');
    expect(message?.text).toContain('Losartana Sintetica');
    expect(message?.text).toContain('08:00');
    const content = `${message?.subject ?? ''}\n${message?.text ?? ''}`;
    expect(content).not.toMatch(/50 mg|comprimido/i);
    expect(content).not.toMatch(/token|[?&]\w+=/i);
    expect(content).toContain(WEB);
    expect((await reminders())[0]).toMatchObject({
      status: 'SENT',
      attempts: 1,
      provider_message_id: 'ses-1',
      sent_at: new Date('2026-10-05T11:00:00Z'),
      failure_code: null,
    });
  });

  it('DEC-031: usa o snapshot da ocorrencia, nao o nome atual do plano', async () => {
    const planId = await planWithOccurrences();
    await h.pool.query(
      `UPDATE occurrences SET medication_name_snapshot = 'Nome Anterior Sintetico'
        WHERE plan_id = $1 AND local_time = '08:00'`,
      [planId],
    );
    await deliver(await requestAtEight(planId));
    expect(email.sent[0]?.subject).toBe('Lembrete: Nome Anterior Sintetico às 08:00');
  });

  it('reentrega do evento depois do SENT nao reenvia', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    await deliver(id);
    await deliver(id);
    expect(email.sent).toHaveLength(1);
  });

  it('TS-034: respondida entre a solicitacao e o envio: FAILED SUPPRESSED_RESPONDED sem e-mail', async () => {
    const planId = await planWithOccurrences();
    const id = await requestAtEight(planId);
    ana = await login(h, 'ana.silva@example.com');
    const eight = await occurrenceId(planId, '08:00');
    expect(
      (
        await h.call('createResponse', 'POST', `/occurrences/${eight}/responses`, {
          body: { type: 'NOT_TAKEN', reason: 'FORGOT' },
          headers: { ...ana.mutation, 'idempotency-key': nextKey() },
        })
      ).status,
    ).toBe(201);
    await deliver(id);
    expect(email.sent).toEqual([]);
    expect((await reminders())[0]).toMatchObject({
      status: 'FAILED',
      failure_code: 'SUPPRESSED_RESPONDED',
      attempts: 0,
    });
  });

  it.each([
    [
      'plano excluido',
      async (planId: string) => {
        ana = await login(h, 'ana.silva@example.com');
        const response = await h.call('deletePlan', 'DELETE', `/plans/${planId}`, {
          headers: ana.mutation,
        });
        expect(response.status).toBe(204);
      },
    ],
    [
      'conta em exclusao',
      async () => {
        await h.pool.query(`UPDATE users SET status = 'DELETION_SCHEDULED' WHERE id = $1`, [anaId]);
      },
    ],
  ])(
    'TS-034: %s entre a solicitacao e o envio: FAILED SUPPRESSED_DELETION sem e-mail',
    async (_caso, remove) => {
      const planId = await planWithOccurrences();
      const id = await requestAtEight(planId);
      await remove(planId);
      await deliver(id);
      expect(email.sent).toEqual([]);
      expect((await reminders())[0]).toMatchObject({
        status: 'FAILED',
        failure_code: 'SUPPRESSED_DELETION',
      });
    },
  );

  it('rejeicao definitiva do provedor: FAILED PROVIDER_REJECTED', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    email.mode = 'reject';
    await deliver(id);
    expect((await reminders())[0]).toMatchObject({
      status: 'FAILED',
      failure_code: 'PROVIDER_REJECTED',
      attempts: 1,
    });
  });

  it('TS-035: timeout sem confirmacao: DELIVERY_UNKNOWN com janela de 24 h e sem reenvio cego', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    email.mode = 'timeout';
    await deliver(id);
    expect((await reminders())[0]).toMatchObject({
      status: 'DELIVERY_UNKNOWN',
      attempts: 1,
      last_attempt_at: new Date('2026-10-05T11:00:00Z'),
      reconcile_until: new Date('2026-10-06T11:00:00Z'),
    });
    email.mode = 'accept';
    await deliver(id);
    expect(email.sent).toHaveLength(1);
    expect((await reminders())[0]?.status).toBe('DELIVERY_UNKNOWN');
  });
});

describe('conciliacao de DELIVERY_UNKNOWN (DEC-005, FL-004)', () => {
  it('conciliacao positiva: SENT com a evidencia; repetir nao altera', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    email.mode = 'timeout';
    await deliver(id);
    h.now = '2026-10-05T11:30:00Z';
    expect(
      await confirmReminderDelivery(h.pool, {
        reminderId: id,
        providerMessageId: 'ses-evento',
        now: h.now,
      }),
    ).toBe(true);
    expect((await reminders())[0]).toMatchObject({
      status: 'SENT',
      provider_message_id: 'ses-evento',
      sent_at: new Date('2026-10-05T11:30:00Z'),
    });
    expect(
      await confirmReminderDelivery(h.pool, {
        reminderId: id,
        providerMessageId: 'outro',
        now: '2026-10-05T11:31:00Z',
      }),
    ).toBe(false);
    expect((await reminders())[0]?.provider_message_id).toBe('ses-evento');
  });

  it('janela encerrada: FAILED DELIVERY_UNCONFIRMED; antes dela nada muda', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    email.mode = 'timeout';
    await deliver(id);
    expect(await expireUnconfirmedReminders(h.pool, { now: '2026-10-06T10:59:59Z' })).toEqual({
      failed: 0,
    });
    expect(await expireUnconfirmedReminders(h.pool, { now: '2026-10-06T11:00:00Z' })).toEqual({
      failed: 1,
    });
    expect((await reminders())[0]).toMatchObject({
      status: 'FAILED',
      failure_code: 'DELIVERY_UNCONFIRMED',
    });
    expect(
      await confirmReminderDelivery(h.pool, {
        reminderId: id,
        providerMessageId: 'tarde',
        now: '2026-10-06T11:00:01Z',
      }),
    ).toBe(false);
  });
});

describe('TS-017: retomada do worker sem efeito duplicado', () => {
  it('queda depois de enviar e antes do ack: reiniciar nao reenvia; termina DELIVERY_UNKNOWN', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    email.mode = 'crash-after-send';
    await deliver(id);
    email.mode = 'accept';
    await deliver(id); // reentrega do pg-boss depois do restart
    expect(email.sent).toHaveLength(1);
    expect((await reminders())[0]).toMatchObject({ status: 'DELIVERY_UNKNOWN', attempts: 1 });
  });

  it('queda antes do envio: termina DELIVERY_UNKNOWN sem reenvio cego e sem e-mail', async () => {
    const id = await requestAtEight(await planWithOccurrences());
    email.mode = 'crash-before-send';
    await deliver(id);
    email.mode = 'accept';
    await deliver(id);
    expect(email.sent).toEqual([]);
    expect((await reminders())[0]).toMatchObject({ status: 'DELIVERY_UNKNOWN', attempts: 1 });
  });

  it('reexecutar o gerador, o job de prazo e a solicitacao nao altera os estados', async () => {
    const planId = await planWithOccurrences();
    const id = await requestAtEight(planId);
    await deliver(id);
    const before = await reminders();
    h.now = '2026-10-05T12:30:00Z';
    await handleOccurrencesRequested(
      { pool: h.pool, clock: { now: () => h.now } },
      { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
    );
    await markReachedDeadlines(h.pool, { now: h.now });
    await requestDueReminders(h.pool, { now: h.now });
    await expireUnconfirmedReminders(h.pool, { now: h.now });
    expect(await reminders()).toEqual(before);
    expect(email.sent).toHaveLength(1);
  });
});

describe('worker: varredura de lembretes a cada minuto', () => {
  it('agenda a fila; a varredura, o Outbox e o consumidor entregam 1 e-mail', async () => {
    await planWithOccurrences();
    const boss = new PgBoss({ connectionString: h.url });
    boss.on('error', () => undefined);
    h.now = '2026-10-05T11:00:30Z';
    const worker = await startWorker({
      pool: h.pool,
      boss,
      clock: { now: () => h.now },
      email,
      webBaseUrl: WEB,
      emailPepper: Buffer.alloc(32, 7),
      pollIntervalMs: 100,
    });
    try {
      const schedules = await boss.getSchedules(REMINDERS_SWEEP_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(['* * * * *']);

      await boss.send(REMINDERS_SWEEP_QUEUE, {});
      const limit = Date.now() + 20_000;
      while ((await reminders())[0]?.status !== 'SENT' && Date.now() < limit) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(email.sent).toHaveLength(1);
      expect((await reminders())[0]?.status).toBe('SENT');
    } finally {
      await worker.stop();
    }
  });
});

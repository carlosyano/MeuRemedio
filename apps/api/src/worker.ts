// Processo do worker (DC-022; AGENTS.md §6: API e workers separados). Mesma base de codigo da API,
// implantacao propria: despacha o Outbox para o pg-boss em laco e consome as filas.
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import {
  handleVerificationRequested,
  type VerificationRequested,
} from './modules/identity/application/issue-verification.js';
import {
  PASSWORD_RESET_REQUESTED,
  handlePasswordResetRequested,
  type PasswordResetRequested,
} from './modules/identity/application/request-password-reset.js';
import {
  EXPORTS_EXPIRY_CRON,
  EXPORTS_EXPIRY_QUEUE,
  handleExportRequested,
  handleExportsExpiry,
  type ExportRequested,
} from './modules/exports/application/process-export.js';
import {
  DEADLINE_SWEEP_CRON,
  DEADLINE_SWEEP_QUEUE,
  handleDeadlineSweep,
} from './modules/occurrences/application/deadline-sweep.js';
import {
  HORIZON_REFRESH_CRON,
  HORIZON_REFRESH_QUEUE,
  handleHorizonRefresh,
} from './modules/occurrences/application/horizon-refresh.js';
import {
  handleOccurrencesRequested,
  type OccurrencesRequested,
} from './modules/occurrences/application/occurrences-requested.js';
import {
  REMINDERS_SWEEP_CRON,
  REMINDERS_SWEEP_QUEUE,
  REMINDER_REQUESTED,
  handleReminderRequested,
  handleRemindersSweep,
  type ReminderRequested,
} from './modules/reminders/application/email-reminders.js';
import {
  PURGE_SWEEP_CRON,
  PURGE_SWEEP_QUEUE,
  handlePurgeSweep,
} from './modules/privacy/application/account-purge.js';
import type { Clock } from './platform/clock.js';
import type { EmailSender } from './platform/email/email-sender.js';
import { OUTBOX_QUEUES, OutboxDispatcher } from './platform/outbox/dispatcher.js';
import {
  unconfiguredObjectStorage,
  type ObjectStorage,
} from './platform/storage/object-storage.js';

export interface WorkerOptions {
  readonly pool: Pool;
  /** Instancia do pg-boss ainda nao iniciada; o worker a inicia e a encerra. */
  readonly boss: PgBoss;
  readonly clock: Clock;
  readonly email: EmailSender;
  readonly webBaseUrl: string;
  /** Pepper do HMAC do e-mail (tombstone do expurgo, RN-019); o mesmo da API. */
  readonly emailPepper: Buffer;
  /** Armazenamento privado dos PDFs; sem ele, as exportacoes falham. */
  readonly storage?: ObjectStorage;
  /** Intervalo do laco do despachante; padrao 1000 ms. */
  readonly pollIntervalMs?: number;
}

export interface RunningWorker {
  stop(): Promise<void>;
}

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const { boss } = options;
  await boss.start();
  for (const queue of OUTBOX_QUEUES) await boss.createQueue(queue);

  await boss.work<VerificationRequested>(
    'identity.verification_requested',
    { pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        await handleVerificationRequested(
          {
            pool: options.pool,
            clock: options.clock,
            email: options.email,
            webBaseUrl: options.webBaseUrl,
          },
          job.data,
        );
      }
    },
  );

  await boss.work<PasswordResetRequested>(
    PASSWORD_RESET_REQUESTED,
    { pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        await handlePasswordResetRequested(
          {
            pool: options.pool,
            clock: options.clock,
            email: options.email,
            webBaseUrl: options.webBaseUrl,
          },
          job.data,
        );
      }
    },
  );

  await boss.work<OccurrencesRequested>(
    'plans.occurrences_requested',
    { pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        await handleOccurrencesRequested({ pool: options.pool, clock: options.clock }, job.data);
      }
    },
  );

  // Job de prazo a cada minuto (RN-009). Passada perdida com o worker parado: so a mais recente roda,
  // e ela alcanca todos os prazos vencidos.
  await boss.createQueue(DEADLINE_SWEEP_QUEUE);
  await boss.schedule(DEADLINE_SWEEP_QUEUE, DEADLINE_SWEEP_CRON, null, { missed: 'once' });
  await boss.work(DEADLINE_SWEEP_QUEUE, { pollingIntervalSeconds: 0.5 }, async () => {
    await handleDeadlineSweep({ pool: options.pool, clock: options.clock });
  });

  // Expurgo das contas em exclusao e reconciliacao com os tombstones a cada 15 minutos (RN-012,
  // TS-029); a passada mais recente basta.
  await boss.createQueue(PURGE_SWEEP_QUEUE);
  await boss.schedule(PURGE_SWEEP_QUEUE, PURGE_SWEEP_CRON, null, { missed: 'once' });
  await boss.work(PURGE_SWEEP_QUEUE, { pollingIntervalSeconds: 0.5 }, async () => {
    await handlePurgeSweep({
      pool: options.pool,
      clock: options.clock,
      storage: options.storage ?? unconfiguredObjectStorage,
      emailPepper: options.emailPepper,
    });
  });

  // Horizonte de 30 dias a cada hora (RF-004, DEC-027); a passada mais recente basta.
  await boss.createQueue(HORIZON_REFRESH_QUEUE);
  await boss.schedule(HORIZON_REFRESH_QUEUE, HORIZON_REFRESH_CRON, null, { missed: 'once' });
  await boss.work(HORIZON_REFRESH_QUEUE, { pollingIntervalSeconds: 0.5 }, async () => {
    await handleHorizonRefresh({ pool: options.pool, clock: options.clock });
  });

  // Lembretes por e-mail (RN-018): a varredura do minuto solicita pelo Outbox; o consumidor envia
  // no maximo uma vez por lembrete (DC-040).
  await boss.work<ReminderRequested>(
    REMINDER_REQUESTED,
    { pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        await handleReminderRequested(
          {
            pool: options.pool,
            clock: options.clock,
            email: options.email,
            webBaseUrl: options.webBaseUrl,
          },
          job.data,
        );
      }
    },
  );
  await boss.createQueue(REMINDERS_SWEEP_QUEUE);
  await boss.schedule(REMINDERS_SWEEP_QUEUE, REMINDERS_SWEEP_CRON, null, { missed: 'once' });
  await boss.work(REMINDERS_SWEEP_QUEUE, { pollingIntervalSeconds: 0.5 }, async () => {
    await handleRemindersSweep({ pool: options.pool, clock: options.clock });
  });

  // Exportacoes em PDF (FL-005): processamento pelo Outbox e expiracao a cada minuto (DC-042).
  const storage = options.storage ?? unconfiguredObjectStorage;
  await boss.work<ExportRequested>(
    'exports.requested',
    { pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        await handleExportRequested(
          { pool: options.pool, clock: options.clock, storage },
          job.data,
        );
      }
    },
  );
  await boss.createQueue(EXPORTS_EXPIRY_QUEUE);
  await boss.schedule(EXPORTS_EXPIRY_QUEUE, EXPORTS_EXPIRY_CRON, null, { missed: 'once' });
  await boss.work(EXPORTS_EXPIRY_QUEUE, { pollingIntervalSeconds: 0.5 }, async () => {
    await handleExportsExpiry({ pool: options.pool, clock: options.clock, storage });
  });

  const dispatcher = new OutboxDispatcher(options.pool, boss, options.clock);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    dispatcher
      .dispatchOnce()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, options.pollIntervalMs ?? 1_000);

  return {
    stop: async () => {
      clearInterval(timer);
      await boss.stop({ graceful: true, timeout: 5_000 });
    },
  };
}

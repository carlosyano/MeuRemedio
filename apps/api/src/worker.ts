// Processo do worker (DC-022; AGENTS.md §6: API e workers separados). Mesma base de codigo da API,
// implantacao propria: despacha o Outbox para o pg-boss em laco e consome as filas.
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import {
  handleVerificationRequested,
  type VerificationRequested,
} from './modules/identity/application/issue-verification.js';
import {
  DEADLINE_SWEEP_CRON,
  DEADLINE_SWEEP_QUEUE,
  handleDeadlineSweep,
} from './modules/occurrences/application/deadline-sweep.js';
import {
  handleOccurrencesRequested,
  type OccurrencesRequested,
} from './modules/occurrences/application/occurrences-requested.js';
import type { Clock } from './platform/clock.js';
import type { EmailSender } from './platform/email/email-sender.js';
import { OUTBOX_QUEUES, OutboxDispatcher } from './platform/outbox/dispatcher.js';

export interface WorkerOptions {
  readonly pool: Pool;
  /** Instancia do pg-boss ainda nao iniciada; o worker a inicia e a encerra. */
  readonly boss: PgBoss;
  readonly clock: Clock;
  readonly email: EmailSender;
  readonly webBaseUrl: string;
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

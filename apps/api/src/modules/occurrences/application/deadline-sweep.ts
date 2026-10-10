// Job de prazo (RN-009, CA-008; TS-006, TS-013; Especificacao 02.33 secao 6: a cada minuto).
// Ocorrencia PROGRAMMED com deadline_at <= instante da varredura passa a NO_RESPONSE, uma unica vez,
// com no_response_reached_at = instante da varredura (mesmo marco da geracao tardia, DEC-027).
//   - independe de lembrete: o prazo vale mesmo sem e-mail ou pagina aberta (TS-006);
//   - lotes com FOR UPDATE SKIP LOCKED: a linha que createResponse ja bloqueou fica para a proxima
//     passada, e a que a varredura bloqueou faz a resposta esperar e virar tardia (TS-013);
//   - reexecutar nao altera o marco nem a versao (so PROGRAMMED e elegivel).
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';

export const DEADLINE_SWEEP_QUEUE = 'occurrences.deadline_sweep';
export const DEADLINE_SWEEP_CRON = '* * * * *';

const DEFAULT_BATCH_SIZE = 1_000;

export async function markReachedDeadlines(
  pool: Pool,
  input: { now: string; batchSize?: number },
): Promise<{ updated: number }> {
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  let updated = 0;
  for (;;) {
    const result = await pool.query(
      `WITH due AS (
         SELECT id FROM occurrences
          WHERE status = 'PROGRAMMED' AND deadline_at <= $1
          ORDER BY deadline_at, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE occurrences o
          SET status = 'NO_RESPONSE', no_response_reached_at = $1,
              row_version = o.row_version + 1, updated_at = $1
         FROM due
        WHERE o.id = due.id`,
      [input.now, batchSize],
    );
    const count = result.rowCount ?? 0;
    updated += count;
    if (count < batchSize) return { updated };
  }
}

/** Consumidor da fila agendada: aplica o prazo no instante atual do relogio. */
export async function handleDeadlineSweep(deps: { pool: Pool; clock: Clock }): Promise<void> {
  await markReachedDeadlines(deps.pool, { now: deps.clock.now() });
}

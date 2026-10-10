// Job horario do horizonte (RF-004; Especificacao 02.33 secao 6; DEC-027): a cada hora, gera o
// horizonte de 30 dias de cada plano ACTIVE de conta ACTIVE a partir do instante atual, para que a
// data civil nova entre no fim do horizonte.
//   - reexecutar nao duplica: a geracao e idempotente (RN-007, TS-003);
//   - conta em exclusao (DELETION_SCHEDULED) nao gera: o acesso ja foi bloqueado (RN-012);
//   - cada plano gera em transacao propria (generateOccurrencesForHorizon), sem prender os demais.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { generateOccurrencesForHorizon } from '../infrastructure/generate-occurrences.js';

export const HORIZON_REFRESH_QUEUE = 'occurrences.horizon_refresh';
export const HORIZON_REFRESH_CRON = '0 * * * *';

/** Instante com precisao de segundos (o gerador nao aceita fracao). */
const toSeconds = (instant: string): string => `${instant.slice(0, 19)}Z`;

export async function refreshHorizons(
  pool: Pool,
  input: { now: string },
): Promise<{ plans: number; inserted: number }> {
  const plans = await pool.query<{ id: string }>(
    `SELECT p.id
       FROM medication_plans p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'ACTIVE' AND u.status = 'ACTIVE'
      ORDER BY p.id`,
  );
  let inserted = 0;
  for (const plan of plans.rows) {
    const result = await generateOccurrencesForHorizon(pool, {
      planId: plan.id,
      now: toSeconds(input.now),
    });
    inserted += result.inserted;
  }
  return { plans: plans.rows.length, inserted };
}

/** Consumidor da fila agendada: avanca o horizonte no instante atual do relogio. */
export async function handleHorizonRefresh(deps: { pool: Pool; clock: Clock }): Promise<void> {
  await refreshHorizons(deps.pool, { now: deps.clock.now() });
}

// Consumidor de plans.occurrences_requested (RF-004, RN-018, DEC-027): gera o horizonte de 30 dias
// do plano a partir do instante atual. Reentrega e segura: a geracao e idempotente (RN-007, TS-003)
// e plano DELETED ou inexistente nao gera nada.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { generateOccurrencesForHorizon } from '../infrastructure/generate-occurrences.js';

export interface OccurrencesRequestedDeps {
  readonly pool: Pool;
  readonly clock: Clock;
}

export interface OccurrencesRequested {
  readonly event_id: string;
  readonly plan_id: string;
}

/** Instante com precisao de segundos (o gerador nao aceita fracao). */
const toSeconds = (instant: string): string => `${instant.slice(0, 19)}Z`;

export async function handleOccurrencesRequested(
  deps: OccurrencesRequestedDeps,
  event: OccurrencesRequested,
): Promise<void> {
  await generateOccurrencesForHorizon(deps.pool, {
    planId: event.plan_id,
    now: toSeconds(deps.clock.now()),
  });
}

// Saude tecnica (RNF-015, DEC-020, DEC-028):
//   - PostgreSQL sem resposta dentro do tempo-limite da sondagem -> DOWN;
//   - |Clock da API - now() do PostgreSQL| > CLOCK_SKEW_MAX_MS -> DEGRADED;
//   - caso contrario -> UP.
// DEGRADED e DOWN respondem 503; UP responde 200.

export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN';

export const DEFAULT_CLOCK_SKEW_MAX_MS = 5_000;
export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 2_000;

export interface HealthSettings {
  readonly clockSkewMaxMs: number;
  readonly probeTimeoutMs: number;
}

export const HEALTH_SETTINGS = Symbol('HealthSettings');

/**
 * @param apiNowMs instante do Clock da API (ms desde a epoca)
 * @param databaseNowMs instante do PostgreSQL, ou undefined se o banco nao respondeu
 */
export function assessHealth(
  apiNowMs: number,
  databaseNowMs: number | undefined,
  clockSkewMaxMs: number,
): HealthStatus {
  if (databaseNowMs === undefined) return 'DOWN';
  // Instante ilegivel conta como desvio fora do limite.
  const skew = Math.abs(apiNowMs - databaseNowMs);
  return Number.isNaN(skew) || skew > clockSkewMaxMs ? 'DEGRADED' : 'UP';
}

export const httpStatusFor = (status: HealthStatus): number => (status === 'UP' ? 200 : 503);

// Rate limit em PostgreSQL (RNF-006, DEC-019, ADR-001 v1.5 OA-009), sem Redis no MVP:
//   - janela fixa de 1 minuto alinhada ao minuto UTC, por (escopo, SHA-256 da chave) (DC-011);
//   - incremento atomico (INSERT ... ON CONFLICT DO UPDATE): o limite e exato sob concorrencia;
//   - excedente: Retry-After = segundos ate o fim da janela (minimo 1).
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** Limites do RNF-006 por minuto. */
export const RATE_LIMITS = { public_ip: 20, user: 100 } as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/** Limites por minuto de cada escopo. */
export type RateLimits = Readonly<Record<RateLimitScope, number>>;

export type RateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

const WINDOW_MS = 60_000;

const windowStartOf = (epochMs: number): number => epochMs - (epochMs % WINDOW_MS);

export class PostgresRateLimiter {
  constructor(
    private readonly pool: Pool,
    /** Producao usa RATE_LIMITS; so a verificacao de contrato com Schemathesis os eleva (DC-047). */
    private readonly limits: RateLimits = RATE_LIMITS,
  ) {}

  /** Conta uma requisicao de `key` no escopo e decide se ela passa. */
  async consume(scope: RateLimitScope, key: string, now: string): Promise<RateLimitDecision> {
    const nowMs = Date.parse(now);
    const windowStart = windowStartOf(nowMs);
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO rate_limit_counters (scope, key_hash, window_start, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (scope, key_hash, window_start)
       DO UPDATE SET count = rate_limit_counters.count + 1
       RETURNING count`,
      [scope, createHash('sha256').update(key).digest(), new Date(windowStart).toISOString()],
    );
    const count = result.rows[0]?.count ?? Number.POSITIVE_INFINITY;
    if (count <= this.limits[scope]) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + WINDOW_MS - nowMs) / 1_000)),
    };
  }

  /** Remove as janelas ja encerradas (limpeza periodica, DEC-019); devolve quantas removeu. */
  async purge(now: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM rate_limit_counters WHERE window_start < $1',
      [new Date(windowStartOf(Date.parse(now))).toISOString()],
    );
    return result.rowCount ?? 0;
  }
}

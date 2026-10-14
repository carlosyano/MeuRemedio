// @trace RNF-006 DEC-019 ERR-010 (ADR-001 v1.5 OA-009; DATA_MODEL secao 4, rate_limit_counters)
// Rate limit em PostgreSQL 17 REAL: janela fixa de 1 minuto por (escopo, chave), contadores UNLOGGED
// com a chave em hash, limite exato sob concorrencia e Retry-After ate o fim da janela (DC-011).
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PostgresRateLimiter,
  RATE_LIMITS,
} from '../../apps/api/src/platform/rate-limit/rate-limiter.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

let db: PostgresHandle;
let pool: pg.Pool;
let limiter: PostgresRateLimiter;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 12 });
  await migrate(pool);
  limiter = new PostgresRateLimiter(pool);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE rate_limit_counters');
});

const AT = '2026-10-05T11:05:15Z';

describe('limites do RNF-006', () => {
  it('20 req/min por IP em rotas publicas e 100 req/min por titular autenticado', () => {
    expect(RATE_LIMITS).toEqual({ public_ip: 20, user: 100 });
  });
});

describe('PostgresRateLimiter', () => {
  it('permite ate o limite e recusa o excedente com Retry-After ate o fim da janela', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await limiter.consume('public_ip', '203.0.113.7', AT)).toEqual({ allowed: true });
    }
    expect(await limiter.consume('public_ip', '203.0.113.7', AT)).toEqual({
      allowed: false,
      retryAfterSeconds: 45,
    });
  });

  it('limites configuraveis (verificacao de contrato com Schemathesis, DC-047)', async () => {
    const relaxed = new PostgresRateLimiter(pool, { public_ip: 2, user: 100 });
    for (let i = 0; i < 2; i += 1) {
      expect(await relaxed.consume('public_ip', '203.0.113.9', AT)).toEqual({ allowed: true });
    }
    expect((await relaxed.consume('public_ip', '203.0.113.9', AT)).allowed).toBe(false);
  });

  it('nova janela zera a contagem', async () => {
    for (let i = 0; i < 21; i += 1) await limiter.consume('public_ip', '203.0.113.7', AT);
    expect(await limiter.consume('public_ip', '203.0.113.7', '2026-10-05T11:06:00Z')).toEqual({
      allowed: true,
    });
  });

  it('Retry-After e no minimo 1 s', async () => {
    const last = '2026-10-05T11:05:59.900Z';
    for (let i = 0; i < 20; i += 1) await limiter.consume('public_ip', '203.0.113.9', last);
    expect(await limiter.consume('public_ip', '203.0.113.9', last)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it('chaves e escopos sao independentes', async () => {
    for (let i = 0; i < 21; i += 1) await limiter.consume('public_ip', '203.0.113.7', AT);
    expect(await limiter.consume('public_ip', '198.51.100.1', AT)).toEqual({ allowed: true });
    expect(await limiter.consume('user', '203.0.113.7', AT)).toEqual({ allowed: true });
  });

  it('o limite do titular e 100', async () => {
    const user = '11111111-1111-4111-8111-111111111111';
    for (let i = 0; i < 100; i += 1) {
      expect((await limiter.consume('user', user, AT)).allowed).toBe(true);
    }
    expect((await limiter.consume('user', user, AT)).allowed).toBe(false);
  });

  it('sob concorrencia, exatamente o limite e permitido', async () => {
    const results = await Promise.all(
      Array.from({ length: 35 }, () => limiter.consume('public_ip', '203.0.113.50', AT)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
  });

  it('a chave fica em hash: o IP nao aparece no banco', async () => {
    await limiter.consume('public_ip', '203.0.113.7', AT);
    const rows = await pool.query<{ key_hash: Buffer; window_start: Date }>(
      'SELECT key_hash, window_start FROM rate_limit_counters',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.key_hash.toString('utf8')).not.toContain('203.0.113.7');
    expect(rows.rows[0]?.window_start.toISOString()).toBe('2026-10-05T11:05:00.000Z');
  });

  it('purge remove janelas encerradas e preserva a atual', async () => {
    await limiter.consume('public_ip', '203.0.113.7', '2026-10-05T11:00:10Z');
    await limiter.consume('public_ip', '203.0.113.7', AT);
    expect(await limiter.purge(AT)).toBe(1);
    const left = await pool.query('SELECT 1 FROM rate_limit_counters');
    expect(left.rowCount).toBe(1);
  });
});

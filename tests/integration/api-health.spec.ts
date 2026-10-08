// @trace TS-040 RNF-015 DEC-028 ERR-003 ERR-016 (ADR-001 v1.5 secao 12, spike S1; OpenAPI getHealth)
// Esqueleto HTTP (NestJS + Fastify) exercitado por HTTP real (inject do Fastify) contra PostgreSQL 17
// real: getHealth (DEC-028: desvio do Clock contra o now() do banco, DEGRADED e DOWN com 503),
// X-Correlation-ID em toda resposta, problem+json para rota fora do contrato e falha inesperada
// (500 INTERNAL_ERROR), e resposta fora do contrato bloqueada antes de sair.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CreateAppOptions } from '../../apps/api/src/app.js';
import type { Clock } from '../../apps/api/src/platform/clock.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../apps/api/src/platform/contract/openapi-contract.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const contract = OpenApiContract.load(locateNormativeOpenApi());

/** Relogio do processo deslocado em offsetMs (o banco usa o mesmo relogio da maquina). */
const shiftedClock = (offsetMs: number): Clock => ({
  now: () => new Date(Date.now() + offsetMs).toISOString(),
});
const fixedClock = (now: string): Clock => ({ now: () => now });

/** Corpo Health com o status esperado e time em RFC 3339 UTC (schema Instant). */
function expectHealth(body: unknown, status: string): void {
  expect(Object.keys(body as object).sort()).toEqual(['status', 'time']);
  const health = body as { status: unknown; time: unknown };
  expect(health.status).toBe(status);
  expect(health.time).toEqual(expect.stringMatching(INSTANT) as unknown);
}

let db: PostgresHandle;
let pool: pg.Pool;
let app: NestFastifyApplication | undefined;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 4 });
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(
  clock: Clock,
  overrides: Partial<Omit<CreateAppOptions, 'clock'>> = {},
): Promise<NestFastifyApplication> {
  app = await createApp({ clock, database: pool, logger: false, ...overrides });
  return app;
}

async function call(target: NestFastifyApplication, method: 'GET' | 'DELETE', url: string) {
  const response = await target.getHttpAdapter().getInstance().inject({ method, url });
  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
  );
  return { status: response.statusCode, headers, body: response.json<unknown>() };
}

describe('getHealth (DEC-028)', () => {
  it('200 UP quando o banco responde e o desvio fica dentro do limite', async () => {
    const response = await call(await start(shiftedClock(0)), 'GET', '/health');
    expect(response.status).toBe(200);
    expectHealth(response.body, 'UP');
    expect(contract.validateResponse('getHealth', response)).toEqual([]);
  });

  it('time e o instante do Clock da API', async () => {
    const clock = shiftedClock(1_000);
    const before = Date.parse(clock.now());
    const response = await call(await start(clock), 'GET', '/health');
    const time = Date.parse((response.body as { time: string }).time);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThan(before + 5_000);
  });

  it('desvio abaixo de CLOCK_SKEW_MAX_MS segue UP', async () => {
    const response = await call(
      await start(shiftedClock(-2_000), { clockSkewMaxMs: 5_000 }),
      'GET',
      '/health',
    );
    expect(response).toMatchObject({ status: 200, body: { status: 'UP' } });
  });

  it.each([
    ['adiantado', 8_000],
    ['atrasado', -8_000],
  ])('503 DEGRADED com o relogio da API %s alem de CLOCK_SKEW_MAX_MS', async (_nome, offset) => {
    const response = await call(
      await start(shiftedClock(offset), { clockSkewMaxMs: 5_000 }),
      'GET',
      '/health',
    );
    expect(response.status).toBe(503);
    expectHealth(response.body, 'DEGRADED');
    expect(contract.validateResponse('getHealth', response)).toEqual([]);
  });

  it('CLOCK_SKEW_MAX_MS padrao de 5 s', async () => {
    expect((await call(await start(shiftedClock(3_000)), 'GET', '/health')).status).toBe(200);
    expect((await call(await start(shiftedClock(7_000)), 'GET', '/health')).status).toBe(503);
  });

  it('503 DOWN quando o banco recusa a conexao', async () => {
    const unreachable = new pg.Pool({
      connectionString: 'postgres://test:test@127.0.0.1:1/test',
      connectionTimeoutMillis: 1_000,
    });
    try {
      const response = await call(
        await start(shiftedClock(0), { database: unreachable }),
        'GET',
        '/health',
      );
      expect(response.status).toBe(503);
      expectHealth(response.body, 'DOWN');
      expect(contract.validateResponse('getHealth', response)).toEqual([]);
    } finally {
      await unreachable.end();
    }
  });

  it('503 DOWN quando o banco nao responde dentro do tempo-limite da sondagem', async () => {
    const hanging = { query: () => new Promise<never>(() => undefined) };
    const started = Date.now();
    const response = await call(
      await start(shiftedClock(0), { database: hanging, healthProbeTimeoutMs: 200 }),
      'GET',
      '/health',
    );
    expect(response).toMatchObject({ status: 503, body: { status: 'DOWN' } });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('X-Correlation-ID', () => {
  it('toda resposta traz um UUID novo', async () => {
    const target = await start(shiftedClock(0));
    const ids = await Promise.all(
      Array.from({ length: 5 }, async () => (await call(target, 'GET', '/health')).headers),
    );
    for (const headers of ids) expect(headers['x-correlation-id']).toMatch(UUID_V4);
    expect(new Set(ids.map((h) => h['x-correlation-id'])).size).toBe(5);
  });
});

describe('problem+json', () => {
  it('rota fora do contrato: 404 RESOURCE_NOT_FOUND com correlation_id igual ao cabecalho', async () => {
    const response = await call(await start(shiftedClock(0)), 'GET', '/nao-existe?x=1');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body).toEqual({
      type: '/problems/resource_not_found',
      title: 'Recurso nao encontrado',
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      detail: 'O item solicitado não foi encontrado.',
      instance: '/nao-existe',
      correlation_id: response.headers['x-correlation-id'],
    });
    expect(contract.validateProblem(response.body)).toEqual([]);
  });

  it('metodo fora do contrato num caminho existente tambem e 404', async () => {
    const response = await call(await start(shiftedClock(0)), 'DELETE', '/health');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND', instance: '/health' });
  });

  it('falha inesperada: 500 INTERNAL_ERROR sem detalhe tecnico', async () => {
    const response = await call(
      await start({
        now: () => {
          throw new Error('segredo-interno: falha do relogio');
        },
      }),
      'GET',
      '/health',
    );
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      title: 'Falha inesperada',
      detail: 'Não foi possível concluir a solicitação agora. Tente novamente em instantes.',
      correlation_id: response.headers['x-correlation-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('segredo-interno');
    expect(contract.validateResponse('getHealth', response)).toEqual([]);
  });

  it('resposta fora do contrato nao sai: vira 500 INTERNAL_ERROR', async () => {
    const response = await call(await start(fixedClock('ontem')), 'GET', '/health');
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(response.body)).not.toContain('ontem');
    expect(contract.validateResponse('getHealth', response)).toEqual([]);
  });
});

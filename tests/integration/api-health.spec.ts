// @trace TS-040 RNF-015 ERR-003 ERR-016 (ADR-001 v1.5 secao 12, spike S1; OpenAPI getHealth)
// Esqueleto HTTP (NestJS + Fastify) exercitado por HTTP real (inject do Fastify): getHealth,
// X-Correlation-ID em toda resposta, problem+json para rota fora do contrato e falha inesperada
// (500 INTERNAL_ERROR), e resposta fora do contrato bloqueada antes de sair.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import type { Clock } from '../../apps/api/src/platform/clock.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../apps/api/src/platform/contract/openapi-contract.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = '2026-10-05T11:05:00Z';
const contract = OpenApiContract.load(locateNormativeOpenApi());

const fixedClock = (now: string): Clock => ({ now: () => now });

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(clock: Clock): Promise<NestFastifyApplication> {
  app = await createApp({ clock, logger: false });
  return app;
}

async function call(target: NestFastifyApplication, method: 'GET' | 'DELETE', url: string) {
  const response = await target.getHttpAdapter().getInstance().inject({ method, url });
  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
  );
  return { status: response.statusCode, headers, body: response.json<unknown>() };
}

describe('getHealth', () => {
  it('200 UP com o instante do Clock injetado, conforme o contrato', async () => {
    const response = await call(await start(fixedClock(NOW)), 'GET', '/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'UP', time: NOW });
    expect(contract.validateResponse('getHealth', response)).toEqual([]);
  });

  it.todo(
    'DEGRADED quando o desvio de relogio passa de CLOCK_SKEW_MAX_MS (RNF-015): referencia do desvio e status HTTP pendentes de decisao',
  );
  it.todo('DOWN e 503 quando uma dependencia esta indisponivel: criterio pendente de decisao');
});

describe('X-Correlation-ID', () => {
  it('toda resposta traz um UUID novo', async () => {
    const target = await start(fixedClock(NOW));
    const ids = await Promise.all(
      Array.from({ length: 5 }, async () => (await call(target, 'GET', '/health')).headers),
    );
    for (const headers of ids) expect(headers['x-correlation-id']).toMatch(UUID_V4);
    expect(new Set(ids.map((h) => h['x-correlation-id'])).size).toBe(5);
  });
});

describe('problem+json', () => {
  it('rota fora do contrato: 404 RESOURCE_NOT_FOUND com correlation_id igual ao cabecalho', async () => {
    const response = await call(await start(fixedClock(NOW)), 'GET', '/nao-existe?x=1');
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
    const response = await call(await start(fixedClock(NOW)), 'DELETE', '/health');
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

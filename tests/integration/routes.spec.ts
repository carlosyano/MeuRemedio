// @trace TS-040 RNF-014 DEC-034 DEC-036 listExports changePlanStatus (Especificacao 02.33 secao 13; AGENTS.md secoes 13 e 14)
// TS-040, rotas da aplicacao em execucao x OpenAPI: a API montada responde por todas as operacoes
// do contrato (nenhuma sem implementacao). Rota extra, metodo, caminho ou operationId divergentes
// impedem a subida (assertRoutesMatchContract, provado em tests/contract/http-foundation.spec.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/http.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

const fastifyPath = (path: string): string => path.replace(/\{([^}]+)\}/g, ':$1');

describe('TS-040 rotas da aplicacao x OpenAPI', () => {
  it('o contrato tem as 30 operacoes da baseline (DEC-038)', () => {
    expect(h.contract.operations).toHaveLength(30);
  });

  it('toda operacao do contrato esta registrada na API em execucao', () => {
    const fastify = h.app.getHttpAdapter().getInstance();
    const missing = h.contract.operations
      .filter((op) => !fastify.hasRoute({ method: op.method, url: fastifyPath(op.path) }))
      .map((op) => `${op.method} ${op.path} (${op.operationId})`);
    expect(missing).toEqual([]);
  });

  it('caminho fora do contrato: 404 RESOURCE_NOT_FOUND em problem+json', async () => {
    const response = await h.call('getHealth', 'GET', '/healthz', { unchecked: true });
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

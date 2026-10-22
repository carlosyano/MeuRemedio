// @trace ERR-011 DEC-026 DEC-028 (503 DEPENDENCY_UNAVAILABLE com o PostgreSQL indisponivel, DC-062)
// ERR-011: com o banco indisponivel, toda operacao responde 503 e nao declara sucesso. As operacoes
// vem da matriz; a chamada e generica (sessao e CSRF bem formados, identificadores novos), porque o
// controle de acesso consulta o banco antes da validacao. getHealth responde 503 com o corpo Health
// (DOWN, DEC-028); as demais, Problem DEPENDENCY_UNAVAILABLE sem detalhe tecnico.
//   - banco recusando conexao (porta fechada);
//   - banco que aceita a conexao e nao responde (tempo-limite de conexao do pool).
import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../../apps/api/src/platform/contract/openapi-contract.js';
import { catalogEntry, expectProblem, genericUrl, unknownSessionToken } from './support/catalog.js';

const ORIGIN = 'https://app.example.invalid';
const contract = OpenApiContract.load(locateNormativeOpenApi());
const entry = catalogEntry('ERR-011');

let silent: Server;
const sockets: Socket[] = [];
const apps: NestFastifyApplication[] = [];
const pools: pg.Pool[] = [];

beforeAll(async () => {
  // Aceita a conexao e nunca responde ao protocolo do PostgreSQL.
  silent = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  for (const app of apps) await app.close();
  for (const pool of pools) await pool.end();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) =>
    silent.close(() => {
      resolve();
    }),
  );
});

async function start(port: number): Promise<NestFastifyApplication> {
  const pool = new pg.Pool({
    connectionString: `postgres://meuremedio:sintetica@127.0.0.1:${String(port)}/meuremedio`,
    connectionTimeoutMillis: 500,
    max: 2,
  });
  pools.push(pool);
  const app = await createApp({
    clock: { now: () => '2026-10-05T11:05:15Z' },
    database: pool,
    logger: false,
    allowedOrigins: [ORIGIN],
    externalRightsChannel: 'https://privacidade.example.invalid/direitos',
    secrets: {
      requestHashKey: randomBytes(32),
      emailPepper: randomBytes(32),
      csrfKey: randomBytes(32),
    },
  });
  apps.push(app);
  return app;
}

async function callGeneric(app: NestFastifyApplication, operationId: string) {
  const operation = contract.operation(operationId);
  const token = unknownSessionToken();
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: operation.method,
      url: genericUrl(operation),
      headers: {
        cookie: `mr_session=${token}; mr_csrf=${token}`,
        'x-csrf-token': token,
        origin: ORIGIN,
        'idempotency-key': 'err-011',
      },
    });
  return {
    status: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
    ),
    body: response.json<unknown>(),
  };
}

function expectUnavailable(
  operationId: string,
  response: Awaited<ReturnType<typeof callGeneric>>,
): void {
  expect(response.status, operationId).toBe(503);
  expect(contract.validateResponse(operationId, response)).toEqual([]);
  if (operationId === 'getHealth') {
    expect(response.body).toMatchObject({ status: 'DOWN' });
    return;
  }
  expectProblem(response, 'DEPENDENCY_UNAVAILABLE', [
    'ECONNREFUSED',
    'timeout',
    '127.0.0.1',
    'postgres',
  ]);
}

describe('ERR-011 DEPENDENCY_UNAVAILABLE (503) com o banco indisponivel', () => {
  it('a matriz liga ERR-011 a todas as operacoes do contrato', () => {
    expect(entry).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', http_status: 503 });
    const all = contract.operations.map((op) => op.operationId).sort();
    expect([...entry.operationIds].sort()).toEqual(all);
  });

  describe('banco recusando conexao', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await start(1);
    });

    it.each(entry.operationIds)('%s', async (operationId) => {
      expectUnavailable(operationId, await callGeneric(app, operationId));
    });
  });

  describe('banco sem resposta (tempo-limite de conexao)', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      const address = silent.address();
      if (address === null || typeof address === 'string') throw new Error('sem porta');
      app = await start(address.port);
    });

    it.each(['createSession', 'listPlans', 'createPlan', 'createAccount'])(
      '%s',
      async (operationId) => {
        expectUnavailable(operationId, await callGeneric(app, operationId));
      },
    );
  });
});

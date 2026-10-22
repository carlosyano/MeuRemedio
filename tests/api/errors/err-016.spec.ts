// @trace ERR-016 DEC-026 (500 INTERNAL_ERROR sem detalhe tecnico em toda operacao)
// ERR-016: falha inesperada vira 500 INTERNAL_ERROR, com o Problem do catalogo e sem detalhe
// tecnico; o detalhe fica so no log, com correlation_id (DEC-026). A falha e provocada por um Clock
// que lanca erro, usado pelo controle de acesso de toda operacao antes do handler. As operacoes vem
// da matriz; a chamada e generica (sessao e CSRF bem formados, identificadores novos).
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../../apps/api/src/platform/contract/openapi-contract.js';
import { migrate } from '../../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../../packages/testkit/src/index.js';
import { catalogEntry, expectProblem, genericUrl, unknownSessionToken } from './support/catalog.js';

const ORIGIN = 'https://app.example.invalid';
const SECRET = 'segredo-interno: falha do relogio';
const contract = OpenApiContract.load(locateNormativeOpenApi());
const entry = catalogEntry('ERR-016');

let db: PostgresHandle;
let pool: pg.Pool;
let app: NestFastifyApplication;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 4 });
  await migrate(pool);
  app = await createApp({
    clock: {
      now: () => {
        throw new Error(SECRET);
      },
    },
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
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.stop();
});

describe('ERR-016 INTERNAL_ERROR (500) em falha inesperada', () => {
  it('a matriz liga ERR-016 a todas as operacoes do contrato', () => {
    expect(entry).toMatchObject({ code: 'INTERNAL_ERROR', http_status: 500 });
    const all = contract.operations.map((op) => op.operationId).sort();
    expect([...entry.operationIds].sort()).toEqual(all);
  });

  it.each(entry.operationIds)('%s', async (operationId) => {
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
          'idempotency-key': 'err-016',
        },
      });
    const result = {
      status: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
      ),
      body: response.json<unknown>(),
    };
    expectProblem(result, 'INTERNAL_ERROR', [SECRET, 'Error', 'stack']);
    expect(contract.validateResponse(operationId, result)).toEqual([]);
  });
});

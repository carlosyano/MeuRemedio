// @trace ERR-003 CA-012 DEC-036 (404 RESOURCE_NOT_FOUND para recurso inexistente)
// ERR-003: toda operacao sobre um recurso identificado no caminho responde 404 quando o
// identificador nao existe, com o mesmo Problem do recurso de outro titular (TS-023), sem efeito.
// As operacoes vem da matriz e precisam ser exatamente as operacoes privadas com parametro de
// caminho.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, genericUrl, persistedState } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-003');
let h: Harness;
let ana: LoggedIn;

/** Corpo valido das operacoes que o exigem (o 404 nao pode depender de entrada invalida). */
const VALID_BODY: Record<string, unknown> = {
  createResponse: { type: 'TAKEN', reason: null },
  changePlanStatus: { action: 'INTERRUPT', reason: 'OTHER', note: null },
  updatePlan: {
    medication_name: 'Comprimido',
    dose_text: '1 comprimido',
    medication_form: 'TABLET',
    administration_route: 'ORAL',
    start_date: '2026-10-01',
    schedule_times: ['08:00', '20:00'],
  },
};

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.activeUser('ana.silva@example.com');
  ana = await login(h, 'ana.silva@example.com');
});

describe('ERR-003 RESOURCE_NOT_FOUND (404)', () => {
  it('a matriz liga ERR-003 exatamente as operacoes privadas com parametro de caminho', () => {
    expect(entry).toMatchObject({ code: 'RESOURCE_NOT_FOUND', http_status: 404 });
    const withPathParameter = h.contract.operations
      .filter((op) => !op.public && op.path.includes('{'))
      .map((op) => op.operationId);
    expect([...entry.operationIds].sort()).toEqual(withPathParameter.sort());
  });

  it.each(entry.operationIds)('%s com identificador inexistente', async (operationId) => {
    const operation = h.contract.operation(operationId);
    const before = await persistedState(h.pool);
    const body = VALID_BODY[operationId];
    const response = await h.call(operationId, operation.method, genericUrl(operation), {
      headers: {
        ...(operation.method === 'GET' ? ana.read : ana.mutation),
        'idempotency-key': 'err-003',
        'if-match': '"1"',
      },
      ...(body === undefined ? {} : { body }),
    });
    expectProblem(response, 'RESOURCE_NOT_FOUND');
    expect(await persistedState(h.pool)).toBe(before);
  });
});

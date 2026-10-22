// @trace ERR-009 RF-003 RF-008 (422 BUSINESS_RULE_VIOLATION)
// ERR-009: entrada valida no formato que viola uma regra de negocio responde 422 sem efeito: plano
// com fim antes do inicio e exportacao com fim antes do inicio ou periodo acima de 12 meses.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  startHarness,
  type Harness,
  type HttpResult,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';
import { PLAN, createPlan, mutate } from './support/fixtures.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-009');
let h: Harness;
let ana: LoggedIn;

const ENDS_BEFORE_START = { ...PLAN, start_date: '2026-10-10', end_date: '2026-10-09' };

/** Chamadas que violam a regra em cada operacao (o plano de updatePlan e criado antes). */
const SCENARIOS: Record<string, () => Promise<(() => Promise<HttpResult>)[]>> = {
  createPlan: () =>
    Promise.resolve([() => mutate(h, ana, 'createPlan', '/plans', ENDS_BEFORE_START)]),
  updatePlan: async () => {
    const url = `/plans/${await createPlan(h, ana)}`;
    return [() => mutate(h, ana, 'updatePlan', url, ENDS_BEFORE_START, { 'if-match': '"1"' })];
  },
  createExport: () =>
    Promise.resolve(
      [
        { start_date: '2026-10-05', end_date: '2026-10-04' },
        { start_date: '2025-10-01', end_date: '2026-10-05' },
      ].map((body) => () => mutate(h, ana, 'createExport', '/exports', body)),
    ),
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

describe('ERR-009 BUSINESS_RULE_VIOLATION (422)', () => {
  it('os cenarios cobrem exatamente as operacoes da matriz', () => {
    expect(entry).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', http_status: 422 });
    expect(Object.keys(SCENARIOS).sort()).toEqual([...entry.operationIds].sort());
  });

  it.each(entry.operationIds)('%s', async (operationId) => {
    const scenario = SCENARIOS[operationId];
    if (scenario === undefined) throw new Error(operationId);
    const calls = await scenario();
    const before = await persistedState(h.pool);
    for (const call of calls) expectProblem(await call(), 'BUSINESS_RULE_VIOLATION');
    expect(await persistedState(h.pool)).toBe(before);
  });
});

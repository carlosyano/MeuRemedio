// @trace ERR-005 CA-006 (409 VERSION_CONFLICT em updatePlan)
// ERR-005: updatePlan com If-Match de uma versao anterior responde 409 sem alterar o plano, que
// continua na versao salva pela outra sessao.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';
import { PLAN, createPlan, mutate } from './support/fixtures.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-005');
let h: Harness;
let ana: LoggedIn;

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

describe('ERR-005 VERSION_CONFLICT (409)', () => {
  it('a matriz liga ERR-005 a updatePlan', () => {
    expect(entry).toMatchObject({ code: 'VERSION_CONFLICT', http_status: 409 });
    expect(entry.operationIds).toEqual(['updatePlan']);
  });

  it('updatePlan com If-Match desatualizado', async () => {
    const planId = await createPlan(h, ana);
    const other = await login(h, 'ana.silva@example.com');
    const saved = await mutate(
      h,
      other,
      'updatePlan',
      `/plans/${planId}`,
      { ...PLAN, medication_name: 'Comprimido Outra Sessao' },
      { 'if-match': '"1"' },
    );
    expect(saved.status).toBe(200);
    const before = await persistedState(h.pool);
    const stale = await mutate(
      h,
      ana,
      'updatePlan',
      `/plans/${planId}`,
      { ...PLAN, medication_name: 'Comprimido Desatualizado' },
      { 'if-match': '"1"' },
    );
    expectProblem(stale, 'VERSION_CONFLICT');
    expect(await persistedState(h.pool)).toBe(before);
    const read = await h.call('getPlan', 'GET', `/plans/${planId}`, { headers: ana.read });
    expect(read.body).toMatchObject({ medication_name: 'Comprimido Outra Sessao', row_version: 2 });
  });
});

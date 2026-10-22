// @trace ERR-014 RN-016 CA-017 TS-043 (409 DUPLICATE_CONFIRMATION_REQUIRED em createPlan)
// ERR-014: plano equivalente a um plano ativo, sem o token de confirmacao, responde 409 com o token
// e os candidatos, sem criar o plano; com o token, o plano e criado.
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
const entry = catalogEntry('ERR-014');
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

interface DuplicateBody {
  duplicate_confirmation: {
    confirmation_token: string;
    candidates: { plan_id: string }[];
  };
}

describe('ERR-014 DUPLICATE_CONFIRMATION_REQUIRED (409)', () => {
  it('a matriz liga ERR-014 a createPlan', () => {
    expect(entry).toMatchObject({ code: 'DUPLICATE_CONFIRMATION_REQUIRED', http_status: 409 });
    expect(entry.operationIds).toEqual(['createPlan']);
  });

  it('createPlan equivalente a um plano ativo', async () => {
    const original = await createPlan(h, ana);
    const before = await persistedState(h.pool);
    const response = await mutate(h, ana, 'createPlan', '/plans', PLAN);
    expectProblem(response, 'DUPLICATE_CONFIRMATION_REQUIRED');
    const { duplicate_confirmation: confirmation } = response.body as DuplicateBody;
    expect(confirmation.candidates.map((candidate) => candidate.plan_id)).toEqual([original]);
    expect(await persistedState(h.pool)).toBe(before);

    await createPlan(h, ana, {
      ...PLAN,
      duplicate_confirmation_token: confirmation.confirmation_token,
    });
  });
});

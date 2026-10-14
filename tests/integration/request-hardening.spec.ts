// @trace TS-040 ERR-001 ERR-016 RNF-014 createPlan deletePlan cancelExport updateCurrentAccount listPlans
// Entradas que o Schemathesis transformou em 500 (DC-047): Content-Type malformado numa requisicao
// sem corpo e texto com o caractere NUL (U+0000), que o PostgreSQL nao armazena. Ambas sao entrada
// invalida: 400 VALIDATION_FAILED, sem efeito.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

let h: Harness;
let ana: LoggedIn;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.truncate();
  await h.activeUser('ana.silva@example.com');
  ana = await login(h, 'ana.silva@example.com');
});

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00'],
};

const plans = async (): Promise<number> =>
  (await h.pool.query('SELECT 1 FROM medication_plans')).rowCount ?? 0;

describe('Content-Type malformado', () => {
  it.each([
    ['deletePlan', 'DELETE', '/plans/'],
    ['cancelExport', 'DELETE', '/exports/'],
  ] as const)('%s sem corpo com multipart sem boundary: 400', async (operationId, method, base) => {
    const response = await h.call(operationId, method, `${base}${randomUUID()}`, {
      headers: { ...ana.mutation, 'content-type': 'multipart/form-data' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('caractere NUL em texto', () => {
  it('createPlan com NUL em prescriber_name: 400 no campo, sem criar o plano', async () => {
    const response = await h.call('createPlan', 'POST', '/plans', {
      body: { ...PLAN, prescriber_name: 'Dra.\u0000Ana' },
      headers: { ...ana.mutation, 'idempotency-key': 'k-nul' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [{ field: 'prescriber_name' }],
    });
    expect(await plans()).toBe(0);
  });

  it('createPlan com NUL em medication_name: 400', async () => {
    const response = await h.call('createPlan', 'POST', '/plans', {
      body: { ...PLAN, medication_name: 'Com\u0000primido' },
      headers: { ...ana.mutation, 'idempotency-key': 'k-nul-2' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'medication_name' }] });
  });

  it('updateCurrentAccount com NUL no nome: 400', async () => {
    const response = await h.call('updateCurrentAccount', 'PUT', '/accounts/me', {
      body: { name: 'Ana\u0000' },
      headers: ana.mutation,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'name' }] });
  });

  it('listPlans com NUL no cursor: 400', async () => {
    const response = await h.call('listPlans', 'GET', '/plans?cursor=abc%00def', {
      headers: ana.read,
    });
    expect(response.status).toBe(400);
  });
});

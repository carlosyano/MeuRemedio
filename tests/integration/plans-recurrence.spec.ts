// @trace RF-003 RF-004 CA-005 CA-006 ERR-001 DEC-037 createPlan getPlan listPlans updatePlan
// Periodicidade do plano por HTTP contra PostgreSQL 17 real (DEC-037): todos os dias (padrao),
// dias da semana escolhidos ou a cada N dias contados do inicio; o gerador so cria ocorrencias
// nos dias da periodicidade, e editar a periodicidade regera os horarios futuros.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): segunda-feira, 2026-10-05 08:05 local.
const NOW = '2026-10-05T11:05:15Z';
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

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00'],
} as const;

interface PlanBody {
  plan_id: string;
  recurrence: unknown;
  row_version: number;
}

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

const create = (body: unknown) =>
  h.call('createPlan', 'POST', '/plans', {
    body,
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });

async function createPlan(body: unknown): Promise<PlanBody> {
  const response = await create(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const plan = response.body as PlanBody;
  await generate(plan.plan_id);
  return plan;
}

const generate = (planId: string) =>
  handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );

/** Datas civis com ocorrencia ativa ate 2026-10-15. */
const activeDates = async (planId: string): Promise<string[]> =>
  (
    await h.pool.query<{ d: string }>(
      `SELECT DISTINCT to_char(local_scheduled_date, 'YYYY-MM-DD') AS d FROM occurrences
        WHERE plan_id = $1 AND status <> 'CANCELED' AND local_scheduled_date <= '2026-10-15'
        ORDER BY 1`,
      [planId],
    )
  ).rows.map((row) => row.d);

describe('createPlan com periodicidade (DEC-037)', () => {
  it('sem periodicidade: todos os dias, e a resposta traz DAILY', async () => {
    const plan = await createPlan(PLAN);
    expect(plan.recurrence).toEqual({ kind: 'DAILY' });
    expect(await activeDates(plan.plan_id)).toHaveLength(11);
  });

  it('dias da semana: so segundas e quintas, e a leitura devolve os dias em ordem', async () => {
    const plan = await createPlan({
      ...PLAN,
      recurrence: { kind: 'WEEKDAYS', weekdays: ['THURSDAY', 'MONDAY'] },
    });
    expect(plan.recurrence).toEqual({ kind: 'WEEKDAYS', weekdays: ['MONDAY', 'THURSDAY'] });
    expect(await activeDates(plan.plan_id)).toEqual([
      '2026-10-05',
      '2026-10-08',
      '2026-10-12',
      '2026-10-15',
    ]);
    const read = await h.call('getPlan', 'GET', `/plans/${plan.plan_id}`, { headers: ana.read });
    expect(read.body).toMatchObject({
      recurrence: { kind: 'WEEKDAYS', weekdays: ['MONDAY', 'THURSDAY'] },
    });
  });

  it('a cada 3 dias contados do inicio (2026-10-01): 07, 10 e 13', async () => {
    const plan = await createPlan({
      ...PLAN,
      recurrence: { kind: 'EVERY_N_DAYS', interval_days: 3 },
    });
    expect(plan.recurrence).toEqual({ kind: 'EVERY_N_DAYS', interval_days: 3 });
    expect(await activeDates(plan.plan_id)).toEqual(['2026-10-07', '2026-10-10', '2026-10-13']);
    const list = await h.call('listPlans', 'GET', '/plans', { headers: ana.read });
    expect((list.body as { items: PlanBody[] }).items[0]).toMatchObject({
      recurrence: { kind: 'EVERY_N_DAYS', interval_days: 3 },
    });
  });

  it.each([
    ['dias da semana sem a lista', { kind: 'WEEKDAYS' }],
    ['lista vazia', { kind: 'WEEKDAYS', weekdays: [] }],
    ['dia repetido', { kind: 'WEEKDAYS', weekdays: ['MONDAY', 'MONDAY'] }],
    ['dia fora da lista', { kind: 'WEEKDAYS', weekdays: ['SEGUNDA'] }],
    ['intervalo 1', { kind: 'EVERY_N_DAYS', interval_days: 1 }],
    ['intervalo 366', { kind: 'EVERY_N_DAYS', interval_days: 366 }],
    ['intervalo sem numero', { kind: 'EVERY_N_DAYS' }],
    ['campo de outra periodicidade', { kind: 'DAILY', interval_days: 3 }],
    ['tipo desconhecido', { kind: 'MONTHLY' }],
  ])('%s: 400 VALIDATION_FAILED sem criar o plano', async (_nome, recurrence) => {
    const response = await create({ ...PLAN, recurrence });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const count = await h.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM medication_plans',
    );
    expect(count.rows[0]?.n).toBe('0');
  });
});

describe('updatePlan com periodicidade (DEC-037)', () => {
  it('trocar para a cada 2 dias cancela os horarios futuros e regera nos dias novos', async () => {
    const plan = await createPlan(PLAN);
    const response = await h.call('updatePlan', 'PUT', `/plans/${plan.plan_id}`, {
      body: { ...PLAN, recurrence: { kind: 'EVERY_N_DAYS', interval_days: 2 } },
      headers: { ...ana.mutation, 'if-match': '"1"', 'idempotency-key': nextKey() },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      recurrence: { kind: 'EVERY_N_DAYS', interval_days: 2 },
      row_version: 2,
    });
    await generate(plan.plan_id);
    // Inicio 2026-10-01, a cada 2 dias: 05 (o horario de hoje ja passou e fica), 07, 09...
    expect(await activeDates(plan.plan_id)).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-09',
      '2026-10-11',
      '2026-10-13',
      '2026-10-15',
    ]);
  });

  it('PUT sem periodicidade volta para todos os dias', async () => {
    const plan = await createPlan({
      ...PLAN,
      recurrence: { kind: 'WEEKDAYS', weekdays: ['FRIDAY'] },
    });
    const response = await h.call('updatePlan', 'PUT', `/plans/${plan.plan_id}`, {
      body: PLAN,
      headers: { ...ana.mutation, 'if-match': '"1"', 'idempotency-key': nextKey() },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ recurrence: { kind: 'DAILY' } });
  });
});

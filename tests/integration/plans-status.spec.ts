// @trace RF-003 RF-004 CA-012 TS-008 TS-023 TS-038 ERR-001 ERR-005 ERR-007 DEC-036 changePlanStatus getPlan listPlans updatePlan
// Situacao do plano por HTTP contra PostgreSQL 17 real (DEC-036): cancelar o plano que ainda nao
// comecou, interromper o que esta em andamento e retomar o interrompido, sempre com motivo; as
// ocorrencias futuras sao canceladas e a retomada so gera horarios a partir dela; If-Match e
// Idempotency-Key como em updatePlan; plano de outro titular com 404 indistinguivel e auditoria.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 2026-10-05 08:05 local.
const NOW = '2026-10-05T11:05:15Z';
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.pool.query('TRUNCATE audit_events');
});

const at = (offsetMs: number): string =>
  new Date(Date.parse(NOW) + offsetMs).toISOString().replace('.000Z', 'Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

let ana: LoggedIn;
let bruno: LoggedIn;
let brunoId: string;

beforeEach(async () => {
  await h.activeUser('ana.silva@example.com');
  brunoId = await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

interface PlanBody {
  plan_id: string;
  status: string;
  status_reason: string | null;
  status_note: string | null;
  status_changed_at: string | null;
  row_version: number;
}

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

/** Cria o plano e gera o horizonte como o worker faria. */
async function createPlan(body: unknown = PLAN): Promise<PlanBody> {
  const response = await h.call('createPlan', 'POST', '/plans', {
    body,
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(201);
  const plan = response.body as PlanBody;
  await generate(plan.plan_id);
  return plan;
}

const generate = (planId: string) =>
  handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );

const changeStatus = (
  session: LoggedIn,
  planId: string,
  body: unknown,
  options: { ifMatch?: string | undefined; key?: string | undefined } = {},
) => {
  const headers: Record<string, string> = { ...session.mutation };
  const ifMatch = 'ifMatch' in options ? options.ifMatch : '"1"';
  const key = 'key' in options ? options.key : nextKey();
  if (ifMatch !== undefined) headers['if-match'] = ifMatch;
  if (key !== undefined) headers['idempotency-key'] = key;
  return h.call('changePlanStatus', 'POST', `/plans/${planId}/status-changes`, { body, headers });
};

const INTERRUPT = { action: 'INTERRUPT', reason: 'SIDE_EFFECT', note: 'Enjoo forte' } as const;
const CANCEL = { action: 'CANCEL', reason: 'MEDICAL_ADVICE', note: null } as const;
const RESUME = { action: 'RESUME', reason: 'MEDICAL_ADVICE', note: null } as const;

const occurrences = async (planId: string) =>
  (
    await h.pool.query<{ slot: string }>(
      `SELECT to_char(local_scheduled_date, 'YYYY-MM-DD') || ' ' || to_char(local_time, 'HH24:MI')
                || ' ' || status AS slot
         FROM occurrences WHERE plan_id = $1 AND local_scheduled_date <= '2026-10-07'
        ORDER BY scheduled_at, status`,
      [planId],
    )
  ).rows.map((row) => row.slot);

describe('changePlanStatus: interromper (DEC-036)', () => {
  it('plano em andamento: INTERRUPTED com motivo e as ocorrencias futuras canceladas', async () => {
    const plan = await createPlan();
    const response = await changeStatus(ana, plan.plan_id, INTERRUPT);
    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.body).toMatchObject({
      plan_id: plan.plan_id,
      status: 'INTERRUPTED',
      status_reason: 'SIDE_EFFECT',
      status_note: 'Enjoo forte',
      status_changed_at: NOW,
      row_version: 2,
    });
    const slots = await occurrences(plan.plan_id);
    // O horario de hoje que ja passou fica; os seguintes sao cancelados.
    expect(slots).toContain('2026-10-05 08:00 PROGRAMMED');
    expect(slots).toContain('2026-10-05 20:00 CANCELED');
    expect(slots).toContain('2026-10-06 08:00 CANCELED');
    expect(
      slots.filter((slot) => slot.startsWith('2026-10-06') && !slot.endsWith('CANCELED')),
    ).toEqual([]);
  });

  it('relogio com milissegundos (o do sistema): a data de hoje da conta continua valendo', async () => {
    const plan = await createPlan();
    h.now = '2026-10-05T11:05:15.123Z';
    ana = await login(h, 'ana.silva@example.com');
    const response = await changeStatus(ana, plan.plan_id, INTERRUPT);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'INTERRUPTED' });
  });

  it('plano que ainda nao comecou ou ja terminou: 409 STATE_CONFLICT sem efeito', async () => {
    const future = await createPlan({ ...PLAN, start_date: '2026-10-10' });
    const finished = await createPlan({ ...PLAN, end_date: '2026-10-04' });
    for (const plan of [future, finished]) {
      const response = await changeStatus(ana, plan.plan_id, INTERRUPT);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
    }
  });

  it('o plano interrompido sai da tela Hoje e nao aceita edicao (409 STATE_CONFLICT)', async () => {
    const plan = await createPlan();
    await changeStatus(ana, plan.plan_id, INTERRUPT);
    const today = await h.call('listOccurrences', 'GET', '/occurrences?local_date=2026-10-05', {
      headers: ana.read,
    });
    expect((today.body as { items: unknown[] }).items).toEqual([]);
    const edit = await h.call('updatePlan', 'PUT', `/plans/${plan.plan_id}`, {
      body: PLAN,
      headers: { ...ana.mutation, 'if-match': '"2"', 'idempotency-key': nextKey() },
    });
    expect(edit.status).toBe(409);
    expect(edit.body).toMatchObject({ code: 'STATE_CONFLICT' });
  });
});

describe('changePlanStatus: cancelar (DEC-036)', () => {
  it('plano que ainda nao comecou: CANCELED e todas as ocorrencias canceladas', async () => {
    const plan = await createPlan({ ...PLAN, start_date: '2026-10-06' });
    const response = await changeStatus(ana, plan.plan_id, CANCEL);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'CANCELED',
      status_reason: 'MEDICAL_ADVICE',
      status_note: null,
      status_changed_at: NOW,
    });
    const slots = await occurrences(plan.plan_id);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.endsWith('CANCELED'))).toBe(true);
  });

  it('plano ja iniciado: 409 STATE_CONFLICT (use interromper)', async () => {
    const plan = await createPlan();
    const response = await changeStatus(ana, plan.plan_id, CANCEL);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('cancelado nao volta: retomar retorna 409', async () => {
    const plan = await createPlan({ ...PLAN, start_date: '2026-10-06' });
    await changeStatus(ana, plan.plan_id, CANCEL);
    const response = await changeStatus(ana, plan.plan_id, RESUME, { ifMatch: '"2"' });
    expect(response.status).toBe(409);
  });
});

describe('changePlanStatus: retomar (DEC-036)', () => {
  it('interrompido volta a ACTIVE com o motivo; so gera horarios a partir da retomada', async () => {
    const plan = await createPlan();
    await changeStatus(ana, plan.plan_id, INTERRUPT);
    h.now = at(2 * DAY);
    ana = await login(h, 'ana.silva@example.com');
    const response = await changeStatus(ana, plan.plan_id, RESUME, { ifMatch: '"2"' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ACTIVE',
      status_reason: 'MEDICAL_ADVICE',
      status_changed_at: at(2 * DAY),
      row_version: 3,
    });
    await generate(plan.plan_id);
    const slots = await occurrences(plan.plan_id);
    // Nada renasce no periodo interrompido; 2026-10-07 20:00 (depois da retomada) volta.
    expect(slots.filter((slot) => !slot.endsWith('CANCELED'))).toEqual([
      '2026-10-05 08:00 PROGRAMMED',
      '2026-10-07 20:00 PROGRAMMED',
    ]);
  });

  it('plano ativo: retomar retorna 409 STATE_CONFLICT', async () => {
    const plan = await createPlan();
    const response = await changeStatus(ana, plan.plan_id, RESUME);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
  });
});

describe('changePlanStatus: validacao, versao e idempotencia', () => {
  it.each([
    ['sem motivo', { action: 'INTERRUPT', note: null }],
    ['motivo fora do enum', { action: 'INTERRUPT', reason: 'TIRED', note: null }],
    ['acao fora do enum', { action: 'PAUSE', reason: 'OTHER', note: null }],
    ['nota com mais de 200 caracteres', { ...INTERRUPT, note: 'x'.repeat(201) }],
  ])('%s: 400 VALIDATION_FAILED sem efeito', async (_nome, body) => {
    const plan = await createPlan();
    const response = await changeStatus(ana, plan.plan_id, body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const read = await h.call('getPlan', 'GET', `/plans/${plan.plan_id}`, { headers: ana.read });
    expect(read.body).toMatchObject({ status: 'ACTIVE', row_version: 1 });
  });

  it('If-Match ausente: 400; obsoleto: 409 VERSION_CONFLICT', async () => {
    const plan = await createPlan();
    const missing = await changeStatus(ana, plan.plan_id, INTERRUPT, { ifMatch: undefined });
    expect(missing.status).toBe(400);
    await h.pool.query('UPDATE medication_plans SET row_version = 3 WHERE id = $1', [plan.plan_id]);
    const stale = await changeStatus(ana, plan.plan_id, INTERRUPT, { ifMatch: '"2"' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('TS-038: repetir com a mesma Idempotency-Key devolve a mesma resposta', async () => {
    const plan = await createPlan();
    const first = await changeStatus(ana, plan.plan_id, INTERRUPT, { key: 'k-status' });
    const again = await changeStatus(ana, plan.plan_id, INTERRUPT, { key: 'k-status' });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it('TS-008: plano de outro titular -> 404 sem efeito e com auditoria', async () => {
    const plan = await createPlan();
    const response = await changeStatus(bruno, plan.plan_id, INTERRUPT);
    expect(response.status).toBe(404);
    const audit = await h.pool.query<{ actor_user_id: string; action: string }>(
      'SELECT actor_user_id, action FROM audit_events',
    );
    expect(audit.rows).toEqual([{ actor_user_id: brunoId, action: 'ownership.denied' }]);
    const read = await h.call('getPlan', 'GET', `/plans/${plan.plan_id}`, { headers: ana.read });
    expect(read.body).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('getPlan e listPlans com a situacao (DEC-036)', () => {
  it('ativos, interrompidos e cancelados aparecem; excluidos nao', async () => {
    const active = await createPlan();
    const interrupted = await createPlan({ ...PLAN, medication_name: 'Xarope' });
    const canceled = await createPlan({
      ...PLAN,
      medication_name: 'Pomada',
      start_date: '2026-10-09',
    });
    const deleted = await createPlan({ ...PLAN, medication_name: 'Gotas' });
    await changeStatus(ana, interrupted.plan_id, INTERRUPT);
    await changeStatus(ana, canceled.plan_id, CANCEL);
    await h.call('deletePlan', 'DELETE', `/plans/${deleted.plan_id}`, { headers: ana.mutation });

    const list = await h.call('listPlans', 'GET', '/plans', { headers: ana.read });
    const items = (list.body as { items: PlanBody[] }).items;
    expect(Object.fromEntries(items.map((plan) => [plan.plan_id, plan.status]))).toEqual({
      [active.plan_id]: 'ACTIVE',
      [interrupted.plan_id]: 'INTERRUPTED',
      [canceled.plan_id]: 'CANCELED',
    });
    expect(items.find((plan) => plan.plan_id === active.plan_id)).toMatchObject({
      status_reason: null,
      status_note: null,
      status_changed_at: null,
    });
    const read = await h.call('getPlan', 'GET', `/plans/${interrupted.plan_id}`, {
      headers: ana.read,
    });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ status: 'INTERRUPTED', status_reason: 'SIDE_EFFECT' });
  });
});

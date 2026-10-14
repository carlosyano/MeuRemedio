// @trace RF-003 RN-002 RN-006 RN-016 RN-018 CA-005 CA-012 CA-013 CA-017 TS-008 TS-015 TS-037 TS-038 TS-043 ERR-006 createPlan getPlan listPlans
// Planos por HTTP contra PostgreSQL 17 real: criacao com ETag e evento no Outbox na mesma
// transacao, idempotencia (TS-015 e passos do TS-038 para createPlan), confirmacao de duplicidade
// (RN-016, CA-017, TS-043), leitura com ownership (TS-008: 404 indistinguivel e auditoria
// ownership.denied) e listagem paginada so com planos ACTIVE do titular (TS-037).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

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

const at = (offsetMs: number): string => new Date(Date.parse(NOW) + offsetMs).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Plano padrao P1 dos testes sentinela, com 08:00 e 20:00 (CA-005). */
const PLAN_A = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

const PLAN_B = {
  medication_name: 'Xarope',
  dose_text: '10 ml',
  medication_form: 'LIQUID',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  end_date: '2026-12-31',
  schedule_times: ['09:30'],
} as const;

let users: { ana: LoggedIn; anaId: string; bruno: LoggedIn; brunoId: string };

beforeEach(async () => {
  const anaId = await h.activeUser('ana.silva@example.com');
  const brunoId = await h.activeUser('bruno.costa@example.com');
  users = {
    anaId,
    brunoId,
    ana: await login(h, 'ana.silva@example.com'),
    bruno: await login(h, 'bruno.costa@example.com'),
  };
});

const createPlan = (session: LoggedIn, key: string | undefined, body: unknown) =>
  h.call('createPlan', 'POST', '/plans', {
    body,
    headers: key === undefined ? session.mutation : { ...session.mutation, 'idempotency-key': key },
  });

const getPlan = (session: LoggedIn, planId: string) =>
  h.call('getPlan', 'GET', `/plans/${planId}`, { headers: session.read });

const listPlans = (session: LoggedIn, query = '') =>
  h.call('listPlans', 'GET', `/plans${query}`, { headers: session.read });

const planCount = async (userId?: string): Promise<number> =>
  Number(
    (
      await h.pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM medication_plans WHERE $1::uuid IS NULL OR user_id = $1',
        [userId ?? null],
      )
    ).rows[0]?.n,
  );

const idempotencyRecords = async (): Promise<number> =>
  Number(
    (await h.pool.query<{ n: string }>('SELECT count(*) AS n FROM idempotency_records')).rows[0]?.n,
  );

/** Corpo sem os campos que variam por requisicao. */
const stable = (body: unknown): unknown =>
  Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      ([key]) => key !== 'correlation_id' && key !== 'instance',
    ),
  );

interface PlanBody {
  plan_id: string;
  row_version: number;
  created_at: string;
}

interface DuplicateBody {
  code: string;
  duplicate_confirmation: {
    confirmation_token: string;
    candidates: { plan_id: string; medication_name: string; dose_text: string }[];
  };
}

describe('createPlan', () => {
  it('CA-005: 201 com ETag "1", horarios unicos e evento de geracao no Outbox', async () => {
    const response = await createPlan(users.ana, 'k-1', {
      ...PLAN_A,
      schedule_times: ['20:00', '08:00'],
    });
    expect(response.status).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    const body = response.body as PlanBody;
    expect(body).toEqual({
      plan_id: expect.any(String) as unknown,
      status: 'ACTIVE',
      medication_name: 'Comprimido',
      dose_text: '1 comprimido',
      medication_form: 'TABLET',
      administration_route: 'ORAL',
      instructions: null,
      prescriber_name: null,
      prescriber_crm: null,
      start_date: '2026-10-01',
      end_date: null,
      schedule_times: ['08:00', '20:00'],
      row_version: 1,
      created_at: expect.any(String) as unknown,
      updated_at: expect.any(String) as unknown,
    });
    expect(Date.parse(body.created_at)).toBe(Date.parse(NOW));

    const plan = await h.pool.query<{
      user_id: string;
      medication_name_norm: string;
      dose_text_norm: string;
    }>('SELECT user_id, medication_name_norm, dose_text_norm FROM medication_plans');
    expect(plan.rows).toEqual([
      { user_id: users.anaId, medication_name_norm: 'comprimido', dose_text_norm: '1 comprimido' },
    ]);
    const times = await h.pool.query<{ t: string }>(
      `SELECT to_char(time_of_day, 'HH24:MI') AS t FROM schedule_times
        WHERE plan_id = $1 AND removed_at IS NULL ORDER BY 1`,
      [body.plan_id],
    );
    expect(times.rows.map((row) => row.t)).toEqual(['08:00', '20:00']);
    const events = await h.pool.query<{
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: unknown;
      dispatched_at: Date | null;
    }>(
      `SELECT event_type, aggregate_type, aggregate_id, payload, dispatched_at
         FROM outbox_events WHERE event_type LIKE 'plans.%'`,
    );
    expect(events.rows).toEqual([
      {
        event_type: 'plans.occurrences_requested',
        aggregate_type: 'medication_plan',
        aggregate_id: body.plan_id,
        payload: { plan_id: body.plan_id },
        dispatched_at: null,
      },
    ]);
  });

  it('campos opcionais e CRM com formato valido sao persistidos e devolvidos', async () => {
    const response = await createPlan(users.ana, 'k-1', {
      ...PLAN_B,
      instructions: 'Apos o almoco',
      prescriber_name: 'Dra. Exemplo',
      prescriber_crm: 'SP-123456',
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      instructions: 'Apos o almoco',
      prescriber_name: 'Dra. Exemplo',
      prescriber_crm: 'SP-123456',
      end_date: '2026-12-31',
    });
  });

  it('nome e dose sao aparados; nome so com espacos e 400 sem efeito', async () => {
    const trimmed = await createPlan(users.ana, 'k-1', {
      ...PLAN_A,
      medication_name: '  Comprimido  ',
      dose_text: ' 1 comprimido ',
    });
    expect(trimmed.body).toMatchObject({
      medication_name: 'Comprimido',
      dose_text: '1 comprimido',
    });

    const blank = await createPlan(users.ana, 'k-2', { ...PLAN_B, medication_name: '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [expect.objectContaining({ field: 'medication_name' })],
    });
    expect(await planCount()).toBe(1);
  });

  it('end_date anterior a start_date: 422 BUSINESS_RULE_VIOLATION sem efeito', async () => {
    const response = await createPlan(users.ana, 'k-1', {
      ...PLAN_A,
      start_date: '2026-10-10',
      end_date: '2026-10-09',
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      field_errors: [expect.objectContaining({ field: 'end_date' })],
    });
    expect(await planCount()).toBe(0);
    expect(await idempotencyRecords()).toBe(0);
  });

  it.each([
    [
      '11 horarios (RN-006)',
      { schedule_times: Array.from({ length: 11 }, (_, i) => `${String(i + 10)}:00`) },
    ],
    ['nenhum horario', { schedule_times: [] }],
    ['horario repetido', { schedule_times: ['08:00', '08:00'] }],
    ['horario invalido', { schedule_times: ['24:00'] }],
    ['CRM fora do formato', { prescriber_crm: 'sp-12' }],
    ['campo desconhecido', { row_version: 3 }],
  ])('%s: 400 VALIDATION_FAILED sem efeito', async (_nome, change) => {
    const response = await createPlan(users.ana, 'k-1', { ...PLAN_A, ...change });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await planCount()).toBe(0);
  });

  it('sem sessao: 401', async () => {
    const response = await h.call('createPlan', 'POST', '/plans', {
      body: PLAN_A,
      headers: { 'idempotency-key': 'k-1', origin: 'https://app.example.invalid' },
    });
    expect(response.status).toBe(401);
  });
});

describe('TS-015 e TS-038 idempotencia de createPlan', () => {
  it('replay identico (propriedades em outra ordem) devolve o mesmo status, corpo e ETag sem novo plano', async () => {
    const first = await createPlan(users.ana, 'K1', PLAN_A);
    const reordered = Object.fromEntries(Object.entries(PLAN_A).reverse());
    const replay = await createPlan(users.ana, 'K1', reordered);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['etag']).toBe(first.headers['etag']);
    expect(await planCount()).toBe(1);
    expect(await idempotencyRecords()).toBe(1);
  });

  it('mesma chave com payload divergente: 409 IDEMPOTENCY_KEY_REUSED sem sobrescrever o snapshot', async () => {
    const first = await createPlan(users.ana, 'K1', PLAN_A);
    const divergent = await createPlan(users.ana, 'K1', { ...PLAN_A, medication_name: 'Outro' });
    expect(divergent.status).toBe(409);
    expect(divergent.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await planCount()).toBe(1);
    const replay = await createPlan(users.ana, 'K1', PLAN_A);
    expect(replay.body).toEqual(first.body);
  });

  it('a chave tem escopo por titular: Bruno usa K1 com o mesmo payload e cria o proprio plano', async () => {
    const ana = await createPlan(users.ana, 'K1', PLAN_A);
    const bruno = await createPlan(users.bruno, 'K1', PLAN_A);
    expect(bruno.status).toBe(201);
    expect((bruno.body as PlanBody).plan_id).not.toBe((ana.body as PlanBody).plan_id);
    expect(await planCount(users.anaId)).toBe(1);
    expect(await planCount(users.brunoId)).toBe(1);
  });

  it('chamadas simultaneas com a mesma chave e o mesmo payload produzem um unico efeito', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => createPlan(users.ana, 'K2', PLAN_B)),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const ids = new Set(responses.map((r) => (r.body as PlanBody).plan_id));
    expect(ids.size).toBe(1);
    expect(await planCount()).toBe(1);
  });

  it('sem Idempotency-Key: 400 VALIDATION_FAILED sem efeito', async () => {
    const response = await createPlan(users.ana, undefined, PLAN_A);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await planCount()).toBe(0);
  });

  it('apos 7 dias + 1 s a chave expirou e e tratada como nova (nao ha replay)', async () => {
    const first = await createPlan(users.ana, 'K1', PLAN_B);
    // A sessao dura no maximo 24 h (RN-004): cada salto de relogio exige novo login.
    h.now = at(7 * DAY - 1_000);
    const later = await login(h, 'ana.silva@example.com');
    expect((await createPlan(later, 'K1', PLAN_B)).body).toEqual(first.body);
    h.now = at(7 * DAY + 1_000);
    // Nova execucao: o plano anterior agora e candidato a duplicidade (RN-016).
    const again = await createPlan(await login(h, 'ana.silva@example.com'), 'K1', PLAN_B);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'DUPLICATE_CONFIRMATION_REQUIRED' });
  });
});

describe('RN-016, CA-017 e TS-043 confirmacao de duplicidade', () => {
  const requireDuplicate = async (
    session: LoggedIn,
    key: string,
    body: unknown,
  ): Promise<DuplicateBody> => {
    const response = await createPlan(session, key, body);
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({
      status: 409,
      code: 'DUPLICATE_CONFIRMATION_REQUIRED',
    });
    return response.body as DuplicateBody;
  };

  it('plano equivalente sem token: 409 com token e candidatos, sem criar nem gravar snapshot', async () => {
    const original = (await createPlan(users.ana, 'K1', PLAN_A)).body as PlanBody;
    const body = await requireDuplicate(users.ana, 'K2', PLAN_A);
    expect(body.duplicate_confirmation.candidates).toEqual([
      { plan_id: original.plan_id, medication_name: 'Comprimido', dose_text: '1 comprimido' },
    ]);
    expect(body.duplicate_confirmation.confirmation_token.length).toBeGreaterThanOrEqual(16);
    expect(await planCount()).toBe(1);
    expect(await idempotencyRecords()).toBe(1);
  });

  it('a comparacao usa nome e dose normalizados (espacos, caixa e diacriticos)', async () => {
    await createPlan(users.ana, 'K1', { ...PLAN_A, medication_name: 'Ácido Fólico' });
    await requireDuplicate(users.ana, 'K2', {
      ...PLAN_A,
      medication_name: '  acido   FOLICO ',
      dose_text: '1  Comprimido',
    });
  });

  it('confirmacao com o token e nova chave cria o plano; o token e de uso unico', async () => {
    await createPlan(users.ana, 'K1', PLAN_A);
    const { duplicate_confirmation: dup } = await requireDuplicate(users.ana, 'K2', PLAN_A);
    const confirmed = await createPlan(users.ana, 'K3', {
      ...PLAN_A,
      duplicate_confirmation_token: dup.confirmation_token,
    });
    expect(confirmed.status).toBe(201);
    expect(await planCount()).toBe(2);

    // Replay da confirmacao (mesma chave e corpo): snapshot, sem novo plano.
    const replay = await createPlan(users.ana, 'K3', {
      ...PLAN_A,
      duplicate_confirmation_token: dup.confirmation_token,
    });
    expect(replay.body).toEqual(confirmed.body);

    // O mesmo token com outra chave ja nao vale: nova confirmacao exigida, com token novo.
    const reused = await requireDuplicate(users.ana, 'K4', {
      ...PLAN_A,
      duplicate_confirmation_token: dup.confirmation_token,
    });
    expect(reused.duplicate_confirmation.confirmation_token).not.toBe(dup.confirmation_token);
    expect(reused.duplicate_confirmation.candidates).toHaveLength(2);
    expect(await planCount()).toBe(2);
  });

  it('o token fica vinculado ao payload: outro payload com o token exige nova confirmacao', async () => {
    await createPlan(users.ana, 'K1', PLAN_A);
    const { duplicate_confirmation: dup } = await requireDuplicate(users.ana, 'K2', PLAN_A);
    await requireDuplicate(users.ana, 'K3', {
      ...PLAN_A,
      instructions: 'Com agua',
      duplicate_confirmation_token: dup.confirmation_token,
    });
    expect(await planCount()).toBe(1);
  });

  it('o token vale 10 minutos', async () => {
    await createPlan(users.ana, 'K1', PLAN_A);
    const first = await requireDuplicate(users.ana, 'K2', PLAN_A);
    h.now = at(10 * MINUTE + 1_000);
    await requireDuplicate(users.ana, 'K3', {
      ...PLAN_A,
      duplicate_confirmation_token: first.duplicate_confirmation.confirmation_token,
    });

    const second = await requireDuplicate(users.ana, 'K4', PLAN_A);
    h.now = at(20 * MINUTE);
    const confirmed = await createPlan(users.ana, 'K5', {
      ...PLAN_A,
      duplicate_confirmation_token: second.duplicate_confirmation.confirmation_token,
    });
    expect(confirmed.status).toBe(201);
  });

  it('o token fica vinculado ao titular: token de Bruno nao confirma para Ana', async () => {
    await createPlan(users.ana, 'K1', PLAN_A);
    await createPlan(users.bruno, 'K1', PLAN_A);
    const bruno = await requireDuplicate(users.bruno, 'K2', PLAN_A);
    await requireDuplicate(users.ana, 'K2', {
      ...PLAN_A,
      duplicate_confirmation_token: bruno.duplicate_confirmation.confirmation_token,
    });
    expect(await planCount(users.anaId)).toBe(1);
  });

  it('planos de outro titular nao sao candidatos', async () => {
    await createPlan(users.bruno, 'K1', PLAN_A);
    expect((await createPlan(users.ana, 'K1', PLAN_A)).status).toBe(201);
  });

  it.each([
    ['periodo sem intersecao', { start_date: '2026-10-10' }, { end_date: '2026-10-09' }],
    ['dose diferente', { dose_text: '2 comprimidos' }, {}],
    ['nome diferente', { medication_name: 'Capsula' }, {}],
  ])('%s: cria sem confirmacao', async (_nome, novo, existente) => {
    await createPlan(users.ana, 'K1', { ...PLAN_A, ...existente });
    const response = await createPlan(users.ana, 'K2', { ...PLAN_A, ...novo });
    expect(response.status).toBe(201);
  });

  it('plano DELETED nao e candidato', async () => {
    await createPlan(users.ana, 'K1', PLAN_A);
    await h.pool.query("UPDATE medication_plans SET status = 'DELETED', deleted_at = $1", [NOW]);
    expect((await createPlan(users.ana, 'K2', PLAN_A)).status).toBe(201);
  });

  it('periodos que se tocam no ultimo dia (end_date inclusiva) se sobrepoem', async () => {
    await createPlan(users.ana, 'K1', { ...PLAN_A, end_date: '2026-10-10' });
    await requireDuplicate(users.ana, 'K2', { ...PLAN_A, start_date: '2026-10-10' });
  });

  it('criacoes simultaneas equivalentes com chaves distintas: exatamente um 201 e um 409', async () => {
    const responses = await Promise.all([
      createPlan(users.ana, 'K1', PLAN_A),
      createPlan(users.ana, 'K2', PLAN_A),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await planCount()).toBe(1);
  });
});

describe('getPlan e TS-008 acesso horizontal', () => {
  it('200 com o plano e o mesmo ETag da criacao', async () => {
    const created = await createPlan(users.ana, 'K1', PLAN_A);
    const plan = created.body as PlanBody;
    const response = await getPlan(users.ana, plan.plan_id);
    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.body).toEqual(created.body);
  });

  it('plano de outro titular: 404 indistinguivel de UUID inexistente e auditoria ownership.denied', async () => {
    const plan = (await createPlan(users.ana, 'K1', PLAN_A)).body as PlanBody;
    const foreign = await getPlan(users.bruno, plan.plan_id);
    const missing = await getPlan(users.bruno, '7b0c5e2a-0d3c-4a4e-9a51-3c0b7c1f2d11');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(stable(foreign.body)).toEqual(stable(missing.body));
    expect(foreign.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(Object.keys(foreign.headers).sort()).toEqual(Object.keys(missing.headers).sort());
    expect(foreign.headers['etag']).toBeUndefined();

    const audit = await h.pool.query<{
      actor_user_id: string;
      action: string;
      resource_type: string;
      resource_id: string;
      outcome: string;
      correlation_id: string;
    }>(
      'SELECT actor_user_id, action, resource_type, resource_id, outcome, correlation_id FROM audit_events',
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: users.brunoId,
        action: 'ownership.denied',
        resource_type: 'medication_plan',
        resource_id: plan.plan_id,
        outcome: 'DENIED',
        correlation_id: (foreign.body as { correlation_id: string }).correlation_id,
      },
    ]);
    // O plano de Ana segue intacto.
    expect((await getPlan(users.ana, plan.plan_id)).body).toEqual(plan);
  });

  it('TS-037: plano DELETED do proprio titular: 404', async () => {
    const plan = (await createPlan(users.ana, 'K1', PLAN_A)).body as PlanBody;
    await h.pool.query("UPDATE medication_plans SET status = 'DELETED', deleted_at = $1", [NOW]);
    const response = await getPlan(users.ana, plan.plan_id);
    expect(response.status).toBe(404);
  });

  it('sem sessao: 401', async () => {
    const plan = (await createPlan(users.ana, 'K1', PLAN_A)).body as PlanBody;
    expect((await h.call('getPlan', 'GET', `/plans/${plan.plan_id}`)).status).toBe(401);
  });

  it('identificador fora do formato UUID: 404 como o inexistente (DC-031)', async () => {
    const malformed = await getPlan(users.ana, 'nao-e-uuid');
    const missing = await getPlan(users.ana, '7b0c5e2a-0d3c-4a4e-9a51-3c0b7c1f2d11');
    expect(malformed.status).toBe(404);
    expect(stable(malformed.body)).toEqual(stable(missing.body));
  });

  // TS-008 em updatePlan e deletePlan no plano de outro titular: tests/security/ts-023.spec.ts.
});

describe('listPlans', () => {
  interface Page {
    items: PlanBody[];
    page: { next_cursor: string | null; limit: number };
  }

  const createAt = async (offsetMs: number, key: string, body: unknown): Promise<PlanBody> => {
    h.now = at(offsetMs);
    const response = await createPlan(users.ana, key, body);
    expect(response.status).toBe(201);
    return response.body as PlanBody;
  };

  it('lista os planos ACTIVE do titular, do mais recente ao mais antigo, com limite padrao 20', async () => {
    const a = await createAt(0, 'K1', PLAN_A);
    const b = await createAt(MINUTE, 'K2', PLAN_B);
    await createPlan(users.bruno, 'K1', { ...PLAN_A, medication_name: 'Do Bruno' });
    const response = await listPlans(users.ana);
    expect(response.status).toBe(200);
    const page = response.body as Page;
    expect(page.items.map((item) => item.plan_id)).toEqual([b.plan_id, a.plan_id]);
    expect(page.items[0]).toEqual(b);
    expect(page.page).toEqual({ next_cursor: null, limit: 20 });
  });

  it('pagina por cursor sem repetir nem pular planos, inclusive com o mesmo created_at', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const plan = await createAt(i < 3 ? 0 : MINUTE, `K${String(i)}`, {
        ...PLAN_B,
        medication_name: `Xarope ${String(i)}`,
      });
      ids.push(plan.plan_id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string =
        cursor === null ? '?limit=2' : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const page = (await listPlans(users.ana, query)).body as Page;
      expect(page.page.limit).toBe(2);
      seen.push(...page.items.map((item) => item.plan_id));
      cursor = page.page.next_cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('TS-037: plano DELETED nao aparece', async () => {
    const a = await createAt(0, 'K1', PLAN_A);
    await createAt(MINUTE, 'K2', PLAN_B);
    await h.pool.query(
      "UPDATE medication_plans SET status = 'DELETED', deleted_at = $1 WHERE id = $2",
      [NOW, a.plan_id],
    );
    const page = (await listPlans(users.ana)).body as Page;
    expect(page.items.map((item) => item.plan_id)).not.toContain(a.plan_id);
    expect(page.items).toHaveLength(1);
  });

  it('titular sem planos ve lista vazia (TS-023, colecao)', async () => {
    await createAt(0, 'K1', PLAN_A);
    const page = (await listPlans(users.bruno)).body as Page;
    expect(page).toEqual({ items: [], page: { next_cursor: null, limit: 20 } });
  });

  it.each([['?cursor=nao-e-cursor'], ['?limit=0'], ['?limit=101']])(
    '%s: 400 VALIDATION_FAILED',
    async (query) => {
      const response = await listPlans(users.ana, query);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );

  it('cursor emitido para outro titular nao revela planos alheios', async () => {
    for (let i = 0; i < 3; i += 1) {
      await createAt(i * MINUTE, `K${String(i)}`, { ...PLAN_B, medication_name: `X ${String(i)}` });
    }
    const first = (await listPlans(users.ana, '?limit=1')).body as Page;
    const cursor = first.page.next_cursor ?? '';
    const response = await listPlans(users.bruno, `?limit=1&cursor=${encodeURIComponent(cursor)}`);
    expect(response.status).toBe(200);
    expect((response.body as Page).items).toEqual([]);
  });
});

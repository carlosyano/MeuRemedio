// @trace RF-003 RF-004 RN-002 RN-007 RN-018 CA-006 CA-012 TS-004 TS-005 TS-008 TS-014 TS-027 TS-037 TS-038 ERR-006 updatePlan deletePlan
// Edicao e exclusao de planos por HTTP contra PostgreSQL 17 real: concorrencia otimista com
// If-Match/ETag (CA-006), idempotencia de updatePlan com o If-Match no hash (TS-038), preservacao
// das ocorrencias iniciadas e cancelamento so das futuras PROGRAMMED (TS-004, TS-027), regeracao
// pelo Outbox, corrida gerador x edicao (TS-014), exclusao logica idempotente (TS-005, TS-037) e
// acesso horizontal com 404 indistinguivel e auditoria (TS-008).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { generateOccurrences } from '../../apps/api/src/modules/occurrences/infrastructure/generate-occurrences.js';
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
const MISSING = '7b0c5e2a-0d3c-4a4e-9a51-3c0b7c1f2d11';

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

const EDIT = {
  ...PLAN,
  medication_name: 'Comprimido Novo',
  schedule_times: ['08:00', '12:00'],
} as const;

let ana: LoggedIn;
let anaId: string;
let bruno: LoggedIn;
let brunoId: string;

beforeEach(async () => {
  anaId = await h.activeUser('ana.silva@example.com');
  brunoId = await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

interface PlanBody {
  plan_id: string;
  row_version: number;
  medication_name: string;
  schedule_times: string[];
}

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

async function createPlan(session: LoggedIn = ana, body: unknown = PLAN): Promise<PlanBody> {
  const response = await h.call('createPlan', 'POST', '/plans', {
    body,
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(201);
  return response.body as PlanBody;
}

const updatePlan = (
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
  return h.call('updatePlan', 'PUT', `/plans/${planId}`, { body, headers });
};

const deletePlan = (session: LoggedIn, planId: string) =>
  h.call('deletePlan', 'DELETE', `/plans/${planId}`, { headers: session.mutation });

const getPlan = (session: LoggedIn, planId: string) =>
  h.call('getPlan', 'GET', `/plans/${planId}`, { headers: session.read });

/** Gera o horizonte do plano como o worker faria, no instante atual do relogio. */
const generate = (planId: string) =>
  handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );

interface OccurrenceRow {
  local_scheduled_date: string;
  local_time: string;
  scheduled_at: Date;
  status: string;
  medication_name_snapshot: string;
}

const occurrences = async (planId: string): Promise<OccurrenceRow[]> =>
  (
    await h.pool.query<OccurrenceRow>(
      `SELECT to_char(local_scheduled_date, 'YYYY-MM-DD') AS local_scheduled_date,
              to_char(local_time, 'HH24:MI') AS local_time, scheduled_at, status,
              medication_name_snapshot
         FROM occurrences WHERE plan_id = $1
        ORDER BY scheduled_at, status`,
      [planId],
    )
  ).rows;

const planRow = async (planId: string) =>
  (
    await h.pool.query<{
      status: string;
      row_version: string;
      medication_name: string;
      deleted_at: Date | null;
      updated_at: Date;
    }>(
      'SELECT status, row_version, medication_name, deleted_at, updated_at FROM medication_plans WHERE id = $1',
      [planId],
    )
  ).rows[0];

const stable = (body: unknown): unknown =>
  Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      ([key]) => key !== 'correlation_id' && key !== 'instance',
    ),
  );

const auditRows = async () =>
  (
    await h.pool.query<{ actor_user_id: string; action: string; resource_id: string }>(
      'SELECT actor_user_id, action, resource_id FROM audit_events ORDER BY occurred_at',
    )
  ).rows;

describe('updatePlan', () => {
  it('CA-006: If-Match "7" salva e devolve a versao 8; If-Match "6" retorna 409 VERSION_CONFLICT', async () => {
    const plan = await createPlan();
    await h.pool.query('UPDATE medication_plans SET row_version = 7 WHERE id = $1', [plan.plan_id]);

    const stale = await updatePlan(ana, plan.plan_id, EDIT, { ifMatch: '"6"' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await planRow(plan.plan_id))?.medication_name).toBe('Comprimido');

    const saved = await updatePlan(ana, plan.plan_id, EDIT, { ifMatch: '"7"' });
    expect(saved.status).toBe(200);
    expect(saved.headers['etag']).toBe('"8"');
    expect(saved.body).toMatchObject({
      plan_id: plan.plan_id,
      status: 'ACTIVE',
      medication_name: 'Comprimido Novo',
      schedule_times: ['08:00', '12:00'],
      row_version: 8,
    });
    const read = await getPlan(ana, plan.plan_id);
    expect(read.headers['etag']).toBe('"8"');
    expect(read.body).toEqual(saved.body);
  });

  it.each([
    ['If-Match ausente', undefined],
    ['If-Match fraco', 'W/"1"'],
    ['If-Match sem aspas', '1'],
    ['If-Match zero', '"0"'],
  ])('%s: 400 VALIDATION_FAILED sem efeito', async (_nome, ifMatch) => {
    const plan = await createPlan();
    const response = await updatePlan(ana, plan.plan_id, EDIT, { ifMatch });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await planRow(plan.plan_id))?.row_version).toBe('1');
  });

  it('horarios: mantem os que ficam, remove logicamente os retirados e inclui os novos', async () => {
    const plan = await createPlan();
    const before = await h.pool.query<{ id: string; t: string }>(
      "SELECT id, to_char(time_of_day, 'HH24:MI') AS t FROM schedule_times WHERE plan_id = $1",
      [plan.plan_id],
    );
    await updatePlan(ana, plan.plan_id, EDIT);
    const after = await h.pool.query<{ id: string; t: string; removed: boolean }>(
      `SELECT id, to_char(time_of_day, 'HH24:MI') AS t, removed_at IS NOT NULL AS removed
         FROM schedule_times WHERE plan_id = $1 ORDER BY time_of_day, removed_at NULLS FIRST`,
      [plan.plan_id],
    );
    const kept = before.rows.find((row) => row.t === '08:00')?.id;
    expect(after.rows.map(({ t, removed }) => ({ t, removed }))).toEqual([
      { t: '08:00', removed: false },
      { t: '12:00', removed: false },
      { t: '20:00', removed: true },
    ]);
    expect(after.rows[0]?.id).toBe(kept);
  });

  it('nome so com espacos: 400; end_date antes de start_date: 422; nada muda', async () => {
    const plan = await createPlan();
    const blank = await updatePlan(ana, plan.plan_id, { ...EDIT, dose_text: '  ' });
    expect(blank.status).toBe(400);
    const period = await updatePlan(ana, plan.plan_id, {
      ...EDIT,
      start_date: '2026-10-10',
      end_date: '2026-10-01',
    });
    expect(period.status).toBe(422);
    expect(period.body).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(await planRow(plan.plan_id)).toMatchObject({
      row_version: '1',
      medication_name: 'Comprimido',
    });
  });

  it('duplicate_confirmation_token nao faz parte da edicao: 400', async () => {
    const plan = await createPlan();
    const response = await updatePlan(ana, plan.plan_id, {
      ...EDIT,
      duplicate_confirmation_token: 'dup_0123456789abcdef',
    });
    expect(response.status).toBe(400);
  });

  it('a edicao nao verifica duplicidade (RN-016 so na criacao)', async () => {
    await createPlan(ana, { ...PLAN, medication_name: 'Xarope', schedule_times: ['09:00'] });
    const other = await createPlan();
    const response = await updatePlan(ana, other.plan_id, {
      ...PLAN,
      medication_name: 'Xarope',
      schedule_times: ['09:00'],
    });
    expect(response.status).toBe(200);
  });

  it('grava plans.occurrences_requested no Outbox na transacao da edicao', async () => {
    const plan = await createPlan();
    await updatePlan(ana, plan.plan_id, EDIT);
    const events = await h.pool.query<{ payload: unknown }>(
      `SELECT payload FROM outbox_events
        WHERE event_type = 'plans.occurrences_requested' ORDER BY created_at`,
    );
    expect(events.rows).toEqual([
      { payload: { plan_id: plan.plan_id } },
      { payload: { plan_id: plan.plan_id } },
    ]);
  });
});

describe('TS-004 e TS-027 ocorrencias na edicao', () => {
  it('preserva as iniciadas (scheduled_at <= instante da acao) e as respondidas; cancela so as futuras PROGRAMMED e regera', async () => {
    const plan = await createPlan();
    await generate(plan.plan_id);
    // Uma futura ja respondida (TAKEN antecipado) nao pode ser cancelada.
    await h.pool.query(
      `UPDATE occurrences SET status = 'TAKEN'
        WHERE plan_id = $1 AND local_scheduled_date = '2026-10-06' AND local_time = '20:00'`,
      [plan.plan_id],
    );
    // Acao exatamente as 20:00 de 05/10 em Sao Paulo (23:00Z): essa ocorrencia ja iniciou.
    h.now = '2026-10-05T23:00:00Z';
    const session = await login(h, 'ana.silva@example.com');
    const response = await updatePlan(session, plan.plan_id, EDIT);
    expect(response.status).toBe(200);

    const rows = await occurrences(plan.plan_id);
    const started = rows.filter((row) => row.scheduled_at.getTime() <= Date.parse(h.now));
    expect(
      started.map((row) => `${row.local_scheduled_date} ${row.local_time} ${row.status}`),
    ).toEqual(['2026-10-05 08:00 PROGRAMMED', '2026-10-05 20:00 PROGRAMMED']);
    expect(started.every((row) => row.medication_name_snapshot === 'Comprimido')).toBe(true);
    const future = rows.filter((row) => row.scheduled_at.getTime() > Date.parse(h.now));
    expect(future.filter((row) => row.status === 'PROGRAMMED')).toEqual([]);
    expect(future.filter((row) => row.status === 'TAKEN')).toHaveLength(1);
    expect(future.filter((row) => row.status === 'CANCELED')).toHaveLength(62 - 2 - 1);

    // O worker regera com a configuracao nova, sem duplicar o slot respondido.
    await generate(plan.plan_id);
    const regenerated = (await occurrences(plan.plan_id)).filter(
      (row) => row.scheduled_at.getTime() > Date.parse(h.now) && row.status === 'PROGRAMMED',
    );
    expect(new Set(regenerated.map((row) => row.local_time))).toEqual(new Set(['08:00', '12:00']));
    expect(regenerated.every((row) => row.medication_name_snapshot === 'Comprimido Novo')).toBe(
      true,
    );
    const active = await h.pool.query<{ n: string; d: string }>(
      `SELECT count(*) AS n, count(DISTINCT (local_scheduled_date, local_time)) AS d
         FROM occurrences WHERE plan_id = $1 AND status <> 'CANCELED'`,
      [plan.plan_id],
    );
    expect(active.rows[0]?.n).toBe(active.rows[0]?.d);
  });
});

describe('TS-014 gerador x edicao', () => {
  it('em 15 corridas, nenhuma ocorrencia futura ativa do horario removido e nenhuma duplicata', async () => {
    for (let i = 0; i < 15; i += 1) {
      const plan = await createPlan(ana, { ...PLAN, medication_name: `Plano ${String(i)}` });
      await Promise.all([
        generateOccurrences(h.pool, {
          planId: plan.plan_id,
          now: NOW,
          fromDate: '2026-10-06',
          toDate: '2026-10-12',
        }),
        updatePlan(ana, plan.plan_id, {
          ...PLAN,
          medication_name: `Plano ${String(i)}`,
          schedule_times: ['09:00'],
        }),
      ]);
      await generate(plan.plan_id);
      const rows = await occurrences(plan.plan_id);
      const futureActive = rows.filter(
        (row) => row.scheduled_at.getTime() > Date.parse(NOW) && row.status !== 'CANCELED',
      );
      expect(futureActive.filter((row) => row.local_time !== '09:00')).toEqual([]);
      const slots = futureActive.map((row) => `${row.local_scheduled_date} ${row.local_time}`);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });
});

describe('TS-038 idempotencia de updatePlan', () => {
  it('replay identico devolve o mesmo 200 e ETag sem nova versao', async () => {
    const plan = await createPlan();
    const first = await updatePlan(ana, plan.plan_id, EDIT, { key: 'U1' });
    const replay = await updatePlan(ana, plan.plan_id, EDIT, { key: 'U1' });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['etag']).toBe('"2"');
    expect((await planRow(plan.plan_id))?.row_version).toBe('2');
  });

  it('mesma chave com corpo ou If-Match divergente: 409 IDEMPOTENCY_KEY_REUSED sem efeito', async () => {
    const plan = await createPlan();
    await updatePlan(ana, plan.plan_id, EDIT, { key: 'U1' });
    const body = await updatePlan(
      ana,
      plan.plan_id,
      { ...EDIT, dose_text: '2 comprimidos' },
      { key: 'U1' },
    );
    expect(body.status).toBe(409);
    expect(body.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    const ifMatch = await updatePlan(ana, plan.plan_id, EDIT, { key: 'U1', ifMatch: '"2"' });
    expect(ifMatch.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await planRow(plan.plan_id))?.row_version).toBe('2');
  });

  it('sem Idempotency-Key: 400', async () => {
    const plan = await createPlan();
    const response = await updatePlan(ana, plan.plan_id, EDIT, { key: undefined });
    expect(response.status).toBe(400);
    expect((await planRow(plan.plan_id))?.row_version).toBe('1');
  });

  it('apos 7 dias + 1 s a chave e nova: o If-Match antigo agora conflita', async () => {
    const plan = await createPlan();
    await updatePlan(ana, plan.plan_id, EDIT, { key: 'U1' });
    h.now = at(7 * DAY + 1_000);
    const session = await login(h, 'ana.silva@example.com');
    const again = await updatePlan(session, plan.plan_id, EDIT, { key: 'U1' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('deletePlan', () => {
  it('TS-005: 204; o plano some de getPlan e listPlans e o historico iniciado fica', async () => {
    const plan = await createPlan();
    await generate(plan.plan_id);
    h.now = at(10 * MINUTE);
    const response = await deletePlan(ana, plan.plan_id);
    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();

    expect(await planRow(plan.plan_id)).toMatchObject({ status: 'DELETED' });
    expect((await planRow(plan.plan_id))?.deleted_at?.toISOString()).toBe(
      new Date(Date.parse(h.now)).toISOString(),
    );
    expect((await getPlan(ana, plan.plan_id)).status).toBe(404);
    const list = await h.call('listPlans', 'GET', '/plans', { headers: ana.read });
    expect(list.body).toMatchObject({ items: [] });

    const rows = await occurrences(plan.plan_id);
    const started = rows.filter((row) => row.scheduled_at.getTime() <= Date.parse(h.now));
    expect(started.map((row) => row.status)).toEqual(['PROGRAMMED']);
    expect(started[0]?.medication_name_snapshot).toBe('Comprimido');
    const future = rows.filter((row) => row.scheduled_at.getTime() > Date.parse(h.now));
    expect(new Set(future.map((row) => row.status))).toEqual(new Set(['CANCELED']));
  });

  it('exclusao logica idempotente: repetir devolve 204 sem alterar deleted_at', async () => {
    const plan = await createPlan();
    expect((await deletePlan(ana, plan.plan_id)).status).toBe(204);
    const first = await planRow(plan.plan_id);
    h.now = at(MINUTE);
    expect((await deletePlan(ana, plan.plan_id)).status).toBe(204);
    expect(await planRow(plan.plan_id)).toEqual(first);
  });

  it('plano excluido nao gera ocorrencias nem aceita edicao', async () => {
    const plan = await createPlan();
    await deletePlan(ana, plan.plan_id);
    await generate(plan.plan_id);
    expect(await occurrences(plan.plan_id)).toEqual([]);
    expect((await updatePlan(ana, plan.plan_id, EDIT)).status).toBe(404);
  });

  it('TS-037: o plano excluido nao conta para a duplicidade', async () => {
    const plan = await createPlan();
    await deletePlan(ana, plan.plan_id);
    await createPlan();
  });
});

describe('TS-008 acesso horizontal em updatePlan e deletePlan', () => {
  it.each([
    ['updatePlan', (planId: string) => updatePlan(bruno, planId, EDIT)],
    ['deletePlan', (planId: string) => deletePlan(bruno, planId)],
  ])(
    '%s no plano de outro titular: 404 identico ao inexistente, auditado e sem efeito',
    async (_op, call) => {
      const plan = await createPlan();
      const foreign = await call(plan.plan_id);
      const missing = await call(MISSING);
      const malformed = await call('nao-e-uuid');
      expect(foreign.status).toBe(404);
      expect(stable(foreign.body)).toEqual(stable(missing.body));
      expect(stable(malformed.body)).toEqual(stable(missing.body));
      expect(Object.keys(foreign.headers).sort()).toEqual(Object.keys(missing.headers).sort());
      expect(await auditRows()).toEqual([
        { actor_user_id: brunoId, action: 'ownership.denied', resource_id: plan.plan_id },
      ]);
      expect(await planRow(plan.plan_id)).toMatchObject({
        status: 'ACTIVE',
        row_version: '1',
        medication_name: 'Comprimido',
      });
      expect(anaId).not.toBe(brunoId);
    },
  );
});

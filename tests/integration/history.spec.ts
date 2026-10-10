// @trace RF-007 RN-010 RN-013 CA-009 CA-012 TS-005 TS-023 TS-037 getHistory
// Historico por HTTP contra PostgreSQL 17 real: periodo civil inclusivo de ate 12 meses como
// intervalo semiaberto no fuso da conta (RN-010), so registros do titular em ordem decrescente
// (CA-009), com a resposta de cada ocorrencia; plano excluido continua no historico (TS-005,
// TS-037); U2 nao ve dados de U1 (TS-023).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 08:00 local = 11:00Z; 20:00 local = 23:00Z.
const NOW = '2026-10-05T07:00:00Z'; // 04:00 local de 05/10
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

let ana: LoggedIn;
let bruno: LoggedIn;

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.activeUser('ana.silva@example.com');
  await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

interface ItemBody {
  occurrence: { occurrence_id: string; scheduled_at: string; status: string; plan_id: string };
  response: { type: string; reason: string | null; captured_at: string; is_late: boolean } | null;
}

interface PageBody {
  items: ItemBody[];
  page: { next_cursor: string | null; limit: number };
}

/** Plano com o horizonte gerado em 05/10 04:00 local; o relogio avanca 3 dias (07/10 04:00 local). */
async function planWithPast(session: LoggedIn = ana): Promise<string> {
  const response = await h.call('createPlan', 'POST', '/plans', {
    body: PLAN,
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(201);
  const planId = (response.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  return planId;
}

async function advanceTo(instant: string): Promise<void> {
  h.now = instant;
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
}

const history = (session: LoggedIn, query: string) =>
  h.call('getHistory', 'GET', `/history?${query}`, { headers: session.read });

const occurrenceId = async (planId: string, date: string, time: string): Promise<string> => {
  const row = (
    await h.pool.query<{ id: string }>(
      `SELECT id FROM occurrences
        WHERE plan_id = $1 AND local_scheduled_date = $2 AND local_time = $3`,
      [planId, date, time],
    )
  ).rows[0];
  if (row === undefined) throw new Error(`ocorrencia ${date} ${time} ausente`);
  return row.id;
};

describe('getHistory: periodo civil e ordem decrescente (RN-010, CA-009)', () => {
  it('lista as ocorrencias ja alcancadas do periodo, da mais recente para a mais antiga, com a resposta', async () => {
    const planId = await planWithPast();
    await advanceTo('2026-10-07T07:00:00Z');
    const answered = await occurrenceId(planId, '2026-10-06', '08:00');
    const created = await h.call('createResponse', 'POST', `/occurrences/${answered}/responses`, {
      body: { type: 'NOT_TAKEN', reason: 'FORGOT' },
      headers: { ...ana.mutation, 'idempotency-key': nextKey() },
    });
    expect(created.status).toBe(201);

    const response = await history(ana, 'start=2026-10-05&end=2026-10-07');
    expect(response.status).toBe(200);
    const page = response.body as PageBody;
    // 07/10 08:00 local ainda nao chegou: fica fora.
    expect(page.items.map((i) => i.occurrence.scheduled_at)).toEqual([
      '2026-10-06T23:00:00Z',
      '2026-10-06T11:00:00Z',
      '2026-10-05T23:00:00Z',
      '2026-10-05T11:00:00Z',
    ]);
    expect(page.items[1]).toMatchObject({
      occurrence: { occurrence_id: answered, status: 'NOT_TAKEN' },
      response: {
        type: 'NOT_TAKEN',
        reason: 'FORGOT',
        captured_at: '2026-10-07T07:00:00Z',
        is_late: true,
      },
    });
    expect(page.items[0]?.response).toBeNull();
    expect(page.page).toEqual({ next_cursor: null, limit: 20 });
  });

  it('o periodo corta pela data civil no fuso da conta (intervalo semiaberto)', async () => {
    await planWithPast();
    await advanceTo('2026-10-07T07:00:00Z');
    // So 06/10 local: 11:00Z e 23:00Z de 06/10 (23:00Z ainda e 06/10 em Sao Paulo).
    const page = (await history(ana, 'start=2026-10-06&end=2026-10-06')).body as PageBody;
    expect(page.items.map((i) => i.occurrence.scheduled_at)).toEqual([
      '2026-10-06T23:00:00Z',
      '2026-10-06T11:00:00Z',
    ]);
  });

  it('pagina por cursor sem repetir nem pular', async () => {
    await planWithPast();
    await advanceTo('2026-10-07T07:00:00Z');
    const first = (await history(ana, 'start=2026-10-05&end=2026-10-07&limit=3')).body as PageBody;
    expect(first.items).toHaveLength(3);
    expect(first.page.next_cursor).not.toBeNull();
    const second = (
      await history(
        ana,
        `start=2026-10-05&end=2026-10-07&limit=3&cursor=${encodeURIComponent(first.page.next_cursor ?? '')}`,
      )
    ).body as PageBody;
    expect(second.items.map((i) => i.occurrence.scheduled_at)).toEqual(['2026-10-05T11:00:00Z']);
    expect(second.page.next_cursor).toBeNull();
  });

  it('omite as canceladas e mantem as de plano excluido (TS-005, TS-037)', async () => {
    const planId = await planWithPast();
    await advanceTo('2026-10-06T07:00:00Z');
    expect(
      (await h.call('deletePlan', 'DELETE', `/plans/${planId}`, { headers: ana.mutation })).status,
    ).toBe(204);
    await advanceTo('2026-10-07T07:00:00Z');
    const page = (await history(ana, 'start=2026-10-05&end=2026-10-07')).body as PageBody;
    // Iniciadas antes da exclusao ficam; as futuras foram canceladas e nao aparecem.
    expect(page.items.map((i) => i.occurrence.scheduled_at)).toEqual([
      '2026-10-05T23:00:00Z',
      '2026-10-05T11:00:00Z',
    ]);
    expect(page.items.every((i) => i.occurrence.plan_id === planId)).toBe(true);
  });

  it('TS-023: U2 nao ve nenhum registro de U1', async () => {
    await planWithPast(ana);
    await advanceTo('2026-10-07T07:00:00Z');
    const page = (await history(bruno, 'start=2026-10-01&end=2026-10-31')).body as PageBody;
    expect(page.items).toEqual([]);
  });
});

describe('getHistory: periodo invalido (TL-006)', () => {
  it.each([
    ['end antes de start', 'start=2026-10-07&end=2026-10-05', 'end'],
    ['mais de 12 meses', 'start=2025-10-01&end=2026-10-01', 'end'],
    ['sem start', 'end=2026-10-05', 'start'],
    ['data inexistente', 'start=2026-02-30&end=2026-03-05', 'start'],
  ])('%s: 400 VALIDATION_FAILED', async (_caso, query, field) => {
    const response = await history(ana, query);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [expect.objectContaining({ field }) as unknown],
    });
  });

  it('cursor invalido: 400 no campo cursor', async () => {
    const response = await history(ana, 'start=2026-10-01&end=2026-10-05&cursor=xyz');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'cursor' }] });
  });

  it('sem sessao: 401', async () => {
    const response = await h.call('getHistory', 'GET', '/history?start=2026-10-01&end=2026-10-05');
    expect(response.status).toBe(401);
  });
});

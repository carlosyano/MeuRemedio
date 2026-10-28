// @trace RF-003 RF-004 RF-007 RF-008 ERR-001 DEC-038 listTreatmentReasons createPlan getPlan updatePlan deletePlan listOccurrences getHistory
// Motivo do tratamento por HTTP contra PostgreSQL 17 real (DEC-038): texto opcional no plano, de 1
// a 80 caracteres, que vira um motivo do titular reaproveitado por outros planos com o mesmo nome
// normalizado; listTreatmentReasons lista os motivos em uso; o motivo some quando nenhum plano o
// usa; as ocorrencias guardam o nome do motivo como snapshot, que vai ao historico e ao PDF.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  freezeHistory,
  renderHistoryPdf,
} from '../../apps/api/src/modules/exports/application/history-pdf.js';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { pdfText } from './support/pdf-text.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 2026-10-05 08:05 local.
const NOW = '2026-10-05T11:05:15Z';
let h: Harness;
let ana: LoggedIn;
let anaId: string;
let bruno: LoggedIn;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  anaId = await h.activeUser('ana.silva@example.com');
  await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

const PLAN = {
  medication_name: 'Losartana',
  dose_text: '50 mg',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00'],
} as const;

interface PlanBody {
  plan_id: string;
  treatment_reason: { treatment_reason_id: string; name: string } | null;
}

interface ReasonPage {
  items: { treatment_reason_id: string; name: string; plan_count: number }[];
  page: { next_cursor: string | null; limit: number };
}

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

const create = (session: LoggedIn, body: unknown) =>
  h.call('createPlan', 'POST', '/plans', {
    body,
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });

async function createPlan(body: unknown, session: LoggedIn = ana): Promise<PlanBody> {
  const response = await create(session, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as PlanBody;
}

const reasons = async (session: LoggedIn = ana, query = ''): Promise<ReasonPage> => {
  const response = await h.call('listTreatmentReasons', 'GET', `/treatment-reasons${query}`, {
    headers: session.read,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as ReasonPage;
};

const update = (planId: string, body: unknown, ifMatch = '"1"') =>
  h.call('updatePlan', 'PUT', `/plans/${planId}`, {
    body,
    headers: { ...ana.mutation, 'if-match': ifMatch, 'idempotency-key': nextKey() },
  });

describe('motivo do tratamento no plano (DEC-038)', () => {
  it('sem motivo: treatment_reason null e nenhum motivo listado', async () => {
    const plan = await createPlan(PLAN);
    expect(plan.treatment_reason).toBeNull();
    expect((await reasons()).items).toEqual([]);
  });

  it('o mesmo motivo, escrito de outro jeito, e reaproveitado por varios remedios', async () => {
    const first = await createPlan({ ...PLAN, treatment_reason: '  Pressão alta ' });
    expect(first.treatment_reason).toEqual({
      treatment_reason_id: expect.any(String) as unknown,
      name: 'Pressão alta',
    });
    const second = await createPlan({
      ...PLAN,
      medication_name: 'Hidroclorotiazida',
      dose_text: '25 mg',
      treatment_reason: 'pressao   ALTA',
    });
    expect(second.treatment_reason).toEqual(first.treatment_reason);
    const read = await h.call('getPlan', 'GET', `/plans/${second.plan_id}`, { headers: ana.read });
    expect(read.body).toMatchObject({ treatment_reason: { name: 'Pressão alta' } });

    const list = await reasons();
    expect(list.items).toEqual([
      {
        treatment_reason_id: first.treatment_reason?.treatment_reason_id,
        name: 'Pressão alta',
        plan_count: 2,
      },
    ]);
  });

  it('motivos em ordem alfabetica, paginados, so do proprio titular', async () => {
    await createPlan({ ...PLAN, treatment_reason: 'Rinite' });
    await createPlan({ ...PLAN, medication_name: 'Dipirona', treatment_reason: 'Dor de cabeça' });
    await createPlan({ ...PLAN, treatment_reason: 'Ansiedade' }, bruno);
    const first = await reasons(ana, '?limit=1');
    expect(first.items.map((item) => item.name)).toEqual(['Dor de cabeça']);
    expect(first.page.next_cursor).not.toBeNull();
    const second = await reasons(
      ana,
      `?limit=1&cursor=${encodeURIComponent(first.page.next_cursor ?? '')}`,
    );
    expect(second.items.map((item) => item.name)).toEqual(['Rinite']);
    expect(second.page.next_cursor).toBeNull();
    expect((await reasons(bruno)).items.map((item) => item.name)).toEqual(['Ansiedade']);
  });

  it.each([
    ['so espacos', '   '],
    ['mais de 80 caracteres', 'x'.repeat(81)],
  ])('motivo %s: 400 VALIDATION_FAILED sem criar o plano', async (_nome, treatment_reason) => {
    const response = await create(ana, { ...PLAN, treatment_reason });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const count = await h.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM medication_plans',
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  it('limit fora de 1..100 ou cursor invalido: 400 VALIDATION_FAILED', async () => {
    for (const query of ['?limit=0', '?limit=101', '?cursor=nao-e-cursor']) {
      const response = await h.call('listTreatmentReasons', 'GET', `/treatment-reasons${query}`, {
        headers: ana.read,
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});

describe('motivo sem plano deixa de existir (DEC-038)', () => {
  it('editar o motivo troca o vinculo e apaga o motivo que ficou sem plano', async () => {
    const plan = await createPlan({ ...PLAN, treatment_reason: 'Pressão alta' });
    const edited = await update(plan.plan_id, { ...PLAN, treatment_reason: 'Coração' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ treatment_reason: { name: 'Coração' } });
    expect((await reasons()).items.map((item) => item.name)).toEqual(['Coração']);

    const cleared = await update(plan.plan_id, PLAN, '"2"');
    expect(cleared.body).toMatchObject({ treatment_reason: null });
    expect((await reasons()).items).toEqual([]);
    const stored = await h.pool.query('SELECT 1 FROM treatment_reasons WHERE user_id = $1', [
      anaId,
    ]);
    expect(stored.rowCount).toBe(0);
  });

  it('excluir o ultimo plano do motivo apaga o motivo; com outro plano, so diminui a contagem', async () => {
    const one = await createPlan({ ...PLAN, treatment_reason: 'Pressão alta' });
    const two = await createPlan({
      ...PLAN,
      medication_name: 'Hidroclorotiazida',
      treatment_reason: 'Pressão alta',
    });
    await h.call('deletePlan', 'DELETE', `/plans/${one.plan_id}`, { headers: ana.mutation });
    expect((await reasons()).items).toMatchObject([{ name: 'Pressão alta', plan_count: 1 }]);
    await h.call('deletePlan', 'DELETE', `/plans/${two.plan_id}`, { headers: ana.mutation });
    expect((await reasons()).items).toEqual([]);
  });
});

describe('snapshot do motivo nas ocorrencias, no historico e no PDF (DEC-038)', () => {
  it('a ocorrencia guarda o nome do motivo; listOccurrences e getHistory o devolvem', async () => {
    const plan = await createPlan({ ...PLAN, treatment_reason: 'Pressão alta' });
    await handleOccurrencesRequested(
      { pool: h.pool, clock: { now: () => h.now } },
      { event_id: '00000000-0000-4000-8000-000000000000', plan_id: plan.plan_id },
    );
    const today = await h.call('listOccurrences', 'GET', '/occurrences?local_date=2026-10-05', {
      headers: ana.read,
    });
    expect((today.body as { items: unknown[] }).items).toMatchObject([
      { treatment_reason_snapshot: 'Pressão alta' },
    ]);
    const history = await h.call('getHistory', 'GET', '/history?start=2026-10-05&end=2026-10-05', {
      headers: ana.read,
    });
    expect((history.body as { items: unknown[] }).items).toMatchObject([
      { occurrence: { treatment_reason_snapshot: 'Pressão alta' } },
    ]);

    const client = await h.pool.connect();
    try {
      const snapshot = await freezeHistory(client, {
        userId: anaId,
        timeZone: 'America/Sao_Paulo',
        startDate: '2026-10-05',
        endDate: '2026-10-05',
        now: NOW,
      });
      expect(snapshot.items).toMatchObject([{ treatment_reason: 'Pressão alta' }]);
      const text = pdfText(await renderHistoryPdf(snapshot));
      expect(text).toContain('Motivo do tratamento: Pressão alta');
    } finally {
      client.release();
    }
  });

  it('plano sem motivo: snapshot null e o PDF sem a linha do motivo', async () => {
    const plan = await createPlan(PLAN);
    await handleOccurrencesRequested(
      { pool: h.pool, clock: { now: () => h.now } },
      { event_id: '00000000-0000-4000-8000-000000000000', plan_id: plan.plan_id },
    );
    const today = await h.call('listOccurrences', 'GET', '/occurrences?local_date=2026-10-05', {
      headers: ana.read,
    });
    expect((today.body as { items: unknown[] }).items).toMatchObject([
      { treatment_reason_snapshot: null },
    ]);
    const text = pdfText(
      await renderHistoryPdf({
        version: 1,
        time_zone: 'America/Sao_Paulo',
        start_date: '2026-10-05',
        end_date: '2026-10-05',
        frozen_at: NOW,
        items: [
          {
            local_date: '2026-10-05',
            local_time: '08:00',
            medication_name: 'Losartana',
            dose_text: '50 mg',
            status: 'NO_RESPONSE',
            response: null,
          },
        ],
      }),
    );
    expect(text).toContain('Losartana');
    expect(text).not.toContain('Motivo do tratamento');
  });
});

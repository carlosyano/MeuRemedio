// @trace RF-004 RN-007 RN-013 TS-003
// Job horario do horizonte contra PostgreSQL 17 real (Especificacao 02.33 secao 6, DEC-027): a cada
// hora, o horizonte de 30 dias de cada plano ACTIVE de conta ACTIVE avanca com a data civil; a
// reexecucao nao duplica (RN-007, TS-003); plano excluido e conta em exclusao nao geram nada.
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HORIZON_REFRESH_QUEUE,
  refreshHorizons,
} from '../../apps/api/src/modules/occurrences/application/horizon-refresh.js';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { startWorker } from '../../apps/api/src/worker.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3). Em 05/10 o horizonte vai ate 04/11, inclusive.
const NOW = '2026-10-05T11:05:15Z';
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

let ana: LoggedIn;
let anaId: string;

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  anaId = await h.activeUser('ana.silva@example.com');
  ana = await login(h, 'ana.silva@example.com');
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

async function planWithOccurrences(body: unknown = PLAN): Promise<string> {
  keySequence += 1;
  const response = await h.call('createPlan', 'POST', '/plans', {
    body,
    headers: { ...ana.mutation, 'idempotency-key': `k-${String(keySequence)}` },
  });
  expect(response.status).toBe(201);
  const planId = (response.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  return planId;
}

const lastDate = async (planId: string): Promise<string | null> =>
  (
    await h.pool.query<{ last: string | null }>(
      `SELECT to_char(max(local_scheduled_date), 'YYYY-MM-DD') AS last
         FROM occurrences WHERE plan_id = $1`,
      [planId],
    )
  ).rows[0]?.last ?? null;

const count = async (planId: string): Promise<number> =>
  Number(
    (
      await h.pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM occurrences WHERE plan_id = $1',
        [planId],
      )
    ).rows[0]?.n,
  );

describe('refreshHorizons: horizonte movel de 30 dias (RF-004, DEC-027)', () => {
  it('no dia seguinte, acrescenta a nova data do fim do horizonte', async () => {
    const planId = await planWithOccurrences();
    expect(await lastDate(planId)).toBe('2026-11-04');
    const before = await count(planId);

    const result = await refreshHorizons(h.pool, { now: '2026-10-06T11:00:00Z' });
    expect(result).toEqual({ plans: 1, inserted: 2 });
    expect(await lastDate(planId)).toBe('2026-11-05');
    expect(await count(planId)).toBe(before + 2);
  });

  it('TS-003: reexecutar na mesma hora nao insere nada', async () => {
    const planId = await planWithOccurrences();
    await refreshHorizons(h.pool, { now: '2026-10-06T11:00:00Z' });
    const after = await count(planId);
    expect(await refreshHorizons(h.pool, { now: '2026-10-06T12:00:00Z' })).toEqual({
      plans: 1,
      inserted: 0,
    });
    expect(await count(planId)).toBe(after);
  });

  it('respeita end_date: plano encerrado nao ganha datas novas', async () => {
    const planId = await planWithOccurrences({ ...PLAN, end_date: '2026-10-20' });
    expect(await lastDate(planId)).toBe('2026-10-20');
    expect(await refreshHorizons(h.pool, { now: '2026-10-10T11:00:00Z' })).toMatchObject({
      inserted: 0,
    });
    expect(await lastDate(planId)).toBe('2026-10-20');
  });

  it('plano excluido nao gera', async () => {
    const planId = await planWithOccurrences();
    expect(
      (await h.call('deletePlan', 'DELETE', `/plans/${planId}`, { headers: ana.mutation })).status,
    ).toBe(204);
    expect(await refreshHorizons(h.pool, { now: '2026-10-06T11:00:00Z' })).toEqual({
      plans: 0,
      inserted: 0,
    });
    expect(await lastDate(planId)).toBe('2026-11-04');
  });

  it('conta em exclusao (DELETION_SCHEDULED) nao gera', async () => {
    const planId = await planWithOccurrences();
    await h.pool.query(
      `UPDATE users SET status = 'DELETION_SCHEDULED', deletion_requested_at = $2,
                        purge_due_at = $2::timestamptz + interval '30 days'
        WHERE id = $1`,
      [anaId, NOW],
    );
    expect(await refreshHorizons(h.pool, { now: '2026-10-06T11:00:00Z' })).toEqual({
      plans: 0,
      inserted: 0,
    });
    expect(await lastDate(planId)).toBe('2026-11-04');
  });
});

describe('worker: horizonte agendado a cada hora', () => {
  it('agenda a fila e o consumidor avanca o horizonte', async () => {
    const planId = await planWithOccurrences();
    const boss = new PgBoss({ connectionString: h.url });
    boss.on('error', () => undefined);
    h.now = '2026-10-06T11:00:00Z';
    const worker = await startWorker({
      pool: h.pool,
      boss,
      clock: { now: () => h.now },
      email: { send: () => Promise.resolve() },
      webBaseUrl: 'https://app.example.invalid',
      pollIntervalMs: 100,
    });
    try {
      const schedules = await boss.getSchedules(HORIZON_REFRESH_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(['0 * * * *']);

      await boss.send(HORIZON_REFRESH_QUEUE, {});
      const limit = Date.now() + 20_000;
      while ((await lastDate(planId)) !== '2026-11-05' && Date.now() < limit) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await lastDate(planId)).toBe('2026-11-05');
    } finally {
      await worker.stop();
    }
  });
});

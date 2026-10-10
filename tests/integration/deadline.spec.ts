// @trace RF-004 RN-009 CA-008 TS-006 TS-013 createResponse
// Job de prazo contra PostgreSQL 17 real: ocorrencia PROGRAMMED com prazo atingido passa uma unica
// vez a NO_RESPONSE com o marco no_response_reached_at (RN-009, CA-008), sem depender de lembrete
// (TS-006); a corrida com createResponse termina em estado unico e coerente (TS-013); o worker
// agenda a varredura a cada minuto no pg-boss (Especificacao 02.33 secao 6).
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import {
  DEADLINE_SWEEP_QUEUE,
  markReachedDeadlines,
} from '../../apps/api/src/modules/occurrences/application/deadline-sweep.js';
import { startWorker } from '../../apps/api/src/worker.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 08:00 local = 11:00Z, prazo 12:00Z; 20:00 local = 23:00Z.
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
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

async function planWithOccurrences(): Promise<string> {
  const response = await h.call('createPlan', 'POST', '/plans', {
    body: PLAN,
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(201);
  const planId = (response.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  return planId;
}

interface Row {
  status: string;
  no_response_reached_at: Date | null;
  row_version: string;
  is_late: boolean;
}

const rowOf = async (planId: string, date: string, time: string): Promise<Row & { id: string }> => {
  const row = (
    await h.pool.query<Row & { id: string }>(
      `SELECT id, status, no_response_reached_at, row_version, is_late FROM occurrences
        WHERE plan_id = $1 AND local_scheduled_date = $2 AND local_time = $3`,
      [planId, date, time],
    )
  ).rows[0];
  if (row === undefined) throw new Error(`ocorrencia ${date} ${time} ausente`);
  return row;
};

describe('markReachedDeadlines: prazo de 60 minutos (RN-009, CA-008)', () => {
  it('antes do prazo nada muda; no prazo vira NO_RESPONSE com o marco do instante da varredura', async () => {
    const planId = await planWithOccurrences();
    expect(await markReachedDeadlines(h.pool, { now: '2026-10-05T11:59:59Z' })).toEqual({
      updated: 0,
    });
    expect((await rowOf(planId, '2026-10-05', '08:00')).status).toBe('PROGRAMMED');

    expect(await markReachedDeadlines(h.pool, { now: '2026-10-05T12:00:00Z' })).toEqual({
      updated: 1,
    });
    expect(await rowOf(planId, '2026-10-05', '08:00')).toMatchObject({
      status: 'NO_RESPONSE',
      no_response_reached_at: new Date('2026-10-05T12:00:00Z'),
      row_version: '2',
      is_late: false,
    });
    expect((await rowOf(planId, '2026-10-05', '20:00')).status).toBe('PROGRAMMED');
  });

  it('CA-008: muda uma unica vez; varreduras seguintes preservam o primeiro marco', async () => {
    const planId = await planWithOccurrences();
    await markReachedDeadlines(h.pool, { now: '2026-10-05T12:00:30Z' });
    expect(await markReachedDeadlines(h.pool, { now: '2026-10-05T12:01:30Z' })).toEqual({
      updated: 0,
    });
    expect(await rowOf(planId, '2026-10-05', '08:00')).toMatchObject({
      status: 'NO_RESPONSE',
      no_response_reached_at: new Date('2026-10-05T12:00:30Z'),
      row_version: '2',
    });
  });

  it('respondidas, canceladas e futuras ficam como estao', async () => {
    const planId = await planWithOccurrences();
    const taken = await rowOf(planId, '2026-10-05', '08:00');
    const response = await h.call('createResponse', 'POST', `/occurrences/${taken.id}/responses`, {
      body: { type: 'TAKEN', reason: null },
      headers: { ...ana.mutation, 'idempotency-key': nextKey() },
    });
    expect(response.status).toBe(201);
    const canceled = await rowOf(planId, '2026-10-05', '20:00');
    await h.pool.query(`UPDATE occurrences SET status = 'CANCELED' WHERE id = $1`, [canceled.id]);

    // 06/10 00:30Z: prazos de 05/10 vencidos; 06/10 08:00 local ainda no futuro.
    expect(await markReachedDeadlines(h.pool, { now: '2026-10-06T00:30:00Z' })).toEqual({
      updated: 0,
    });
    expect((await rowOf(planId, '2026-10-05', '08:00')).status).toBe('TAKEN');
    expect((await rowOf(planId, '2026-10-05', '20:00')).status).toBe('CANCELED');
    expect((await rowOf(planId, '2026-10-06', '08:00')).status).toBe('PROGRAMMED');
  });

  it('TS-006: sem e-mail nem lembrete web, o prazo ainda gera NO_RESPONSE', async () => {
    const planId = await planWithOccurrences();
    const before = await h.pool.query('SELECT 1 FROM outbox_events WHERE event_type LIKE $1', [
      'reminders.%',
    ]);
    expect(before.rowCount).toBe(0);
    await markReachedDeadlines(h.pool, { now: '2026-10-05T12:00:00Z' });
    expect((await rowOf(planId, '2026-10-05', '08:00')).status).toBe('NO_RESPONSE');
  });

  it('processa em lotes ate esgotar os prazos vencidos', async () => {
    const planId = await planWithOccurrences();
    // 08/10 00:00Z: 6 ocorrencias com prazo vencido (05, 06 e 07/10, 08:00 e 20:00).
    expect(
      await markReachedDeadlines(h.pool, { now: '2026-10-08T00:00:00Z', batchSize: 4 }),
    ).toEqual({ updated: 6 });
    const pending = await h.pool.query(
      `SELECT 1 FROM occurrences
        WHERE plan_id = $1 AND status = 'PROGRAMMED' AND deadline_at <= '2026-10-08T00:00:00Z'`,
      [planId],
    );
    expect(pending.rowCount).toBe(0);
  });
});

describe('TS-013: resposta versus prazo', () => {
  it('30 corridas: sempre 201, 1 resposta, estado igual ao tipo e is_late=true', async () => {
    const planId = await planWithOccurrences();
    const timeId = (
      await h.pool.query<{ id: string }>(
        `SELECT id FROM schedule_times WHERE plan_id = $1 AND time_of_day = '08:00'`,
        [planId],
      )
    ).rows[0]?.id;
    // Relogio no prazo exato: a varredura e a resposta (tardia) disputam a mesma linha.
    h.now = '2026-10-05T12:00:00Z';
    ana = await login(h, 'ana.silva@example.com');
    for (let i = 0; i < 30; i += 1) {
      const id = (
        await h.pool.query<{ id: string }>(
          `INSERT INTO occurrences (user_id, plan_id, schedule_time_id, local_scheduled_date,
                                   local_time, scheduled_at, deadline_at, medication_name_snapshot,
                                   dose_text_snapshot)
           VALUES ($1, $2, $3, DATE '2025-01-01' + $4::int, '08:00', '2026-10-05T11:00:00Z',
                   '2026-10-05T12:00:00Z', 'Comprimido', '1 comprimido')
           RETURNING id`,
          [anaId, planId, timeId, i],
        )
      ).rows[0]?.id;
      if (id === undefined) throw new Error('ocorrencia nao criada');

      const [response] = await Promise.all([
        h.call('createResponse', 'POST', `/occurrences/${id}/responses`, {
          body: { type: 'NOT_TAKEN', reason: 'FORGOT' },
          headers: { ...ana.mutation, 'idempotency-key': nextKey() },
        }),
        markReachedDeadlines(h.pool, { now: h.now }),
      ]);
      expect(response.status, `corrida ${String(i)}`).toBe(201);
      expect(response.body).toMatchObject({ is_late: true });
      const final = (
        await h.pool.query<Row & { responses: string }>(
          `SELECT o.status, o.no_response_reached_at, o.row_version, o.is_late,
                  (SELECT count(*) FROM responses r WHERE r.occurrence_id = o.id) AS responses
             FROM occurrences o WHERE o.id = $1`,
          [id],
        )
      ).rows[0];
      expect(final).toMatchObject({ status: 'NOT_TAKEN', is_late: true, responses: '1' });
      // A varredura que venceu deixa o marco (versao 3); a que perdeu nao toca a linha (versao 2).
      expect(final?.row_version).toBe(final?.no_response_reached_at === null ? '2' : '3');
    }
    // Nenhuma varredura posterior encontra a ocorrencia respondida.
    expect(await markReachedDeadlines(h.pool, { now: '2026-10-05T12:05:00Z' })).toMatchObject({
      updated: 0,
    });
  });
});

describe('worker: varredura agendada a cada minuto', () => {
  it('agenda a fila e o consumidor aplica o prazo', async () => {
    const planId = await planWithOccurrences();
    const boss = new PgBoss({ connectionString: h.url });
    boss.on('error', () => undefined);
    h.now = '2026-10-05T12:00:10Z';
    const worker = await startWorker({
      pool: h.pool,
      boss,
      clock: { now: () => h.now },
      email: { send: () => Promise.resolve(undefined) },
      webBaseUrl: 'https://app.example.invalid',
      pollIntervalMs: 100,
    });
    try {
      const schedules = await boss.getSchedules(DEADLINE_SWEEP_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(['* * * * *']);

      await boss.send(DEADLINE_SWEEP_QUEUE, {});
      const limit = Date.now() + 20_000;
      while (
        (await rowOf(planId, '2026-10-05', '08:00')).status !== 'NO_RESPONSE' &&
        Date.now() < limit
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await rowOf(planId, '2026-10-05', '08:00')).toMatchObject({
        status: 'NO_RESPONSE',
        no_response_reached_at: new Date('2026-10-05T12:00:10Z'),
      });
    } finally {
      await worker.stop();
    }
  });
});

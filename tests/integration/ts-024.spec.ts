// @trace TS-024 TS-003 RN-007 RN-009 RN-013 RN-018 RF-004 DEC-027 (secao 13.5 da Especificacao 02.33; ADR-001 v1.5 OA-003)
// Gerador de ocorrencias contra PostgreSQL 17 REAL (QG-004): DST, unicidade por (plano, data, horario),
// reexecucao sem alterar linhas e o horizonte de 30 dias da DEC-027 (limites e horarios ja vencidos).
// O disparo via Outbox/job horario fica fora desta etapa.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateOccurrences,
  generateOccurrencesForHorizon,
} from '../../apps/api/src/modules/occurrences/infrastructure/generate-occurrences.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

// Instante anterior a todas as janelas explicitas: nenhuma ocorrencia nasce vencida.
const BEFORE_WINDOWS = '2026-01-01T00:00:00Z';
// Relogio padrao dos cenarios (docs/specifications/P0_SENTINEL_TESTS.md).
const NOW = '2026-10-05T11:05:00Z';

let db: PostgresHandle;
let pool: pg.Pool;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 12 });
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
});

// ---------- fixtures (dados sinteticos: AGENTS.md secao 15) ----------
let sequence = 0;

async function insertReturningId(sql: string, params: unknown[]): Promise<string> {
  const result = await pool.query<{ id: string }>(sql, params);
  const first = result.rows[0];
  if (!first) throw new Error('INSERT nao retornou id');
  return first.id;
}

interface PlanFixture {
  readonly userId: string;
  readonly planId: string;
  readonly timeIds: Record<string, string>;
}

async function planFixture(options: {
  zone: string;
  times: readonly string[];
  startDate?: string;
  endDate?: string | null;
}): Promise<PlanFixture> {
  sequence += 1;
  const userId = await insertReturningId(
    `INSERT INTO users (name, email_normalized, password_hash, status, account_timezone,
       terms_version, privacy_notice_version, terms_accepted_at, privacy_acknowledged_at, verified_at)
     VALUES ('Ana Silva', $1, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'ACTIVE', $2,
       '2026-10', '2026-10', '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z')
     RETURNING id`,
    [`ana.silva+${String(sequence)}@example.com`, options.zone],
  );
  const planId = await insertReturningId(
    `INSERT INTO medication_plans (user_id, medication_name, medication_name_norm, dose_text,
       dose_text_norm, medication_form, administration_route, start_date, end_date)
     VALUES ($1, 'Comprimido', 'comprimido', '1 comprimido', '1 comprimido', 'TABLET', 'ORAL', $2, $3)
     RETURNING id`,
    [userId, options.startDate ?? '2026-01-01', options.endDate ?? null],
  );
  const timeIds: Record<string, string> = {};
  for (const time of options.times) {
    timeIds[time] = await insertReturningId(
      'INSERT INTO schedule_times (plan_id, time_of_day) VALUES ($1, $2) RETURNING id',
      [planId, time],
    );
  }
  return { userId, planId, timeIds };
}

interface OccurrenceRow {
  id: string;
  user_id: string;
  schedule_time_id: string;
  local_scheduled_date: string;
  local_time: string;
  scheduled_at: string;
  deadline_at: string;
  status: string;
  no_response_reached_at: string | null;
  medication_name_snapshot: string;
  dose_text_snapshot: string;
  row_version: string;
  created_at: string;
  updated_at: string;
}

async function occurrencesOf(planId: string): Promise<OccurrenceRow[]> {
  const result = await pool.query<OccurrenceRow>(
    `SELECT id, user_id, schedule_time_id,
            to_char(local_scheduled_date, 'YYYY-MM-DD') AS local_scheduled_date,
            to_char(local_time, 'HH24:MI') AS local_time,
            to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS scheduled_at,
            to_char(deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deadline_at,
            status,
            to_char(no_response_reached_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
              AS no_response_reached_at,
            medication_name_snapshot, dose_text_snapshot, row_version::text,
            created_at::text, updated_at::text
       FROM occurrences WHERE plan_id = $1
      ORDER BY local_scheduled_date, local_time`,
    [planId],
  );
  return result.rows;
}

// ---------- fixtures normativas (docs/specifications/P0_SENTINEL_TESTS.md, TS-024) ----------
const TRANSITIONS = [
  ['America/New_York', '2026-03-08', '02:30', '2026-03-08T07:00:00Z'],
  ['America/New_York', '2026-11-01', '01:30', '2026-11-01T05:30:00Z'],
  ['Europe/Lisbon', '2026-03-29', '01:30', '2026-03-29T01:00:00Z'],
  ['Europe/Lisbon', '2026-10-25', '01:30', '2026-10-25T00:30:00Z'],
  ['America/Santiago', '2026-09-06', '00:30', '2026-09-06T04:00:00Z'],
  ['America/Santiago', '2026-04-04', '23:30', '2026-04-05T02:30:00Z'],
  ['Australia/Lord_Howe', '2026-10-04', '02:15', '2026-10-03T15:30:00Z'],
  ['Australia/Lord_Howe', '2026-04-05', '01:45', '2026-04-04T14:45:00Z'],
] as const;

describe('TS-024 generateOccurrences: dias de transicao no PostgreSQL', () => {
  it.each(TRANSITIONS)(
    '%s %s %s -> exatamente 1 ocorrencia em %s, com local_time preservado',
    async (zone, date, time, expectedUtc) => {
      const plan = await planFixture({ zone, times: [time] });
      const result = await generateOccurrences(pool, {
        planId: plan.planId,
        now: BEFORE_WINDOWS,
        fromDate: date,
        toDate: date,
      });
      expect(result.inserted).toBe(1);
      const rows = await occurrencesOf(plan.planId);
      expect(rows).toHaveLength(1);
      const deadline = new Date(Date.parse(expectedUtc) + 3_600_000)
        .toISOString()
        .replace('.000Z', 'Z');
      expect(rows[0]).toMatchObject({
        user_id: plan.userId,
        schedule_time_id: plan.timeIds[time],
        local_scheduled_date: date,
        local_time: time,
        scheduled_at: expectedUtc,
        deadline_at: deadline,
        status: 'PROGRAMMED',
        medication_name_snapshot: 'Comprimido',
        dose_text_snapshot: '1 comprimido',
        row_version: '1',
      });
    },
  );

  it('no dia de repeticao de hora, todos os horarios do plano geram 1 ocorrencia cada', async () => {
    const times = ['00:30', '01:00', '01:30', '01:59', '02:00', '02:30'];
    const plan = await planFixture({ zone: 'America/New_York', times });
    await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
    });
    const rows = await occurrencesOf(plan.planId);
    expect(rows.map((r) => r.local_time)).toEqual(times);
    expect(rows.find((r) => r.local_time === '01:30')?.scheduled_at).toBe('2026-11-01T05:30:00Z');
  });

  it('na lacuna, 02:30 e 03:00 geram 2 ocorrencias distintas no mesmo instante UTC', async () => {
    const plan = await planFixture({ zone: 'America/New_York', times: ['02:30', '03:00'] });
    await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
    });
    const rows = await occurrencesOf(plan.planId);
    expect(rows.map((r) => [r.local_time, r.scheduled_at])).toEqual([
      ['02:30', '2026-03-08T07:00:00Z'],
      ['03:00', '2026-03-08T07:00:00Z'],
    ]);
  });

  it('America/Sao_Paulo (sem DST): 08:00 vira 11:00Z em todo o periodo', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['08:00'] });
    await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-01',
      toDate: '2026-10-30',
    });
    const rows = await occurrencesOf(plan.planId);
    expect(rows).toHaveLength(30);
    for (const row of rows) expect(row.scheduled_at).toBe(`${row.local_scheduled_date}T11:00:00Z`);
  });
});

describe('TS-024 / TS-003 generateOccurrences: reexecucao e concorrencia', () => {
  it('reexecutar o gerador nao insere nem altera linhas existentes', async () => {
    const plan = await planFixture({ zone: 'Europe/Lisbon', times: ['01:30', '08:00'] });
    const window = {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-20',
      toDate: '2026-10-30',
    };
    const first = await generateOccurrences(pool, window);
    expect(first.inserted).toBe(22);
    const before = await occurrencesOf(plan.planId);

    const second = await generateOccurrences(pool, window);
    expect(second.inserted).toBe(0);
    expect(await occurrencesOf(plan.planId)).toEqual(before);
  });

  it('ampliar a janela insere apenas os dias novos e preserva os existentes', async () => {
    const plan = await planFixture({ zone: 'America/Santiago', times: ['23:30'] });
    await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-04-01',
      toDate: '2026-04-04',
    });
    const before = await occurrencesOf(plan.planId);
    const widened = await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-04-01',
      toDate: '2026-04-06',
    });
    expect(widened.inserted).toBe(2);
    const after = await occurrencesOf(plan.planId);
    expect(after.slice(0, 4)).toEqual(before);
    expect(after.map((r) => r.local_scheduled_date)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
      '2026-04-06',
    ]);
  });

  it('execucoes simultaneas nao duplicam ocorrencias nem falham', async () => {
    const plan = await planFixture({ zone: 'America/New_York', times: ['01:30', '02:30'] });
    const window = {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-28',
      toDate: '2026-11-03',
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => generateOccurrences(pool, window)),
    );
    expect(results.reduce((sum, r) => sum + r.inserted, 0)).toBe(14);
    const rows = await occurrencesOf(plan.planId);
    expect(rows).toHaveLength(14);
    expect(new Set(rows.map((r) => `${r.local_scheduled_date} ${r.local_time}`)).size).toBe(14);
  });
});

describe('TS-024 generateOccurrences: escopo do plano', () => {
  it('respeita inicio e fim do plano', async () => {
    const plan = await planFixture({
      zone: 'America/Sao_Paulo',
      times: ['08:00'],
      startDate: '2026-10-03',
      endDate: '2026-10-05',
    });
    const result = await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-01',
      toDate: '2026-10-10',
    });
    expect(result.inserted).toBe(3);
    expect((await occurrencesOf(plan.planId)).map((r) => r.local_scheduled_date)).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
  });

  it('ignora horarios removidos', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['08:00', '20:00'] });
    await pool.query('UPDATE schedule_times SET removed_at = now() WHERE id = $1', [
      plan.timeIds['20:00'],
    ]);
    await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-05',
      toDate: '2026-10-06',
    });
    expect((await occurrencesOf(plan.planId)).map((r) => r.local_time)).toEqual(['08:00', '08:00']);
  });

  it('plano excluido logicamente nao gera ocorrencias', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['08:00'] });
    await pool.query(
      "UPDATE medication_plans SET status = 'DELETED', deleted_at = now() WHERE id = $1",
      [plan.planId],
    );
    const result = await generateOccurrences(pool, {
      planId: plan.planId,
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-05',
      toDate: '2026-10-06',
    });
    expect(result.inserted).toBe(0);
    expect(await occurrencesOf(plan.planId)).toEqual([]);
  });

  it('plano inexistente nao gera ocorrencias', async () => {
    const result = await generateOccurrences(pool, {
      planId: '00000000-0000-4000-8000-000000000000',
      now: BEFORE_WINDOWS,
      fromDate: '2026-10-05',
      toDate: '2026-10-06',
    });
    expect(result.inserted).toBe(0);
  });
});

describe('DEC-027 generateOccurrencesForHorizon: horizonte de 30 dias', () => {
  it('gera da data atual ate + 30 dias, inclusive, no fuso da conta', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['20:00'] });
    const result = await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: NOW });
    expect(result.inserted).toBe(31);
    const dates = (await occurrencesOf(plan.planId)).map((r) => r.local_scheduled_date);
    expect(dates[0]).toBe('2026-10-05');
    expect(dates.at(-1)).toBe('2026-11-04');
  });

  it('usa a data civil da conta: 01:30Z ainda e o dia anterior em Sao Paulo', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['23:00'] });
    await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: '2026-10-05T01:30:00Z' });
    const rows = await occurrencesOf(plan.planId);
    expect(rows[0]?.local_scheduled_date).toBe('2026-10-04');
    expect(rows.at(-1)?.local_scheduled_date).toBe('2026-11-03');
  });

  it('horarios do dia ja vencidos nascem NO_RESPONSE; os demais, PROGRAMMED', async () => {
    // 11:05Z = 08:05 em Sao Paulo: 06:00 ja venceu (prazo 10:00Z); 08:00 passou, mas o prazo
    // (12:00Z) nao; 20:00 ainda vai acontecer.
    const plan = await planFixture({
      zone: 'America/Sao_Paulo',
      times: ['06:00', '08:00', '20:00'],
    });
    await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: NOW });
    const rows = await occurrencesOf(plan.planId);
    const today = rows.filter((r) => r.local_scheduled_date === '2026-10-05');
    expect(today.map((r) => [r.local_time, r.status, r.no_response_reached_at])).toEqual([
      ['06:00', 'NO_RESPONSE', NOW],
      ['08:00', 'PROGRAMMED', null],
      ['20:00', 'PROGRAMMED', null],
    ]);
    const later = rows.filter((r) => r.local_scheduled_date !== '2026-10-05');
    expect(later).toHaveLength(90);
    expect(later.every((r) => r.status === 'PROGRAMMED' && r.no_response_reached_at === null)).toBe(
      true,
    );
  });

  it('respeita start_date futura e end_date dentro do horizonte', async () => {
    const plan = await planFixture({
      zone: 'America/Sao_Paulo',
      times: ['08:00'],
      startDate: '2026-10-20',
      endDate: '2026-10-25',
    });
    const result = await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: NOW });
    expect(result.inserted).toBe(6);
    expect((await occurrencesOf(plan.planId)).map((r) => r.local_scheduled_date)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('nao gera nada quando o plano comeca depois do horizonte ou ja terminou', async () => {
    const future = await planFixture({
      zone: 'America/Sao_Paulo',
      times: ['08:00'],
      startDate: '2026-11-05',
    });
    const ended = await planFixture({
      zone: 'America/Sao_Paulo',
      times: ['08:00'],
      startDate: '2026-09-01',
      endDate: '2026-10-04',
    });
    for (const plan of [future, ended]) {
      const result = await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: NOW });
      expect(result.inserted).toBe(0);
      expect(await occurrencesOf(plan.planId)).toEqual([]);
    }
  });

  it('o job do dia seguinte insere so o novo ultimo dia e preserva as existentes', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['06:00', '20:00'] });
    await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: NOW });
    const before = await occurrencesOf(plan.planId);

    const next = await generateOccurrencesForHorizon(pool, {
      planId: plan.planId,
      now: '2026-10-06T11:05:00Z',
    });
    expect(next.inserted).toBe(2);
    const after = await occurrencesOf(plan.planId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((r) => [r.local_scheduled_date, r.status])).toEqual([
      ['2026-11-05', 'PROGRAMMED'],
      ['2026-11-05', 'PROGRAMMED'],
    ]);
  });

  it('plano excluido logicamente ou inexistente nao gera ocorrencias', async () => {
    const plan = await planFixture({ zone: 'America/Sao_Paulo', times: ['08:00'] });
    await pool.query(
      "UPDATE medication_plans SET status = 'DELETED', deleted_at = now() WHERE id = $1",
      [plan.planId],
    );
    const deleted = await generateOccurrencesForHorizon(pool, { planId: plan.planId, now: NOW });
    expect(deleted.inserted).toBe(0);
    const missing = await generateOccurrencesForHorizon(pool, {
      planId: '00000000-0000-4000-8000-000000000000',
      now: NOW,
    });
    expect(missing.inserted).toBe(0);
  });
});

// @trace TS-024 TS-003 RN-007 RN-009 RN-013 RF-004 (secao 13.5 da Especificacao 02.33; ADR-001 v1.5 OA-003)
// Gerador de ocorrencias contra PostgreSQL 17 REAL (QG-004): DST, unicidade por (plano, data, horario)
// e reexecucao sem alterar linhas. A janela de datas civis e explicita; a politica do horizonte movel
// de 30 dias (inicio e limites) e o disparo via Outbox/job ficam fora desta etapa.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateOccurrences } from '../../apps/api/src/modules/occurrences/infrastructure/generate-occurrences.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

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
            status, medication_name_snapshot, dose_text_snapshot, row_version::text,
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
    const window = { planId: plan.planId, fromDate: '2026-10-20', toDate: '2026-10-30' };
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
      fromDate: '2026-04-01',
      toDate: '2026-04-04',
    });
    const before = await occurrencesOf(plan.planId);
    const widened = await generateOccurrences(pool, {
      planId: plan.planId,
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
    const window = { planId: plan.planId, fromDate: '2026-10-28', toDate: '2026-11-03' };
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
      fromDate: '2026-10-05',
      toDate: '2026-10-06',
    });
    expect(result.inserted).toBe(0);
    expect(await occurrencesOf(plan.planId)).toEqual([]);
  });

  it('plano inexistente nao gera ocorrencias', async () => {
    const result = await generateOccurrences(pool, {
      planId: '00000000-0000-4000-8000-000000000000',
      fromDate: '2026-10-05',
      toDate: '2026-10-06',
    });
    expect(result.inserted).toBe(0);
  });
});

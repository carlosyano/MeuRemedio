// @trace TS-001 TS-025 RN-002 RN-003 RN-004 RN-006 RN-007 RN-008 RN-009 RN-013 RF-001 RF-002 RF-003 RF-004 RF-006 DEC-036 DEC-037 DEC-038
// Esquema central no PostgreSQL 17 REAL (docs/architecture/DATA_MODEL.md: ENT-001 e ENT-004 a ENT-008).
// Base de banco do TS-001 (concorrencia TAKEN x NOT_TAKEN): o teste HTTP completo vem com a API.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';
import { asArray, asString, asStrings, dig } from '../contract/support/json.js';
import { loadContract } from '../contract/support/load.js';
import { expectPgError } from './support/pg-errors.js';

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

// ---------- helpers de dados ----------
let sequence = 0;
const next = (): string => {
  sequence += 1;
  return String(sequence);
};

async function insert(
  table: string,
  row: Record<string, unknown>,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<string> {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const keys = entries.map(([key]) => key);
  const placeholders = keys.map((_, index) => `$${String(index + 1)}`).join(', ');
  const result = await client.query<{ id: string }>(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    entries.map(([, value]) => value),
  );
  const first = result.rows[0];
  if (!first) throw new Error(`INSERT em ${table} nao retornou id`);
  return first.id;
}

const userRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Ana Silva',
  email_normalized: `ana${next()}@example.com`,
  password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
  status: 'ACTIVE',
  account_timezone: 'America/Sao_Paulo',
  terms_version: '2026-10',
  privacy_notice_version: '2026-10',
  terms_accepted_at: '2026-10-01T10:00:00Z',
  privacy_acknowledged_at: '2026-10-01T10:00:00Z',
  verified_at: '2026-10-01T10:05:00Z',
  ...over,
});

const planRow = (userId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  user_id: userId,
  medication_name: 'Comprimido X',
  medication_name_norm: 'comprimido x',
  dose_text: '1 comprimido',
  dose_text_norm: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  ...over,
});

const timeRow = (planId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  plan_id: planId,
  time_of_day: '08:00',
  ...over,
});

const occurrenceRow = (
  userId: string,
  planId: string,
  scheduleTimeId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  user_id: userId,
  plan_id: planId,
  schedule_time_id: scheduleTimeId,
  local_scheduled_date: '2026-10-05',
  local_time: '08:00',
  scheduled_at: '2026-10-05T11:00:00Z',
  deadline_at: '2026-10-05T12:00:00Z',
  medication_name_snapshot: 'Comprimido X',
  dose_text_snapshot: '1 comprimido',
  ...over,
});

interface Chain {
  userId: string;
  planId: string;
  timeId: string;
  occurrenceId: string;
}

async function chain(over: { occurrence?: Record<string, unknown> } = {}): Promise<Chain> {
  const userId = await insert('users', userRow());
  const planId = await insert('medication_plans', planRow(userId));
  const timeId = await insert('schedule_times', timeRow(planId));
  const occurrenceId = await insert(
    'occurrences',
    occurrenceRow(userId, planId, timeId, over.occurrence),
  );
  return { userId, planId, timeId, occurrenceId };
}

const responseRow = (c: Chain, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  occurrence_id: c.occurrenceId,
  user_id: c.userId,
  type: 'TAKEN',
  captured_at: '2026-10-05T11:03:00Z',
  is_late: false,
  ...over,
});

const count = async (table: string): Promise<number> => {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(result.rows[0]?.n);
};

// ---------- contrato x banco ----------
describe('enums do banco coincidem com a OpenAPI', () => {
  const MAP: Readonly<Record<string, string>> = {
    account_status: 'AccountStatus',
    plan_status: 'PlanStatus',
    plan_status_reason: 'PlanStatusReason',
    plan_recurrence_kind: 'PlanRecurrenceKind',
    medication_form: 'MedicationForm',
    administration_route: 'AdministrationRoute',
    occurrence_status: 'OccurrenceStatus',
    response_type: 'ResponseType',
    not_taken_reason: 'NotTakenReason',
  };

  it.each(Object.entries(MAP))('%s == %s', async (typeName, schemaName) => {
    const { api } = loadContract();
    const fromContract = asStrings(
      dig(api, 'components', 'schemas', schemaName)['enum'],
      schemaName,
    );
    const fromDb = await pool.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [typeName],
    );
    expect(fromDb.rows.map((r) => r.label)).toEqual(fromContract);
  });

  it('o contrato ainda declara os enums usados no mapeamento', () => {
    const { api } = loadContract();
    const schemas = dig(api, 'components', 'schemas');
    for (const name of Object.values(MAP)) {
      expect(
        asArray(dig(schemas, name)['enum'], name).length,
        asString(name, 'nome'),
      ).toBeGreaterThan(1);
    }
  });
});

// ---------- ENT-001 users ----------
describe('users (ENT-001)', () => {
  it('aplica defaults: status inicial, escala 100, contraste desligado e versao 1', async () => {
    const id = await insert('users', userRow({ status: undefined, verified_at: null }));
    const row = await pool.query<{
      status: string;
      text_scale: number;
      high_contrast: boolean;
      row_version: string;
    }>('SELECT status, text_scale, high_contrast, row_version::text FROM users WHERE id = $1', [
      id,
    ]);
    expect(row.rows[0]).toEqual({
      status: 'PENDING_VERIFICATION',
      text_scale: 100,
      high_contrast: false,
      row_version: '1',
    });
  });

  it('rejeita e-mail repetido', async () => {
    await insert('users', userRow({ email_normalized: 'dup@example.com' }));
    await expectPgError(insert('users', userRow({ email_normalized: 'dup@example.com' })), {
      code: '23505',
      constraint: 'users_email_normalized_key',
    });
  });

  it('rejeita e-mail fora da forma normalizada (maiusculas ou espacos)', async () => {
    await expectPgError(insert('users', userRow({ email_normalized: 'Ana@Example.com' })), {
      code: '23514',
      constraint: 'users_email_normalized_chk',
    });
    await expectPgError(insert('users', userRow({ email_normalized: ' ana@example.com' })), {
      code: '23514',
      constraint: 'users_email_normalized_chk',
    });
  });

  it('conta ACTIVE exige verified_at', async () => {
    await expectPgError(insert('users', userRow({ status: 'ACTIVE', verified_at: null })), {
      code: '23514',
      constraint: 'users_active_requires_verified_chk',
    });
  });

  it.each([90, 110, 250])(
    'rejeita escala de texto %i fora do enum 100/125/150/175/200',
    async (scale) => {
      await expectPgError(insert('users', userRow({ text_scale: scale })), {
        code: '23514',
        constraint: 'users_text_scale_chk',
      });
    },
  );

  it.each(['UTC', 'saopaulo', 'America/', 'America/Sao Paulo'])(
    'rejeita fuso fora do padrao do contrato: %s',
    async (zone) => {
      await expectPgError(insert('users', userRow({ account_timezone: zone })), {
        code: '23514',
        constraint: 'users_timezone_chk',
      });
    },
  );

  it('expurgo agendado respeita o prazo de 30 dias', async () => {
    await expectPgError(
      insert(
        'users',
        userRow({
          status: 'DELETION_SCHEDULED',
          deletion_requested_at: '2026-10-01T10:00:00Z',
          purge_due_at: '2026-11-15T10:00:00Z',
        }),
      ),
      { code: '23514', constraint: 'users_purge_window_chk' },
    );
    await expect(
      insert(
        'users',
        userRow({
          status: 'DELETION_SCHEDULED',
          deletion_requested_at: '2026-10-01T10:00:00Z',
          purge_due_at: '2026-10-31T10:00:00Z',
        }),
      ),
    ).resolves.toBeTypeOf('string');
  });
});

// ---------- ENT-004 sessions ----------
describe('sessions (ENT-004)', () => {
  const sessionRow = (
    userId: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    user_id: userId,
    created_at: '2026-10-05T11:00:00Z',
    secret_hash: Buffer.alloc(32, Number(next()) % 250),
    idle_expires_at: '2026-10-05T11:30:00Z',
    absolute_expires_at: '2026-10-06T11:00:00Z',
    ...over,
  });

  it('revogacao exige data e motivo juntos', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(
      insert('sessions', sessionRow(userId, { revoked_at: '2026-10-05T11:10:00Z' })),
      {
        code: '23514',
        constraint: 'sessions_revocation_pair_chk',
      },
    );
    await expectPgError(insert('sessions', sessionRow(userId, { revoked_reason: 'LOGOUT' })), {
      code: '23514',
      constraint: 'sessions_revocation_pair_chk',
    });
    await expect(
      insert(
        'sessions',
        sessionRow(userId, { revoked_at: '2026-10-05T11:10:00Z', revoked_reason: 'LOGOUT' }),
      ),
    ).resolves.toBeTypeOf('string');
  });

  it('o hash do segredo tem 32 bytes e e unico', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(
      insert('sessions', sessionRow(userId, { secret_hash: Buffer.alloc(16, 1) })),
      {
        code: '23514',
        constraint: 'sessions_secret_hash_len_chk',
      },
    );
    const secret = Buffer.alloc(32, 7);
    await insert('sessions', sessionRow(userId, { secret_hash: secret }));
    await expectPgError(insert('sessions', sessionRow(userId, { secret_hash: secret })), {
      code: '23505',
      constraint: 'sessions_secret_hash_key',
    });
  });

  it('as expiracoes sao sempre posteriores a criacao da sessao', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(
      insert(
        'sessions',
        sessionRow(userId, {
          created_at: '2026-10-05T11:00:00Z',
          absolute_expires_at: '2026-10-05T10:00:00Z',
        }),
      ),
      { code: '23514', constraint: 'sessions_expiry_order_chk' },
    );
  });
});

// ---------- ENT-005 medication_plans ----------
describe('medication_plans (ENT-005)', () => {
  it('fim do periodo nao pode ser anterior ao inicio', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(
      insert(
        'medication_plans',
        planRow(userId, { start_date: '2026-10-10', end_date: '2026-10-09' }),
      ),
      {
        code: '23514',
        constraint: 'plans_period_chk',
      },
    );
    await expect(
      insert(
        'medication_plans',
        planRow(userId, { start_date: '2026-10-10', end_date: '2026-10-10' }),
      ),
    ).resolves.toBeTypeOf('string');
  });

  it('plano DELETED exige deleted_at', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(insert('medication_plans', planRow(userId, { status: 'DELETED' })), {
      code: '23514',
      constraint: 'plans_deleted_requires_ts_chk',
    });
  });

  it('situacao (DEC-036): motivo e instante andam juntos', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(insert('medication_plans', planRow(userId, { status_reason: 'OTHER' })), {
      code: '23514',
      constraint: 'plans_status_change_pair_chk',
    });
    await expectPgError(
      insert('medication_plans', planRow(userId, { status_changed_at: '2026-10-05T11:00:00Z' })),
      { code: '23514', constraint: 'plans_status_change_pair_chk' },
    );
  });

  it('situacao (DEC-036): observacao de 1 a 200 caracteres e so com motivo', async () => {
    const userId = await insert('users', userRow());
    const changed = { status_reason: 'OTHER', status_changed_at: '2026-10-05T11:00:00Z' };
    for (const note of ['', 'x'.repeat(201)]) {
      await expectPgError(
        insert('medication_plans', planRow(userId, { ...changed, status_note: note })),
        { code: '23514', constraint: 'plans_status_note_chk' },
      );
    }
    await expectPgError(insert('medication_plans', planRow(userId, { status_note: 'Nota' })), {
      code: '23514',
      constraint: 'plans_status_note_chk',
    });
    await expect(
      insert('medication_plans', planRow(userId, { ...changed, status_note: 'x'.repeat(200) })),
    ).resolves.toBeTypeOf('string');
  });

  it('periodicidade (DEC-037): DAILY por padrao, sem dias nem intervalo', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    const row = await pool.query<{ k: string; w: number | null; i: number | null }>(
      `SELECT recurrence_kind AS k, recurrence_weekdays AS w, recurrence_interval_days AS i
         FROM medication_plans WHERE id = $1`,
      [planId],
    );
    expect(row.rows).toEqual([{ k: 'DAILY', w: null, i: null }]);
  });

  it.each([
    ['DAILY com dias', { recurrence_weekdays: 1 }],
    ['DAILY com intervalo', { recurrence_interval_days: 3 }],
    ['WEEKDAYS sem dias', { recurrence_kind: 'WEEKDAYS' }],
    [
      'WEEKDAYS com intervalo',
      { recurrence_kind: 'WEEKDAYS', recurrence_weekdays: 1, recurrence_interval_days: 3 },
    ],
    ['EVERY_N_DAYS sem intervalo', { recurrence_kind: 'EVERY_N_DAYS' }],
    [
      'EVERY_N_DAYS com dias',
      { recurrence_kind: 'EVERY_N_DAYS', recurrence_interval_days: 3, recurrence_weekdays: 1 },
    ],
  ])('periodicidade (DEC-037): %s viola o formato', async (_nome, over) => {
    const userId = await insert('users', userRow());
    await expectPgError(insert('medication_plans', planRow(userId, over)), {
      code: '23514',
      constraint: 'plans_recurrence_shape_chk',
    });
  });

  it('periodicidade (DEC-037): dias de 1 a 127 (mascara de segunda a domingo)', async () => {
    const userId = await insert('users', userRow());
    for (const mask of [0, 128]) {
      await expectPgError(
        insert(
          'medication_plans',
          planRow(userId, { recurrence_kind: 'WEEKDAYS', recurrence_weekdays: mask }),
        ),
        { code: '23514', constraint: 'plans_recurrence_weekdays_chk' },
      );
    }
    for (const mask of [1, 127]) {
      await expect(
        insert(
          'medication_plans',
          planRow(userId, { recurrence_kind: 'WEEKDAYS', recurrence_weekdays: mask }),
        ),
      ).resolves.toBeTypeOf('string');
    }
  });

  it('periodicidade (DEC-037): intervalo de 2 a 365 dias', async () => {
    const userId = await insert('users', userRow());
    for (const days of [1, 366]) {
      await expectPgError(
        insert(
          'medication_plans',
          planRow(userId, { recurrence_kind: 'EVERY_N_DAYS', recurrence_interval_days: days }),
        ),
        { code: '23514', constraint: 'plans_recurrence_interval_chk' },
      );
    }
    for (const days of [2, 365]) {
      await expect(
        insert(
          'medication_plans',
          planRow(userId, { recurrence_kind: 'EVERY_N_DAYS', recurrence_interval_days: days }),
        ),
      ).resolves.toBeTypeOf('string');
    }
  });

  it.each(['CANCELED', 'INTERRUPTED'])('situacao %s exige motivo (DEC-036)', async (status) => {
    const userId = await insert('users', userRow());
    await expectPgError(insert('medication_plans', planRow(userId, { status })), {
      code: '23514',
      constraint: 'plans_stopped_requires_reason_chk',
    });
    await expect(
      insert(
        'medication_plans',
        planRow(userId, {
          status,
          status_reason: 'SIDE_EFFECT',
          status_changed_at: '2026-10-05T11:00:00Z',
        }),
      ),
    ).resolves.toBeTypeOf('string');
  });

  it.each(['SP-123', 'sp-12345', 'SP12345', 'SPP-12345', 'SP-1234a'])(
    'rejeita CRM fora do formato UF-digitos: %s',
    async (crm) => {
      const userId = await insert('users', userRow());
      await expectPgError(insert('medication_plans', planRow(userId, { prescriber_crm: crm })), {
        code: '23514',
        constraint: 'plans_crm_format_chk',
      });
    },
  );

  it('aceita CRM no formato UF-digitos e CRM ausente', async () => {
    const userId = await insert('users', userRow());
    await expect(
      insert('medication_plans', planRow(userId, { prescriber_crm: 'SP-123456' })),
    ).resolves.toBeTypeOf('string');
    await expect(
      insert('medication_plans', planRow(userId, { prescriber_crm: null })),
    ).resolves.toBeTypeOf('string');
  });

  it('nome e dose nao podem ser vazios nem exceder os limites do contrato', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(insert('medication_plans', planRow(userId, { medication_name: '' })), {
      code: '23514',
      constraint: 'plans_name_len_chk',
    });
    await expectPgError(insert('medication_plans', planRow(userId, { dose_text: '' })), {
      code: '23514',
      constraint: 'plans_dose_len_chk',
    });
    await expectPgError(
      insert('medication_plans', planRow(userId, { medication_name: 'x'.repeat(121) })),
      {
        code: '22001',
      },
    );
  });

  it('rejeita enums invalidos', async () => {
    const userId = await insert('users', userRow());
    await expectPgError(
      insert('medication_plans', planRow(userId, { medication_form: 'POWDER' })),
      { code: '22P02' },
    );
  });
});

// ---------- ENT-006 schedule_times ----------
describe('treatment_reasons (ENT-018, DEC-038)', () => {
  const reasonRow = (userId: string, over: Record<string, unknown> = {}) => ({
    user_id: userId,
    name: 'Pressão alta',
    name_norm: 'pressao alta',
    ...over,
  });

  it('nome e nome normalizado de 1 a 80 caracteres', async () => {
    const userId = await insert('users', userRow());
    for (const over of [{ name: '' }, { name_norm: '' }, { name: 'x'.repeat(81) }]) {
      await expectPgError(insert('treatment_reasons', reasonRow(userId, over)), {
        code: '23514',
        constraint: 'treatment_reasons_name_len_chk',
      });
    }
  });

  it('um motivo por nome normalizado e titular; outro titular pode repetir', async () => {
    const ana = await insert('users', userRow());
    const bruno = await insert('users', userRow());
    await insert('treatment_reasons', reasonRow(ana));
    await expectPgError(insert('treatment_reasons', reasonRow(ana, { name: 'PRESSÃO ALTA' })), {
      code: '23505',
      constraint: 'treatment_reasons_user_name_key',
    });
    await expect(insert('treatment_reasons', reasonRow(bruno))).resolves.toBeTypeOf('string');
  });

  it('o plano so aponta para motivo do mesmo titular (defesa contra BOLA)', async () => {
    const owner = await insert('users', userRow());
    const stranger = await insert('users', userRow());
    const reasonId = await insert('treatment_reasons', reasonRow(stranger));
    await expectPgError(
      insert('medication_plans', planRow(owner, { treatment_reason_id: reasonId })),
      { code: '23503', constraint: 'plans_treatment_reason_owner_fk' },
    );
  });

  it('apagar o motivo desfaz o vinculo sem apagar o plano', async () => {
    const userId = await insert('users', userRow());
    const reasonId = await insert('treatment_reasons', reasonRow(userId));
    const planId = await insert(
      'medication_plans',
      planRow(userId, { treatment_reason_id: reasonId }),
    );
    await pool.query('DELETE FROM treatment_reasons WHERE id = $1', [reasonId]);
    const plan = await pool.query<{ treatment_reason_id: string | null; user_id: string }>(
      'SELECT treatment_reason_id, user_id FROM medication_plans WHERE id = $1',
      [planId],
    );
    expect(plan.rows).toEqual([{ treatment_reason_id: null, user_id: userId }]);
  });

  it('snapshot do motivo na ocorrencia com ate 80 caracteres', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    const timeId = await insert('schedule_times', timeRow(planId));
    await expectPgError(
      insert(
        'occurrences',
        occurrenceRow(userId, planId, timeId, { treatment_reason_snapshot: 'x'.repeat(81) }),
      ),
      { code: '23514', constraint: 'occurrences_treatment_reason_snapshot_len_chk' },
    );
  });
});

describe('schedule_times (ENT-006)', () => {
  it('nao repete horario ativo no mesmo plano, mas permite recriar apos remocao', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    const first = await insert('schedule_times', timeRow(planId));
    await expectPgError(insert('schedule_times', timeRow(planId)), {
      code: '23505',
      constraint: 'schedule_times_active_unique',
    });
    await pool.query('UPDATE schedule_times SET removed_at = now() WHERE id = $1', [first]);
    await expect(insert('schedule_times', timeRow(planId))).resolves.toBeTypeOf('string');
  });

  it('o mesmo horario pode existir em planos diferentes', async () => {
    const userId = await insert('users', userRow());
    const a = await insert('medication_plans', planRow(userId));
    const b = await insert('medication_plans', planRow(userId));
    await insert('schedule_times', timeRow(a));
    await expect(insert('schedule_times', timeRow(b))).resolves.toBeTypeOf('string');
  });

  it('limita a 10 horarios ativos por plano (RN-006)', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    for (let hour = 0; hour < 10; hour += 1) {
      await insert(
        'schedule_times',
        timeRow(planId, { time_of_day: `${String(hour).padStart(2, '0')}:00` }),
      );
    }
    await expectPgError(insert('schedule_times', timeRow(planId, { time_of_day: '23:00' })), {
      code: '23514',
      constraint: 'schedule_times_max_10_chk',
    });
  });

  it('o limite de 10 vale com transacoes simultaneas (a segunda espera a primeira)', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    for (let hour = 0; hour < 9; hour += 1) {
      await insert(
        'schedule_times',
        timeRow(planId, { time_of_day: `${String(hour).padStart(2, '0')}:00` }),
      );
    }
    const [a, b] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await a.query('BEGIN');
      await insert('schedule_times', timeRow(planId, { time_of_day: '20:00' }), a); // 10o, ainda sem COMMIT
      await b.query('BEGIN');
      const second = insert('schedule_times', timeRow(planId, { time_of_day: '21:00' }), b).then(
        () => 'inserido',
        (reason: unknown) => reason,
      );
      await new Promise((resolve) => setTimeout(resolve, 300)); // sem bloqueio, o 11o entraria agora
      await a.query('COMMIT');
      const outcome = await second;
      if (outcome === 'inserido') await b.query('COMMIT');
      else await b.query('ROLLBACK');
      expect(outcome, 'o 11o horario deve ser rejeitado depois que o 10o confirma').toBeInstanceOf(
        pg.DatabaseError,
      );
      expect((outcome as pg.DatabaseError).constraint).toBe('schedule_times_max_10_chk');
    } finally {
      a.release();
      b.release();
    }
    const active = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM schedule_times WHERE plan_id = $1 AND removed_at IS NULL',
      [planId],
    );
    expect(active.rows[0]?.n).toBe('10');
  });

  it('o limite de 10 resiste a 14 insercoes paralelas (estresse)', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_, hour) =>
        insert(
          'schedule_times',
          timeRow(planId, { time_of_day: `${String(hour).padStart(2, '0')}:30` }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const active = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM schedule_times WHERE plan_id = $1 AND removed_at IS NULL',
      [planId],
    );
    expect(active.rows[0]?.n).toBe('10');
  });

  it('horario tem precisao de minuto', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    await expectPgError(insert('schedule_times', timeRow(planId, { time_of_day: '08:00:30' })), {
      code: '23514',
      constraint: 'schedule_times_minute_chk',
    });
  });
});

// ---------- ENT-007 occurrences ----------
describe('occurrences (ENT-007)', () => {
  it('no maximo uma ocorrencia nao cancelada por plano, data e horario (RN-007)', async () => {
    const c = await chain();
    await expectPgError(insert('occurrences', occurrenceRow(c.userId, c.planId, c.timeId)), {
      code: '23505',
      constraint: 'occurrences_slot_active_unique',
    });
  });

  it('ocorrencia cancelada libera o horario para uma nova', async () => {
    const c = await chain();
    await pool.query("UPDATE occurrences SET status = 'CANCELED' WHERE id = $1", [c.occurrenceId]);
    await expect(
      insert('occurrences', occurrenceRow(c.userId, c.planId, c.timeId)),
    ).resolves.toBeTypeOf('string');
  });

  it('o prazo e exatamente 60 minutos apos o horario programado (RN-009)', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    const timeId = await insert('schedule_times', timeRow(planId));
    await expectPgError(
      insert(
        'occurrences',
        occurrenceRow(userId, planId, timeId, { deadline_at: '2026-10-05T12:30:00Z' }),
      ),
      { code: '23514', constraint: 'occurrences_deadline_chk' },
    );
  });

  it('NO_RESPONSE exige o marco no_response_reached_at', async () => {
    const userId = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(userId));
    const timeId = await insert('schedule_times', timeRow(planId));
    await expectPgError(
      insert('occurrences', occurrenceRow(userId, planId, timeId, { status: 'NO_RESPONSE' })),
      {
        code: '23514',
        constraint: 'occurrences_no_response_marker_chk',
      },
    );
  });

  it('a ocorrencia pertence ao mesmo titular do plano (defesa em profundidade contra BOLA)', async () => {
    const owner = await insert('users', userRow());
    const stranger = await insert('users', userRow());
    const planId = await insert('medication_plans', planRow(owner));
    const timeId = await insert('schedule_times', timeRow(planId));
    await expectPgError(insert('occurrences', occurrenceRow(stranger, planId, timeId)), {
      code: '23503',
      constraint: 'occurrences_plan_owner_fk',
    });
  });

  it('o horario da ocorrencia pertence ao plano da ocorrencia', async () => {
    const userId = await insert('users', userRow());
    const planA = await insert('medication_plans', planRow(userId));
    const planB = await insert('medication_plans', planRow(userId));
    const timeOfB = await insert('schedule_times', timeRow(planB));
    await expectPgError(insert('occurrences', occurrenceRow(userId, planA, timeOfB)), {
      code: '23503',
      constraint: 'occurrences_time_plan_fk',
    });
  });
});

// ---------- ENT-008 responses ----------
describe('responses (ENT-008)', () => {
  it('motivo e proibido quando a resposta e TAKEN', async () => {
    const c = await chain();
    await expectPgError(insert('responses', responseRow(c, { type: 'TAKEN', reason: 'FORGOT' })), {
      code: '23514',
      constraint: 'responses_reason_chk',
    });
  });

  it('NOT_TAKEN aceita motivo do enum e rejeita motivo invalido', async () => {
    const c = await chain();
    await expectPgError(
      insert('responses', responseRow(c, { type: 'NOT_TAKEN', reason: 'BORED' })),
      { code: '22P02' },
    );
    await expect(
      insert('responses', responseRow(c, { type: 'NOT_TAKEN', reason: 'FORGOT' })),
    ).resolves.toBeTypeOf('string');
  });

  it('so existe uma resposta por ocorrencia (RN-008)', async () => {
    const c = await chain();
    await insert('responses', responseRow(c));
    await expectPgError(
      insert('responses', responseRow(c, { type: 'NOT_TAKEN', reason: 'FORGOT' })),
      {
        code: '23505',
        constraint: 'responses_occurrence_id_key',
      },
    );
  });

  it('a resposta pertence ao titular da ocorrencia (defesa em profundidade contra BOLA)', async () => {
    const c = await chain();
    const stranger = await insert('users', userRow());
    await expectPgError(insert('responses', responseRow(c, { user_id: stranger })), {
      code: '23503',
      constraint: 'responses_occurrence_owner_fk',
    });
  });

  it('resposta aceita e imutavel: UPDATE e rejeitado', async () => {
    const c = await chain();
    const id = await insert('responses', responseRow(c));
    await expectPgError(
      pool.query("UPDATE responses SET type = 'NOT_TAKEN', reason = 'FORGOT' WHERE id = $1", [id]),
      {
        code: '23000',
        message: /imutaveis/,
      },
    );
    const row = await pool.query<{ type: string }>('SELECT type FROM responses WHERE id = $1', [
      id,
    ]);
    expect(row.rows[0]?.type).toBe('TAKEN');
  });
});

// ---------- TS-001 (base de banco) ----------
describe('TS-001 concorrencia TAKEN x NOT_TAKEN no banco', () => {
  it('em 60 corridas simultaneas, exatamente uma resposta vence e a outra viola a unicidade', async () => {
    for (let round = 0; round < 60; round += 1) {
      const c = await chain({
        occurrence: {
          local_scheduled_date: `2027-01-${String((round % 28) + 1).padStart(2, '0')}`,
        },
      });
      const [first, second] = await Promise.all([pool.connect(), pool.connect()]);
      try {
        const outcomes = await Promise.allSettled([
          insert('responses', responseRow(c, { type: 'TAKEN' }), first),
          insert('responses', responseRow(c, { type: 'NOT_TAKEN', reason: 'FORGOT' }), second),
        ]);
        const winners = outcomes.filter((o) => o.status === 'fulfilled');
        const losers = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
        expect(winners, `rodada ${String(round)}`).toHaveLength(1);
        expect(losers).toHaveLength(1);
        const reason: unknown = losers[0]?.reason;
        expect(reason).toBeInstanceOf(pg.DatabaseError);
        expect((reason as pg.DatabaseError).code).toBe('23505');
        expect((reason as pg.DatabaseError).constraint).toBe('responses_occurrence_id_key');
      } finally {
        first.release();
        second.release();
      }
      const rows = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM responses WHERE occurrence_id = $1',
        [c.occurrenceId],
      );
      expect(rows.rows[0]?.n).toBe('1');
    }
  });
});

// ---------- expurgo ----------
describe('expurgo da conta (FL-001)', () => {
  it('apagar o titular remove em cascata sessoes, planos, horarios, ocorrencias e respostas', async () => {
    const c = await chain();
    await insert('sessions', {
      user_id: c.userId,
      created_at: '2026-10-05T11:00:00Z',
      secret_hash: Buffer.alloc(32, 9),
      idle_expires_at: '2026-10-05T11:30:00Z',
      absolute_expires_at: '2026-10-06T11:00:00Z',
    });
    await insert('responses', responseRow(c));

    await pool.query('DELETE FROM users WHERE id = $1', [c.userId]);

    for (const table of [
      'sessions',
      'medication_plans',
      'schedule_times',
      'occurrences',
      'responses',
    ]) {
      expect(await count(table), table).toBe(0);
    }
  });
});

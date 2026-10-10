// @trace ENT-009 RN-018 RF-005 TS-017 TS-035 (docs/architecture/DATA_MODEL.md; migracao 0006_reminders)
// Base de banco dos lembretes por e-mail no PostgreSQL 17 REAL: 1 lembrete por ocorrencia (RN-018),
// titularidade pela FK composta, estados e codigos de falha fechados. Cada regra e provada pela
// constraint nomeada.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';
import { expectPgError } from './support/pg-errors.js';

let db: PostgresHandle;
let pool: pg.Pool;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 4 });
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
});

async function insertUser(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email_normalized, password_hash, account_timezone, terms_version,
       privacy_notice_version, terms_accepted_at, privacy_acknowledged_at)
     VALUES ('Ana Silva', $1, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
       'America/Sao_Paulo', '2026-10', '2026-10', '2026-10-05T11:05:00Z', '2026-10-05T11:05:00Z')
     RETURNING id`,
    [email],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('INSERT em users nao retornou id');
  return id;
}

/** Usuario com plano, horario e uma ocorrencia; devolve os ids. */
async function fixture(email = 'ana.silva@example.com') {
  const userId = await insertUser(email);
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO medication_plans (user_id, medication_name, medication_name_norm, dose_text,
       dose_text_norm, medication_form, administration_route, start_date)
     VALUES ($1, 'Comprimido', 'comprimido', '1 comprimido', '1 comprimido', 'TABLET', 'ORAL',
       '2026-10-01')
     RETURNING id`,
    [userId],
  );
  const planId = plan.rows[0]?.id ?? '';
  const time = await pool.query<{ id: string }>(
    `INSERT INTO schedule_times (plan_id, time_of_day) VALUES ($1, '08:00') RETURNING id`,
    [planId],
  );
  const occurrence = await pool.query<{ id: string }>(
    `INSERT INTO occurrences (user_id, plan_id, schedule_time_id, local_scheduled_date, local_time,
       scheduled_at, deadline_at, medication_name_snapshot, dose_text_snapshot)
     VALUES ($1, $2, $3, '2026-10-05', '08:00', '2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z',
       'Comprimido', '1 comprimido')
     RETURNING id`,
    [userId, planId, time.rows[0]?.id],
  );
  return { userId, occurrenceId: occurrence.rows[0]?.id ?? '' };
}

const reminder = (values: Record<string, unknown>) => {
  const columns = Object.keys(values);
  return pool.query(
    `INSERT INTO email_reminders (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
    Object.values(values),
  );
};

describe('ENT-009 email_reminders', () => {
  it('aceita o lembrete REQUESTED com os padroes do modelo', async () => {
    const { userId, occurrenceId } = await fixture();
    await reminder({ occurrence_id: occurrenceId, user_id: userId });
    const row = (
      await pool.query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM email_reminders',
      )
    ).rows[0];
    expect(row).toEqual({ status: 'REQUESTED', attempts: 0 });
  });

  it('RN-018: no maximo 1 lembrete por ocorrencia', async () => {
    const { userId, occurrenceId } = await fixture();
    await reminder({ occurrence_id: occurrenceId, user_id: userId });
    await expectPgError(reminder({ occurrence_id: occurrenceId, user_id: userId }), {
      code: '23505',
      constraint: 'email_reminders_occurrence_id_key',
    });
  });

  it('titularidade: o lembrete pertence ao titular da ocorrencia', async () => {
    const { occurrenceId } = await fixture();
    const other = await insertUser('bruno.costa@example.com');
    await expectPgError(reminder({ occurrence_id: occurrenceId, user_id: other }), {
      code: '23503',
      constraint: 'email_reminders_occurrence_owner_fk',
    });
  });

  it.each([[-1], [4]])('attempts fora de 0..3 (%s) e rejeitado', async (attempts) => {
    const { userId, occurrenceId } = await fixture();
    await expectPgError(reminder({ occurrence_id: occurrenceId, user_id: userId, attempts }), {
      code: '23514',
      constraint: 'email_reminders_attempts_chk',
    });
  });

  it('FAILED exige failure_code, e o codigo e de lista fechada', async () => {
    const { userId, occurrenceId } = await fixture();
    await expectPgError(
      reminder({ occurrence_id: occurrenceId, user_id: userId, status: 'FAILED' }),
      { code: '23514', constraint: 'email_reminders_failure_code_chk' },
    );
    await expectPgError(
      reminder({
        occurrence_id: occurrenceId,
        user_id: userId,
        status: 'FAILED',
        failure_code: 'TIMEOUT',
      }),
      { code: '23514', constraint: 'email_reminders_failure_code_chk' },
    );
    await reminder({
      occurrence_id: occurrenceId,
      user_id: userId,
      status: 'FAILED',
      failure_code: 'SUPPRESSED_RESPONDED',
    });
  });

  it('failure_code so existe em FAILED', async () => {
    const { userId, occurrenceId } = await fixture();
    await expectPgError(
      reminder({
        occurrence_id: occurrenceId,
        user_id: userId,
        failure_code: 'DELIVERY_UNCONFIRMED',
      }),
      { code: '23514', constraint: 'email_reminders_failure_code_chk' },
    );
  });

  it('SENT exige sent_at', async () => {
    const { userId, occurrenceId } = await fixture();
    await expectPgError(
      reminder({ occurrence_id: occurrenceId, user_id: userId, status: 'SENT' }),
      { code: '23514', constraint: 'email_reminders_sent_chk' },
    );
  });

  it('DELIVERY_UNKNOWN exige a janela de conciliacao (reconcile_until)', async () => {
    const { userId, occurrenceId } = await fixture();
    await expectPgError(
      reminder({ occurrence_id: occurrenceId, user_id: userId, status: 'DELIVERY_UNKNOWN' }),
      { code: '23514', constraint: 'email_reminders_reconcile_chk' },
    );
  });

  it('exclusao da conta remove os lembretes em cascata', async () => {
    const { userId, occurrenceId } = await fixture();
    await reminder({ occurrence_id: occurrenceId, user_id: userId });
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    expect((await pool.query('SELECT 1 FROM email_reminders')).rowCount).toBe(0);
  });
});

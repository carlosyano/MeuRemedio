// Dados sinteticos dos testes E2E, gravados direto no PostgreSQL da suite (E2E_DATABASE_URL).
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const PASSWORD = 'Senha-Sintetica-2026';

type HasherModule =
  typeof import('../../../apps/api/src/modules/identity/infrastructure/password-hasher.js');

let pool: pg.Pool | undefined;
const db = (): pg.Pool => {
  const url = process.env['E2E_DATABASE_URL'];
  if (url === undefined) throw new Error('E2E_DATABASE_URL nao definida (global-setup)');
  pool ??= new pg.Pool({ connectionString: url, max: 2 });
  return pool;
};

/** E-mail sintetico unico por teste (o rate limit e o bloqueio de login sao por e-mail). */
export const uniqueEmail = (name = 'ana.silva'): string =>
  `${name}+${randomUUID().slice(0, 8)}@example.com`;

/** Conta ACTIVE com a senha PASSWORD. */
export async function activeUser(email: string, name = 'Ana Silva'): Promise<string> {
  const { argon2idPasswordHasher } = (await import(
    new URL(
      '../../../apps/api/dist/modules/identity/infrastructure/password-hasher.js',
      import.meta.url,
    ).href
  )) as HasherModule;
  const result = await db().query<{ id: string }>(
    `INSERT INTO users (name, email_normalized, password_hash, status, account_timezone,
       terms_version, privacy_notice_version, terms_accepted_at, privacy_acknowledged_at,
       verified_at)
     VALUES ($1, $2, $3, 'ACTIVE', 'America/Sao_Paulo', '2026-10', '2026-10', now(), now(), now())
     RETURNING id`,
    [name, email, await argon2idPasswordHasher.hash(PASSWORD)],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('INSERT em users nao retornou id');
  return id;
}

export interface SeededOccurrence {
  readonly id: string;
  /** HH:MM no fuso da conta (America/Sao_Paulo). */
  readonly localTime: string;
}

/**
 * Plano ACTIVE com ocorrencias a `minutesAgo` minutos de agora (negativo = futura). O periodo do
 * plano vai so ate hoje, para o job do horizonte nao gerar outras ocorrencias listaveis.
 */
export async function planWithOccurrences(
  userId: string,
  plan: { readonly name: string; readonly dose: string },
  slots: readonly {
    readonly minutesAgo: number;
    readonly status?: 'PROGRAMMED' | 'NO_RESPONSE' | 'CANCELED';
  }[],
): Promise<SeededOccurrence[]> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const planId = (
      await client.query<{ id: string }>(
        `INSERT INTO medication_plans (user_id, medication_name, medication_name_norm, dose_text,
           dose_text_norm, medication_form, administration_route, start_date, end_date)
         VALUES ($1, $2::text, lower($2::text), $3::text, lower($3::text), 'TABLET', 'ORAL',
           (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
           (now() AT TIME ZONE 'America/Sao_Paulo')::date)
         RETURNING id`,
        [userId, plan.name, plan.dose],
      )
    ).rows[0]?.id;
    if (planId === undefined) throw new Error('INSERT em medication_plans nao retornou id');
    const seeded: SeededOccurrence[] = [];
    for (const slot of slots) {
      const status = slot.status ?? 'PROGRAMMED';
      const row = (
        await client.query<{ id: string; local_time: string }>(
          `WITH slot AS (
             SELECT date_trunc('minute', now()) - make_interval(mins => $3) AS at),
           local AS (
             SELECT at, (at AT TIME ZONE 'America/Sao_Paulo') AS civil FROM slot),
           time_row AS (
             INSERT INTO schedule_times (plan_id, time_of_day)
             SELECT $1, civil::time FROM local
             RETURNING id)
           INSERT INTO occurrences (user_id, plan_id, schedule_time_id, local_scheduled_date,
             local_time, scheduled_at, deadline_at, status, no_response_reached_at,
             medication_name_snapshot, dose_text_snapshot)
           SELECT $2, $1, time_row.id, local.civil::date, local.civil::time, local.at,
             local.at + interval '60 minutes', $4::text::occurrence_status,
             CASE WHEN $4::text = 'NO_RESPONSE' THEN local.at + interval '60 minutes' END, $5::text, $6::text
             FROM local, time_row
           RETURNING id, to_char(local_time, 'HH24:MI') AS local_time`,
          [planId, userId, slot.minutesAgo, status, plan.name, plan.dose],
        )
      ).rows[0];
      if (row === undefined) throw new Error('INSERT em occurrences nao retornou id');
      seeded.push({ id: row.id, localTime: row.local_time });
    }
    await client.query('COMMIT');
    return seeded;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

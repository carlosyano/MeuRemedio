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

// @trace ENT-014 RN-019 TS-029 (docs/architecture/DATA_MODEL.md)
// Base de banco do expurgo no PostgreSQL 17 REAL: tombstones (ENT-014) e indice das contas em
// exclusao. Cada regra e provada pela constraint nomeada.
import { randomBytes, randomUUID } from 'node:crypto';
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
  await pool.query('TRUNCATE purge_tombstones');
});

const insertTombstone = (row: { user_id?: string; email_hmac?: Buffer; expires_at?: string }) =>
  pool.query(
    `INSERT INTO purge_tombstones (user_id, email_hmac, purged_at, expires_at)
     VALUES ($1, $2, '2026-11-04T11:05:15Z', $3)`,
    [
      row.user_id ?? randomUUID(),
      row.email_hmac ?? randomBytes(32),
      row.expires_at ?? '2027-05-03T11:05:15Z',
    ],
  );

describe('ENT-014 purge_tombstones', () => {
  it('aceita user_id sem FK (a conta ja nao existe) e HMAC de 32 bytes', async () => {
    await insertTombstone({});
    expect((await pool.query('SELECT 1 FROM purge_tombstones')).rowCount).toBe(1);
  });

  it('um tombstone por conta', async () => {
    const userId = randomUUID();
    await insertTombstone({ user_id: userId });
    await expectPgError(insertTombstone({ user_id: userId }), {
      code: '23505',
      constraint: 'purge_tombstones_user_id_key',
    });
  });

  it('email_hmac tem exatamente 32 bytes', async () => {
    await expectPgError(insertTombstone({ email_hmac: Buffer.alloc(16) }), {
      code: '23514',
      constraint: 'purge_tombstones_email_hmac_chk',
    });
  });

  it('expires_at = purged_at + 180 dias (RN-019)', async () => {
    await expectPgError(insertTombstone({ expires_at: '2027-05-04T11:05:15Z' }), {
      code: '23514',
      constraint: 'purge_tombstones_expiry_chk',
    });
  });

  it('indice das contas aguardando o expurgo', async () => {
    const result = await pool.query<{ def: string }>(
      `SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index
        WHERE indexrelid = 'users_purge_due_idx'::regclass`,
    );
    expect(result.rows[0]?.def).toMatch(
      /\(purge_due_at\) WHERE \(status = 'DELETION_SCHEDULED'::account_status\)/,
    );
  });
});

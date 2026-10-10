// @trace ENT-010 RN-011 RF-008 FL-005 TS-042 (docs/architecture/DATA_MODEL.md; migracao 0007_exports)
// Base de banco das exportacoes no PostgreSQL 17 REAL: periodo de ate 12 meses, COMPLETED com
// checksum e expiracao em 24 h, FAILED com motivo, CANCELED com instante. Cada regra e provada pela
// constraint nomeada.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';
import { expectPgError } from './support/pg-errors.js';

let db: PostgresHandle;
let pool: pg.Pool;
let userId: string;

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
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email_normalized, password_hash, account_timezone, terms_version,
       privacy_notice_version, terms_accepted_at, privacy_acknowledged_at)
     VALUES ('Ana Silva', 'ana.silva@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
       'America/Sao_Paulo', '2026-10', '2026-10', '2026-10-05T11:05:00Z', '2026-10-05T11:05:00Z')
     RETURNING id`,
  );
  userId = result.rows[0]?.id ?? '';
});

const sha = createHash('sha256').update('pdf').digest();

const insert = (values: Record<string, unknown>) => {
  const row = { user_id: userId, start_date: '2026-10-01', end_date: '2026-10-31', ...values };
  const columns = Object.keys(row);
  return pool.query(
    `INSERT INTO export_requests (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
    Object.values(row),
  );
};

const completed = {
  status: 'COMPLETED',
  completed_at: '2026-10-05T12:00:00Z',
  expires_at: '2026-10-06T12:00:00Z',
  file_sha256: sha,
  file_size_bytes: 1024,
  file_object_key: 'exports/x.pdf',
};

describe('ENT-010 export_requests', () => {
  it('aceita o pedido REQUESTED com os padroes do modelo', async () => {
    await insert({});
    const row = (
      await pool.query<{ status: string; row_version: string }>(
        'SELECT status, row_version FROM export_requests',
      )
    ).rows[0];
    expect(row).toEqual({ status: 'REQUESTED', row_version: '1' });
  });

  it('periodo: end_date >= start_date', async () => {
    await expectPgError(insert({ start_date: '2026-10-31', end_date: '2026-10-01' }), {
      code: '23514',
      constraint: 'export_requests_period_chk',
    });
  });

  it('periodo: no maximo 12 meses', async () => {
    await insert({ start_date: '2026-01-01', end_date: '2026-12-31' });
    await expectPgError(insert({ start_date: '2026-01-01', end_date: '2027-01-02' }), {
      code: '23514',
      constraint: 'export_requests_period_chk',
    });
  });

  it('COMPLETED exige checksum e expires_at = completed_at + 24 h', async () => {
    await insert(completed);
    await expectPgError(insert({ ...completed, file_sha256: null }), {
      code: '23514',
      constraint: 'export_requests_completed_chk',
    });
    await expectPgError(insert({ ...completed, expires_at: '2026-10-07T12:00:00Z' }), {
      code: '23514',
      constraint: 'export_requests_completed_chk',
    });
  });

  it('checksum tem 32 bytes', async () => {
    await expectPgError(insert({ ...completed, file_sha256: Buffer.from('curto') }), {
      code: '23514',
      constraint: 'export_requests_sha256_chk',
    });
  });

  it('FAILED exige failure_reason, que so existe em FAILED', async () => {
    await expectPgError(insert({ status: 'FAILED' }), {
      code: '23514',
      constraint: 'export_requests_failure_chk',
    });
    await expectPgError(insert({ failure_reason: 'TECHNICAL_FAILURE' }), {
      code: '23514',
      constraint: 'export_requests_failure_chk',
    });
    await insert({ status: 'FAILED', failure_reason: 'ACCOUNT_NOT_ACTIVE' });
  });

  it('CANCELED exige canceled_at', async () => {
    await expectPgError(insert({ status: 'CANCELED' }), {
      code: '23514',
      constraint: 'export_requests_canceled_chk',
    });
  });

  it('snapshot limitado a 5 MB', async () => {
    const big = JSON.stringify({ items: 'x'.repeat(5 * 1024 * 1024) });
    await expectPgError(insert({ snapshot: big }), {
      code: '23514',
      constraint: 'export_requests_snapshot_chk',
    });
  });

  it('exclusao da conta remove os pedidos em cascata', async () => {
    await insert({});
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    expect((await pool.query('SELECT 1 FROM export_requests')).rowCount).toBe(0);
  });
});

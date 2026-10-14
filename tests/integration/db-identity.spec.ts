// @trace ENT-002 ENT-003 RF-001 RF-002 RN-017 RNF-006 CA-001 DEC-015 DEC-019 (docs/architecture/DATA_MODEL.md)
// Base de banco do cadastro no PostgreSQL 17 REAL: tokens de verificacao (ENT-002) e de redefinicao
// de senha (ENT-003) e contadores de rate limit (tabela de plataforma UNLOGGED, DEC-019). Cada regra e provada pela constraint nomeada.
import { createHash, randomBytes } from 'node:crypto';
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
  await pool.query('TRUNCATE users, rate_limit_counters CASCADE');
});

let sequence = 0;
const tokenHash = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

async function userId(): Promise<string> {
  sequence += 1;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email_normalized, password_hash, account_timezone, terms_version,
       privacy_notice_version, terms_accepted_at, privacy_acknowledged_at)
     VALUES ('Ana Silva', $1, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'America/Sao_Paulo',
       '2026-10', '2026-10', '2026-10-05T11:05:00Z', '2026-10-05T11:05:00Z')
     RETURNING id`,
    [`ana.silva+${String(sequence)}@example.com`],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('INSERT nao retornou id');
  return id;
}

const insertToken = (row: {
  user_id: string;
  token_hash?: Buffer;
  issued_at?: string;
  expires_at?: string;
}) =>
  pool.query(
    `INSERT INTO verification_tokens (user_id, token_hash, issued_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [
      row.user_id,
      row.token_hash ?? tokenHash(),
      row.issued_at ?? '2026-10-05T11:05:00Z',
      row.expires_at ?? '2026-10-06T11:05:00Z',
    ],
  );

describe('ENT-002 verification_tokens', () => {
  it('aceita token com hash SHA-256 e validade de 24 h', async () => {
    const user = await userId();
    await insertToken({ user_id: user });
    const row = (
      await pool.query<{ used_at: Date | null; superseded_at: Date | null }>(
        'SELECT used_at, superseded_at FROM verification_tokens WHERE user_id = $1',
        [user],
      )
    ).rows[0];
    expect(row).toEqual({ used_at: null, superseded_at: null });
  });

  it('token_hash tem exatamente 32 bytes', async () => {
    await expectPgError(insertToken({ user_id: await userId(), token_hash: Buffer.alloc(16) }), {
      code: '23514',
      constraint: 'verification_tokens_token_hash_chk',
    });
  });

  it('token_hash e unico', async () => {
    const hash = tokenHash();
    await insertToken({ user_id: await userId(), token_hash: hash });
    await expectPgError(insertToken({ user_id: await userId(), token_hash: hash }), {
      code: '23505',
      constraint: 'verification_tokens_token_hash_key',
    });
  });

  it('expires_at = issued_at + 24 horas absolutas (RN-017)', async () => {
    await expectPgError(
      insertToken({ user_id: await userId(), expires_at: '2026-10-06T11:06:00Z' }),
      { code: '23514', constraint: 'verification_tokens_expiry_chk' },
    );
  });

  it('pertence a uma conta existente e sai junto com ela', async () => {
    await expectPgError(insertToken({ user_id: '00000000-0000-4000-8000-000000000000' }), {
      code: '23503',
      constraint: 'verification_tokens_user_fk',
    });
    const user = await userId();
    await insertToken({ user_id: user });
    await pool.query('DELETE FROM users WHERE id = $1', [user]);
    const left = await pool.query('SELECT 1 FROM verification_tokens WHERE user_id = $1', [user]);
    expect(left.rowCount).toBe(0);
  });

  it('indice dos tokens em aberto por conta', async () => {
    const result = await pool.query<{ def: string }>(
      `SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index
        WHERE indexrelid = 'verification_tokens_open_idx'::regclass`,
    );
    expect(result.rows[0]?.def).toMatch(
      /\(user_id\) WHERE \(\(used_at IS NULL\) AND \(superseded_at IS NULL\)\)/,
    );
  });
});

describe('ENT-003 password_reset_tokens', () => {
  const insertReset = (row: { user_id: string; token_hash?: Buffer; expires_at?: string }) =>
    pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, '2026-10-05T11:05:00Z', $3)`,
      [row.user_id, row.token_hash ?? tokenHash(), row.expires_at ?? '2026-10-05T12:05:00Z'],
    );

  it('aceita token com hash SHA-256 e validade de 60 min', async () => {
    const user = await userId();
    await insertReset({ user_id: user });
    const row = (
      await pool.query<{ used_at: Date | null; superseded_at: Date | null }>(
        'SELECT used_at, superseded_at FROM password_reset_tokens WHERE user_id = $1',
        [user],
      )
    ).rows[0];
    expect(row).toEqual({ used_at: null, superseded_at: null });
  });

  it('token_hash tem exatamente 32 bytes', async () => {
    await expectPgError(insertReset({ user_id: await userId(), token_hash: Buffer.alloc(16) }), {
      code: '23514',
      constraint: 'password_reset_tokens_token_hash_chk',
    });
  });

  it('token_hash e unico', async () => {
    const hash = tokenHash();
    await insertReset({ user_id: await userId(), token_hash: hash });
    await expectPgError(insertReset({ user_id: await userId(), token_hash: hash }), {
      code: '23505',
      constraint: 'password_reset_tokens_token_hash_key',
    });
  });

  it('expires_at = issued_at + 60 minutos (RN-017)', async () => {
    await expectPgError(
      insertReset({ user_id: await userId(), expires_at: '2026-10-06T11:05:00Z' }),
      { code: '23514', constraint: 'password_reset_tokens_expiry_chk' },
    );
  });

  it('pertence a uma conta existente e sai junto com ela', async () => {
    await expectPgError(insertReset({ user_id: '00000000-0000-4000-8000-000000000000' }), {
      code: '23503',
      constraint: 'password_reset_tokens_user_fk',
    });
    const user = await userId();
    await insertReset({ user_id: user });
    await pool.query('DELETE FROM users WHERE id = $1', [user]);
    const left = await pool.query('SELECT 1 FROM password_reset_tokens WHERE user_id = $1', [user]);
    expect(left.rowCount).toBe(0);
  });

  it('indice dos tokens em aberto por conta', async () => {
    const result = await pool.query<{ def: string }>(
      `SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index
        WHERE indexrelid = 'password_reset_tokens_open_idx'::regclass`,
    );
    expect(result.rows[0]?.def).toMatch(
      /\(user_id\) WHERE \(\(used_at IS NULL\) AND \(superseded_at IS NULL\)\)/,
    );
  });
});

describe('rate_limit_counters (DEC-019)', () => {
  const insertCounter = (row: { key_hash?: Buffer; count?: number; window_start?: string }) =>
    pool.query(
      `INSERT INTO rate_limit_counters (scope, key_hash, window_start, count)
       VALUES ('public_ip', $1, $2, $3)`,
      [row.key_hash ?? tokenHash(), row.window_start ?? '2026-10-05T11:05:00Z', row.count ?? 1],
    );

  it('e UNLOGGED: contadores nao passam pelo WAL', async () => {
    const result = await pool.query<{ persistence: string }>(
      "SELECT relpersistence AS persistence FROM pg_class WHERE oid = 'rate_limit_counters'::regclass",
    );
    expect(result.rows[0]?.persistence).toBe('u');
  });

  it('um contador por (escopo, chave, janela)', async () => {
    const hash = tokenHash();
    await insertCounter({ key_hash: hash });
    await insertCounter({ key_hash: hash, window_start: '2026-10-05T11:06:00Z' });
    await expectPgError(insertCounter({ key_hash: hash }), {
      code: '23505',
      constraint: 'rate_limit_counters_pkey',
    });
  });

  it('chave em hash de 32 bytes e contagem positiva', async () => {
    await expectPgError(insertCounter({ key_hash: Buffer.alloc(8) }), {
      code: '23514',
      constraint: 'rate_limit_counters_key_hash_chk',
    });
    await expectPgError(insertCounter({ count: 0 }), {
      code: '23514',
      constraint: 'rate_limit_counters_count_chk',
    });
  });
});

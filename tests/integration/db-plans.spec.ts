// @trace ENT-013 RN-016 CA-012 TS-043 (docs/architecture/DATA_MODEL.md; migracao 0005_plans)
// Base de banco do modulo de planos no PostgreSQL 17 REAL: trilha de auditoria append-only
// (ENT-013) e tokens de confirmacao de duplicidade (tabela de plataforma, DC-028). Cada regra e
// provada pela constraint nomeada.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  await pool.query('TRUNCATE users, audit_events CASCADE');
});

const digest = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

async function userId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email_normalized, password_hash, account_timezone, terms_version,
       privacy_notice_version, terms_accepted_at, privacy_acknowledged_at)
     VALUES ('Ana Silva', 'ana.silva@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
       'America/Sao_Paulo', '2026-10', '2026-10', '2026-10-05T11:05:00Z', '2026-10-05T11:05:00Z')
     RETURNING id`,
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('INSERT em users nao retornou id');
  return id;
}

const audit = (overrides: Record<string, unknown> = {}) => {
  const row = {
    action: 'ownership.denied',
    outcome: 'DENIED',
    correlation_id: randomUUID(),
    metadata: null,
    ...overrides,
  };
  return pool.query(
    `INSERT INTO audit_events (action, outcome, correlation_id, metadata)
     VALUES ($1, $2, $3, $4)`,
    [row.action, row.outcome, row.correlation_id, row.metadata],
  );
};

describe('ENT-013 audit_events', () => {
  it('aceita evento valido e rejeita UPDATE e DELETE (append-only)', async () => {
    await audit();
    await expectPgError(pool.query("UPDATE audit_events SET action = 'auth.login_failed'"), {
      code: '42501',
      constraint: 'audit_events_append_only',
    });
    await expectPgError(pool.query('DELETE FROM audit_events'), {
      code: '42501',
      constraint: 'audit_events_append_only',
    });
    expect((await pool.query('SELECT 1 FROM audit_events')).rowCount).toBe(1);
  });

  it.each([['Ownership.Denied'], ['ownership'], ['ownership.denied; drop']])(
    'acao fora do formato dominio.acao (%s) e rejeitada',
    async (action) => {
      await expectPgError(audit({ action }), {
        code: '23514',
        constraint: 'audit_events_action_chk',
      });
    },
  );

  it('metadata precisa ser objeto de ate 2 KB', async () => {
    await audit({ metadata: JSON.stringify({ attempt: 1 }) });
    await expectPgError(audit({ metadata: JSON.stringify([1]) }), {
      code: '23514',
      constraint: 'audit_events_metadata_chk',
    });
    await expectPgError(audit({ metadata: JSON.stringify({ x: 'a'.repeat(2100) }) }), {
      code: '23514',
      constraint: 'audit_events_metadata_chk',
    });
  });
});

describe('plan_duplicate_confirmations (RN-016, DC-028)', () => {
  const insert = async (overrides: Record<string, unknown> = {}) => {
    const row = {
      token_hash: digest(),
      user_id: await userId(),
      request_hash: digest(),
      issued_at: '2026-10-05T11:05:00Z',
      expires_at: '2026-10-05T11:15:00Z',
      consumed_at: null,
      ...overrides,
    };
    return pool.query(
      `INSERT INTO plan_duplicate_confirmations (token_hash, user_id, request_hash, issued_at,
         expires_at, consumed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.token_hash,
        row.user_id,
        row.request_hash,
        row.issued_at,
        row.expires_at,
        row.consumed_at,
      ],
    );
  };

  it('aceita token com TTL de exatamente 10 minutos', async () => {
    await insert();
  });

  it.each([
    [
      'TTL diferente de 10 min',
      { expires_at: '2026-10-05T11:16:00Z' },
      'plan_duplicate_confirmations_expiry_chk',
    ],
    [
      'hash do token com 16 bytes',
      { token_hash: randomBytes(16) },
      'plan_duplicate_confirmations_token_hash_chk',
    ],
    [
      'hash do payload com 16 bytes',
      { request_hash: randomBytes(16) },
      'plan_duplicate_confirmations_request_hash_chk',
    ],
    [
      'consumo no instante da expiracao',
      { consumed_at: '2026-10-05T11:15:00Z' },
      'plan_duplicate_confirmations_consumed_chk',
    ],
  ])('%s: rejeitado', async (_nome, overrides, constraint) => {
    await expectPgError(insert(overrides), { code: '23514', constraint });
  });

  it('o expurgo da conta remove os tokens (FK em cascata)', async () => {
    await insert();
    await pool.query('DELETE FROM users');
    expect((await pool.query('SELECT 1 FROM plan_duplicate_confirmations')).rowCount).toBe(0);
  });
});

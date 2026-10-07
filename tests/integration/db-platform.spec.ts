// @trace TS-015 TS-016 TS-017 TS-038 RF-003 RF-005 RF-006 RNF-007 CA-013 ERR-006 DEC-009
// Idempotencia e Outbox no PostgreSQL 17 REAL (docs/architecture/DATA_MODEL.md: ENT-011 e ENT-012).
// Base de banco dos TS-015/TS-038 (idempotencia) e TS-016/TS-017 (Outbox): os testes HTTP e do
// despachante vem com a API e o worker.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';
import { asArray, asString, isObject } from '../contract/support/json.js';
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
  await pool.query('TRUNCATE users, idempotency_records, outbox_events CASCADE');
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

const count = async (table: string, where = 'true'): Promise<number> => {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE ${where}`,
  );
  return Number(result.rows[0]?.n);
};

const userRow = (): Record<string, unknown> => ({
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
});

const planRow = (userId: string): Record<string, unknown> => ({
  user_id: userId,
  medication_name: 'Comprimido X',
  medication_name_norm: 'comprimido x',
  dose_text: '1 comprimido',
  dose_text_norm: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
});

const SCOPE_U1 = '11111111-1111-4111-8111-111111111111';
const SCOPE_U2 = '22222222-2222-4222-8222-222222222222';
const HASH_A = Buffer.alloc(32, 0xa1);

const idemRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  operation_id: 'createPlan',
  scope_key: SCOPE_U1,
  key: `K${next()}`,
  request_hash: HASH_A,
  response_status: 201,
  response_headers: JSON.stringify({ ETag: '"1"', 'X-Correlation-ID': 'c-1' }),
  response_body: JSON.stringify({ id: 'p-1' }),
  created_at: '2026-10-05T12:00:00Z',
  expires_at: '2026-10-12T12:00:00Z',
  ...over,
});

const outboxRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  aggregate_type: 'medication_plan',
  aggregate_id: SCOPE_U1,
  event_type: 'plan.created',
  payload: JSON.stringify({ plan_id: SCOPE_U1 }),
  ...over,
});

/** operationIds da OpenAPI, separados por exigirem ou nao o cabecalho Idempotency-Key. */
function contractOperations(): { idempotent: string[]; other: string[] } {
  const { api } = loadContract();
  const idempotent: string[] = [];
  const other: string[] = [];
  const paths = api['paths'];
  if (!isObject(paths)) throw new Error('paths ausente');
  for (const item of Object.values(paths)) {
    if (!isObject(item)) continue;
    for (const operation of Object.values(item)) {
      if (!isObject(operation) || operation['operationId'] === undefined) continue;
      const id = asString(operation['operationId'], 'operationId');
      const params =
        operation['parameters'] === undefined ? [] : asArray(operation['parameters'], id);
      const usesKey = params.some(
        (p) => isObject(p) && p['$ref'] === '#/components/parameters/IdempotencyKey',
      );
      (usesKey ? idempotent : other).push(id);
    }
  }
  return { idempotent, other };
}

// ---------- contrato x banco ----------
describe('operation_id coincide com as operacoes idempotentes da OpenAPI', () => {
  it('o contrato declara Idempotency-Key nas 7 mutacoes do AGENTS §13', () => {
    expect(contractOperations().idempotent.sort()).toEqual(
      [
        'createAccount',
        'createExport',
        'createPlan',
        'createResponse',
        'requestAccountDeletion',
        'revokeAllSessions',
        'updatePlan',
      ].sort(),
    );
  });

  it('aceita toda operacao idempotente do contrato', async () => {
    for (const operation of contractOperations().idempotent) {
      const scope = operation === 'createAccount' ? 'public' : SCOPE_U1;
      await insert('idempotency_records', idemRow({ operation_id: operation, scope_key: scope }));
    }
    expect(await count('idempotency_records')).toBe(7);
  });

  it('rejeita toda operacao do contrato que nao usa Idempotency-Key', async () => {
    const { other } = contractOperations();
    expect(other.length).toBeGreaterThan(0);
    for (const operation of other) {
      await expectPgError(insert('idempotency_records', idemRow({ operation_id: operation })), {
        code: '23514',
        constraint: 'idempotency_records_operation_chk',
      });
    }
  });
});

// ---------- ENT-011 idempotency_records ----------
describe('idempotency_records (ENT-011)', () => {
  it('uma unica linha por (operacao, escopo, chave) (TS-015)', async () => {
    await insert('idempotency_records', idemRow({ key: 'K1' }));
    await expectPgError(insert('idempotency_records', idemRow({ key: 'K1' })), {
      code: '23505',
      constraint: 'idempotency_records_scope_key_key',
    });
  });

  it('a mesma chave vale em outro escopo ou em outra operacao (TS-015 passo 4)', async () => {
    await insert('idempotency_records', idemRow({ key: 'K1' }));
    await insert('idempotency_records', idemRow({ key: 'K1', scope_key: SCOPE_U2 }));
    await insert('idempotency_records', idemRow({ key: 'K1', operation_id: 'updatePlan' }));
    expect(await count('idempotency_records', "key = 'K1'")).toBe(3);
  });

  it("createAccount usa somente o escopo 'public'; as demais, o UUID do titular", async () => {
    await insert(
      'idempotency_records',
      idemRow({ operation_id: 'createAccount', scope_key: 'public' }),
    );
    for (const bad of [
      { operation_id: 'createAccount', scope_key: SCOPE_U1 },
      { operation_id: 'createPlan', scope_key: 'public' },
      { operation_id: 'createPlan', scope_key: 'nao-e-uuid' },
    ]) {
      await expectPgError(insert('idempotency_records', idemRow(bad)), {
        code: '23514',
        constraint: 'idempotency_records_scope_chk',
      });
    }
  });

  it('a chave segue o formato do contrato (1..100, ^[A-Za-z0-9._~:+/=-]+$)', async () => {
    await insert('idempotency_records', idemRow({ key: 'aZ09._~:+/=-' }));
    await insert('idempotency_records', idemRow({ key: 'k'.repeat(100) }));
    for (const key of ['', 'com espaco', 'acento-é', 'k'.repeat(101), 'a;b']) {
      await expectPgError(insert('idempotency_records', idemRow({ key })), {
        code: key.length > 100 ? '22001' : '23514',
        ...(key.length > 100 ? {} : { constraint: 'idempotency_records_key_format_chk' }),
      });
    }
  });

  it('o hash da requisicao tem exatamente 32 bytes (SHA-256)', async () => {
    for (const size of [0, 31, 33]) {
      await expectPgError(
        insert('idempotency_records', idemRow({ request_hash: Buffer.alloc(size, 1) })),
        { code: '23514', constraint: 'idempotency_records_request_hash_len_chk' },
      );
    }
  });

  it('o status da resposta fica entre 100 e 599', async () => {
    await insert('idempotency_records', idemRow({ response_status: 100 }));
    await insert('idempotency_records', idemRow({ response_status: 599 }));
    for (const status of [99, 600]) {
      await expectPgError(insert('idempotency_records', idemRow({ response_status: status })), {
        code: '23514',
        constraint: 'idempotency_records_status_chk',
      });
    }
  });

  it('expira exatamente 7 dias apos a criacao (TS-038 passo 5)', async () => {
    for (const expires of ['2026-10-12T12:00:01Z', '2026-10-12T11:59:59Z']) {
      await expectPgError(insert('idempotency_records', idemRow({ expires_at: expires })), {
        code: '23514',
        constraint: 'idempotency_records_expiry_chk',
      });
    }
  });

  it('nunca guarda Set-Cookie no snapshot, em qualquer caixa', async () => {
    for (const name of ['Set-Cookie', 'set-cookie', 'SET-COOKIE']) {
      await expectPgError(
        insert(
          'idempotency_records',
          idemRow({ response_headers: JSON.stringify({ [name]: 'x' }) }),
        ),
        { code: '23514', constraint: 'idempotency_records_headers_chk' },
      );
    }
  });

  it('cabecalhos sao um objeto de ate 4 KB; corpo ate 64 KB; ambos opcionais', async () => {
    await insert('idempotency_records', idemRow({ response_headers: null, response_body: null }));
    await expectPgError(
      insert('idempotency_records', idemRow({ response_headers: JSON.stringify(['ETag']) })),
      { code: '23514', constraint: 'idempotency_records_headers_chk' },
    );
    await expectPgError(
      insert(
        'idempotency_records',
        idemRow({ response_headers: JSON.stringify({ ETag: 'x'.repeat(4100) }) }),
      ),
      { code: '23514', constraint: 'idempotency_records_headers_chk' },
    );
    await expectPgError(
      insert(
        'idempotency_records',
        idemRow({ response_body: JSON.stringify({ d: 'x'.repeat(65600) }) }),
      ),
      { code: '23514', constraint: 'idempotency_records_body_size_chk' },
    );
  });

  it('possui indice por expires_at para o expurgo', async () => {
    const result = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'idempotency_records' AND indexname = 'idempotency_records_expires_idx'",
    );
    expect(result.rows[0]?.indexdef).toMatch(/\(expires_at\)/);
  });

  it('chamadas simultaneas com a mesma chave registram um unico efeito (TS-015 passo 5)', async () => {
    const attempts = 10;
    const winners = await Promise.all(
      Array.from({ length: attempts }, async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const row = idemRow({ key: 'K2' });
          const keys = Object.keys(row);
          const result = await client.query(
            `INSERT INTO idempotency_records (${keys.join(', ')})
             VALUES (${keys.map((_, i) => `$${String(i + 1)}`).join(', ')})
             ON CONFLICT ON CONSTRAINT idempotency_records_scope_key_key DO NOTHING RETURNING id`,
            Object.values(row),
          );
          await client.query('COMMIT');
          return result.rowCount ?? 0;
        } finally {
          client.release();
        }
      }),
    );
    expect(winners.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await count('idempotency_records', "key = 'K2'")).toBe(1);
  });
});

// ---------- ENT-012 outbox_events ----------
describe('outbox_events (ENT-012)', () => {
  it('aplica defaults: pendente, disponivel agora e sem tentativas', async () => {
    const id = await insert('outbox_events', outboxRow());
    const result = await pool.query<{
      attempts: number;
      dispatched_at: Date | null;
      available_now: boolean;
    }>(
      `SELECT attempts, dispatched_at, available_at <= now() AS available_now
         FROM outbox_events WHERE id = $1`,
      [id],
    );
    expect(result.rows[0]).toEqual({ attempts: 0, dispatched_at: null, available_now: true });
  });

  it('tentativas nunca sao negativas', async () => {
    await expectPgError(insert('outbox_events', outboxRow({ attempts: -1 })), {
      code: '23514',
      constraint: 'outbox_events_attempts_chk',
    });
  });

  it('payload e um objeto de ate 8 KB', async () => {
    for (const payload of [JSON.stringify([1]), JSON.stringify({ d: 'x'.repeat(8200) })]) {
      await expectPgError(insert('outbox_events', outboxRow({ payload })), {
        code: '23514',
        constraint: 'outbox_events_payload_chk',
      });
    }
  });

  it('aggregate_id nao tem FK: o evento sobrevive ao expurgo do agregado', async () => {
    const userId = await insert('users', userRow());
    await insert('outbox_events', outboxRow({ aggregate_type: 'user', aggregate_id: userId }));
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    expect(await count('outbox_events')).toBe(1);
  });

  it('o evento e gravado na mesma transacao do dominio (TS-016)', async () => {
    const userId = await insert('users', userRow());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planId = await insert('medication_plans', planRow(userId), client);
      await insert('outbox_events', outboxRow({ aggregate_id: planId }), client);
      await client.query('ROLLBACK');

      expect(await count('medication_plans')).toBe(0);
      expect(await count('outbox_events')).toBe(0);

      await client.query('BEGIN');
      const committed = await insert('medication_plans', planRow(userId), client);
      await insert('outbox_events', outboxRow({ aggregate_id: committed }), client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await count('medication_plans')).toBe(1);
    expect(await count('outbox_events', 'dispatched_at IS NULL')).toBe(1);
  });

  it('consumidores concorrentes recebem eventos disjuntos (base do despacho unico, TS-016/TS-017)', async () => {
    for (let i = 0; i < 6; i += 1) await insert('outbox_events', outboxRow());
    await insert('outbox_events', outboxRow({ dispatched_at: '2026-10-05T12:00:00Z' }));
    await insert('outbox_events', outboxRow({ available_at: '2999-01-01T00:00:00Z' }));

    const claim = `SELECT id FROM outbox_events
                    WHERE dispatched_at IS NULL AND available_at <= now()
                    ORDER BY available_at LIMIT 4 FOR UPDATE SKIP LOCKED`;
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const fromA = (await a.query<{ id: string }>(claim)).rows.map((r) => r.id);
      const fromB = (await b.query<{ id: string }>(claim)).rows.map((r) => r.id);
      await a.query('COMMIT');
      await b.query('COMMIT');

      expect(fromA).toHaveLength(4);
      expect(fromB).toHaveLength(2);
      expect(fromA.filter((id) => fromB.includes(id))).toEqual([]);
    } finally {
      a.release();
      b.release();
    }
  });

  it('possui indice parcial dos eventos pendentes', async () => {
    const result = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'outbox_events' AND indexname = 'outbox_events_pending_idx'",
    );
    const def = result.rows[0]?.indexdef ?? '';
    expect(def).toMatch(/\(available_at\)/);
    expect(def).toMatch(/WHERE \(dispatched_at IS NULL\)/);
  });
});

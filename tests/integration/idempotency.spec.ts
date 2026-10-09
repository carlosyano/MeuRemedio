// @trace TS-015 TS-038 RF-003 CA-013 ERR-006 DEC-009 ENT-011 (DC-009, DC-010, DC-012) (AGENTS.md §13; ADR-001 v1.5 secao 7)
// Servico de idempotencia contra PostgreSQL 17 REAL: replay do snapshot, payload divergente
// (409 IDEMPOTENCY_KEY_REUSED sem sobrescrever), escopo por titular, concorrencia com efeito unico,
// expiracao de 7 dias e falha que nao consome a chave (DC-009, DC-010).
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../../apps/api/src/platform/db/transaction.js';
import { ProblemError } from '../../apps/api/src/platform/http/problem-catalog.js';
import {
  createRequestHasher,
  runIdempotent,
  type IdempotentResponse,
} from '../../apps/api/src/platform/idempotency/idempotency.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

let db: PostgresHandle;
let pool: pg.Pool;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 12 });
  await migrate(pool);
  await pool.query('CREATE TABLE effects (id serial PRIMARY KEY, label text NOT NULL)');
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE idempotency_records, effects');
});

const NOW = '2026-10-05T11:05:00Z';
const hashRequest = createRequestHasher(randomBytes(32));
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

/** Executa createPlan idempotente: grava 1 efeito e devolve 201 com o id gravado. */
async function createPlan(
  options: { scope?: string; key?: string; payload?: unknown; now?: string; status?: number } = {},
): Promise<{ replayed: boolean; response: IdempotentResponse }> {
  return withTransaction(pool, (client) =>
    runIdempotent(
      client,
      {
        operationId: 'createPlan',
        scopeKey: options.scope ?? U1,
        key: options.key ?? 'K1',
        requestHash: hashRequest({ body: options.payload ?? { medication_name: 'Comprimido' } }),
        now: options.now ?? NOW,
      },
      async () => {
        const effect = await client.query<{ id: number }>(
          "INSERT INTO effects (label) VALUES ('plano') RETURNING id",
        );
        return {
          status: options.status ?? 201,
          headers: { etag: '"1"' },
          body: { id: effect.rows[0]?.id ?? 0 },
        };
      },
    ),
  );
}

const effects = async (): Promise<number> =>
  Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM effects')).rows[0]?.n);

const records = async (): Promise<number> =>
  Number(
    (await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM idempotency_records')).rows[0]
      ?.n,
  );

describe('createRequestHasher (HMAC-SHA-256, DC-012)', () => {
  it('depende do segredo e nao e o SHA-256 simples do JSON', () => {
    const parts = { body: { password: 'Senha-Sintetica-2026' } };
    const other = createRequestHasher(randomBytes(32));
    expect(hashRequest(parts).equals(other(parts))).toBe(false);
    const plain = createHash('sha256').update(JSON.stringify(parts)).digest();
    expect(hashRequest(parts).equals(plain)).toBe(false);
  });

  it('exige segredo de pelo menos 32 bytes', () => {
    expect(() => createRequestHasher(Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it('ignora a ordem das propriedades e distingue conteudo diferente', () => {
    const a = hashRequest({ body: { b: 1, a: { y: [1, 2], x: null } }, ifMatch: '"3"' });
    const b = hashRequest({ ifMatch: '"3"', body: { a: { x: null, y: [1, 2] }, b: 1 } });
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
    expect(
      hashRequest({ body: { a: { y: [2, 1] } } }).equals(
        hashRequest({ body: { a: { y: [1, 2] } } }),
      ),
    ).toBe(false);
    expect(hashRequest({ body: { a: 1 } }).equals(hashRequest({ body: { a: '1' } }))).toBe(false);
  });
});

describe('runIdempotent', () => {
  it('primeira chamada executa e guarda o snapshot; o replay devolve o mesmo resultado sem novo efeito', async () => {
    const first = await createPlan();
    expect(first.replayed).toBe(false);
    const replay = await createPlan();
    expect(replay).toEqual({ replayed: true, response: first.response });
    expect(await effects()).toBe(1);
    expect(await records()).toBe(1);
  });

  it('mesma chave com payload divergente: 409 IDEMPOTENCY_KEY_REUSED sem novo efeito nem sobrescrita', async () => {
    const first = await createPlan();
    const error = await createPlan({ payload: { medication_name: 'Outro' } }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await effects()).toBe(1);
    expect((await createPlan()).response).toEqual(first.response);
  });

  it('a chave vale por titular: outro escopo executa de novo', async () => {
    await createPlan({ scope: U1 });
    const other = await createPlan({ scope: U2 });
    expect(other.replayed).toBe(false);
    expect(await effects()).toBe(2);
  });

  it('chamadas simultaneas com a mesma chave produzem um unico efeito', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => createPlan({ key: 'K2' })));
    expect(await effects()).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    for (const result of results) expect(result.response).toEqual(results[0]?.response);
  });

  it('a chave expira em 7 dias: depois disso e tratada como nova', async () => {
    await createPlan({ now: NOW });
    const sevenDays = new Date(Date.parse(NOW) + 7 * 86_400_000).toISOString();
    const beforeExpiry = new Date(Date.parse(sevenDays) - 1_000).toISOString();
    expect((await createPlan({ now: beforeExpiry })).replayed).toBe(true);
    const after = await createPlan({ now: new Date(Date.parse(sevenDays) + 1_000).toISOString() });
    expect(after.replayed).toBe(false);
    expect(await effects()).toBe(2);
    expect(await records()).toBe(1);
  });

  it('falha na execucao desfaz tudo e nao consome a chave', async () => {
    await expect(
      withTransaction(pool, (client) =>
        runIdempotent(
          client,
          {
            operationId: 'createPlan',
            scopeKey: U1,
            key: 'K3',
            requestHash: hashRequest({ body: {} }),
            now: NOW,
          },
          async () => {
            await client.query("INSERT INTO effects (label) VALUES ('parcial')");
            throw new ProblemError('BUSINESS_RULE_VIOLATION');
          },
        ),
      ),
    ).rejects.toBeInstanceOf(ProblemError);
    expect(await effects()).toBe(0);
    expect(await records()).toBe(0);
  });

  it('resposta que nao e 2xx nao vira snapshot (DC-009)', async () => {
    const first = await createPlan({ key: 'K4', status: 409 });
    expect(first.replayed).toBe(false);
    expect(await records()).toBe(0);
  });

  it('createAccount usa o escopo public', async () => {
    const result = await withTransaction(pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'createAccount',
          scopeKey: 'public',
          key: 'K5',
          requestHash: hashRequest({ body: { email: 'ana.silva@example.com' } }),
          now: NOW,
        },
        () => Promise.resolve({ status: 201, headers: {}, body: { ok: true } }),
      ),
    );
    expect(result.replayed).toBe(false);
    expect(await records()).toBe(1);
  });
});

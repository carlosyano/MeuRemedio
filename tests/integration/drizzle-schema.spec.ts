// @trace ENT-001 ENT-002 ENT-003 ENT-004 ENT-005 ENT-006 ENT-007 ENT-008 ENT-009 ENT-010 ENT-011 ENT-012 ENT-013 ENT-014 DEC-019
// Schemas Drizzle x migracoes SQL (ADR-001 v1.5 OA-001; AGENTS.md §12.1: sem divergencia entre o
// conjunto de migracoes e o esquema efetivo). Rastreia as entidades do DATA_MODEL mapeadas.
// O SQL e a fonte do esquema; o Drizzle e apenas o mapeamento tipado e precisa coincidir com o banco
// real em tabelas, colunas, tipos, nulidade, presenca de default, chave primaria e enums.
import { eq, is } from 'drizzle-orm';
import { getTableConfig, isPgEnum, PgTable, type PgEnum } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../apps/api/src/platform/db/client.js';
import * as schema from '../../apps/api/src/platform/db/schema.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

let db: PostgresHandle;
let pool: pg.Pool;

const exported: unknown[] = Object.values(schema);
const tables = exported.filter((value): value is PgTable => is(value, PgTable));
const enums = exported.filter((value): value is PgEnum<[string, ...string[]]> => isPgEnum(value));

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url });
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE users, idempotency_records, outbox_events, rate_limit_counters CASCADE',
  );
});

interface ColumnShape {
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  readonly primary: boolean;
}

/** Tipo do catalogo no mesmo vocabulario do Drizzle (getSQLType). */
function normalizeType(type: string): string {
  return type.replace(/^character varying/, 'varchar').replace(/^time without time zone$/, 'time');
}

async function databaseColumns(table: string): Promise<Record<string, ColumnShape>> {
  const result = await pool.query<{
    name: string;
    type: string;
    not_null: boolean;
    has_default: boolean;
    primary: boolean;
  }>(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull AS not_null,
            a.atthasdef AS has_default,
            EXISTS (SELECT 1 FROM pg_index i
                     WHERE i.indrelid = a.attrelid AND i.indisprimary
                       AND a.attnum = ANY (i.indkey)) AS primary
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  );
  return Object.fromEntries(
    result.rows.map((r) => [
      r.name,
      {
        type: normalizeType(r.type),
        notNull: r.not_null,
        hasDefault: r.has_default,
        primary: r.primary,
      },
    ]),
  );
}

function drizzleColumns(table: PgTable): Record<string, ColumnShape> {
  const config = getTableConfig(table);
  // Chave primaria composta (primaryKey({ columns })) marca cada coluna, como no catalogo.
  const composite = new Set(config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)));
  return Object.fromEntries(
    config.columns.map((c) => [
      c.name,
      {
        type: c.getSQLType(),
        notNull: c.notNull,
        hasDefault: c.hasDefault,
        primary: c.primary || composite.has(c.name),
      },
    ]),
  );
}

describe('schemas Drizzle coincidem com as migracoes SQL', () => {
  it('cada tabela do banco tem schema Drizzle e vice-versa', async () => {
    const result = await pool.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
    );
    const fromDb = result.rows.map((r) => r.name).sort();
    const fromDrizzle = tables.map((t) => getTableConfig(t).name).sort();
    expect(fromDrizzle).toEqual(fromDb);
  });

  it('as colunas coincidem em tipo, nulidade, default e chave primaria', async () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const name = getTableConfig(table).name;
      expect(drizzleColumns(table), name).toEqual(await databaseColumns(name));
    }
  });

  it('cada enum do banco tem pgEnum com os mesmos valores, na mesma ordem', async () => {
    const result = await pool.query<{ name: string; labels: string[] }>(
      `SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`,
    );
    const fromDb = Object.fromEntries(result.rows.map((r) => [r.name, r.labels]));
    const fromDrizzle = Object.fromEntries(enums.map((e) => [e.enumName, [...e.enumValues]]));
    expect(fromDrizzle).toEqual(fromDb);
  });
});

describe('cliente Drizzle contra o PostgreSQL real', () => {
  it('grava e le uma conta com defaults do banco e instantes como Date', async () => {
    const orm = createDb(pool);
    const [created] = await orm
      .insert(schema.users)
      .values({
        name: 'Ana Silva',
        emailNormalized: 'ana.drizzle@example.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
        accountTimezone: 'America/Sao_Paulo',
        termsVersion: '2026-10',
        privacyNoticeVersion: '2026-10',
        termsAcceptedAt: new Date('2026-10-01T10:00:00Z'),
        privacyAcknowledgedAt: new Date('2026-10-01T10:00:00Z'),
      })
      .returning();
    expect(created).toMatchObject({
      status: 'PENDING_VERIFICATION',
      textScale: 100,
      highContrast: false,
      rowVersion: 1,
      verifiedAt: null,
    });
    expect(created?.termsAcceptedAt).toEqual(new Date('2026-10-01T10:00:00Z'));
  });

  it('bytea vira Buffer e jsonb vira objeto, nos dois sentidos', async () => {
    const orm = createDb(pool);
    const hash = Buffer.alloc(32, 0xab);
    await orm.insert(schema.idempotencyRecords).values({
      operationId: 'createAccount',
      scopeKey: 'public',
      key: 'K-drizzle',
      requestHash: hash,
      responseStatus: 201,
      responseHeaders: { 'X-Correlation-ID': 'c-1' },
      responseBody: { id: 'u-1' },
      createdAt: new Date('2026-10-05T12:00:00Z'),
      expiresAt: new Date('2026-10-12T12:00:00Z'),
    });
    const [row] = await orm
      .select()
      .from(schema.idempotencyRecords)
      .where(eq(schema.idempotencyRecords.key, 'K-drizzle'));
    expect(Buffer.isBuffer(row?.requestHash)).toBe(true);
    expect(row?.requestHash.equals(hash)).toBe(true);
    expect(row?.responseHeaders).toEqual({ 'X-Correlation-ID': 'c-1' });
    expect(row?.responseBody).toEqual({ id: 'u-1' });
  });
});

// @trace-exempt runner de migracoes (infraestrutura de banco; ADR-001 v1.5 OA-001), sem ID normativo proprio
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MigrationChecksumError, migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

let db: PostgresHandle;
let admin: pg.Pool;
let directory: string;
const pools: pg.Pool[] = [];
let counter = 0;

/** Pool preso a um schema novo, para cada teste enxergar seu proprio schema_migrations. */
async function isolatedPool(): Promise<{ pool: pg.Pool; schema: string }> {
  counter += 1;
  const schema = `runner_${String(counter)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: db.url, options: `-c search_path=${schema}` });
  pools.push(pool);
  return { pool, schema };
}

async function writeMigration(name: string, sql: string): Promise<void> {
  await writeFile(join(directory, name), sql, 'utf8');
}

const dirUrl = (): URL => pathToFileURL(`${directory}/`);

beforeAll(async () => {
  db = await startPostgres();
  admin = new pg.Pool({ connectionString: db.url });
  pools.push(admin);
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await db.stop();
});

describe('runner de migracoes', () => {
  it('aplica as pendentes em ordem e registra versao e checksum', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mr-mig-'));
    await writeMigration('0001_a.sql', 'CREATE TABLE a (id int PRIMARY KEY);');
    await writeMigration('0002_b.sql', 'CREATE TABLE b (id int PRIMARY KEY);');
    const { pool } = await isolatedPool();

    const result = await migrate(pool, dirUrl());

    expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql']);
    const rows = await pool.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows.rows.map((r) => r.version)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
    await rm(directory, { recursive: true });
  });

  it('e idempotente: a segunda execucao nao aplica nada', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mr-mig-'));
    await writeMigration('0001_a.sql', 'CREATE TABLE a (id int PRIMARY KEY);');
    const { pool } = await isolatedPool();
    await migrate(pool, dirUrl());

    const second = await migrate(pool, dirUrl());

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001_a.sql']);
    await rm(directory, { recursive: true });
  });

  it('e transacional: falha no meio desfaz a migracao e nao a registra', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mr-mig-'));
    await writeMigration('0001_a.sql', 'CREATE TABLE a (id int PRIMARY KEY);');
    await writeMigration('0002_ruim.sql', 'CREATE TABLE c (id int); SELECT 1/0;');
    await writeMigration('0003_c.sql', 'CREATE TABLE d (id int);');
    const { pool } = await isolatedPool();

    await expect(migrate(pool, dirUrl())).rejects.toThrow(/division by zero/);

    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('a','c','d')",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(['a']);
    const versions = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
    expect(versions.rows.map((r) => r.version)).toEqual(['0001_a.sql']);
    await rm(directory, { recursive: true });
  });

  it('detecta migracao alterada depois de aplicada', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mr-mig-'));
    await writeMigration('0001_a.sql', 'CREATE TABLE a (id int PRIMARY KEY);');
    const { pool } = await isolatedPool();
    await migrate(pool, dirUrl());
    await writeMigration('0001_a.sql', 'CREATE TABLE a (id bigint PRIMARY KEY);');

    await expect(migrate(pool, dirUrl())).rejects.toBeInstanceOf(MigrationChecksumError);
    await rm(directory, { recursive: true });
  });

  it('ignora arquivos fora do padrao NNNN_descricao.sql', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mr-mig-'));
    await writeMigration('0001_a.sql', 'CREATE TABLE a (id int PRIMARY KEY);');
    await writeMigration('README.md', '# nao e migracao');
    await writeMigration('sem_numero.sql', 'DROP TABLE a;');
    const { pool } = await isolatedPool();

    const result = await migrate(pool, dirUrl());

    expect(result.applied).toEqual(['0001_a.sql']);
    await rm(directory, { recursive: true });
  });

  it('execucoes concorrentes aplicam cada migracao uma unica vez', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mr-mig-'));
    await writeMigration(
      '0001_a.sql',
      'CREATE TABLE a (id int PRIMARY KEY); SELECT pg_sleep(0.3);',
    );
    const { schema } = await isolatedPool();
    const make = (): pg.Pool => {
      const pool = new pg.Pool({ connectionString: db.url, options: `-c search_path=${schema}` });
      pools.push(pool);
      return pool;
    };

    const results = await Promise.all([migrate(make(), dirUrl()), migrate(make(), dirUrl())]);

    expect(results.flatMap((r) => r.applied)).toEqual(['0001_a.sql']);
    expect(results.flatMap((r) => r.skipped)).toEqual(['0001_a.sql']);
    await rm(directory, { recursive: true });
  });
});

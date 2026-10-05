// Banco PostgreSQL 17 REAL para testes de integracao (sem banco simulado: AGENTS.md, QG-004).
// - padrao: Testcontainers sobe um contêiner descartavel (imagem postgres:17);
// - MEUREMEDIO_TEST_PG_URL: usa um servidor existente (por exemplo, service container da CI),
//   criando um banco isolado por chamada e removendo-o no stop().
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

export interface PostgresHandle {
  /** Connection string do banco isolado deste teste. */
  readonly url: string;
  stop: () => Promise<void>;
}

const IMAGE = 'postgres:17';

async function createIsolatedDatabase(adminUrl: string): Promise<PostgresHandle> {
  const name = `mr_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    stop: async () => {
      const cleaner = new pg.Client({ connectionString: adminUrl });
      await cleaner.connect();
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

export async function startPostgres(): Promise<PostgresHandle> {
  const external = process.env['MEUREMEDIO_TEST_PG_URL'];
  if (external !== undefined && external !== '') return createIsolatedDatabase(external);
  const container = await new PostgreSqlContainer(IMAGE).start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

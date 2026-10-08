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
const CLOSE_WAIT_MS = 5_000;
const CLOSE_POLL_MS = 50;

/**
 * Espera as demais conexoes do banco encerrarem antes de derruba-lo. O pool.end() do pg resolve
 * antes de o socket fechar; parar o contêiner (ou DROP ... WITH (FORCE)) nesse intervalo faz o
 * servidor enviar FATAL 57P01 a um cliente sem listener, e o Vitest acusa erro nao tratado.
 */
async function waitForOtherConnections(url: string, database: string): Promise<void> {
  const probe = new pg.Client({ connectionString: url });
  await probe.connect();
  try {
    const deadline = Date.now() + CLOSE_WAIT_MS;
    for (;;) {
      const result = await probe.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [database],
      );
      if (Number(result.rows[0]?.n) === 0 || Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, CLOSE_POLL_MS));
    }
  } finally {
    await probe.end();
  }
}

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
      await waitForOtherConnections(adminUrl, name);
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
      await waitForOtherConnections(container.getConnectionUri(), container.getDatabase());
      await container.stop();
    },
  };
}

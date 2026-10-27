// Ponto de entrada da migracao (DC-070): aplica as migracoes pendentes no PostgreSQL de
// DATABASE_URL e termina. Roda como tarefa avulsa antes de cada implantacao da API e do worker;
// o advisory lock do runner impede duas execucoes ao mesmo tempo. A saida e o JSON do resultado.
import pg from 'pg';
import { migrate } from './platform/migrate.js';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') throw new Error('DATABASE_URL nao definida');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  process.stdout.write(JSON.stringify(await migrate(pool)) + '\n');
} finally {
  await pool.end();
}

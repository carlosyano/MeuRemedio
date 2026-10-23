// Ponto de entrada dos scripts operacionais (npm run ops -- <comando> ...): PostgreSQL de
// DATABASE_URL e o principal IAM de quem executa em OPS_OPERATOR (auditoria). Ver ops/ops-cli.ts.
import pg from 'pg';
import { runOps } from './ops/ops-cli.js';
import { systemClock } from './platform/clock.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} nao definida`);
  return value;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
};

const pool = new pg.Pool({ connectionString: required('DATABASE_URL'), max: 2 });
try {
  process.exitCode = await runOps(process.argv.slice(2), {
    pool,
    clock: systemClock,
    operator: required('OPS_OPERATOR'),
    readStdin,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} finally {
  await pool.end();
}

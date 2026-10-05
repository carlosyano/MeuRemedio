// Runner de migracoes SQL explicitas (ADR-001 v1.5, OA-001).
// - aplica apenas migracoes pendentes, em ordem lexicografica (NNNN_descricao.sql);
// - cada migracao roda em uma transacao e e registrada em schema_migrations com o checksum SHA-256;
// - uma migracao ja aplicada NAO pode ser editada: o checksum divergente aborta (MigrationChecksumError);
// - um advisory lock impede execucoes concorrentes (varias instancias subindo ao mesmo tempo).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export class MigrationChecksumError extends Error {
  public override readonly name = 'MigrationChecksumError';
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

const ADVISORY_LOCK_KEY = 727_001;
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const DEFAULT_DIRECTORY = new URL('../../migrations/', import.meta.url);

export async function migrate(
  pool: Pool,
  directory: URL = DEFAULT_DIRECTORY,
): Promise<MigrationResult> {
  const names = (await readdir(directory)).filter((name) => FILE_PATTERN.test(name)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         checksum   text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const name of names) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE version = $1',
        [name],
      );
      const recorded = existing.rows[0];
      if (recorded) {
        if (recorded.checksum !== checksum) {
          throw new MigrationChecksumError(`Migracao ${name} foi alterada depois de aplicada`);
        }
        skipped.push(name);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          name,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    client.release();
  }
  return { applied, skipped };
}

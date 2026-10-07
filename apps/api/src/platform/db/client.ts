// Cliente Drizzle sobre o pool node-postgres (ADR-001 v1.5 OA-001).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}

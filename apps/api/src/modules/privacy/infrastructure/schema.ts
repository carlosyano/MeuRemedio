// Mapeamento Drizzle de ENT-014 purge_tombstones (migracao 0009_purge_tombstones).
// O SQL e a fonte do esquema: constraints e indices vivem nas migracoes; este arquivo so tipa o
// acesso e e conferido contra o banco real (tests/integration/drizzle-schema.spec.ts).
import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../../../platform/db/types.js';

export const purgeTombstones = pgTable('purge_tombstones', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  emailHmac: bytea('email_hmac').notNull(),
  purgedAt: timestamp('purged_at', { withTimezone: true }).notNull(),
  // = purgedAt + 180 dias (CHECK no SQL).
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

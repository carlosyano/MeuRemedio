// Mapeamento Drizzle de ENT-014 purge_tombstones (migracao 0009_purge_tombstones) e de ENT-016
// external_rights_requests (migracao 0012_rights_requests).
// O SQL e a fonte do esquema: constraints e indices vivem nas migracoes; este arquivo so tipa o
// acesso e e conferido contra o banco real (tests/integration/drizzle-schema.spec.ts).
import { pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { bytea } from '../../../platform/db/types.js';

export const purgeTombstones = pgTable('purge_tombstones', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  emailHmac: bytea('email_hmac').notNull(),
  purgedAt: timestamp('purged_at', { withTimezone: true }).notNull(),
  // = purgedAt + 180 dias (CHECK no SQL).
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const rightsType = pgEnum('rights_type', [
  'ACCESS',
  'CORRECTION',
  'DELETION',
  'PORTABILITY',
  'OPPOSITION',
  'OTHER',
]);

export const rightsStatus = pgEnum('rights_status', [
  'RECEIVED',
  'IN_PROGRESS',
  'ANSWERED',
  'CLOSED',
]);

export const externalRightsRequests = pgTable('external_rights_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  // DSR-AAAAMMDD-NNNN (CHECK no SQL).
  protocol: varchar('protocol').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  channel: varchar('channel').notNull(),
  rightType: rightsType('right_type').notNull(),
  userId: uuid('user_id'),
  status: rightsStatus('status').notNull().default('RECEIVED'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

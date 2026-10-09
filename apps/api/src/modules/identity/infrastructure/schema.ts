// Mapeamento Drizzle de ENT-001 users e ENT-004 sessions (migracao 0001_core) e de ENT-002
// verification_tokens (migracao 0003_identity).
// O SQL e a fonte do esquema: constraints, FKs e indices vivem nas migracoes; este arquivo so tipa o
// acesso e e conferido contra o banco real (tests/integration/drizzle-schema.spec.ts).
import {
  bigint,
  boolean,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { bytea } from '../../../platform/db/types.js';

export const accountStatus = pgEnum('account_status', [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'DELETION_SCHEDULED',
]);

export const sessionRevokedReason = pgEnum('session_revoked_reason', [
  'LOGOUT',
  'REVOKE_ALL',
  'PASSWORD_RESET',
  'ACCOUNT_DELETION',
  'EXPIRED',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  status: accountStatus('status').notNull().default('PENDING_VERIFICATION'),
  accountTimezone: varchar('account_timezone', { length: 64 }).notNull(),
  termsVersion: varchar('terms_version', { length: 30 }).notNull(),
  privacyNoticeVersion: varchar('privacy_notice_version', { length: 30 }).notNull(),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
  privacyAcknowledgedAt: timestamp('privacy_acknowledged_at', { withTimezone: true }).notNull(),
  textScale: smallint('text_scale').notNull().default(100),
  highContrast: boolean('high_contrast').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
  purgeDueAt: timestamp('purge_due_at', { withTimezone: true }),
  rowVersion: bigint('row_version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  secretHash: bytea('secret_hash').notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: sessionRevokedReason('revoked_reason'),
  rowVersion: bigint('row_version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verificationTokens = pgTable('verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  // = issuedAt + 24 h (CHECK no SQL).
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

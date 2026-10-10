// Mapeamento Drizzle de ENT-010 export_requests (migracao 0007_exports).
// O SQL e a fonte do esquema: periodo, checksum, expiracao e estados vivem na migracao.
import {
  bigint,
  date,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { bytea } from '../../../platform/db/types.js';

export const exportStatus = pgEnum('export_status', [
  'REQUESTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELED',
]);

export const exportFailureReason = pgEnum('export_failure_reason', [
  'TECHNICAL_FAILURE',
  'ACCOUNT_NOT_ACTIVE',
]);

export const exportRequests = pgTable('export_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  status: exportStatus('status').notNull().default('REQUESTED'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  snapshot: jsonb('snapshot'),
  fileObjectKey: varchar('file_object_key', { length: 512 }),
  fileSha256: bytea('file_sha256'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  failureReason: exportFailureReason('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  rowVersion: bigint('row_version', { mode: 'number' }).notNull().default(1),
});

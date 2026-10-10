// Mapeamento Drizzle de ENT-009 email_reminders (migracao 0006_reminders).
// O SQL e a fonte do esquema: unicidade por ocorrencia, FK de titularidade e os checks de estado
// vivem na migracao.
import { pgEnum, pgTable, smallint, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const reminderStatus = pgEnum('reminder_status', [
  'REQUESTED',
  'DELIVERY_UNKNOWN',
  'SENT',
  'FAILED',
]);

export const emailReminders = pgTable('email_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurrenceId: uuid('occurrence_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: reminderStatus('status').notNull().default('REQUESTED'),
  attempts: smallint('attempts').notNull().default(0),
  providerMessageId: varchar('provider_message_id', { length: 128 }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  reconcileUntil: timestamp('reconcile_until', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  failureCode: varchar('failure_code', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

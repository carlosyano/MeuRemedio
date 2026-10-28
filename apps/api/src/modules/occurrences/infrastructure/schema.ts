// Mapeamento Drizzle de ENT-007 occurrences (migracao 0001_core).
// O SQL e a fonte do esquema: as FKs compostas de titularidade e os indices vivem na migracao.
import {
  bigint,
  boolean,
  date,
  pgEnum,
  pgTable,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const occurrenceStatus = pgEnum('occurrence_status', [
  'PROGRAMMED',
  'NO_RESPONSE',
  'TAKEN',
  'NOT_TAKEN',
  'CANCELED',
]);

export const occurrences = pgTable('occurrences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  planId: uuid('plan_id').notNull(),
  scheduleTimeId: uuid('schedule_time_id').notNull(),
  localScheduledDate: date('local_scheduled_date').notNull(),
  localTime: time('local_time').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
  status: occurrenceStatus('status').notNull().default('PROGRAMMED'),
  noResponseReachedAt: timestamp('no_response_reached_at', { withTimezone: true }),
  medicationNameSnapshot: varchar('medication_name_snapshot', { length: 120 }).notNull(),
  doseTextSnapshot: varchar('dose_text_snapshot', { length: 80 }).notNull(),
  // Migracao 0016_treatment_reasons (DEC-038).
  treatmentReasonSnapshot: varchar('treatment_reason_snapshot'),
  isLate: boolean('is_late').notNull().default(false),
  rowVersion: bigint('row_version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

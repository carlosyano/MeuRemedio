// Mapeamento Drizzle de ENT-005 medication_plans e ENT-006 schedule_times (migracao 0001_core).
// O SQL e a fonte do esquema: constraints, FKs, triggers e indices vivem nas migracoes.
import { bigint, date, pgEnum, pgTable, time, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const planStatus = pgEnum('plan_status', ['ACTIVE', 'DELETED']);

export const medicationForm = pgEnum('medication_form', [
  'TABLET',
  'CAPSULE',
  'LIQUID',
  'DROPS',
  'INJECTION',
  'CREAM',
  'OINTMENT',
  'INHALER',
  'PATCH',
  'OTHER',
]);

export const administrationRoute = pgEnum('administration_route', [
  'ORAL',
  'TOPICAL',
  'INHALED',
  'NASAL',
  'OPHTHALMIC',
  'OTIC',
  'RECTAL',
  'VAGINAL',
  'SUBCUTANEOUS',
  'INTRAMUSCULAR',
  'OTHER',
]);

export const medicationPlans = pgTable('medication_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  status: planStatus('status').notNull().default('ACTIVE'),
  medicationName: varchar('medication_name', { length: 120 }).notNull(),
  medicationNameNorm: varchar('medication_name_norm', { length: 120 }).notNull(),
  doseText: varchar('dose_text', { length: 80 }).notNull(),
  doseTextNorm: varchar('dose_text_norm', { length: 80 }).notNull(),
  medicationForm: medicationForm('medication_form').notNull(),
  administrationRoute: administrationRoute('administration_route').notNull(),
  instructions: varchar('instructions', { length: 500 }),
  prescriberName: varchar('prescriber_name', { length: 120 }),
  prescriberCrm: varchar('prescriber_crm', { length: 13 }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  rowVersion: bigint('row_version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scheduleTimes = pgTable('schedule_times', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull(),
  timeOfDay: time('time_of_day').notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

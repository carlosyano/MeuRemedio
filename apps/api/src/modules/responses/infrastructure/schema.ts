// Mapeamento Drizzle de ENT-008 responses (migracao 0001_core).
// O SQL e a fonte do esquema: unicidade por ocorrencia, FK de titularidade e o trigger de
// imutabilidade vivem na migracao.
import { boolean, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

export const responseType = pgEnum('response_type', ['TAKEN', 'NOT_TAKEN']);

export const notTakenReason = pgEnum('not_taken_reason', [
  'FORGOT',
  'UNAVAILABLE',
  'SIDE_EFFECT_CONCERN',
  'CHOSE_NOT_TO_TAKE',
  'OTHER',
]);

export const responses = pgTable('responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurrenceId: uuid('occurrence_id').notNull(),
  userId: uuid('user_id').notNull(),
  type: responseType('type').notNull(),
  reason: notTakenReason('reason'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  isLate: boolean('is_late').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

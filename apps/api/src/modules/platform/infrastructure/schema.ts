// Mapeamento Drizzle de ENT-011 idempotency_records e ENT-012 outbox_events (migracao 0002_platform)
// da tabela de plataforma rate_limit_counters (migracao 0003_identity, DEC-019) e de ENT-013
// audit_events (migracao 0005_plans).
// O SQL e a fonte do esquema: as regras de idempotencia e de tamanho vivem na migracao.
import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { bytea, type JsonObject } from '../../../platform/db/types.js';

export const idempotencyRecords = pgTable('idempotency_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  operationId: varchar('operation_id', { length: 64 }).notNull(),
  scopeKey: varchar('scope_key', { length: 64 }).notNull(),
  key: varchar('key', { length: 100 }).notNull(),
  requestHash: bytea('request_hash').notNull(),
  responseStatus: smallint('response_status').notNull(),
  responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
  responseBody: jsonb('response_body').$type<JsonObject>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Quem informa createdAt (Clock injetavel) informa expiresAt = createdAt + 168h (CHECK no SQL).
  expiresAt: timestamp('expires_at', { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '168 hours'`),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  aggregateType: varchar('aggregate_type', { length: 40 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastErrorCode: varchar('last_error_code', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    scope: text('scope').notNull(),
    keyHash: bytea('key_hash').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.keyHash, table.windowStart] })],
);

export const auditOutcome = pgEnum('audit_outcome', ['SUCCESS', 'DENIED', 'FAILED']);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  action: varchar('action', { length: 80 }).notNull(),
  resourceType: varchar('resource_type', { length: 40 }),
  resourceId: uuid('resource_id'),
  outcome: auditOutcome('outcome').notNull(),
  correlationId: uuid('correlation_id').notNull(),
  metadata: jsonb('metadata').$type<JsonObject>(),
});

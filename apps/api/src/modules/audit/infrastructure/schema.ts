// Mapeamento Drizzle de ENT-015 security.incident_records (migracao 0013_incidents), no schema
// segregado security. O SQL e a fonte do esquema; este arquivo so tipa o acesso e e conferido
// contra o banco real (tests/integration/drizzle-schema.spec.ts).
import { pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const security = pgSchema('security');

export const incidentSeverity = security.enum('incident_severity', [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const incidentStatus = security.enum('incident_status', [
  'OPEN',
  'CONTAINED',
  'RESOLVED',
  'CLOSED',
]);

export const incidentRecords = security.table('incident_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  severity: incidentSeverity('severity').notNull(),
  status: incidentStatus('status').notNull().default('OPEN'),
  summary: varchar('summary').notNull(),
  evidenceRef: varchar('evidence_ref'),
  // Obrigatoria para encerrar (CHECK no SQL).
  decisionSummary: varchar('decision_summary'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

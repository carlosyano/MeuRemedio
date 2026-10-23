// Incidentes de seguranca (RF-012, ENT-015, DEC-022, DC-067): procedimento operacional sem endpoint
// HTTP (docs/operations/RIGHTS_AND_INCIDENTS.md §3). Estados OPEN -> CONTAINED -> RESOLVED ->
// CLOSED, so para a frente; a decisao sobre a comunicacao (GX-001, GX-006) pode ser registrada e
// revista ate o encerramento, que a exige. Cada passo vai a audit_events com o operador, sem o
// resumo nem a decisao; o relatorio pos-incidente junta o registro e essa linha do tempo.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { recordAudit, type AuditAction } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';

export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export type IncidentStatus = 'OPEN' | 'CONTAINED' | 'RESOLVED' | 'CLOSED';

export interface IncidentDeps {
  readonly pool: Pool;
  readonly clock: Clock;
  /** Principal IAM de quem executa o script (auditoria). */
  readonly operator: string;
}

/** Recusa do procedimento: incidente desconhecido, fora de ordem ou encerrado sem decisao. */
export class IncidentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentRejected';
  }
}

export interface IncidentReport {
  readonly incident_id: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly summary: string;
  readonly evidence_ref: string | null;
  readonly decision_summary: string | null;
  readonly opened_at: string;
  readonly closed_at: string | null;
  readonly timeline: readonly { at: string; action: string; operator: string | null }[];
}

interface IncidentRow {
  id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  evidence_ref: string | null;
  decision_summary: string | null;
  opened_at: Date;
  closed_at: Date | null;
}

const audit = (action: AuditAction, id: string, now: string) =>
  ({
    occurredAt: now,
    actorUserId: null,
    action,
    resourceType: 'incident',
    resourceId: id,
    outcome: 'SUCCESS',
    correlationId: randomUUID(),
  }) as const;

export async function openIncident(
  deps: IncidentDeps,
  input: { severity: IncidentSeverity; summary: string; evidenceRef?: string },
): Promise<{ incident_id: string; status: 'OPEN'; severity: IncidentSeverity }> {
  const id = randomUUID();
  const now = deps.clock.now();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO security.incident_records
         (id, opened_at, severity, summary, evidence_ref, updated_at)
       VALUES ($1, $2, $3, $4, $5, $2)`,
      [id, now, input.severity, input.summary, input.evidenceRef ?? null],
    );
    await recordAudit(client, {
      ...audit('incident.opened', id, now),
      metadata: { operator: deps.operator, severity: input.severity },
    });
  });
  return { incident_id: id, status: 'OPEN', severity: input.severity };
}

// Transicoes de estado: comando -> [estado exigido, novo estado, acao auditada].
const TRANSITIONS = {
  contain: ['OPEN', 'CONTAINED', 'incident.contained'],
  resolve: ['CONTAINED', 'RESOLVED', 'incident.resolved'],
  close: ['RESOLVED', 'CLOSED', 'incident.closed'],
} as const satisfies Record<string, readonly [IncidentStatus, IncidentStatus, AuditAction]>;

export type IncidentTransition = keyof typeof TRANSITIONS;

export async function advanceIncident(
  deps: IncidentDeps,
  input: { id: string; transition: IncidentTransition; evidenceRef?: string },
): Promise<{ incident_id: string; status: IncidentStatus }> {
  const [from, to, action] = TRANSITIONS[input.transition];
  return withTransaction(deps.pool, async (client) => {
    const current = (
      await client.query<Pick<IncidentRow, 'status' | 'decision_summary'>>(
        'SELECT status, decision_summary FROM security.incident_records WHERE id = $1 FOR UPDATE',
        [input.id],
      )
    ).rows[0];
    if (current === undefined) throw new IncidentRejected(`incidente ${input.id} nao encontrado`);
    if (current.status !== from) {
      throw new IncidentRejected(`incidente ${input.id}: ${current.status} -> ${to} recusado`);
    }
    if (to === 'CLOSED' && current.decision_summary === null) {
      throw new IncidentRejected(`incidente ${input.id}: encerramento exige a decisao registrada`);
    }
    const now = deps.clock.now();
    await client.query(
      `UPDATE security.incident_records
          SET status = $2::security.incident_status, updated_at = $3,
              evidence_ref = COALESCE($4, evidence_ref),
              closed_at = CASE WHEN $2::security.incident_status = 'CLOSED'
                               THEN $3::timestamptz ELSE closed_at END
        WHERE id = $1`,
      [input.id, to, now, input.evidenceRef ?? null],
    );
    await recordAudit(client, {
      ...audit(action, input.id, now),
      metadata: { operator: deps.operator, status: to },
    });
    return { incident_id: input.id, status: to };
  });
}

/** Registra ou revisa a decisao sobre a comunicacao; recusado depois do encerramento. */
export async function decideIncident(
  deps: IncidentDeps,
  input: { id: string; decision: string },
): Promise<{ incident_id: string; status: IncidentStatus }> {
  return withTransaction(deps.pool, async (client) => {
    const current = (
      await client.query<Pick<IncidentRow, 'status'>>(
        'SELECT status FROM security.incident_records WHERE id = $1 FOR UPDATE',
        [input.id],
      )
    ).rows[0];
    if (current === undefined) throw new IncidentRejected(`incidente ${input.id} nao encontrado`);
    if (current.status === 'CLOSED') {
      throw new IncidentRejected(`incidente ${input.id}: encerrado, decisao nao muda`);
    }
    const now = deps.clock.now();
    await client.query(
      `UPDATE security.incident_records SET decision_summary = $2, updated_at = $3 WHERE id = $1`,
      [input.id, input.decision, now],
    );
    await recordAudit(client, {
      ...audit('incident.decided', input.id, now),
      metadata: { operator: deps.operator, status: current.status },
    });
    return { incident_id: input.id, status: current.status };
  });
}

/** Relatorio pos-incidente: o registro e a linha do tempo da auditoria. */
export async function incidentReport(deps: IncidentDeps, id: string): Promise<IncidentReport> {
  const row = (
    await deps.pool.query<IncidentRow>(
      `SELECT id, severity, status, summary, evidence_ref, decision_summary, opened_at, closed_at
         FROM security.incident_records WHERE id = $1`,
      [id],
    )
  ).rows[0];
  if (row === undefined) throw new IncidentRejected(`incidente ${id} nao encontrado`);
  const timeline = await deps.pool.query<{
    occurred_at: Date;
    action: string;
    operator: string | null;
  }>(
    `SELECT occurred_at, action, metadata->>'operator' AS operator FROM audit_events
      WHERE resource_type = 'incident' AND resource_id = $1 ORDER BY occurred_at, id`,
    [id],
  );
  return {
    incident_id: row.id,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    evidence_ref: row.evidence_ref,
    decision_summary: row.decision_summary,
    opened_at: row.opened_at.toISOString(),
    closed_at: row.closed_at?.toISOString() ?? null,
    timeline: timeline.rows.map((event) => ({
      at: event.occurred_at.toISOString(),
      action: event.action,
      operator: event.operator,
    })),
  };
}

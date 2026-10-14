// Trilha de auditoria (ENT-013): append-only, minimizada, com catalogo fechado de acoes.
// metadata nunca leva e-mail completo, senha, token ou dado de saude.
import type { Pool, PoolClient } from 'pg';

/** Catalogo fechado de acoes auditadas. */
export type AuditAction = 'ownership.denied' | 'account.deletion_requested';

export interface AuditEvent {
  /** Id gerado pelo chamador quando ele precisa referenciar o evento; por padrao, o do banco. */
  readonly id?: string;
  readonly occurredAt: string;
  readonly actorUserId: string | null;
  readonly action: AuditAction;
  readonly resourceType: 'medication_plan' | 'occurrence' | 'export_request' | 'user_account';
  readonly resourceId: string | null;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  readonly correlationId: string;
}

export async function recordAudit(db: Pool | PoolClient, event: AuditEvent): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (id, occurred_at, actor_user_id, action, resource_type, resource_id,
                               outcome, correlation_id)
     VALUES (COALESCE($8::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7)`,
    [
      event.occurredAt,
      event.actorUserId,
      event.action,
      event.resourceType,
      event.resourceId,
      event.outcome,
      event.correlationId,
      event.id ?? null,
    ],
  );
}

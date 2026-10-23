// Solicitacoes externas de direitos (RF-011, ENT-016, DEC-022, DC-066): procedimento operacional
// sem endpoint HTTP (docs/operations/RIGHTS_AND_INCIDENTS.md §2). O protocolo DSR-AAAAMMDD-NNNN
// usa o dia UTC do recebimento e a sequencia do dia. O e-mail da conta so localiza o user_id: nao e
// gravado, auditado nem devolvido (TS-032). O prazo vem do operador, conforme GX-002.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';

export const RIGHT_TYPES = [
  'ACCESS',
  'CORRECTION',
  'DELETION',
  'PORTABILITY',
  'OPPOSITION',
  'OTHER',
] as const;
export type RightType = (typeof RIGHT_TYPES)[number];

/** Estados na ordem do procedimento; o andamento so avanca. */
export const RIGHTS_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export interface RightsDeps {
  readonly pool: Pool;
  readonly clock: Clock;
  /** Principal IAM de quem executa o script (auditoria). */
  readonly operator: string;
}

export interface RegisterRightsRequest {
  readonly channel: string;
  readonly rightType: RightType;
  readonly receivedAt: string;
  readonly dueAt: string;
  /** E-mail da conta informado pelo solicitante, se houver; usado so para achar o user_id. */
  readonly accountEmail?: string;
}

export interface RegisteredRightsRequest {
  readonly protocol: string;
  readonly status: 'RECEIVED';
  readonly accountLinked: boolean;
}

/** Recusa do andamento: protocolo desconhecido ou transicao fora da ordem do procedimento. */
export class RightsRequestRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RightsRequestRejected';
  }
}

const dayOf = (instant: string): string =>
  new Date(instant).toISOString().slice(0, 10).replace(/-/g, '');

export async function registerRightsRequest(
  deps: RightsDeps,
  input: RegisterRightsRequest,
): Promise<RegisteredRightsRequest> {
  const day = dayOf(input.receivedAt);
  return withTransaction(deps.pool, async (client) => {
    // Serializa a numeracao do dia (registros simultaneos recebem protocolos distintos).
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('rights:' || $1, 0))", [day]);
    const last = (
      await client.query<{ protocol: string | null }>(
        'SELECT max(protocol) AS protocol FROM external_rights_requests WHERE protocol LIKE $1',
        [`DSR-${day}-%`],
      )
    ).rows[0]?.protocol;
    const sequence = last === null || last === undefined ? 1 : Number(last.slice(-4)) + 1;
    if (sequence > 9_999) throw new RightsRequestRejected(`limite diario de protocolos em ${day}`);
    const protocol = `DSR-${day}-${String(sequence).padStart(4, '0')}`;

    const userId =
      input.accountEmail === undefined
        ? undefined
        : (
            await client.query<{ id: string }>('SELECT id FROM users WHERE email_normalized = $1', [
              input.accountEmail.trim().toLowerCase(),
            ])
          ).rows[0]?.id;
    const now = deps.clock.now();
    const id = randomUUID();
    await client.query(
      `INSERT INTO external_rights_requests
         (id, protocol, received_at, channel, right_type, user_id, due_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        protocol,
        input.receivedAt,
        input.channel,
        input.rightType,
        userId ?? null,
        input.dueAt,
        now,
      ],
    );
    await recordAudit(client, {
      occurredAt: now,
      actorUserId: null,
      action: 'rights.request_registered',
      resourceType: 'rights_request',
      resourceId: id,
      outcome: 'SUCCESS',
      correlationId: randomUUID(),
      metadata: { operator: deps.operator, protocol, right_type: input.rightType },
    });
    return { protocol, status: 'RECEIVED', accountLinked: userId !== undefined };
  });
}

/** Proximos estados aceitos: so para frente, e CLOSED so depois de ANSWERED. */
function allowed(from: RightsStatus, to: RightsStatus): boolean {
  if (to === 'CLOSED') return from === 'ANSWERED';
  return RIGHTS_STATUSES.indexOf(to) > RIGHTS_STATUSES.indexOf(from);
}

export async function advanceRightsRequest(
  deps: RightsDeps,
  input: { readonly protocol: string; readonly status: RightsStatus },
): Promise<{ protocol: string; status: RightsStatus }> {
  return withTransaction(deps.pool, async (client) => {
    const current = (
      await client.query<{ id: string; status: RightsStatus }>(
        'SELECT id, status FROM external_rights_requests WHERE protocol = $1 FOR UPDATE',
        [input.protocol],
      )
    ).rows[0];
    if (current === undefined) {
      throw new RightsRequestRejected(`protocolo ${input.protocol} nao encontrado`);
    }
    if (!allowed(current.status, input.status)) {
      throw new RightsRequestRejected(
        `${input.protocol}: transicao ${current.status} -> ${input.status} recusada`,
      );
    }
    const now = deps.clock.now();
    await client.query(
      `UPDATE external_rights_requests
          SET status = $2::rights_status, updated_at = $3,
              answered_at = CASE WHEN $2::rights_status = 'ANSWERED' THEN $3::timestamptz ELSE answered_at END
        WHERE id = $1`,
      [current.id, input.status, now],
    );
    await recordAudit(client, {
      occurredAt: now,
      actorUserId: null,
      action: 'rights.request_updated',
      resourceType: 'rights_request',
      resourceId: current.id,
      outcome: 'SUCCESS',
      correlationId: randomUUID(),
      metadata: { operator: deps.operator, protocol: input.protocol, status: input.status },
    });
    return { protocol: input.protocol, status: input.status };
  });
}

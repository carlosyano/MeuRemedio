// getPlan e listPlans (RF-003; RN-002, CA-012, TS-008, TS-037).
//   - getPlan: plano do titular com ETag, ativo, cancelado ou interrompido (DEC-036). Inexistente,
//     DELETED ou de outro titular -> 404 identico; a tentativa no recurso de outro titular gera
//     audit_events ownership.denied;
//   - listPlans: planos do titular exceto os DELETED, do mais recente ao mais antigo
//     (created_at, id), com cursor opaco da ultima posicao entregue (DC-030). Cursor invalido ->
//     400 VALIDATION_FAILED.
import type { Pool } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { decodeCursor, pageOf, type PageMeta } from '../../../platform/http/keyset-cursor.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  PLAN_COLUMNS,
  etagOf,
  findPlan,
  toPlanView,
  type PlanRow,
  type PlanView,
} from './plan-view.js';

export interface PlanPage {
  readonly items: PlanView[];
  readonly page: PageMeta;
}

export class ReadPlans {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
  ) {}

  async get(
    userId: string,
    planId: string,
    correlationId: string,
  ): Promise<{ plan: PlanView; etag: string }> {
    const row = await findPlan(this.pool, planId);
    if (row?.user_id === userId && row.status !== 'DELETED') {
      return { plan: toPlanView(row), etag: etagOf(Number(row.row_version)) };
    }
    if (row !== undefined && row.user_id !== userId) {
      await recordAudit(this.pool, {
        occurredAt: this.clock.now(),
        actorUserId: userId,
        action: 'ownership.denied',
        resourceType: 'medication_plan',
        resourceId: planId,
        outcome: 'DENIED',
        correlationId,
      });
    }
    throw new ProblemError('RESOURCE_NOT_FOUND');
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<PlanPage> {
    const after = cursor === undefined ? null : decodeCursor(cursor);
    const rows = (
      await this.pool.query<PlanRow>(
        `SELECT ${PLAN_COLUMNS}
           FROM medication_plans p
          WHERE p.user_id = $1 AND p.status <> 'DELETED'
            AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT $4`,
        [userId, after?.t ?? null, after?.i ?? null, limit + 1],
      )
    ).rows;
    return pageOf(rows, limit, toPlanView, (row) => ({ t: row.created_at_us, i: row.id }));
  }
}

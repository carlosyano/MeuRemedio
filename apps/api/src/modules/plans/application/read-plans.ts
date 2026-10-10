// getPlan e listPlans (RF-003; RN-002, CA-012, TS-008, TS-037).
//   - getPlan: plano ACTIVE do titular com ETag. Inexistente, DELETED ou de outro titular -> 404
//     identico; a tentativa no recurso de outro titular gera audit_events ownership.denied;
//   - listPlans: so planos ACTIVE do titular, do mais recente ao mais antigo (created_at, id), com
//     cursor opaco da ultima posicao entregue (DC-030). Cursor invalido -> 400 VALIDATION_FAILED.
import type { Pool } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  PLAN_COLUMNS,
  etagOf,
  findPlan,
  toPlanView,
  type PlanRow,
  type PlanView,
} from './plan-view.js';

export const DEFAULT_PAGE_LIMIT = 20;

export interface PlanPage {
  readonly items: PlanView[];
  readonly page: { readonly next_cursor: string | null; readonly limit: number };
}

interface Cursor {
  /** created_at em UTC com microssegundos. */
  readonly t: string;
  /** id do ultimo plano entregue. */
  readonly i: string;
}

const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      't' in parsed &&
      'i' in parsed &&
      typeof parsed.t === 'string' &&
      typeof parsed.i === 'string' &&
      CURSOR_INSTANT.test(parsed.t) &&
      UUID.test(parsed.i)
    ) {
      return { t: parsed.t, i: parsed.i };
    }
  } catch {
    // cai no erro abaixo
  }
  throw new ProblemError('VALIDATION_FAILED', [
    { field: 'cursor', code: 'INVALID', message: 'Valor inválido.' },
  ]);
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
    if (row?.user_id === userId && row.status === 'ACTIVE') {
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
          WHERE p.user_id = $1 AND p.status = 'ACTIVE'
            AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT $4`,
        [userId, after?.t ?? null, after?.i ?? null, limit + 1],
      )
    ).rows;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(toPlanView),
      page: {
        next_cursor:
          rows.length > limit && last !== undefined
            ? encodeCursor({ t: last.created_at_us, i: last.id })
            : null,
        limit,
      },
    };
  }
}

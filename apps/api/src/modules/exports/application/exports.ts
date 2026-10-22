// createExport, listExports, getExport, cancelExport e downloadExport (RF-008, RN-011, FL-005;
// CA-010, CA-011, CA-016; TS-008, TS-011, TS-023, TS-038, TS-042; DC-042, DEC-034).
//   - listExports: pedidos do titular em todos os estados, do mais recente para o mais antigo
//     (requested_at, id), com o cursor da DC-030;
//   - createExport: periodo de ate 12 meses (DC-041) ou 422 BUSINESS_RULE_VIOLATION em end_date;
//     Idempotency-Key no escopo do titular; pedido REQUESTED e evento exports.requested no Outbox
//     na mesma transacao; 202;
//   - exportacao inexistente ou de outro titular -> 404 identico; a de outro titular e auditada
//     (ownership.denied, DC-032), com a auditoria confirmada mesmo com o 404;
//   - COMPLETED com expires_at atingido e exibida como EXPIRED antes de o job passar (DC-042);
//   - cancelExport: REQUESTED ou PROCESSING -> CANCELED com o snapshot descartado; o arquivo
//     parcial e removido pelo worker; estados terminais -> 409 STATE_CONFLICT;
//   - downloadExport: so COMPLETED nao expirado; expirado -> 410 RESOURCE_EXPIRED sem revelar o
//     armazenamento; demais estados -> 404; o checksum e conferido antes de entregar.
import { createHash } from 'node:crypto';
import { historyWindow } from '@meuremedio/domain';
import type { Pool, PoolClient } from 'pg';
import { recordAudit } from '../../../platform/audit/audit.js';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { decodeCursor, pageOf, type PageMeta } from '../../../platform/http/keyset-cursor.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import type { ObjectStorage } from '../../../platform/storage/object-storage.js';

export const EXPORT_REQUESTED = 'exports.requested';

export type ExportStatus =
  'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELED';

export interface ExportView {
  readonly export_id: string;
  readonly status: ExportStatus;
  readonly start_date: string;
  readonly end_date: string;
  readonly requested_at: string;
  readonly completed_at: string | null;
  readonly expires_at: string | null;
  readonly failure_reason: 'TECHNICAL_FAILURE' | 'ACCOUNT_NOT_ACTIVE' | null;
}

export interface ExportPage {
  readonly items: ExportView[];
  readonly page: PageMeta;
}

export interface CreateExportRequest {
  readonly start_date: string;
  readonly end_date: string;
}

interface ExportRow {
  id: string;
  user_id: string;
  status: ExportStatus;
  start_date: string;
  end_date: string;
  requested_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  failure_reason: ExportView['failure_reason'];
  file_object_key: string | null;
  file_sha256: Buffer | null;
  /** requested_at com microssegundos, para o cursor. */
  requested_at_us: string;
}

const EXPORT_COLUMNS = `id, user_id, status, to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date, requested_at, completed_at, expires_at,
  failure_reason, file_object_key, file_sha256,
  to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS requested_at_us`;

const instantOf = (value: Date): string => value.toISOString().replace('.000Z', 'Z');

/** COMPLETED com expires_at atingido ja e EXPIRED para o titular. */
const effectiveStatus = (row: ExportRow, now: string): ExportStatus =>
  row.status === 'COMPLETED' &&
  row.expires_at !== null &&
  row.expires_at.getTime() <= Date.parse(now)
    ? 'EXPIRED'
    : row.status;

const toExportView = (row: ExportRow, now: string): ExportView => ({
  export_id: row.id,
  status: effectiveStatus(row, now),
  start_date: row.start_date,
  end_date: row.end_date,
  requested_at: instantOf(row.requested_at),
  completed_at: row.completed_at === null ? null : instantOf(row.completed_at),
  expires_at: row.expires_at === null ? null : instantOf(row.expires_at),
  failure_reason: row.failure_reason,
});

export class Exports {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
    private readonly storage: ObjectStorage,
  ) {}

  async create(
    userId: string,
    key: string,
    request: CreateExportRequest,
  ): Promise<IdempotentResponse> {
    const now = this.clock.now();
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'createExport',
          scopeKey: userId,
          key,
          requestHash: this.hashRequest(request),
          now,
        },
        async () => {
          const account = (
            await client.query<{ account_timezone: string }>(
              'SELECT account_timezone FROM users WHERE id = $1',
              [userId],
            )
          ).rows[0];
          if (account === undefined) throw new Error('Titular da sessao nao encontrado');
          const window = historyWindow({
            start: request.start_date,
            end: request.end_date,
            timeZone: account.account_timezone,
          });
          if (!window.ok) {
            throw new ProblemError('BUSINESS_RULE_VIOLATION', [
              {
                field: 'end_date',
                code: window.code,
                message:
                  window.code === 'BEFORE_START'
                    ? 'A data final deve ser igual ou posterior à inicial.'
                    : 'O período pode ter no máximo 12 meses.',
              },
            ]);
          }
          const row = (
            await client.query<ExportRow>(
              `INSERT INTO export_requests (user_id, start_date, end_date, requested_at, created_at,
                                            updated_at)
               VALUES ($1, $2, $3, $4, $4, $4)
               RETURNING ${EXPORT_COLUMNS}`,
              [userId, request.start_date, request.end_date, now],
            )
          ).rows[0];
          if (row === undefined) throw new Error('Pedido de exportacao nao gravado');
          await client.query(
            `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload,
                                        available_at, created_at)
             VALUES ('export_request', $1, $2, $3, $4, $4)`,
            [row.id, EXPORT_REQUESTED, JSON.stringify({ export_id: row.id }), now],
          );
          return { status: 202, headers: {}, body: toExportView(row, now) };
        },
      ),
    );
    return response;
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<ExportPage> {
    const now = this.clock.now();
    const after = cursor === undefined ? null : decodeCursor(cursor);
    const rows = (
      await this.pool.query<ExportRow>(
        `SELECT ${EXPORT_COLUMNS}
           FROM export_requests
          WHERE user_id = $1
            AND ($2::timestamptz IS NULL OR (requested_at, id) < ($2::timestamptz, $3::uuid))
          ORDER BY requested_at DESC, id DESC
          LIMIT $4`,
        [userId, after?.t ?? null, after?.i ?? null, limit + 1],
      )
    ).rows;
    return pageOf(
      rows,
      limit,
      (row) => toExportView(row, now),
      (row) => ({ t: row.requested_at_us, i: row.id }),
    );
  }

  async get(userId: string, exportId: string, correlationId: string): Promise<ExportView> {
    const now = this.clock.now();
    const row = await this.findOwn(this.pool, { userId, exportId, correlationId, now }, false);
    if (row === undefined) throw new ProblemError('RESOURCE_NOT_FOUND');
    return toExportView(row, now);
  }

  async cancel(userId: string, exportId: string, correlationId: string): Promise<void> {
    const now = this.clock.now();
    const outcome = await withTransaction(this.pool, async (client) => {
      const row = await this.findOwn(client, { userId, exportId, correlationId, now }, true);
      if (row === undefined) return 'NOT_FOUND' as const;
      if (row.status !== 'REQUESTED' && row.status !== 'PROCESSING') return 'TERMINAL' as const;
      await client.query(
        `UPDATE export_requests
            SET status = 'CANCELED', canceled_at = $2, snapshot = NULL, updated_at = $2,
                row_version = row_version + 1
          WHERE id = $1`,
        [exportId, now],
      );
      return 'CANCELED' as const;
    });
    // Fora da transacao: a auditoria do acesso negado ja foi confirmada.
    if (outcome === 'NOT_FOUND') throw new ProblemError('RESOURCE_NOT_FOUND');
    if (outcome === 'TERMINAL') throw new ProblemError('STATE_CONFLICT');
  }

  async download(
    userId: string,
    exportId: string,
    correlationId: string,
  ): Promise<{ filename: string; body: Buffer }> {
    const now = this.clock.now();
    const row = await this.findOwn(this.pool, { userId, exportId, correlationId, now }, false);
    if (row === undefined) throw new ProblemError('RESOURCE_NOT_FOUND');
    const status = effectiveStatus(row, now);
    if (status === 'EXPIRED') throw new ProblemError('RESOURCE_EXPIRED');
    if (status !== 'COMPLETED' || row.file_object_key === null || row.file_sha256 === null) {
      throw new ProblemError('RESOURCE_NOT_FOUND');
    }
    const body = await this.storage.get(row.file_object_key);
    if (body === undefined) throw new Error('Arquivo da exportacao ausente no armazenamento');
    if (!createHash('sha256').update(body).digest().equals(row.file_sha256)) {
      throw new Error('Checksum do arquivo da exportacao divergente');
    }
    return { filename: `meuremedio-historico-${row.start_date}-a-${row.end_date}.pdf`, body };
  }

  /** Exportacao do titular; a de outro titular e auditada e tratada como inexistente. */
  private async findOwn(
    db: Pool | PoolClient,
    input: { userId: string; exportId: string; correlationId: string; now: string },
    lock: boolean,
  ): Promise<ExportRow | undefined> {
    const row = (
      await db.query<ExportRow>(
        `SELECT ${EXPORT_COLUMNS} FROM export_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
        [input.exportId],
      )
    ).rows[0];
    if (row === undefined) return undefined;
    if (row.user_id !== input.userId) {
      await recordAudit(db, {
        occurredAt: input.now,
        actorUserId: input.userId,
        action: 'ownership.denied',
        resourceType: 'export_request',
        resourceId: input.exportId,
        outcome: 'DENIED',
        correlationId: input.correlationId,
      });
      return undefined;
    }
    return row;
  }
}

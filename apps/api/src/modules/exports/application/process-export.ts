// Processamento e expiracao das exportacoes no worker (FL-005, RN-011; TS-020, TS-042; DC-042).
//   - consumidor de exports.requested: com o pedido bloqueado, conta fora de ACTIVE -> FAILED
//     ACCOUNT_NOT_ACTIVE; REQUESTED -> PROCESSING com o snapshot congelado (confirmado antes de
//     gerar); PROCESSING ja congelado (retomada) reaproveita o snapshot; terminal -> nada;
//   - o PDF sai do snapshot e vai ao armazenamento com chave deterministica; erro do armazenamento
//     e relancado para o pg-boss refazer; snapshot ilegivel -> FAILED TECHNICAL_FAILURE;
//   - conclusao com o pedido bloqueado: ainda PROCESSING -> COMPLETED com checksum, tamanho e
//     expires_at = completed_at + 24 h, snapshot descartado; cancelado no meio -> arquivo removido;
//   - job a cada minuto: COMPLETED com expires_at atingido -> EXPIRED com o arquivo removido;
//     PROCESSING parado ha 30 min ou mais -> FAILED TECHNICAL_FAILURE.
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import type { ObjectStorage } from '../../../platform/storage/object-storage.js';
import { freezeHistory, parseSnapshot, renderHistoryPdf } from './history-pdf.js';

export const EXPORTS_EXPIRY_QUEUE = 'exports.expiry_sweep';
export const EXPORTS_EXPIRY_CRON = '* * * * *';

const FILE_TTL_MS = 24 * 3_600_000;
const STALE_PROCESSING_MS = 30 * 60_000;

export interface ExportRequested {
  readonly event_id: string;
  readonly export_id: string;
}

export interface ExportDeps {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly storage: ObjectStorage;
}

const objectKey = (userId: string, exportId: string): string => `exports/${userId}/${exportId}.pdf`;

const fail = (pool: Pool, exportId: string, reason: string, now: string) =>
  pool.query(
    `UPDATE export_requests
        SET status = 'FAILED', failure_reason = $2, snapshot = NULL, updated_at = $3,
            row_version = row_version + 1
      WHERE id = $1 AND status IN ('REQUESTED', 'PROCESSING')`,
    [exportId, reason, now],
  );

export async function handleExportRequested(
  deps: ExportDeps,
  event: ExportRequested,
): Promise<void> {
  const now = deps.clock.now();
  const claimed = await withTransaction(deps.pool, async (client) => {
    const row = (
      await client.query<{
        user_id: string;
        status: string;
        start_date: string;
        end_date: string;
        snapshot: unknown;
        user_status: string;
        account_timezone: string;
      }>(
        `SELECT e.user_id, e.status, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
                to_char(e.end_date, 'YYYY-MM-DD') AS end_date, e.snapshot,
                u.status AS user_status, u.account_timezone
           FROM export_requests e JOIN users u ON u.id = e.user_id
          WHERE e.id = $1
          FOR UPDATE OF e`,
        [event.export_id],
      )
    ).rows[0];
    if (row === undefined || (row.status !== 'REQUESTED' && row.status !== 'PROCESSING')) {
      return undefined;
    }
    if (row.user_status !== 'ACTIVE') {
      await client.query(
        `UPDATE export_requests
            SET status = 'FAILED', failure_reason = 'ACCOUNT_NOT_ACTIVE', snapshot = NULL,
                updated_at = $2, row_version = row_version + 1
          WHERE id = $1`,
        [event.export_id, now],
      );
      return undefined;
    }
    if (row.status === 'PROCESSING') return { userId: row.user_id, snapshot: row.snapshot };
    const snapshot = await freezeHistory(client, {
      userId: row.user_id,
      timeZone: row.account_timezone,
      startDate: row.start_date,
      endDate: row.end_date,
      now,
    });
    await client.query(
      `UPDATE export_requests
          SET status = 'PROCESSING', snapshot = $2, updated_at = $3, row_version = row_version + 1
        WHERE id = $1`,
      [event.export_id, JSON.stringify(snapshot), now],
    );
    return { userId: row.user_id, snapshot: snapshot };
  });
  if (claimed === undefined) return;

  const snapshot = parseSnapshot(claimed.snapshot);
  if (snapshot === undefined) {
    await fail(deps.pool, event.export_id, 'TECHNICAL_FAILURE', deps.clock.now());
    return;
  }
  const pdf = await renderHistoryPdf(snapshot);
  const key = objectKey(claimed.userId, event.export_id);
  await deps.storage.put(key, pdf);

  const completedAt = deps.clock.now();
  const completed = await withTransaction(deps.pool, async (client) => {
    const result = await client.query(
      `UPDATE export_requests
          SET status = 'COMPLETED', snapshot = NULL, file_object_key = $2, file_sha256 = $3,
              file_size_bytes = $4, completed_at = $5, expires_at = $6, updated_at = $5,
              row_version = row_version + 1
        WHERE id = $1 AND status = 'PROCESSING'`,
      [
        event.export_id,
        key,
        createHash('sha256').update(pdf).digest(),
        pdf.length,
        completedAt,
        new Date(Date.parse(completedAt) + FILE_TTL_MS).toISOString(),
      ],
    );
    return result.rowCount === 1;
  });
  // Cancelado (ou encerrado) durante a geracao: o arquivo parcial nao fica no armazenamento.
  if (!completed) await deps.storage.delete(key);
}

/** Expira os arquivos vencidos e encerra processamentos parados. */
export async function expireExports(
  deps: { pool: Pool; storage: ObjectStorage },
  input: { now: string },
): Promise<{ expired: number; failed: number }> {
  const due = (
    await deps.pool.query<{ id: string; file_object_key: string | null }>(
      `SELECT id, file_object_key FROM export_requests
        WHERE status = 'COMPLETED' AND expires_at <= $1`,
      [input.now],
    )
  ).rows;
  let expired = 0;
  for (const row of due) {
    if (row.file_object_key !== null) await deps.storage.delete(row.file_object_key);
    const result = await deps.pool.query(
      `UPDATE export_requests
          SET status = 'EXPIRED', file_object_key = NULL, updated_at = $2,
              row_version = row_version + 1
        WHERE id = $1 AND status = 'COMPLETED'`,
      [row.id, input.now],
    );
    expired += result.rowCount ?? 0;
  }

  const stale = (
    await deps.pool.query<{ id: string; user_id: string }>(
      `UPDATE export_requests
          SET status = 'FAILED', failure_reason = 'TECHNICAL_FAILURE', snapshot = NULL,
              updated_at = $1, row_version = row_version + 1
        WHERE status = 'PROCESSING' AND updated_at <= $2
        RETURNING id, user_id`,
      [input.now, new Date(Date.parse(input.now) - STALE_PROCESSING_MS).toISOString()],
    )
  ).rows;
  for (const row of stale) await deps.storage.delete(objectKey(row.user_id, row.id));
  return { expired, failed: stale.length };
}

/** Consumidor da fila agendada. */
export async function handleExportsExpiry(deps: ExportDeps): Promise<void> {
  await expireExports(deps, { now: deps.clock.now() });
}

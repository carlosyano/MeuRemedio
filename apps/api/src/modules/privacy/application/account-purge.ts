// Expurgo da conta (RF-010, RN-012, RN-019, TS-029; DC-046), job do worker a cada 15 minutos.
//   - conta DELETION_SCHEDULED com purge_due_at ate 1 h a frente: o expurgo nunca passa dos 30 dias,
//     mesmo com uma passada perdida;
//   - conta cujo id esta num tombstone (restore de backup anterior ao expurgo): removida de novo
//     (reconciliacao, TS-029);
//   - cada conta em sua transacao, com a linha bloqueada (SKIP LOCKED): remove os PDFs do
//     armazenamento ANTES de apagar as linhas (erro do armazenamento desfaz tudo e a proxima
//     passada refaz), grava o tombstone (user_id + HMAC do e-mail, 180 dias), apaga os snapshots de
//     idempotencia, os eventos do Outbox e o contador de login do titular e, por fim, a conta (as
//     demais tabelas saem por ON DELETE CASCADE). A auditoria permanece (sem FK, ENT-013);
//   - conta PENDING_VERIFICATION com 30 dias de cadastro (TS-028, DC-051): removida pelo mesmo
//     caminho, sem tombstone (nunca foi ativada; copia restaurada continua pendente e antiga) e com
//     o snapshot do createAccount, de escopo public, localizado pelo user_id da resposta;
//   - tombstones com 180 dias saem na mesma passada.
import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import type { ObjectStorage } from '../../../platform/storage/object-storage.js';

export const PURGE_SWEEP_QUEUE = 'privacy.purge_sweep';
export const PURGE_SWEEP_CRON = '*/15 * * * *';

const PURGE_LEAD_MS = 3_600_000;
const TOMBSTONE_TTL_MS = 180 * 24 * 3_600_000;
const PENDING_TTL_MS = 30 * 24 * 3_600_000;

export interface PurgeDeps {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly storage: ObjectStorage;
  /** Pepper do HMAC do e-mail: o mesmo do bloqueio de login (DEC-016). */
  readonly emailPepper: Buffer;
}

export interface PurgeResult {
  readonly purged: number;
  readonly reconciled: number;
  readonly tombstonesExpired: number;
  readonly pendingRemoved: number;
}

type Candidate = 'due' | 'tombstoned' | 'pending';

const PICK: Record<Candidate, string> = {
  due: `SELECT id, email_normalized FROM users
         WHERE status = 'DELETION_SCHEDULED' AND purge_due_at <= $1
         ORDER BY purge_due_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
  tombstoned: `SELECT u.id, u.email_normalized FROM users u
                 JOIN purge_tombstones t ON t.user_id = u.id
                ORDER BY u.id LIMIT 1 FOR UPDATE OF u SKIP LOCKED`,
  pending: `SELECT id, email_normalized FROM users
             WHERE status = 'PENDING_VERIFICATION' AND created_at <= $1
             ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
};

async function purgeAccount(
  client: PoolClient,
  deps: PurgeDeps,
  user: { id: string; email_normalized: string },
  now: string,
  tombstone: boolean,
): Promise<void> {
  const files = await client.query<{ key: string }>(
    `SELECT file_object_key AS key FROM export_requests
      WHERE user_id = $1 AND file_object_key IS NOT NULL`,
    [user.id],
  );
  for (const file of files.rows) await deps.storage.delete(file.key);

  const emailHmac = createHmac('sha256', deps.emailPepper).update(user.email_normalized).digest();
  if (tombstone) {
    await client.query(
      `INSERT INTO purge_tombstones (user_id, email_hmac, purged_at, expires_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING`,
      [user.id, emailHmac, now, new Date(Date.parse(now) + TOMBSTONE_TTL_MS).toISOString()],
    );
  }
  await client.query(
    `DELETE FROM idempotency_records
      WHERE scope_key = $1
         OR (operation_id = 'createAccount' AND response_body->>'user_id' = $1::text)`,
    [user.id],
  );
  await client.query(
    `DELETE FROM outbox_events
      WHERE aggregate_id = $1
         OR aggregate_id IN (SELECT id FROM medication_plans WHERE user_id = $1)
         OR aggregate_id IN (SELECT id FROM export_requests WHERE user_id = $1)
         OR aggregate_id IN (SELECT id FROM email_reminders WHERE user_id = $1)`,
    [user.id],
  );
  await client.query('DELETE FROM login_failure_counters WHERE email_hash = $1', [emailHmac]);
  await client.query('DELETE FROM users WHERE id = $1', [user.id]);
}

const pickParameters = (candidate: Candidate, now: string): unknown[] => {
  if (candidate === 'due') return [new Date(Date.parse(now) + PURGE_LEAD_MS).toISOString()];
  if (candidate === 'pending') return [new Date(Date.parse(now) - PENDING_TTL_MS).toISOString()];
  return [];
};

async function purgeAll(deps: PurgeDeps, candidate: Candidate, now: string): Promise<number> {
  let count = 0;
  for (;;) {
    const done = await withTransaction(deps.pool, async (client) => {
      const user = (
        await client.query<{ id: string; email_normalized: string }>(
          PICK[candidate],
          pickParameters(candidate, now),
        )
      ).rows[0];
      if (user === undefined) return true;
      await purgeAccount(client, deps, user, now, candidate !== 'pending');
      return false;
    });
    if (done) return count;
    count += 1;
  }
}

export async function handlePurgeSweep(deps: PurgeDeps): Promise<PurgeResult> {
  const now = deps.clock.now();
  const reconciled = await purgeAll(deps, 'tombstoned', now);
  const purged = await purgeAll(deps, 'due', now);
  const pendingRemoved = await purgeAll(deps, 'pending', now);
  const expired = await deps.pool.query('DELETE FROM purge_tombstones WHERE expires_at <= $1', [
    now,
  ]);
  return { purged, reconciled, tombstonesExpired: expired.rowCount ?? 0, pendingRemoved };
}

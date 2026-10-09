// Idempotency-Key das 7 mutacoes criticas (Especificacao 02.33 DEC-009; AGENTS.md §13; ENT-011).
// Roda dentro da transacao de quem chama, junto com o efeito de dominio:
//   - mesma (operacao, escopo, chave) e serializada por advisory lock de transacao (DC-010);
//   - registro vigente com o mesmo hash -> replay do snapshot, sem executar de novo;
//   - registro vigente com hash diferente -> 409 IDEMPOTENCY_KEY_REUSED, sem sobrescrever;
//   - registro expirado (7 dias) -> removido; a chave e tratada como nova;
//   - so respostas 2xx viram snapshot; falha desfaz a transacao e nao consome a chave (DC-009).
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ProblemError } from '../http/problem-catalog.js';

export type IdempotentOperation =
  | 'createAccount'
  | 'createPlan'
  | 'updatePlan'
  | 'createResponse'
  | 'createExport'
  | 'requestAccountDeletion'
  | 'revokeAllSessions';

export interface IdempotencyRequest {
  readonly operationId: IdempotentOperation;
  /** UUID do titular, ou 'public' em createAccount. */
  readonly scopeKey: string;
  /** Valor do cabecalho Idempotency-Key (ja validado pelo contrato). */
  readonly key: string;
  /** hashRequest(...) do corpo e dos parametros que definem a requisicao. */
  readonly requestHash: Buffer;
  /** Instante atual (Clock injetavel), UTC. */
  readonly now: string;
}

export interface IdempotentResponse {
  readonly status: number;
  /** Cabecalhos relevantes ao replay (ex.: etag); nunca Set-Cookie. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const RETENTION_MS = 168 * 3_600_000;

/** JSON canonico: chaves de objeto ordenadas, arrays na ordem original. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** SHA-256 (32 bytes) do JSON canonico das partes da requisicao. */
export function hashRequest(parts: unknown): Buffer {
  return createHash('sha256')
    .update(JSON.stringify(canonical(parts)))
    .digest();
}

interface RecordRow {
  request_hash: Buffer;
  response_status: number;
  response_headers: Record<string, string> | null;
  response_body: unknown;
  expires_at: Date;
}

export async function runIdempotent(
  client: PoolClient,
  request: IdempotencyRequest,
  execute: () => Promise<IdempotentResponse>,
): Promise<{ replayed: boolean; response: IdempotentResponse }> {
  const identity = [request.operationId, request.scopeKey, request.key];
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3, 0))",
    identity,
  );

  const existing = (
    await client.query<RecordRow>(
      `SELECT request_hash, response_status, response_headers, response_body, expires_at
         FROM idempotency_records
        WHERE operation_id = $1 AND scope_key = $2 AND key = $3`,
      identity,
    )
  ).rows[0];
  const nowMs = Date.parse(request.now);

  if (existing !== undefined) {
    if (existing.expires_at.getTime() > nowMs) {
      if (!existing.request_hash.equals(request.requestHash)) {
        throw new ProblemError('IDEMPOTENCY_KEY_REUSED');
      }
      return {
        replayed: true,
        response: {
          status: existing.response_status,
          headers: existing.response_headers ?? {},
          body: existing.response_body ?? undefined,
        },
      };
    }
    await client.query(
      'DELETE FROM idempotency_records WHERE operation_id = $1 AND scope_key = $2 AND key = $3',
      identity,
    );
  }

  const response = await execute();
  if (response.status >= 200 && response.status < 300) {
    await client.query(
      `INSERT INTO idempotency_records (operation_id, scope_key, key, request_hash, response_status,
                                        response_headers, response_body, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ...identity,
        request.requestHash,
        response.status,
        JSON.stringify(response.headers),
        response.body === undefined ? null : JSON.stringify(response.body),
        request.now,
        new Date(nowMs + RETENTION_MS).toISOString(),
      ],
    );
  }
  return { replayed: false, response };
}

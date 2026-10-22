// Cenarios dos testes negativos do catalogo de erros: plano com ocorrencias geradas como o worker
// faria, exportacao processada e tokens de verificacao e de redefinicao gravados como o worker os
// emitiria (so o SHA-256 no banco).
import { createHash, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { handleExportRequested } from '../../../../apps/api/src/modules/exports/application/process-export.js';
import { handleOccurrencesRequested } from '../../../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import type { Harness, HttpResult, LoggedIn } from '../../../integration/support/http.js';

export const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00'],
} as const;

let keySequence = 0;
/** Idempotency-Key nova a cada chamada. */
export const nextKey = (): string => {
  keySequence += 1;
  return `err-${String(keySequence)}`;
};

/** Mutacao autenticada com Idempotency-Key e cabecalhos extras (ex.: If-Match). */
export const mutate = (
  h: Harness,
  session: LoggedIn,
  operationId: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> =>
  h.call(operationId, h.contract.operation(operationId).method, url, {
    ...(body === undefined ? {} : { body }),
    headers: { ...session.mutation, 'idempotency-key': nextKey(), ...headers },
  });

/** Cria o plano por HTTP e devolve o id. */
export async function createPlan(
  h: Harness,
  session: LoggedIn,
  body: unknown = PLAN,
): Promise<string> {
  const response = await mutate(h, session, 'createPlan', '/plans', body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { plan_id: string }).plan_id;
}

/** Cria o plano e gera o horizonte; devolve a ocorrencia do dia civil informado. */
export async function occurrenceOn(h: Harness, session: LoggedIn, date: string): Promise<string> {
  const planId = await createPlan(h, session);
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  const row = (
    await h.pool.query<{ id: string }>(
      'SELECT id FROM occurrences WHERE plan_id = $1 AND local_scheduled_date = $2',
      [planId, date],
    )
  ).rows[0];
  if (row === undefined) throw new Error(`ocorrencia de ${date} ausente`);
  return row.id;
}

/** Pede a exportacao e a processa como o worker; devolve o id. */
export async function completedExport(h: Harness, session: LoggedIn): Promise<string> {
  const response = await mutate(h, session, 'createExport', '/exports', {
    start_date: '2026-10-01',
    end_date: '2026-10-05',
  });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  const exportId = (response.body as { export_id: string }).export_id;
  await handleExportRequested(
    { pool: h.pool, clock: { now: () => h.now }, storage: h.storage },
    { event_id: '00000000-0000-4000-8000-000000000002', export_id: exportId },
  );
  return exportId;
}

/** Grava um token de verificacao (24 h) ou de redefinicao (60 min) emitido em `issuedAt`. */
export async function issueToken(
  h: Harness,
  kind: 'verification' | 'password_reset',
  userId: string,
  issuedAt: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const table = kind === 'verification' ? 'verification_tokens' : 'password_reset_tokens';
  const validity = kind === 'verification' ? '24 hours' : '60 minutes';
  await h.pool.query(
    `INSERT INTO ${table} (user_id, token_hash, issued_at, expires_at)
     VALUES ($1, $2, $3, $3::timestamptz + interval '${validity}')`,
    [userId, createHash('sha256').update(token).digest(), issuedAt],
  );
  return token;
}

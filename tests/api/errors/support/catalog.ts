// Apoio dos testes negativos do catalogo de erros (ERR-001..ERR-016, Especificacao 02.33 secao 8):
// operacoes de cada ERR segundo a matriz, chamada generica de uma operacao do contrato e conferencia
// do Problem devolvido.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { parse } from 'yaml';
import { PROBLEM_CATALOG } from '../../../../apps/api/src/platform/http/problem-catalog.js';
import type { ContractOperation } from '../../../../apps/api/src/platform/contract/openapi-contract.js';

interface CatalogEntry {
  readonly code: keyof typeof PROBLEM_CATALOG;
  readonly http_status: number;
  readonly operationIds: readonly string[];
}

const matrix = parse(
  readFileSync(new URL('../../../../traceability-matrix.yaml', import.meta.url), 'utf8'),
) as { errors: Record<string, CatalogEntry> };

/** Entrada do catalogo de erros na matriz (codigo, status e operacoes que o declaram). */
export function catalogEntry(id: string): CatalogEntry {
  const entry = matrix.errors[id];
  if (entry === undefined) throw new Error(`${id} ausente da matriz`);
  return entry;
}

/** Segredo de sessao bem formado (32 bytes em base64url) que nao existe no banco. */
export const unknownSessionToken = (): string => randomBytes(32).toString('base64url');

/** Caminho da operacao com cada parametro de caminho trocado por um UUID novo. */
export const genericUrl = (operation: ContractOperation): string =>
  operation.path.replace(/\{[^}]+\}/g, () => randomUUID());

interface ProblemResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Problem do catalogo: status, codigo, titulo e detalhe fixos, correlation_id igual ao cabecalho e
 * nenhum dos textos internos informados.
 */
export function expectProblem(
  response: ProblemResponse,
  code: keyof typeof PROBLEM_CATALOG,
  internals: readonly string[] = [],
): void {
  const definition = PROBLEM_CATALOG[code];
  expect(response.status).toBe(definition.status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  expect(response.body).toMatchObject({
    code,
    status: definition.status,
    title: definition.title,
    detail: definition.detail,
    correlation_id: response.headers['x-correlation-id'],
  });
  const text = JSON.stringify(response.body);
  for (const internal of internals) expect(text).not.toContain(internal);
}

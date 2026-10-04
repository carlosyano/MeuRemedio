import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { asObject, type JsonObject } from './json.js';

export interface ContractContext {
  /** OpenAPI normativa, ja interpretada. */
  readonly api: JsonObject;
  /** Matriz de rastreabilidade, ja interpretada. */
  readonly matrix: JsonObject;
  /** Nome do arquivo da OpenAPI na raiz do repositorio. */
  readonly openapiFile: string;
  /** SHA-256 (hex) dos bytes exatos da OpenAPI. */
  readonly openapiSha256: string;
}

const ROOT = new URL('../../../', import.meta.url);

export function loadContract(): ContractContext {
  const files = readdirSync(ROOT).filter((f) => /^MeuRemedio_OpenAPI_.*_COMPLETO\.yaml$/.test(f));
  const [openapiFile] = files;
  if (files.length !== 1 || openapiFile === undefined) {
    throw new Error(
      `Esperada exatamente 1 OpenAPI normativa na raiz; encontradas: ${String(files.length)}`,
    );
  }
  const bytes = readFileSync(new URL(openapiFile, ROOT));
  return {
    api: asObject(parse(bytes.toString('utf8')), openapiFile),
    matrix: asObject(
      parse(readFileSync(new URL('traceability-matrix.yaml', ROOT), 'utf8')),
      'traceability-matrix.yaml',
    ),
    openapiFile,
    openapiSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

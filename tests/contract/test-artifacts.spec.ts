// @trace TS-040 (AGENTS.md QG-011: rastreabilidade)
// Artefatos de teste da matriz: todo artefato declarado "implemented" (ou "passing"/"failing")
// aponta para um arquivo que existe e que traz o seu identificador na marca @trace da primeira
// linha: o TS nos testes sentinela, o ERR nos testes negativos do catalogo de erros e o operationId
// nos testes de ownership. A verificacao nao exige o inverso: um teste novo pode rastrear um
// identificador antes de a matriz o listar.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../../', import.meta.url);

interface Artifact {
  readonly id: string;
  readonly path: string;
  readonly status: string;
}

const matrix = parse(readFileSync(new URL('traceability-matrix.yaml', root), 'utf8')) as {
  sentinel_tests: Record<string, { test_artifacts: Artifact[] }>;
  errors: Record<string, { negative_test_artifact: string; status: string }>;
  operations: Record<string, { ownership_test?: { test_artifact: string; status: string } }>;
};

const declaredStatus = (status: string): boolean => status !== 'planned' && status !== 'blocked';

const declared = Object.entries(matrix.sentinel_tests).flatMap(([ts, test]) =>
  test.test_artifacts
    .filter((artifact) => declaredStatus(artifact.status))
    .map((artifact) => ({ ts, ...artifact })),
);

const errors = Object.entries(matrix.errors)
  .filter(([, error]) => declaredStatus(error.status))
  .map(([id, error]) => [id, error.negative_test_artifact] as const);

const ownership = Object.entries(matrix.operations).flatMap(([operationId, operation]) =>
  operation.ownership_test !== undefined && declaredStatus(operation.ownership_test.status)
    ? [[operationId, operation.ownership_test.test_artifact] as const]
    : [],
);

/** Confere que o arquivo existe e que a primeira linha rastreia o identificador. */
function expectTraced(path: string, id: string): void {
  const file = new URL(path, root);
  expect(existsSync(file), path).toBe(true);
  const firstLine = readFileSync(file, 'utf8').split('\n')[0] ?? '';
  expect(firstLine.startsWith('// @trace ')).toBe(true);
  expect(firstLine.split(/\s+/)).toContain(id);
}

describe('artefatos de teste da matriz', () => {
  it('ha artefatos implementados', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared.map((a) => [a.id, a.path, a.ts] as const))(
    '%s (%s) existe e rastreia %s',
    (_id, path, ts) => {
      expectTraced(path, ts);
    },
  );

  it.each(errors)('%s: teste negativo %s existe e rastreia o ERR', (id, path) => {
    expectTraced(path, id);
  });

  it.each(ownership)('%s: teste de ownership %s existe e rastreia a operacao', (id, path) => {
    expectTraced(path, id);
  });
});

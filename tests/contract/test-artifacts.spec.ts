// @trace TS-040 (AGENTS.md QG-011: rastreabilidade)
// Artefatos de teste da matriz: todo artefato declarado "implemented" (ou "passing"/"failing")
// aponta para um arquivo que existe e que traz o TS na marca @trace da primeira linha. A
// verificacao nao exige o inverso: um teste novo pode rastrear um TS antes de a matriz o listar.
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
};

const declared = Object.entries(matrix.sentinel_tests).flatMap(([ts, test]) =>
  test.test_artifacts
    .filter((artifact) => artifact.status !== 'planned' && artifact.status !== 'blocked')
    .map((artifact) => ({ ts, ...artifact })),
);

describe('artefatos de teste da matriz', () => {
  it('ha artefatos implementados', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared.map((a) => [a.id, a.path, a.ts] as const))(
    '%s (%s) existe e rastreia %s',
    (_id, path, ts) => {
      const file = new URL(path, root);
      expect(existsSync(file)).toBe(true);
      const firstLine = readFileSync(file, 'utf8').split('\n')[0] ?? '';
      expect(firstLine.startsWith('// @trace ')).toBe(true);
      expect(firstLine.split(/\s+/)).toContain(ts);
    },
  );
});

// @trace TS-040 RNF-014 (AGENTS.md §19 e QG-001: oasdiff sem incompatibilidade nao aprovada)
// Testa `npm run openapi:diff` (tools/scripts/openapi-diff.mjs) com variacoes da OpenAPI normativa:
// cada mudanca incompativel precisa REPROVAR, e as compativeis ou aprovadas precisam passar.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { asObject, type JsonObject } from './support/json.js';
import { loadContract } from './support/load.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'tools', 'scripts', 'openapi-diff.mjs');
const TIMEOUT = 120_000;

const ctx = loadContract();
const NORMATIVE = join(ROOT, ctx.openapiFile);
let dir: string;

interface Run {
  readonly status: number | null;
  readonly output: string;
}

function diff(args: string[], env: Record<string, string> = {}): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: TIMEOUT,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/** Grava uma variacao da OpenAPI normativa e devolve o caminho. */
function variant(name: string, change: (api: JsonObject) => void): string {
  const api = structuredClone(ctx.api);
  change(api);
  const file = join(dir, `${name}.yaml`);
  writeFileSync(file, stringify(api), 'utf8');
  return file;
}

const paths = (api: JsonObject): JsonObject => asObject(api['paths'], 'paths');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mr-oasdiff-'));
  // Primeira execucao baixa e verifica o binario fixado; as seguintes usam o cache.
  expect(diff([NORMATIVE, NORMATIVE]).status).toBe(0);
}, TIMEOUT);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openapi:diff (oasdiff breaking)', () => {
  it('contrato identico passa', () => {
    const run = diff([NORMATIVE, NORMATIVE]);
    expect(run.status, run.output).toBe(0);
  });

  it('remover um endpoint reprova (api-path-removed)', () => {
    const revision = variant('sem-accounts', (api) => {
      const all = paths(api);
      expect(all['/accounts']).toBeDefined();
      Reflect.deleteProperty(all, '/accounts');
    });
    const run = diff([NORMATIVE, revision]);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toMatch(/api-path-removed/);
  });

  it('tornar obrigatorio um parametro antes opcional reprova', () => {
    const revision = variant('cursor-obrigatorio', (api) => {
      const cursor = asObject(
        asObject(asObject(api['components'], 'components')['parameters'], 'parameters')['Cursor'],
        'Cursor',
      );
      cursor['required'] = true;
    });
    const run = diff([NORMATIVE, revision]);
    expect(run.status, run.output).toBe(1);
  });

  it('acrescentar um endpoint novo e compativel', () => {
    const revision = variant('com-endpoint-novo', (api) => {
      paths(api)['/x-compat-probe'] = {
        get: {
          operationId: 'compatProbe',
          responses: { '204': { description: 'sem conteudo' } },
        },
      };
    });
    const run = diff([NORMATIVE, revision]);
    expect(run.status, run.output).toBe(0);
  });

  it('incompatibilidade registrada no arquivo de aprovacoes passa', () => {
    const revision = variant('sem-accounts-aprovado', (api) => {
      Reflect.deleteProperty(paths(api), '/accounts');
    });
    const approvals = join(dir, 'approved.txt');
    writeFileSync(
      approvals,
      '# aprovacao de teste\nPOST /accounts api path removed without deprecation\n',
      'utf8',
    );
    const run = diff([NORMATIVE, revision], { OPENAPI_DIFF_APPROVED: approvals });
    expect(run.status, run.output).toBe(0);
  });

  it('arquivo de aprovacoes ausente falha em vez de aprovar', () => {
    const run = diff([NORMATIVE, NORMATIVE], {
      OPENAPI_DIFF_APPROVED: join(dir, 'nao-existe.txt'),
    });
    expect(run.status, run.output).not.toBe(0);
  });

  it('aceita ref git como base e localiza a OpenAPI normativa daquele commit', () => {
    const run = diff(['HEAD', 'HEAD']);
    expect(run.status, run.output).toBe(0);
    expect(run.output).toMatch(/MeuRemedio_OpenAPI_.*_COMPLETO\.yaml/);
  });

  it('ref git inexistente falha com erro de uso', () => {
    const run = diff(['ref-que-nao-existe-123', NORMATIVE]);
    expect(run.status, run.output).toBe(2);
  });
});

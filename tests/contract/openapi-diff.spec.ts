// @trace TS-040 RNF-014 (AGENTS.md §19 e QG-001: oasdiff sem incompatibilidade nao aprovada)
// Testa `npm run openapi:diff` (tools/scripts/openapi-diff.mjs) com variacoes da OpenAPI normativa:
// cada mudanca incompativel precisa REPROVAR, e as compativeis ou aprovadas precisam passar.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { asObject, isObject, type JsonObject } from './support/json.js';
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

function diff(args: string[], env: Record<string, string> = {}, cwd = ROOT): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
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
}, TIMEOUT);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openapi:diff (oasdiff breaking)', () => {
  it('contrato identico passa (a primeira execucao baixa e verifica o binario)', () => {
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

  it('remover parametro de query reprova (incompatibilidade de nivel WARN tambem bloqueia)', () => {
    const revision = variant('sem-cursor', (api) => {
      const listPlans = asObject(asObject(paths(api)['/plans'], '/plans')['get'], 'listPlans');
      const params = listPlans['parameters'];
      if (!Array.isArray(params)) throw new Error('listPlans sem parametros');
      listPlans['parameters'] = params.filter(
        (p) => !(isObject(p) && p['$ref'] === '#/components/parameters/Cursor'),
      );
      expect(listPlans['parameters']).toHaveLength(params.length - 1);
    });
    const run = diff([NORMATIVE, revision]);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toMatch(/request-parameter-removed/);
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

  it('sem argumentos compara o merge-base de OPENAPI_DIFF_BASE com a arvore de trabalho', () => {
    const run = diff([], { OPENAPI_DIFF_BASE: 'HEAD' });
    expect(run.status, run.output).toBe(0);
    expect(run.output).toMatch(/base [0-9a-f]{40}:MeuRemedio_OpenAPI_/);
  });

  it('OPENAPI_DIFF_BASE zerado (push que cria o branch) usa o commit anterior', () => {
    const run = diff([], { OPENAPI_DIFF_BASE: '0'.repeat(40) });
    expect(run.output).toMatch(/base HEAD~1/);
    expect([0, 1], run.output).toContain(run.status);
  });

  it('funciona a partir de um subdiretorio', () => {
    const run = diff([NORMATIVE, NORMATIVE], {}, join(ROOT, 'tests'));
    expect(run.status, run.output).toBe(0);
  });

  it('falha de infraestrutura (download) sai com codigo proprio, nunca 1', () => {
    const cache = mkdtempSync(join(tmpdir(), 'mr-oasdiff-cache-'));
    try {
      const run = diff([NORMATIVE, NORMATIVE], {
        OASDIFF_CACHE_DIR: cache,
        OASDIFF_BASE_URL: 'http://127.0.0.1:9/',
      });
      expect(run.status, run.output).toBe(3);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it('binario incompleto no cache (sem marca de verificacao) nao e executado', () => {
    const cache = mkdtempSync(join(tmpdir(), 'mr-oasdiff-cache-'));
    try {
      const version = join(cache, '1.33.0');
      mkdirSync(version);
      writeFileSync(join(version, process.platform === 'win32' ? 'oasdiff.exe' : 'oasdiff'), 'x');
      const run = diff([NORMATIVE, NORMATIVE], {
        OASDIFF_CACHE_DIR: cache,
        OASDIFF_BASE_URL: 'http://127.0.0.1:9/',
      });
      // Sem a marca, tenta baixar de novo (e falha aqui por causa da URL), em vez de rodar o lixo.
      expect(run.status, run.output).toBe(3);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it('ref git inexistente falha com erro de uso', () => {
    const run = diff(['ref-que-nao-existe-123', NORMATIVE]);
    expect(run.status, run.output).toBe(2);
  });
});

// QG-001: incompatibilidades da OpenAPI normativa em relacao a base (oasdiff breaking).
// Uso: node tools/scripts/openapi-diff.mjs [base] [revisao]
//   base/revisao: caminho de arquivo ou ref git (a OpenAPI normativa daquele commit e localizada
//   pelo padrao do nome, que muda a cada versao). Padroes: base = merge-base de HEAD com
//   OPENAPI_DIFF_BASE (ou origin/main; SHA zerado = commit anterior); revisao = OpenAPI normativa
//   da arvore de trabalho. Caminhos relativos ao diretorio atual; o resto, a raiz do repositorio.
// Incompatibilidades aprovadas (ERR e WARN): tools/oasdiff/approved-breaking.txt
// (ou OPENAPI_DIFF_APPROVED).
// Saida: 0 sem incompatibilidade nao aprovada; 1 com incompatibilidade; 2 erro de uso;
// 3 falha de infraestrutura (download, hash, extracao, execucao).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { findNormative, REPO_ROOT } from './normative-openapi.mjs';
import { ensureOasdiff } from './oasdiff-bin.mjs';

const ZERO_SHA = /^0{40}$/;

class UsageError extends Error {}

function fail(message) {
  throw new UsageError(message);
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : undefined;
}

function single(names, where) {
  const found = findNormative(names);
  if (found.error) fail(`${found.error} (${where})`);
  return found.name;
}

/** Resolve um argumento (arquivo ou ref git) para um arquivo local e um rotulo legivel. */
function resolve(arg, tmp, label) {
  if (arg === undefined) {
    const name = single(readdirSync(REPO_ROOT), 'arvore de trabalho');
    return { file: join(REPO_ROOT, name), label: name };
  }
  if (existsSync(arg)) return { file: resolvePath(arg), label: arg };
  const commit = git(['rev-parse', '--verify', '--quiet', `${arg}^{commit}`])?.trim();
  if (!commit) fail(`'${arg}' nao e arquivo nem ref git`);
  const name = single((git(['ls-tree', '--name-only', commit]) ?? '').split('\n'), arg);
  const content = git(['show', `${commit}:${name}`]);
  if (content === undefined) fail(`nao foi possivel ler ${name} em ${arg}`);
  const file = join(tmp, `${label}.yaml`);
  writeFileSync(file, content, 'utf8');
  return { file, label: `${arg}:${name}` };
}

function defaultBase() {
  const target = process.env.OPENAPI_DIFF_BASE || 'origin/main';
  // Push que cria o branch: o GitHub informa "before" zerado; compara com o commit anterior.
  if (ZERO_SHA.test(target)) return 'HEAD~1';
  const mergeBase = git(['merge-base', 'HEAD', target])?.trim();
  if (!mergeBase) fail(`sem merge-base entre HEAD e ${target} (defina OPENAPI_DIFF_BASE)`);
  return mergeBase;
}

async function main() {
  const [baseArg, revisionArg] = process.argv.slice(2);
  const approved =
    process.env.OPENAPI_DIFF_APPROVED ||
    join(REPO_ROOT, 'tools', 'oasdiff', 'approved-breaking.txt');
  const tmp = mkdtempSync(join(tmpdir(), 'mr-openapi-diff-'));
  try {
    const base = resolve(baseArg ?? defaultBase(), tmp, 'base');
    const revision = resolve(revisionArg, tmp, 'revision');
    console.log(`openapi:diff: base ${base.label} -> revisao ${revision.label}`);

    const bin = await ensureOasdiff(REPO_ROOT);
    // --fail-on WARN: incompatibilidades de nivel WARN (ex.: parametro removido) tambem bloqueiam.
    // --allow-external-refs=false: sem busca de $ref remoto (SSRF). Nunca usar --open (envia a especificacao).
    const result = spawnSync(
      bin,
      [
        'breaking',
        base.file,
        revision.file,
        '--fail-on',
        'WARN',
        '--err-ignore',
        approved,
        '--warn-ignore',
        approved,
        '--allow-external-refs=false',
        '--color',
        'never',
      ],
      { stdio: 'inherit' },
    );
    if (result.status === 0 || result.status === 1) return result.status;
    console.error(`openapi:diff: oasdiff terminou com ${String(result.status ?? result.error)}`);
    return 3;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

let status;
try {
  status = await main();
} catch (error) {
  console.error(`openapi:diff: ${error instanceof Error ? error.message : String(error)}`);
  status = error instanceof UsageError ? 2 : 3;
}
process.exit(status);

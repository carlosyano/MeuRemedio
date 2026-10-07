// QG-001: incompatibilidades da OpenAPI normativa em relacao a base (oasdiff breaking).
// Uso: node tools/scripts/openapi-diff.mjs [base] [revisao]
//   base/revisao: caminho de arquivo ou ref git (a OpenAPI normativa daquele commit e localizada
//   pelo padrao do nome, que muda a cada versao). Padroes: base = merge-base de HEAD com
//   OPENAPI_DIFF_BASE (ou origin/main); revisao = OpenAPI normativa da arvore de trabalho.
// Incompatibilidades aprovadas: tools/oasdiff/approved-breaking.txt (ou OPENAPI_DIFF_APPROVED).
// Saida: 0 sem incompatibilidade nao aprovada; 1 com incompatibilidade; 2 erro de uso; outro: erro.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureOasdiff } from './oasdiff-bin.mjs';

const PATTERN = /^MeuRemedio_OpenAPI_.*_COMPLETO\.yaml$/;

class UsageError extends Error {}

function fail(message) {
  throw new UsageError(message);
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
}

function single(names, where) {
  const found = names.filter((name) => PATTERN.test(name));
  if (found.length !== 1) {
    fail(
      `esperada exatamente 1 OpenAPI normativa em ${where}; encontradas: ${String(found.length)}`,
    );
  }
  return found[0];
}

/** Resolve um argumento (arquivo ou ref git) para um arquivo local e um rotulo legivel. */
function resolve(arg, tmp, label) {
  if (arg === undefined) {
    const file = single(readdirSync('.'), 'arvore de trabalho');
    return { file, label: file };
  }
  if (existsSync(arg)) return { file: arg, label: arg };
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
  const mergeBase = git(['merge-base', 'HEAD', target])?.trim();
  if (!mergeBase) fail(`sem merge-base entre HEAD e ${target} (defina OPENAPI_DIFF_BASE)`);
  return mergeBase;
}

const [baseArg, revisionArg] = process.argv.slice(2);
const approved =
  process.env.OPENAPI_DIFF_APPROVED || join('tools', 'oasdiff', 'approved-breaking.txt');
const tmp = mkdtempSync(join(tmpdir(), 'mr-openapi-diff-'));
let status;
try {
  const base = resolve(baseArg ?? defaultBase(), tmp, 'base');
  const revision = resolve(revisionArg, tmp, 'revision');
  console.log(`openapi:diff: base ${base.label} -> revisao ${revision.label}`);

  const bin = await ensureOasdiff();
  // --allow-external-refs=false: sem busca de $ref remoto (SSRF). Nunca usar --open (envia a especificacao).
  const result = spawnSync(
    bin,
    [
      'breaking',
      base.file,
      revision.file,
      '--fail-on',
      'ERR',
      '--err-ignore',
      approved,
      '--allow-external-refs=false',
      '--color',
      'never',
    ],
    { stdio: 'inherit' },
  );
  status = result.status ?? 3;
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`openapi:diff: ${error.message}`);
  status = 2;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(status);

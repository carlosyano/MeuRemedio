// Gate de rastreabilidade dos testes (AGENTS.md QG-011; DC-060). Uso: node tools/scripts/trace-check.mjs
//   - todo *.spec.ts em tests/ comeca com "// @trace <IDs>" (IDs da matriz ou operationIds do
//     contrato; o texto depois do primeiro "(" e comentario livre) ou "// @trace-exempt <motivo>";
//   - identificador inexistente, @trace vazio e operacao sem teste reprovam;
//   - requisito (RF) ou teste sentinela (TS) sem teste reprova, salvo quando a matriz marca os
//     artefatos dele como planned: nesse caso aparece como pendencia, sem reprovar.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

/** Catalogos da matriz cujas chaves sao IDs rastreaveis. */
const CATALOGS = [
  'requirements',
  'non_functional_requirements',
  'acceptance_criteria',
  'sentinel_tests',
  'errors',
  'business_rules',
  'entities',
  'flows',
  'screen_states',
  'user_stories',
  'decisions',
];

/** Tokens rastreaveis da primeira linha, ou o motivo da isencao. */
function header(content) {
  const first = content.split(/\r?\n/, 1)[0] ?? '';
  const exempt = /^\/\/ @trace-exempt(?:\s+(.*))?$/.exec(first);
  if (exempt !== null) return { exempt: (exempt[1] ?? '').trim() };
  const trace = /^\/\/ @trace(?:\s+(.*))?$/.exec(first);
  if (trace === null) return undefined;
  const ids = (trace[1] ?? '').split('(', 1)[0] ?? '';
  return { tokens: ids.split(/\s+/).filter((token) => token !== '') };
}

/**
 * @param {import('./trace-check.d.mts').TraceInput} input
 * @returns {{ errors: string[]; pending: string[] }}
 */
export function checkTraceability(input) {
  const errors = [];
  const pending = [];
  const used = new Set();
  for (const file of input.files) {
    const parsed = header(file.content);
    if (parsed === undefined) {
      errors.push(`${file.path}: primeira linha sem // @trace`);
      continue;
    }
    if ('exempt' in parsed) {
      if (parsed.exempt === '') errors.push(`${file.path}: @trace-exempt sem motivo`);
      continue;
    }
    if (parsed.tokens.length === 0) {
      errors.push(`${file.path}: @trace sem identificadores`);
      continue;
    }
    for (const token of parsed.tokens) {
      if (input.ids.has(token) || input.operations.has(token)) used.add(token);
      else errors.push(`${file.path}: identificador inexistente ${token}`);
    }
  }
  for (const operation of input.operations) {
    if (!used.has(operation)) errors.push(`operacao ${operation} sem teste`);
  }
  const planned = (id) => {
    const statuses = input.sentinelTests[id] ?? [];
    return statuses.length > 0 && statuses.every((status) => status === 'planned');
  };
  for (const [id, tests] of Object.entries(input.requirements)) {
    if (used.has(id)) continue;
    if (tests.length > 0 && tests.every(planned)) {
      pending.push(`${id} sem teste (planejado: ${tests.join(', ')})`);
    } else errors.push(`${id} sem teste`);
  }
  for (const id of Object.keys(input.sentinelTests)) {
    if (used.has(id)) continue;
    if (planned(id)) pending.push(`${id} sem teste (planejado)`);
    else errors.push(`${id} sem teste`);
  }
  return { errors, pending };
}

function specFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : specFiles(path);
    return name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Entrada do gate a partir da matriz e dos testes do repositorio. */
export function loadInput(root) {
  const matrix = parse(readFileSync(join(root, 'traceability-matrix.yaml'), 'utf8'));
  const ids = new Set(matrix.governance.required_gates);
  for (const catalog of CATALOGS) for (const id of Object.keys(matrix[catalog] ?? {})) ids.add(id);
  return {
    ids,
    operations: new Set(Object.keys(matrix.operations)),
    requirements: Object.fromEntries(
      Object.entries(matrix.requirements).map(([id, value]) => [id, value.sentinel_tests ?? []]),
    ),
    sentinelTests: Object.fromEntries(
      Object.entries(matrix.sentinel_tests).map(([id, value]) => [
        id,
        (value.test_artifacts ?? []).map((artifact) => artifact.status),
      ]),
    ),
    files: specFiles(join(root, 'tests')).map((path) => ({
      path: relative(root, path).replaceAll('\\', '/'),
      content: readFileSync(path, 'utf8'),
    })),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const input = loadInput(process.cwd());
  const { errors, pending } = checkTraceability(input);
  console.log(
    `QG-011: ${String(input.files.length)} arquivos de teste, ${String(input.operations.size)} operacoes.`,
  );
  for (const item of pending) console.log(`pendente: ${item}`);
  for (const item of errors) console.error(`erro: ${item}`);
  if (errors.length > 0) process.exit(1);
  console.log('QG-011: rastreabilidade dos testes sem erros.');
}

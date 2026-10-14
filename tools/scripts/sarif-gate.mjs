// Gate do CodeQL (AGENTS.md QG-005; DC-049): le os SARIF gerados pelo codeql-action e falha (exit 1)
// se algum resultado vier de regra com security-severity >= 7.0 (alta ou critica). Uso:
//   node tools/scripts/sarif-gate.mjs <diretorio-ou-arquivo.sarif>...
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCKING_SEVERITY = 7.0;

/** Achados bloqueantes (texto legivel) de um documento SARIF. */
export function blockingFindings(sarif) {
  const findings = [];
  for (const run of sarif.runs ?? []) {
    const severities = new Map(
      (run.tool?.driver?.rules ?? []).map((rule) => [
        rule.id,
        rule.properties?.['security-severity'],
      ]),
    );
    for (const result of run.results ?? []) {
      const severity = severities.get(result.ruleId);
      if (severity === undefined || Number(severity) < BLOCKING_SEVERITY) continue;
      const location = result.locations?.[0]?.physicalLocation;
      const where = `${location?.artifactLocation?.uri ?? '?'}:${String(location?.region?.startLine ?? '?')}`;
      findings.push(
        `${result.ruleId} (security-severity ${severity}) em ${where}: ${result.message?.text ?? ''}`,
      );
    }
  }
  return findings;
}

function sarifFiles(target) {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target)
    .filter((name) => name.endsWith('.sarif'))
    .map((name) => join(target, name));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2).flatMap(sarifFiles);
  if (files.length === 0) {
    console.error('sarif-gate: nenhum arquivo SARIF encontrado');
    process.exit(2);
  }
  const findings = files.flatMap((file) =>
    blockingFindings(JSON.parse(readFileSync(file, 'utf8'))),
  );
  if (findings.length > 0) {
    console.error('Achados altos ou criticos do CodeQL (QG-005):');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log(`CodeQL: nenhum achado alto ou critico em ${String(files.length)} arquivo(s) SARIF.`);
}

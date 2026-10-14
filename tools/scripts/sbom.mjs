// SBOM CycloneDX das dependencias de producao (AGENTS.md QG-006; DC-048): gera sbom/sbom.cdx.json
// com o npm sbom e falha (exit 1) se alguma licenca estiver fora da politica (license-policy.mjs).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { licenseViolations } from './license-policy.mjs';
import { REPO_ROOT } from './normative-openapi.mjs';

// Via `npm run sbom`, npm_execpath aponta para o npm-cli.js: roda com o proprio Node, sem shell.
const npmCli = process.env['npm_execpath'];
const args = ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'];
const raw = execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const sbom = JSON.parse(raw);
const dir = join(REPO_ROOT, 'sbom');
mkdirSync(dir, { recursive: true });
const file = join(dir, 'sbom.cdx.json');
writeFileSync(file, `${JSON.stringify(sbom, null, 2)}\n`);

const components = sbom.components ?? [];
const violations = licenseViolations(components);
console.log(
  `SBOM CycloneDX ${sbom.specVersion}: ${String(components.length)} componentes em ${file}`,
);
if (violations.length > 0) {
  console.error('Licencas fora da politica (QG-006):');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log('Licencas: todas dentro da politica.');

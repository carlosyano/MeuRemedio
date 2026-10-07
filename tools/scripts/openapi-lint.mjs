// Lint da OpenAPI normativa com Spectral (ruleset oas), usando apenas o nucleo do Spectral.
// Motivo: a CLI (@stoplight/spectral-cli) depende de fast-glob -> micromatch -> braces, com
// vulnerabilidade alta sem correcao publicada (bloqueia QG-006). Ver docs/architecture/TOOLCHAIN.md.
// Falha (exit 1) em qualquer resultado de severidade error ou warn.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Spectral } from '@stoplight/spectral-core';
import Parsers from '@stoplight/spectral-parsers';
import { oas } from '@stoplight/spectral-rulesets';
import { findNormative, REPO_ROOT } from './normative-openapi.mjs';

let file = process.argv[2];
if (!file) {
  const found = findNormative(readdirSync(REPO_ROOT));
  if (found.error) {
    console.error(found.error);
    process.exit(2);
  }
  file = join(REPO_ROOT, found.name);
}

const spectral = new Spectral();
spectral.setRuleset({ extends: [[oas, 'recommended']] });

const results = await spectral.run(new Document(readFileSync(file, 'utf8'), Parsers.Yaml, file));
const names = ['error', 'warn', 'info', 'hint'];
const blocking = results.filter((r) => r.severity <= 1);

for (const r of results) {
  const line = r.range.start.line + 1;
  console.log(`${file}:${line} ${names[r.severity]} ${String(r.code)} ${r.message}`);
}
console.log(
  `${file}: ${blocking.length} bloqueante(s) (error/warn), ${results.length - blocking.length} informativo(s)`,
);
process.exit(blocking.length > 0 ? 1 : 0);

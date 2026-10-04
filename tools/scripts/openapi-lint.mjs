// Lint da OpenAPI normativa com Spectral (ruleset oas), usando apenas o nucleo do Spectral.
// Motivo: a CLI (@stoplight/spectral-cli) depende de fast-glob -> micromatch -> braces, com
// vulnerabilidade alta sem correcao publicada (bloqueia QG-006). Ver docs/architecture/TOOLCHAIN.md.
// Falha (exit 1) em qualquer resultado de severidade error ou warn.
import { readdirSync, readFileSync } from 'node:fs';
import { Document, Spectral } from '@stoplight/spectral-core';
import Parsers from '@stoplight/spectral-parsers';
import { oas } from '@stoplight/spectral-rulesets';

const target = process.argv[2];
const files = target
  ? [target]
  : readdirSync('.').filter((f) => /^MeuRemedio_OpenAPI_.*_COMPLETO\.yaml$/.test(f));

if (files.length !== 1) {
  console.error(`Esperada exatamente 1 OpenAPI normativa na raiz; encontradas: ${files.length}`);
  process.exit(2);
}

const file = files[0];
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

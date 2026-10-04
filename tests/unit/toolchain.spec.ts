// Teste de infraestrutura (sem ID normativo): protege premissas da fundacao tecnica.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

describe('toolchain', () => {
  it('o Node em execucao tem a mesma major do .nvmrc', () => {
    const nvmrc = readFileSync(new URL('.nvmrc', root), 'utf8').trim();
    expect(process.versions.node.split('.')[0]).toBe(nvmrc.split('.')[0]);
  });

  it('existe exatamente uma OpenAPI normativa na raiz (usada por openapi:lint)', () => {
    const files = readdirSync(root).filter((f) => /^MeuRemedio_OpenAPI_.*_COMPLETO\.yaml$/.test(f));
    expect(files).toHaveLength(1);
  });
});

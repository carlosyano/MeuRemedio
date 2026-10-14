// @trace RNF-014 (AGENTS.md QG-006: dependencias, licencas e SBOM)
// Politica de licencas das dependencias de producao (DC-048): so licencas permissivas; expressao
// SPDX com OR passa se uma alternativa for aceita, com AND so se todas forem; componente sem
// licenca declarada so passa com excecao revisada.
import { describe, expect, it } from 'vitest';
import { REVIEWED_EXCEPTIONS, licenseViolations } from '../../tools/scripts/license-policy.mjs';

const component = (name: string, version: string, licenses: unknown[]) => ({
  name,
  version,
  purl: `pkg:npm/${name}@${version}`,
  licenses,
});

describe('politica de licencas (QG-006)', () => {
  it.each([
    ['MIT', [{ license: { id: 'MIT' } }]],
    ['Apache-2.0', [{ license: { id: 'Apache-2.0' } }]],
    ['BlueOak-1.0.0', [{ license: { id: 'BlueOak-1.0.0' } }]],
    ['expressao OR com uma aceita', [{ expression: '(MIT OR GPL-3.0-only)' }]],
    ['expressao AND toda aceita', [{ expression: 'MIT AND ISC' }]],
  ])('aceita %s', (_nome, licenses) => {
    expect(licenseViolations([component('lib', '1.0.0', licenses)])).toEqual([]);
  });

  it.each([
    ['GPL', [{ license: { id: 'GPL-3.0-only' } }]],
    ['AGPL', [{ license: { id: 'AGPL-3.0-or-later' } }]],
    ['expressao AND com uma recusada', [{ expression: 'MIT AND SSPL-1.0' }]],
    ['sem licenca', []],
  ])('recusa %s', (_nome, licenses) => {
    expect(licenseViolations([component('lib', '1.0.0', licenses)])).toHaveLength(1);
  });

  it('pacotes do proprio workspace (@meuremedio) ficam fora da politica', () => {
    expect(
      licenseViolations([
        { name: 'api', version: '0.0.0', purl: 'pkg:npm/%40meuremedio/api@0.0.0', licenses: [] },
      ]),
    ).toEqual([]);
  });

  it('excecao revisada aceita componente sem licenca declarada, so naquela versao', () => {
    const [reviewed] = Object.keys(REVIEWED_EXCEPTIONS);
    if (reviewed === undefined) throw new Error('sem excecoes');
    const [name, version] = reviewed.split('@');
    expect(licenseViolations([component(name ?? '', version ?? '', [])])).toEqual([]);
    expect(licenseViolations([component(name ?? '', '99.0.0', [])])).toHaveLength(1);
  });
});

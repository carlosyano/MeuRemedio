// Politica de licencas das dependencias de producao (AGENTS.md QG-006; DC-048).
// Aceitas: licencas permissivas. Expressao SPDX com OR passa se uma alternativa for aceita; com AND,
// so se todas forem. Pacotes do proprio workspace (@meuremedio) ficam fora. Componente sem licenca
// declarada so passa com excecao revisada, presa a versao.

export const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
]);

/** Excecoes revisadas (nome@versao -> motivo). */
export const REVIEWED_EXCEPTIONS = {
  'png-js@2.0.0': 'MIT no arquivo LICENSE; o package.json nao declara o campo license.',
  'ssh2@1.17.0': 'MIT no campo legado licenses; o npm sbom nao o le.',
};

const WORKSPACE_PURL = 'pkg:npm/%40meuremedio/';

/** A expressao SPDX e aceita pela politica? */
function expressionAllowed(expression) {
  const text = expression.replace(/[()]/g, ' ').trim();
  return text
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative
        .split(/\s+AND\s+/)
        .every((id) => ALLOWED_LICENSES.has(id.trim().replace(/\+$/, ''))),
    );
}

function licensesOf(component) {
  return (component.licenses ?? []).flatMap((entry) => {
    if (entry.expression) return [entry.expression];
    const id = entry.license?.id ?? entry.license?.name;
    return id ? [id] : [];
  });
}

/** Violacoes da politica entre os componentes de uma SBOM CycloneDX. */
export function licenseViolations(components) {
  const violations = [];
  for (const component of components) {
    if (component.purl?.startsWith(WORKSPACE_PURL)) continue;
    const id = `${component.name}@${component.version}`;
    const licenses = licensesOf(component);
    if (licenses.length === 0) {
      if (!(id in REVIEWED_EXCEPTIONS)) violations.push(`${id}: sem licenca declarada`);
      continue;
    }
    if (!licenses.every(expressionAllowed)) {
      violations.push(`${id}: licenca fora da politica (${licenses.join(', ')})`);
    }
  }
  return violations;
}

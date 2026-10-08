// Localizacao da OpenAPI normativa (AGENTS.md §3): exatamente 1 arquivo na raiz do repositorio,
// com o nome no padrao abaixo (a versao faz parte do nome e muda a cada revisao).
import { fileURLToPath } from 'node:url';

export const NORMATIVE_PATTERN = /^MeuRemedio_OpenAPI_.*_COMPLETO\.yaml$/;

/** Raiz do repositorio, independente do diretorio de trabalho. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Devolve o unico nome normativo em `names`, ou uma mensagem de erro. */
export function findNormative(names) {
  const found = names.filter((name) => NORMATIVE_PATTERN.test(name));
  return found.length === 1
    ? { name: found[0] }
    : { error: `esperada exatamente 1 OpenAPI normativa; encontradas: ${String(found.length)}` };
}

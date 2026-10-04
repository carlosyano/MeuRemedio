# MeuRemedio — Toolchain e versões fixadas

> Atende AGENTS.md §5.8 e ADR-001 v1.5 (OA-010). Reproduzir o ambiente: `npm ci` (nunca `npm install` na CI). Versões exatas em `package.json` (`save-exact`) e `package-lock.json`.

## 1. Ambiente

| Item | Versão | Observação |
|---|---|---|
| Node.js | 24 (LTS), em `.nvmrc` | `engines`: `>=24.0.0 <25`; `engine-strict=true`. Reavaliar o Node 26 após sua promoção a LTS (outubro de 2026). |
| npm | o que acompanha o Node 24 (11.x) | Lockfile v3. |
| PostgreSQL | 17 (`postgres:17` nos testes; 17.11 validada em 04/10/2026) | Testcontainers sobe o banco real. |
| Docker | Docker Desktop | Necessário a partir dos testes de integração. |
| Python | o definido em `.github/workflows/traceability-validation.yml` | Só para `validate_all.py`. |

## 2. Dependências de desenvolvimento (fundação)

| Pacote | Versão | Uso |
|---|---|---|
| typescript | 6.0.3 | QG-002, modo `strict` e flags adicionais em `tsconfig.base.json` |
| typescript-eslint | 8.71.0 | ESLint com regras `strictTypeChecked` |
| eslint | 10.12.0 | QG-002 |
| @eslint/js | 10.0.1 | Regras base |
| prettier | 3.9.9 | Formatação (código e JSON; Markdown, YAML e `.docx` ficam fora) |
| vitest | 5.0.3 | QG-003 e QG-004 |
| fast-check | 4.10.2 | Testes de propriedade (TS-024 e demais); dependência única: pure-rand |
| @types/node | 24.19.1 | Tipos do Node 24 |
| @stoplight/spectral-core, -parsers, -rulesets | 1.24.0, 1.0.5, 1.23.0 | QG-001 (lint da OpenAPI) via `tools/scripts/openapi-lint.mjs` |

### Decisões de versão

- **TypeScript 6.0.3, e não 7.x.** A versão mais recente do TypeScript é a 7.0.2, mas o `typescript-eslint` 8.71.0 declara compatibilidade apenas com TypeScript `<6.1.0`. Subir para o TypeScript 7 exige uma versão do `typescript-eslint` compatível; reavaliar por PR próprio.
- **Spectral sem a CLI.** `@stoplight/spectral-cli` depende de `fast-glob` → `micromatch` → `braces`, com vulnerabilidade **alta** (GHSA-vfj7-8cjw-p6xm) sem correção publicada em 04/10/2026, o que violaria o QG-006 (RNF-009). O lint usa o núcleo do Spectral (`spectral-core`) com o ruleset `oas`, e o `npm audit` fica em 0 vulnerabilidades. Quando houver correção publicada, avaliar o retorno à CLI.
- **Versões das bibliotecas de aplicação** (Next.js, NestJS, Fastify, Drizzle, pg-boss, Testcontainers, Playwright, axe, Stryker, Zod etc.) **não estão fixadas ainda**: serão escolhidas, com consulta ao registro, checagem de compatibilidade (`peerDependencies` e `engines`) e `npm audit`, no PR que cada uma introduzir.

## 3. Scripts e quality gates

| Script | Gate | Situação |
|---|---|---|
| `npm run typecheck` | QG-002 | Implementado |
| `npm run lint` | QG-002 | Implementado |
| `npm run format:check` | QG-002 | Implementado |
| `npm run test:unit` | QG-003 | Implementado (apenas teste de infraestrutura) |
| `npm run openapi:lint` | QG-001 (parcial) | Implementado (Spectral) |
| `npm run traceability:check` | QG-011 | Implementado (`python validate_all.py`) |
| `npm run verify` | — | Executa os cinco primeiros em sequência |
| `test:integration`, `test:contract`, `test:ownership`, `test:e2e`, `test:a11y`, `test:mutation`, `security`, `sbom`, `openapi:diff` | QG-001, 004 a 010 | **Não implementados**: serão criados com os testes e as ferramentas correspondentes (oasdiff, Schemathesis, Playwright, Stryker, CodeQL, Semgrep, Gitleaks, Trivy) |

## 4. Política de atualização

- Toda atualização de dependência entra por pull request, com `npm run verify` e `npm audit` verdes.
- Achado alto ou crítico em dependência bloqueia o merge (QG-006) até correção ou exceção formal aprovada por humano.
- Não usar `npm install` para adicionar pacote sem `--save-exact`; o `.npmrc` já impõe `save-exact=true`.

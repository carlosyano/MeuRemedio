# MeuRemedio — Toolchain e versões fixadas

> Atende AGENTS.md §5.8 e ADR-001 v1.5 (OA-010). Reproduzir o ambiente: `npm ci` (nunca `npm install` na CI). Versões exatas em `package.json` (`save-exact`) e `package-lock.json`.

## 1. Ambiente

| Item | Versão | Observação |
|---|---|---|
| Node.js | 24 (LTS), em `.nvmrc` | `engines`: `>=24.0.0 <25`; `engine-strict=true`. Reavaliar o Node 26 após sua promoção a LTS (outubro de 2026). |
| npm | o que acompanha o Node 24 (11.x) | Lockfile v3. |
| PostgreSQL | 17 (`postgres:17` nos testes; 17.11 validada em 04/10/2026) | Testcontainers sobe o banco real. |
| Docker | Docker Desktop | Necessário a partir dos testes de integração. |
| Python | o definido em `.github/workflows/traceability-validation.yml` | Para `validate_all.py` e para o Schemathesis. |

## 2. Dependências de desenvolvimento (fundação)

| Pacote | Versão | Uso |
|---|---|---|
| typescript | 6.0.3 | QG-002, modo `strict` e flags adicionais em `tsconfig.base.json` |
| typescript-eslint | 8.71.0 | ESLint com regras `strictTypeChecked` |
| eslint | 10.12.0 | QG-002 |
| @eslint/js | 10.0.1 | Regras base |
| prettier | 3.9.9 | Formatação (código e JSON; Markdown, YAML e `.docx` ficam fora) |
| vitest | 5.0.3 | QG-003 e QG-004 |
| testcontainers, @testcontainers/postgresql | 12.2.0 | PostgreSQL 17 real em contêiner descartável nos testes de integração (exige Docker) |
| pg, @types/pg | 8.23.1 | Driver PostgreSQL (runner de migrações e testes) |
| drizzle-orm (em `apps/api`) | 0.45.3 | Acesso a dados tipado (ADR-001 v1.5 OA-001); sem dependências transitivas. Última estável em 06/10/2026 (a linha 1.0 está em beta). `drizzle-kit` **não** é usado: as migrações seguem em SQL explícito |
| yaml | 2.9.1 | Leitura da OpenAPI e da matriz nos testes de contrato (TS-040) |
| fast-check | 4.10.2 | Testes de propriedade (TS-024 e demais); dependência única: pure-rand |
| @types/node | 24.19.1 | Tipos do Node 24 |
| @stoplight/spectral-core, -parsers, -rulesets | 1.24.0, 1.0.5, 1.23.0 | QG-001 (lint da OpenAPI) via `tools/scripts/openapi-lint.mjs` |
| @nestjs/common, @nestjs/core, @nestjs/platform-fastify (em `apps/api`) | 12.1.2 | API HTTP (ADR-001 v1.5 §4); linha 12 é ESM nativa (`"type": "module"`), como o repositório. MIT |
| fastify (em `apps/api`) | 5.12.5 | Adaptador HTTP; mesma versão exigida pelo `@nestjs/platform-fastify` 12.1.2 |
| reflect-metadata, rxjs (em `apps/api`) | 0.2.2, 7.8.2 | Dependências de par do NestJS |
| ajv, ajv-formats (em `apps/api`) | 8.20.0, 3.0.1 | Validação de requisição e resposta contra os schemas da OpenAPI (JSON Schema 2020-12, `Ajv2020`) |
| @node-rs/argon2 (em `apps/api`) | 2.2.1 | Argon2id (RN-017, OA-009): binários N-API pré-compilados, sem dependências em tempo de execução, MIT. A 2.2.2 tinha 2 dias em 08/10/2026; preferida a anterior (DC-013) |
| pg-boss (em `apps/api`) | 12.34.0 | Filas sobre PostgreSQL (OA-002), ESM, MIT. Publicações quase diárias; fixada a versão com 2 semanas em 08/10/2026 (DC-016). O despachante enfileira na mesma transação do Outbox (opção `db`) |
| yaml (em `apps/api`) | 2.9.1 | Leitura da OpenAPI normativa em tempo de execução |
| pdfkit (em `apps/api`) | 0.20.2 | PDF pesquisável da exportação (RN-011) com fontes padrão; MIT, dependências MIT (fontkit, linebreak, png-js, fflate, @noble/hashes e @noble/ciphers), publicada em 30/08/2026; `npm audit` sem achados (DC-042). O pdf-lib foi descartado por estar sem manutenção desde 2022 |
| @types/pdfkit (em `apps/api`, dev) | 0.17.6 | Tipos do pdfkit (o pacote não publica tipos); a API usada (`text`, `font`, `fontSize`, `moveDown`) não mudou entre a 0.17 e a 0.20 |
| oasdiff (binário Go, fora do npm) | 1.33.0 | QG-001 (incompatibilidades da OpenAPI) via `tools/scripts/openapi-diff.mjs`; SHA-256 de cada plataforma fixado em `tools/scripts/oasdiff-bin.mjs` |

### Decisões de versão

- **TypeScript 6.0.3, e não 7.x.** A versão mais recente do TypeScript é a 7.0.2, mas o `typescript-eslint` 8.71.0 declara compatibilidade apenas com TypeScript `<6.1.0`. Subir para o TypeScript 7 exige uma versão do `typescript-eslint` compatível; reavaliar por PR próprio.
- **Spectral sem a CLI.** `@stoplight/spectral-cli` depende de `fast-glob` → `micromatch` → `braces`, com vulnerabilidade **alta** (GHSA-vfj7-8cjw-p6xm) sem correção publicada em 04/10/2026, o que violaria o QG-006 (RNF-009). O lint usa o núcleo do Spectral (`spectral-core`) com o ruleset `oas`, e o `npm audit` fica em 0 vulnerabilidades. Quando houver correção publicada, avaliar o retorno à CLI.
- **oasdiff como binário verificado.** O oasdiff não tem pacote npm oficial (o nome `oasdiff` no npm é um placeholder de segurança `0.0.1-security`, verificado em 06/10/2026: não instalar). `tools/scripts/oasdiff-bin.mjs` baixa o `.tar.gz` da release oficial (linux amd64/arm64, windows amd64/arm64, darwin), confere o SHA-256 fixado (copiado do `checksums.txt` da release) e guarda o binário em `node_modules/.cache/oasdiff/<versão>/`. Divergência de hash aborta. Exige `tar` no PATH (nativo no Windows 10+, Linux e macOS). Atualizar = trocar versão e hashes no mesmo PR. A extração é feita em diretório temporário e só vale com a marca `.verified`, então execução interrompida não deixa binário truncado no cache; o download tem timeout de 60 s. `OASDIFF_CACHE_DIR` muda o cache e `OASDIFF_BASE_URL` aponta para um espelho da release (o SHA-256 continua obrigatório; o `fetch` do Node não usa `HTTP(S)_PROXY`). O script desliga `$ref` externo (`--allow-external-refs=false`, contra SSRF) e nunca usa `--open`, que enviaria a especificação a serviço externo. Incompatibilidades de nível ERR **e** WARN bloqueiam (`--fail-on WARN`). Códigos de saída: 0 sem incompatibilidade não aprovada, 1 incompatível, 2 erro de uso, 3 falha de infraestrutura.
- **NestJS 12 com decorators legados.** `apps/api` e `tests` ligam `experimentalDecorators`. Não há `emitDecoratorMetadata` (o Vitest transpila com oxc, sem metadados de tipo): toda injeção por construtor usa `@Inject(token)` explícito. Os módulos do Nest são classes vazias com decorator, liberadas na regra `no-extraneous-class` do ESLint.
- **Versões das demais bibliotecas de aplicação** (Next.js, pg-boss, Playwright, axe, Stryker, Zod etc.) **não estão fixadas ainda**: serão escolhidas, com consulta ao registro, checagem de compatibilidade (`peerDependencies` e `engines`) e `npm audit`, no PR que cada uma introduzir.

## 3. Scripts e quality gates

| Script | Gate | Situação |
|---|---|---|
| `npm run typecheck` | QG-002 | Implementado |
| `npm run lint` | QG-002 | Implementado |
| `npm run format:check` | QG-002 | Implementado |
| `npm run test:unit` | QG-003 | Implementado (infraestrutura e domínio: TS-024 parte pura) |
| `npm run test:integration` | QG-004 (parcial) | Implementado (esquema central no PostgreSQL 17 real; exige Docker) |
| `npm run test:contract` | QG-001 (parcial) | Implementado (TS-040 estático e testes do `openapi:diff`; rotas da API em `tests/integration/routes.spec.ts`) |
| `npm run test:schemathesis` | QG-001 | Implementado (TS-040: Schemathesis `4.29.4`, fixado em `tools/schemathesis/requirements.txt`, contra a API em execução e o PostgreSQL 17 real; exige Docker e o Schemathesis no `PATH` ou em `SCHEMATHESIS_BIN`) |
| `npm run openapi:lint` | QG-001 (parcial) | Implementado (Spectral) |
| `npm run openapi:diff` | QG-001 (parcial) | Implementado (oasdiff `breaking` contra a OpenAPI do merge-base com `origin/main`, ou `OPENAPI_DIFF_BASE`; aprovações em `tools/oasdiff/approved-breaking.txt`) |
| `npm run test:ownership` | QG-009 | Implementado (TS-023 gerado da OpenAPI, que inclui o TS-008; job próprio na CI) |
| `npm audit --audit-level=high` e `npm run sbom` | QG-006 | Implementado (SBOM CycloneDX das dependências de produção, artefato `sbom-cyclonedx` da CI, e política de licenças, DC-048); Trivy entra quando o projeto produzir imagem |
| `npm run traceability:check` | QG-011 | Implementado (`python validate_all.py`) |
| `npm run verify` | — | Executa typecheck, lint, format:check, test:unit, test:contract, openapi:lint e openapi:diff em sequência (a primeira execução baixa o oasdiff) |
| `test:e2e`, `test:a11y`, `test:mutation`, `security` | QG-005, 007, 008 e 010 | **Não implementados**: serão criados com os testes e as ferramentas correspondentes (Playwright, Stryker, CodeQL, Semgrep, Gitleaks, Trivy) |

## 4. Política de atualização

- Toda atualização de dependência entra por pull request, com `npm run verify` e `npm audit` verdes.
- Achado alto ou crítico em dependência bloqueia o merge (QG-006) até correção ou exceção formal aprovada por humano.
- Não usar `npm install` para adicionar pacote sem `--save-exact`; o `.npmrc` já impõe `save-exact=true`.

## 5. Banco de dados nos testes

- Padrão: o Testcontainers sobe um contêiner `postgres:17` descartável por arquivo de teste.
- `MEUREMEDIO_TEST_PG_URL`: se definida, usa um servidor PostgreSQL existente (por exemplo, um service container da CI) e cria um banco isolado por teste, removido ao final.
- `npm run verify` não inclui `test:integration`, para continuar rápido e sem Docker; a CI executa os dois.

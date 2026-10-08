# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MeuRemedio: aplicação web individual e declaratória para rotinas de medicamentos (não prescreve nem valida medicamentos). A política normativa completa está em `AGENTS.md`; o estado do projeto e as decisões vigentes, em `PROJECT_CONTEXT.md`. Este arquivo não repete essas regras: resume o que é preciso para trabalhar no código.

## Comandos

Requisitos: Node.js 24 (`.nvmrc`), npm, Docker (testes de integração) e Python 3 (validador da matriz).

```bash
npm ci
npm run verify              # typecheck, lint, format:check, test:unit, test:contract, openapi:lint, openapi:diff
npm run typecheck           # tsc -b (project references) + tsc -p tests/tsconfig.json
npm run lint                # eslint .
npm run format              # prettier --write . (format:check roda na CI)
npm run test:unit           # vitest --project unit         (tests/unit)
npm run test:contract       # vitest --project contract     (tests/contract)
npm run test:integration    # vitest --project integration  (tests/integration, PostgreSQL 17 real)
npm run openapi:lint        # Spectral na OpenAPI normativa
npm run openapi:diff        # oasdiff contra o merge-base com origin/main (ou OPENAPI_DIFF_BASE)
python validate_all.py      # matriz de rastreabilidade (= npm run traceability:check); relatórios em validation-report/
```

Um único arquivo ou teste:

```bash
npx vitest run --project unit tests/unit/civil-time.spec.ts
npx vitest run --project integration tests/integration/ts-024.spec.ts -t "reexecutar"
```

- Integração: `packages/testkit` sobe `postgres:17` via Testcontainers. Com `MEUREMEDIO_TEST_PG_URL` definido, usa esse servidor e cria um banco isolado por suíte.
- `test:integration` não faz parte de `verify`; rode-o à parte quando tocar em persistência.
- `openapi:diff` baixa um binário fixado do oasdiff (SHA-256 verificado) e precisa do histórico git (a CI usa `fetch-depth: 0`). Incompatibilidades aprovadas ficam em `tools/oasdiff/approved-breaking.txt`, com referência a uma decisão (DEC-xxx).

## Fontes normativas e integridade

- Na raiz: `MeuRemedio_OpenAPI_02.33.4_COMPLETO.yaml` (superfície HTTP), `MeuRemedio_Especificacao_Funcional_02.33.docx` (regras, RF/RN/CA/TS/DEC), `ADR-001_Arquitetura_Base_MeuRemedio_v1.5.docx` (arquitetura) e `AGENTS.md`.
- `traceability-matrix.yaml` guarda o SHA-256 dessas quatro fontes (`source_integrity`) e o catálogo de IDs (RF, RN, TS, DEC, operações...). Qualquer edição numa fonte normativa exige atualizar o hash e o conteúdo correspondente na matriz. Caso contrário, `validate_all.py` falha com `source-hash-mismatch`. `traceability-matrix.schema.json` limita contagens (por exemplo, `maxProperties` de `decisions`).
- Uma nova decisão (DEC-xxx) é registrada na tabela de decisões e no Anexo C da Especificação, na matriz, em `docs/CHANGELOG_02.33.md` e em `PROJECT_CONTEXT.md`. Alterações normativas só entram com aprovação do mantenedor no PR (CODEOWNERS).
- Documentos de apoio, subordinados à Especificação: `docs/architecture/DATA_MODEL.md` (modelo físico), `docs/specifications/P0_SENTINEL_TESTS.md` (cenários, fixtures e o estado "Estado (PR n)" de cada teste sentinela bloqueador) e `docs/architecture/TOOLCHAIN.md` (versões).

## Arquitetura

Monorepo npm workspaces (`apps/*`, `packages/*`), TypeScript strict (`tsconfig.base.json`: NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), ESM com imports `.js`.

- `packages/domain`: regras puras, sem I/O. `civil-time.ts` (`resolveCivilInstant`: hora civil inexistente avança, ambígua usa o primeiro instante; `deadlineFor` = +60 min) e `occurrence-slots.ts` (slots de ocorrência por janela de datas civis). Usa só `Intl`, sem bibliotecas de data, e o resultado não depende do `TZ` do processo.
- `apps/api`: `src/platform/migrate.ts` aplica `migrations/NNNN_*.sql` em ordem, em transação, com checksum SHA-256 e advisory lock. Migração aplicada nunca é editada: mudança vai em nova migração. Os módulos seguem as fronteiras de domínio do AGENTS.md §7 (`src/modules/<dominio>/{application,domain,infrastructure}`); ex.: `modules/occurrences/infrastructure/generate-occurrences.ts`.
- API HTTP (NestJS 12 + Fastify, `apps/api/src/app.ts`, `createApp({ clock })`): contract-first. `platform/contract/openapi-contract.ts` carrega a OpenAPI da raiz e valida requisição e resposta (Ajv 2020-12); todo handler leva `@OperationId(...)` e a aplicação não sobe se método, caminho ou operationId divergirem do contrato (`route-check.ts`). Erros viram Problem do catálogo fechado (`platform/http/problem-catalog.ts`); resposta fora do contrato vira 500 `INTERNAL_ERROR`; toda resposta leva `X-Correlation-ID`. Injeção sempre com `@Inject(token)` explícito (sem `emitDecoratorMetadata`). Testes HTTP usam `inject` do Fastify (ex.: `tests/integration/api-health.spec.ts`).
- `packages/testkit`: `startPostgres()`. `packages/contract` e `packages/shared` são placeholders. A OpenAPI nunca é copiada para dentro de pacotes.
- O banco carrega regras de integridade em constraints **nomeadas** (`0001_core.sql`): ownership por FKs compostas `(id, user_id)`, unicidade de ocorrência ativa pelo índice parcial `occurrences_slot_active_unique`, limite de 10 horários por trigger. Os testes de integração verificam qual constraint disparou (`tests/integration/support/pg-errors.ts`).
- Resolução de pacotes: `vitest.config.ts` aponta `@meuremedio/domain` para o `src`, então os testes não dependem de `dist/`. O `tsc -b` usa project references (`apps/api` referencia `packages/domain`).

## Testes de contrato

`tests/contract/ts-040.spec.ts` (TS-040) faz verificações estáticas da OpenAPI, com regras R01..R18 em `tests/contract/support/rules.ts`: operationId, `Problem.code` × catálogo de erros da matriz, 429, 500/503, `Idempotency-Key`, CSRF, `X-Correlation-ID`, `ETag`/`If-Match`, nome e SHA-256 do arquivo. `ts-040.negative.spec.ts` prova cada regra aplicando uma mutação no contrato que precisa ser reprovada. Uma nova regra precisa ter o seu caso negativo.

## Convenções do repositório

- Test-First em commits separados: `test: ... (etapa vermelha)` seguido de `feat: ... (etapa verde)`. Mensagens em português, sem acentos.
- Todo arquivo de teste começa com `// @trace TS-xxx RN-xxx RF-xxx ...` (IDs que existem na matriz). Pendências conhecidas ficam como `it.todo(...)` com a razão.
- Identificadores e código em inglês; comentários de código em português sem acentos; documentação e textos de interface em pt-BR.
- Fixtures só com dados sintéticos (`ana.silva@example.com`, `bruno.costa@example.com`).
- Comportamento não definido na Especificação não é suprido por suposição: registre a lacuna e peça a decisão (AGENTS.md §18).

## Fluxo de trabalho autônomo (decisão do mantenedor, 08/10/2026)

O agente evolui o projeto continuamente e só para quando houver um item crítico sem recomendação clara (passo 0); o resto ele decide, registra e segue. A cada PR:

0. **Dúvidas:** em dúvida não crítica, analisar a fundo as alternativas, adotar a recomendação, registrar como **Decisão Claude** em `docs/decisions/DECISOES_CLAUDE.md` (DC-NNN: contexto, alternativas, decisão, riscos, onde se aplica) e seguir. Perguntar ao mantenedor só em item crítico (segurança, privacidade, dados de saúde, mudança de comportamento normativo de alto impacto) **e** sem recomendação clara. Decisão que preenche lacuna da Especificação continua indo para o PR normativo (DEC-xxx) para o merge do mantenedor; a DC registra a escolha até lá.
1. **Conferir antes:** CI toda verde (`gh pr checks`), PR sem conflito, diff restrito ao escopo, `python validate_all.py` e `npm run verify` locais (e `test:integration` quando tocar em persistência).
2. **Merge:** o GitHub não deixa o autor aprovar o próprio PR, então "aprovar" significa fazer o merge (`gh pr merge --merge --delete-branch`) depois da conferência.
   - **PR só de código, testes ou documentação de apoio:** o agente faz o merge.
   - **PR com mudança normativa** (Especificação, OpenAPI, ADR, `AGENTS.md`, matriz ou schema da matriz): o agente abre o PR e espera o mantenedor fazer o merge, a menos que ele autorize aquele PR explicitamente.
3. **Verificar depois:** garantir que tudo está coerente e funcionando (código, testes, documentação de apoio e registro de decisões); atualizar a `main`, rodar `validate_all.py`, conferir o `ci` da `main` (`gh run list --branch main`) e só então seguir para o próximo passo do PROJECT_CONTEXT §12.

Exceção registrada no PROJECT_CONTEXT §8.1.

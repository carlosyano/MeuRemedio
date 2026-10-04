# MeuRemedio

Aplicação web individual e declaratória para gerenciar rotinas de medicamentos. O produto não prescreve, não valida medicamentos e não substitui orientação profissional.

> **Antes de qualquer alteração**, leia `AGENTS.md` e `PROJECT_CONTEXT.md`. A baseline normativa (OpenAPI, Especificação Funcional, ADR) está na raiz.

## Requisitos locais

- Node.js 24 (veja `.nvmrc`) e npm
- Docker Desktop (a partir dos testes de integração)
- Python 3 (somente para `python validate_all.py`)

## Comandos

```bash
npm ci                # instala as dependências exatas do package-lock.json
npm run verify        # typecheck, lint, format:check, test:unit e openapi:lint
npm run traceability:check   # valida a matriz de rastreabilidade
```

Versões e política de atualização: `docs/architecture/TOOLCHAIN.md`.

## Estrutura

```text
apps/       api, web, worker      (reservados; criados em PRs próprios)
packages/   contract, domain, shared, testkit
tests/      unit, integration, api, e2e, ... (conforme AGENTS.md §19.6)
docs/       specifications, architecture, operations
tools/      scripts
```

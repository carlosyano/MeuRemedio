# Ciclo de uma mudança: do branch ao merge

Roteiro para o mantenedor executar à mão as etapas de uma mudança, com o Claude escrevendo o código e os testes. Cada etapa diz o que rodar, o que esperar e o que fazer quando falha. Os comandos valem para o terminal do Windows (PowerShell ou Git Bash) na pasta do repositório; os detalhes do ambiente estão em `AMBIENTE_LOCAL.md`.

## 0. Uma vez por máquina

| O quê | Como | Para quê |
|---|---|---|
| Node.js 24 | versão do arquivo `.nvmrc` | rodar build, testes e scripts |
| Docker Desktop | com o WSL 2 habilitado | banco dos testes de integração e do E2E |
| Python 3 | `pip install -r requirements-validation.txt` | validador da matriz (`validate_all.py`) |
| Navegador do E2E | `npx playwright install chromium` | testes de tela (Playwright + axe) |
| GitHub CLI (opcional) | `gh auth login` | abrir PR e acompanhar a CI pelo terminal; o site do GitHub faz o mesmo |

## 1. Começar pela `main` atualizada

```bash
git checkout main
git pull
npm ci
```

- `npm ci` instala as dependências exatamente como estão no `package-lock.json`, sem alterá-lo.
- Antes de qualquer coisa, `git status` deve dizer que não há alteração pendente.

## 2. Criar o branch (ou pegar o do Claude)

Mudança nova, feita por você:

```bash
git checkout -b ajuste/mensagem-conflito-plano
```

Mudança que o Claude preparou num branch:

```bash
git fetch origin
git checkout claude/nome-do-branch
```

Nome do branch: curto, em minúsculas, sem acento, dizendo o assunto.

## 3. Etapa vermelha: o teste antes do código

O projeto é Test-First: primeiro entra o teste que descreve o comportamento e **falha**; depois o código que o faz passar.

Rodar só o teste novo:

```bash
npx vitest run --project unit tests/unit/nome-do-teste.spec.ts
npx vitest run --project integration tests/integration/nome-do-teste.spec.ts
```

- **Esperado:** o teste novo falha, e pelo motivo certo (o comportamento ainda não existe, não um erro de digitação).
- Todo arquivo de teste começa com `// @trace ...` e os IDs da matriz (RF, RN, TS, DEC ou operationId). Sem isso, a CI reprova no QG-011.

Commit só dos testes:

```bash
git add tests/
git commit -m "test: o que o teste cobre, DEC-xxx (etapa vermelha)"
```

## 4. Etapa verde: o código e a conferência local

Com o código no lugar, rode as conferências na ordem abaixo. Pare na primeira que falhar.

| Comando | O que confere | Quando rodar | Tempo aproximado |
|---|---|---|---|
| `npm run verify` | tipos, lint, formatação, testes unitários e de contrato, OpenAPI (Spectral e oasdiff) | sempre | 1 a 2 min |
| `python validate_all.py` | matriz de rastreabilidade e hashes das fontes normativas | sempre | segundos |
| `npm run trace:check` | `@trace` dos testes contra a matriz e o contrato | sempre | segundos |
| `npm run test:integration` | API e banco reais (PostgreSQL 17 no Docker) | mudou API, banco ou migração | 3 a 6 min |
| `npm run test:e2e` | telas reais no navegador, com acessibilidade (axe) | mudou a web | 2 a 4 min |
| `npm run test:mutation` | testes de mutação do domínio (Stryker) | mudou `packages/domain` | 20 min ou mais; pode deixar para a CI |

Rodar um único arquivo de E2E: `npm run test:e2e -- tests/e2e/plans.spec.ts`.

Falha de formatação se corrige sozinha: `npm run format`.

Commit do código, separado do commit dos testes:

```bash
git add -A
git status
git commit -m "feat: o que muda para o titular, DEC-xxx (etapa verde)"
```

- Confira no `git status` que só entrou o que faz parte da mudança.
- Mensagens em português, sem acentos: `test:`, `feat:`, `fix:`, `docs:`, `chore:`.

## 5. Enviar e abrir o PR

```bash
git push -u origin nome-do-branch
gh pr create --draft --fill
```

Sem o GitHub CLI: depois do push, o GitHub mostra o link "Compare & pull request".

Na descrição do PR:

- **O que muda:** o comportamento novo, a decisão (DEC ou DC) e se há mudança normativa.
- **Testes:** o que foi rodado localmente e o resultado.

## 6. Acompanhar a CI

```bash
gh pr checks --watch
```

A CI roda 17 checagens. As que mais reprovam:

| Checagem | O que reprova |
|---|---|
| QG-002 Build | erro de tipo, lint ou formatação |
| QG-003 Unit / QG-001 Contract | teste unitário ou de contrato quebrado |
| QG-004 Integration | API ou banco; costuma ser teste que espera o formato antigo da resposta |
| QG-009 Ownership (TS-023) | operação privada sem o caso de BOLA/IDOR |
| QG-010 Mutation | teste novo de domínio fora da lista do `vitest.mutation.config.ts` ou mutante sobrevivente |
| QG-007/008 E2E | tela ou acessibilidade |
| QG-011 Traceability | `@trace` faltando ou ID inexistente na matriz |

Quando uma checagem falha:

```bash
gh run view --log-failed
```

Copie para o Claude **só o trecho do erro** (o nome do teste e as linhas do `AssertionError` ou do `error`), não o log inteiro. É mais rápido e gasta menos.

## 7. Merge e conferência da `main`

Com as 17 checagens verdes e o PR sem conflito:

```bash
gh pr ready
gh pr merge --merge --delete-branch
git checkout main
git pull
python validate_all.py
gh run list --branch main --limit 3
```

- **PR normativo** (OpenAPI, Especificação, ADR, `AGENTS.md`, matriz ou schema da matriz): o merge é sempre do mantenedor.
- Depois do merge, a CI da `main` precisa terminar verde antes do próximo PR.

## 8. Problemas comuns

| Sintoma | Causa | O que fazer |
|---|---|---|
| `apps/web/next-env.d.ts` aparece alterado depois do E2E | o build da web reescreve o arquivo | `git checkout -- apps/web/next-env.d.ts` |
| Lint acusa arquivos em `.stryker-tmp/` | sobra de um Stryker interrompido | apagar a pasta `.stryker-tmp` |
| Integração ou E2E falham ao subir o banco | Docker Desktop parado | abrir o Docker Desktop e repetir |
| `validate_all.py` falha com `source-hash-mismatch` | uma fonte normativa mudou sem o hash na matriz | pedir ao Claude a atualização da matriz |
| O push é recusado | a `main` andou | `git pull origin main`, resolver conflito se houver, rodar `verify` e repetir o push |

## 9. Como dividir o trabalho com o Claude

Frases que deixam a divisão clara:

- "Prepare o branch com os testes e o código, sem commit. Eu rodo e faço os commits."
- "Rodei o `verify` e deu este erro: (trecho). Corrija."
- "A CI reprovou no QG-004 com este erro: (trecho)."
- "Explique o que este teste está conferindo antes de eu rodar."

Mudanças normativas ficam com o Claude até você conhecer a matriz: elas mexem em arquivos grandes e em hashes de integridade.

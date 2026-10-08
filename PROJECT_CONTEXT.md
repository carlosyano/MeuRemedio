# PROJECT_CONTEXT.md

| Campo | Valor |
|---|---|
| Versão do documento | 1.3 |
| Última atualização | 08/10/2026 (DEC-028 e DEC-029: saúde técnica e senhas comprometidas) |
| Baseline descrita | Especificação 02.33 · OpenAPI 02.33.4 · ADR-001 v1.5 · AGENTS.md 1.5 · Matriz 2.1.6 |
| Commit da baseline | _preencher no merge do PR que aplica esta revisão_ |

## 1. Finalidade

Este documento fornece contexto operacional para continuidade do projeto **MeuRemedio** por desenvolvedores, revisores e agentes de IA. Não substitui as fontes normativas. Em caso de conflito, aplica-se a ordem de prevalência da seção 4.

> **Regra de entrada:** antes de propor código, testes, alterações contratuais ou decisões arquiteturais, leia integralmente `AGENTS.md`, este documento e as fontes normativas aplicáveis.

## 2. Identificação do projeto

| Campo | Valor |
|---|---|
| Projeto | MeuRemedio |
| Repositório | `https://github.com/carlosyano/MeuRemedio` |
| Branch principal | `main` |
| Fase atual | Fundação técnica Test-First em andamento (baseline 02.33.4; §12, passos 5 a 7) |
| Modelo de engenharia | Contract-First, Test-First e IA-First com aprovação humana |
| Matriz de rastreabilidade | versão `2.1.6` |
| Autorização de produção | Não concedida |
| Idioma | Código, identificadores, commits e contratos em inglês; documentação e textos de interface em português do Brasil |

## 3. Objetivo e limites do produto

O MeuRemedio é uma aplicação web individual e declaratória para gerenciamento de rotinas de medicamentos.

### 3.1 Capacidades previstas no MVP

- criação e verificação de conta, consulta e atualização do nome do perfil;
- autenticação, sessões, revogação global e recuperação de senha;
- criação, edição, consulta e exclusão lógica de planos, com confirmação de possível duplicidade;
- geração de ocorrências por horário civil;
- lembretes web e por e-mail;
- registro único de `TAKEN` ou `NOT_TAKEN`;
- histórico por período civil;
- geração, cancelamento e download de PDF privado;
- preferências de acessibilidade;
- solicitação de exclusão de conta;
- tratamento de solicitações externas de direitos e de incidentes de segurança (procedimentos operacionais, sem endpoint HTTP).

### 3.2 Limites obrigatórios

O produto não prescreve medicamentos; não valida medicamentos, interações, profissionais ou registros profissionais (do CRM informado só se valida o formato); não recomenda nem altera tratamento; não substitui profissionais de saúde ou serviços de emergência; e não inclui, no MVP, aplicativos nativos, operação offline, push, SMS, WhatsApp, cuidador, compartilhamento ou capacidades clínicas.

## 4. Fontes normativas e prevalência

A prevalência depende do assunto tratado.

| Assunto | Fonte normativa | Prevalece para |
|---|---|---|
| Superfície HTTP | `MeuRemedio_OpenAPI_02.33.4_COMPLETO.yaml` | paths, métodos, `operationId`, parâmetros, cabeçalhos, cookies, payloads, schemas, enums, códigos HTTP, `Problem.code` e segurança da API |
| Comportamento funcional | `MeuRemedio_Especificacao_Funcional_02.33.docx` | requisitos, regras de negócio, entidades, fluxos, estados de tela, histórias, critérios de aceitação, mensagens, testes sentinela e gates externos |
| Arquitetura | `ADR-001_Arquitetura_Base_MeuRemedio_v1.5.docx` | arquitetura, stack, persistência, processamento assíncrono, infraestrutura e governança arquitetural |
| Processo operacional | `AGENTS.md` (v1.3) | comportamento de agentes, desenvolvimento, quality gates, testes, rastreabilidade, segurança e aprovação humana |

### 4.1 Tratamento de conflito

A ordem acima é **por assunto**, não uma hierarquia entre documentos.

1. A OpenAPI decide o que trafega no HTTP, inclusive o código HTTP e o `code` de cada erro; a Especificação decide a mensagem ao usuário, o estado resultante e a regra de negócio. O mapeamento ERR → HTTP → `code` deve ser idêntico nos dois documentos.
2. Conflitos não resolvidos por essas regras bloqueiam a alteração e vão à decisão humana formal.
3. Nenhum agente resolve conflito normativo por suposição.

### 4.2 Documentos de apoio (subordinados às fontes normativas)

| Arquivo | Conteúdo |
|---|---|
| `docs/architecture/DATA_MODEL.md` | modelo físico e dicionário completo (17 entidades, 182 campos) |
| `docs/specifications/P0_SENTINEL_TESTS.md` | cenários e fixtures dos testes bloqueadores da fundação |
| `docs/specifications/performance-profile.v1.yaml` | PerformanceProfile PP-001 v1 (aprovado como provisório em 04/10/2026) |
| `docs/operations/RIGHTS_AND_INCIDENTS.md` | procedimentos de RF-011 e RF-012 |
| `.github/CODEOWNERS` | responsáveis por área protegida (interino) |

## 5. Inventário crítico do repositório

```text
.github/
├── CODEOWNERS
└── workflows/
    └── traceability-validation.yml

docs/
├── architecture/DATA_MODEL.md
├── operations/RIGHTS_AND_INCIDENTS.md
└── specifications/
    ├── P0_SENTINEL_TESTS.md
    └── performance-profile.v1.yaml

ADR-001_Arquitetura_Base_MeuRemedio_v1.5.docx
AGENTS.md
MeuRemedio_Especificacao_Funcional_02.33.docx
MeuRemedio_OpenAPI_02.33.4_COMPLETO.yaml
PROJECT_CONTEXT.md
requirements-validation.txt
traceability-check.py
traceability-matrix.schema.json
traceability-matrix.yaml
validate_all.py
```

Arquivos `.txt` usados como cópia de conteúdo não são fontes normativas e não devem ser consumidos pela automação. As versões anteriores (OpenAPI 02.33.3 e anteriores, Especificação 02.32, ADR v1.4) não são fontes normativas.

## 6. Baseline de rastreabilidade

A matriz `traceability-matrix.yaml`, versão `2.1.3`, contém:

| Catálogo | Quantidade |
|---|---:|
| Requisitos funcionais, RF | 12 |
| Requisitos não funcionais, RNF | 16 |
| Regras de negócio, RN | 19 |
| Entidades, ENT | 17 |
| Fluxos, FL | 5 |
| Estados de tela, TL | 8 |
| Histórias de usuário, US | 8 |
| Critérios de aceitação, CA | 18 |
| Erros, ERR | 15 |
| Testes sentinela, TS | 44 |
| Decisões, DEC | 25 |
| Recomendações aprovadas, Q | 4 |
| Gates externos, GX | 6 |
| Operações OpenAPI | 27 |

### 6.1 Cadeia de rastreabilidade esperada

```text
RF/RNF/RN → CA/ERR → TS e testes executáveis → operationId → controller/handler/serviço → evidência de CI
```

A matriz representa a baseline documental. A existência de um caminho planejado de teste não prova que o teste foi implementado ou executado.

## 7. Validação automatizada

### 7.1 Dependências e comando único

```bash
python -m pip install -r requirements-validation.txt
python validate_all.py          # Windows (PowerShell): python validate_all.py
```

Use a versão de Python definida em `.github/workflows/traceability-validation.yml`. O resultado esperado é `"status": "PASS"` e os relatórios em `validation-report/` (`.json` e `.md`).

### 7.2 O que o validador verifica

1. estrutura da matriz contra `traceability-matrix.schema.json`;
2. hashes SHA-256 de `AGENTS.md`, da OpenAPI, da Especificação e da ADR, lidos de `generated_from.source_integrity`;
3. conjunto de operações da matriz contra os `operationId` da OpenAPI;
4. igualdade entre `catalog_completeness`, catálogos vivos e visões `*_source`;
5. existência de todas as referências `x-traceability`;
6. cobertura de ownership (TS-023) em toda operação privada;
7. existência de artefato de teste planejado para todo TS.

`validate_all.py` exige o arquivo `MeuRemedio_OpenAPI_02.33.4_COMPLETO.yaml` no diretório; ao trocar a versão da OpenAPI, atualize a constante `OPENAPI` e a matriz.

### 7.3 Significado de PASS

`PASS` comprova consistência estrutural, integridade das fontes e rastreabilidade documental. **Não** comprova que regras foram implementadas, que controles de segurança funcionam, que testes existem, que o desempenho foi atingido nem que gates de produção foram encerrados.

## 8. CI e governança do repositório

Workflow: `.github/workflows/traceability-validation.yml` · nome: `Validate traceability baseline` · check: `Schema and semantic validation`. Executa em pull requests e pushes relevantes, instala dependências, verifica artefatos obrigatórios, roda os validadores, publica o relatório e falha se a validação não passar.

> **Atenção:** se o workflow lista os nomes dos artefatos obrigatórios, atualize-o para os nomes da seção 5.

### 8.1 Proteção da `main` (decisão: opção C, aprovada em 04/10/2026)

O ruleset com pull request, uma aprovação, check obrigatório e bloqueio de force push **não é aplicado a repositório privado no plano atual**. Com um único mantenedor, a regra de "uma aprovação" também é inviável, pois o autor não aprova o próprio PR. Opções:

| Opção | Efeito |
|---|---|
| A. Plano GitHub com rulesets em repositório privado, mais segundo revisor | proteção completa; custo e pessoa adicional |
| B. Tornar o repositório público | ruleset aplicável; exige revisão de conteúdo antes |
| C. Interina: PR obrigatório e check obrigatório sem contagem de aprovações; merge apenas pelo mantenedor; agentes de IA sem permissão de merge | reduz o risco com um mantenedor; registrar como exceção formal |

**Decisão de 04/10/2026:** adotada a opção C, como exceção formal enquanto houver um único mantenedor: toda mudança entra por pull request com o check verde; não há push direto na `main`; agentes de IA não têm permissão de merge; o mantenedor confere o check antes de cada merge. Reavaliar (opção A) quando houver um segundo desenvolvedor.

**Ajuste de 08/10/2026 (decisão do mantenedor):** agentes de IA podem fazer o merge de PRs **sem mudança normativa** (código, testes e documentação de apoio), depois de conferir que o CI está verde, que o PR não tem conflito e que `validate_all.py` e `npm run verify` passam, e verificando a `main` depois do merge. PRs que alteram a Especificação, a OpenAPI, a ADR, o `AGENTS.md`, a matriz ou o seu schema continuam com merge pelo mantenedor, salvo autorização explícita para aquele PR. Procedimento em `CLAUDE.md` ("Fluxo de trabalho autônomo").

## 9. Stack, arquitetura e toolchain

- **Frontend:** Next.js, React, TypeScript strict, Tailwind CSS, shadcn/ui, Radix UI, React Hook Form, Zod, TanStack Query.
- **Backend:** NestJS, TypeScript strict, adaptador Fastify quando compatível com o contrato e os requisitos (critério: o spike S1 passar os testes de contrato com Fastify).
- **Dados e assíncrono:** PostgreSQL 17, Drizzle ORM, migrações SQL explícitas, pg-boss, Outbox transacional.
- **Toolchain (ADR OA-010, aprovado em 04/10/2026):** Node.js 24 LTS em `.nvmrc`, npm com `package-lock.json` e `npm ci`; versões das bibliotecas fixadas por lockfile e registradas em `docs/architecture/TOOLCHAIN.md` no início da fundação.
- **Infraestrutura-alvo:** AWS (RDS, S3, SES, KMS, Secrets Manager, CloudWatch), Terraform, `sa-east-1`, ECS Fargate, GitHub Actions com OIDC.
- **Arquitetura lógica:** monólito modular; web, API e worker separáveis; módulos `identity`, `plans`, `occurrences`, `responses`, `reminders`, `history`, `exports`, `privacy`, `audit` e `platform`; nenhuma regra de negócio normativa duplicada no frontend.

## 10. Invariantes técnicas essenciais

- OpenAPI contract-first; `operationId` é o identificador canônico;
- ownership server-side em toda operação privada, com 404 e sem enumeração;
- `ETag`/`If-Match` na escrita de plano; `expected_row_version` não integra a API;
- `Idempotency-Key` nas 7 mutações definidas (`createAccount`, `createPlan`, `updatePlan`, `createResponse`, `createExport`, `requestAccountDeletion`, `revokeAllSessions`);
- CSRF: cookie `mr_csrf` + `X-CSRF-Token` + validação de `Origin` nas 11 mutações autenticadas;
- constraints e transações no PostgreSQL; `Clock` injetável e fuso IANA;
- Outbox no mesmo commit da alteração de domínio;
- logs minimizados, sem segredos, e-mail completo ou conteúdo de saúde;
- testes contra PostgreSQL real quando a persistência for relevante.

## 11. Estado atual

| Área | Estado |
|---|---|
| Baseline documental 02.33 / 02.33.3 / v1.5 / AGENTS 1.3 | Revisada e **aprovada em 04/10/2026** pelo mantenedor (interino); parecer jurídico e de privacidade pendente |
| Revisão 02.33.4 / AGENTS 1.5 / matriz 2.1.4 | Aprovada em 06/10/2026 pelo mantenedor (interino) no PR #8 (DEC-026) |
| DEC-027 / matriz 2.1.5 | Aprovada no PR #11 (08/10/2026) |
| DEC-028, DEC-029 / matriz 2.1.6 | Escolhas do mantenedor em 08/10/2026; aprovação formal no PR desta revisão |
| Matriz 2.1.6 e schema | Validadas (`PASS`) com o schema real e no CI |
| Fundação do monorepo | Em andamento: estrutura, toolchain e CI; PostgreSQL 17 com Testcontainers e migrações `0001_core` e `0002_platform` (ENT-001, ENT-004 a ENT-008, ENT-011 e ENT-012) com schemas Drizzle por módulo; `openapi:lint` e `openapi:diff`; Schemathesis pendente |
| Implementação funcional | Iniciada: tempo civil (`resolveCivilInstant`) e gerador de ocorrências com o horizonte da DEC-027 (`generateOccurrencesForHorizon`); esqueleto HTTP contract-first (spike S1: NestJS 12 + Fastify, `getHealth`, Problem e `X-Correlation-ID`) |
| Testes sentinela | Parciais: TS-040 (estático) e TS-024 (puro e integração) verdes; base de banco de TS-001, TS-015, TS-016, TS-017 e TS-038 verde; TS-008, TS-023 e os testes HTTP pendentes (requerem a API); estado em `docs/specifications/P0_SENTINEL_TESTS.md` |
| Evidências de segurança dinâmica e de desempenho | Não produzidas |
| GX-001 a GX-006 | Abertos (responsável interino `@carlosyano`; reatribuir) |
| Produção | Bloqueada |

## 12. Próximo marco

Decisões da seção 14 aprovadas em 04/10/2026.

**Fundação técnica Test-First**, na ordem:

1. estrutura do monorepo (`apps/api`, `apps/web`, `apps/worker`, `packages/contract`, `packages/domain`, `packages/shared`, `packages/testkit`);
2. `packages/contract` com a OpenAPI normativa; `.nvmrc`, npm, TypeScript strict, lint e formatação;
3. `docs/architecture/TOOLCHAIN.md` com as versões fixadas;
4. PostgreSQL 17 e Testcontainers;
5. infraestrutura de testes de contrato (Spectral, oasdiff, Schemathesis);
6. materializar os testes bloqueadores (vermelhos): **TS-001, TS-008, TS-015, TS-016, TS-017, TS-023, TS-024, TS-038, TS-040** (os cinco P0 do AGENTS §11 mais os exigidos por QG-004 e QG-009), conforme `docs/specifications/P0_SENTINEL_TESTS.md`;
7. schema Drizzle e migrações a partir de `DATA_MODEL.md`;
8. a menor fundação que torne os testes verdes;
9. só então os primeiros requisitos funcionais (sugestão: `identity` → `plans` → `occurrences` → `responses` → `reminders` → `history` → `exports` → `privacy`).

## 13. Regras para qualquer novo agente

O agente deve: ler `AGENTS.md`; ler este documento; executar `python validate_all.py` antes de modificar a baseline; identificar RF, RNF, RN, CA, ERR, TS e `operationId` aplicáveis; gerar ou atualizar testes antes da implementação; preservar a OpenAPI; registrar rastreabilidade nos testes; revalidar; apresentar evidências objetivas; e interromper diante de conflito normativo.

O agente não deve: inventar requisitos, critérios, testes ou endpoints; alterar a superfície HTTP para facilitar a implementação; tratar a matriz como prova de teste executado; marcar testes como aprovados sem evidência; alterar hashes para mascarar mudança não revisada; incluir dados reais de saúde ou credenciais; ou declarar prontidão para produção com GX-001 a GX-006 abertos.

## 14. Registro de aprovação humana (04/10/2026)

Aprovador: Carlos Yano (`@carlosyano`), mantenedor, **em caráter interino**. A aprovação cobre o desenvolvimento e **não substitui** o parecer jurídico e de privacidade exigido para dados reais e produção.

| Item | Decisão |
|---|---|
| DEC-011 a DEC-025 (Especificação 02.33) | Aprovadas |
| ADR OA-008 a OA-011 | Aprovadas |
| TS-038 | Manter `401` no replay de `revokeAllSessions` e `requestAccountDeletion` após a revogação da própria sessão |
| Proteção da `main` | Opção C (seção 8.1) |
| Responsáveis (GX e `CODEOWNERS`) | `@carlosyano` interino para desenvolver; designar jurista ou DPO antes de dados reais ou produção |
| `PerformanceProfile` | PP-001 v1 aprovado como provisório; recalibrar após os spikes de infraestrutura |
| Retenção de `audit_events` | Padrão provisório de 180 dias configuráveis; definitivo em GX-003 |
| Convenção de idioma (seção 2) | Aprovada |
| GAP-008 e GAP-009 (decisão "A e A", 04/10/2026) | Removido o 410 de `createResponse`; `X-Correlation-ID` exigido em toda resposta (OpenAPI 02.33.3) |
| GAP-010 / DEC-026 (decisão de 06/10/2026, aprovação no PR) | Falha inesperada documentada: ERR-016 `INTERNAL_ERROR` (500) e 503 `DEPENDENCY_UNAVAILABLE` em todas as operações (OpenAPI 02.33.4, matriz 2.1.4, AGENTS.md 1.5) |
| DEC-027 (texto confirmado em 08/10/2026, aprovação no PR) | Horizonte de geração: da data civil atual (ou `start_date`) até + 30 dias, inclusive, limitado a `end_date`; horários do dia já vencidos nascem `NO_RESPONSE` (matriz 2.1.5) |
| DEC-028 e DEC-029 (escolhas de 08/10/2026, aprovação no PR) | `getHealth`: desvio contra o relógio do PostgreSQL, `DEGRADED` e `DOWN` com 503; lista de senhas comprometidas: SecLists top 100.000 (MIT), comparação exata (matriz 2.1.6) |
| Papel de privacidade (08/10/2026) | Haverá um DPO designado; ele substitui a alternativa "jurista ou DPO" das pendências |

### 14.1 Governança de alterações

- **Documentais:** justificativa, revisão humana, atualização da matriz e dos hashes, atualização dos testes, `python validate_all.py` e PR com o relatório.
- **Arquiteturais:** ADR nova ou atualização formal da vigente.
- **Contratuais:** atualização prévia da OpenAPI e dos testes de contrato. Ao trocar a versão do arquivo, atualizar também `validate_all.py`, o workflow e a matriz.

## 15. Pendências operacionais

- reatribuir `@carlosyano` (interino) aos responsáveis reais em `CODEOWNERS` e nos GX;
- materializar os arquivos de teste planejados e registrar evidências e datas na matriz;
- recalibrar o `PerformanceProfile` após os spikes de infraestrutura;
- implementar os quality gates QG-001 a QG-012 na pipeline;
- encerrar GX-001 a GX-006 antes de produção;
- designar o DPO e substituir o responsável interino antes de dados reais ou produção;
- reavaliar a proteção da `main` quando houver um segundo desenvolvedor (seção 8.1).

## 16. Checklist de retomada

- [ ] confirmar a branch e o commit em uso; `git pull`;
- [ ] ler alterações recentes em `AGENTS.md` e neste documento;
- [ ] executar `python validate_all.py` e confirmar `PASS`;
- [ ] selecionar um escopo rastreável e criar uma branch;
- [ ] gerar testes antes da implementação;
- [ ] executar os gates aplicáveis;
- [ ] abrir pull request com evidências.

## 17. Prompt de retomada para outro agente

```text
Você atuará no projeto MeuRemedio.

Antes de propor ou alterar código, leia integralmente:
1. AGENTS.md
2. PROJECT_CONTEXT.md
3. traceability-matrix.yaml
4. MeuRemedio_OpenAPI_02.33.4_COMPLETO.yaml
5. MeuRemedio_Especificacao_Funcional_02.33.docx
6. ADR-001_Arquitetura_Base_MeuRemedio_v1.5.docx
7. docs/specifications/P0_SENTINEL_TESTS.md e docs/architecture/DATA_MODEL.md

Execute `python validate_all.py` e confirme PASS.

Adote Contract-First, Test-First e IA-First com aprovação humana. Não invente requisitos, endpoints ou decisões. Preserve RF, RNF, RN, CA, ERR, TS e operationId. Diante de conflito normativo, interrompa a alteração e solicite decisão humana.

Estado inicial: baseline documental 02.33 aprovada em 04/10/2026 pelo mantenedor (interino), com parecer jurídico e de privacidade pendente; matriz 2.1.1; implementação e testes executáveis não iniciados; produção bloqueada por GX-001 a GX-006.

Primeira tarefa: analisar o repositório e propor o plano Test-First da fundação técnica, sem implementar funcionalidade antes dos testes correspondentes.
```

## 18. Critério de conclusão da fase documental

- `python validate_all.py` retorna `PASS`;
- o workflow de rastreabilidade retorna sucesso e publica o relatório;
- as fontes normativas e seus hashes estão alinhados;
- as decisões da seção 14 foram aprovadas por responsável humano (concluído em 04/10/2026, em caráter interino).

Isso não conclui a fundação técnica, os testes executáveis nem a prontidão de produção.

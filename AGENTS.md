# AGENTS.md

## Política operacional para agentes de desenvolvimento, testes e integração contínua

**Versão:** 1.11  
**Status:** Baseline operacional aprovada  
**Baseline contratual:** OpenAPI 02.33.10  
**Baseline funcional:** Especificação Funcional 02.33  
**Baseline arquitetural:** ADR-001 v1.5  
**Última atualização:** 27/10/2026

---

## 1. Finalidade

Este documento estabelece os requisitos normativos aplicáveis aos agentes de inteligência artificial, aos processos de desenvolvimento e testes, às revisões de código e às pipelines de integração contínua do projeto MeuRemedio.

São requisitos obrigatórios:

- rastreabilidade verificável e automatizável;
- aderência integral ao contrato OpenAPI vigente;
- conformidade com a baseline funcional e arquitetural;
- geração e validação dos testes antes da implementação correspondente;
- produção de evidências objetivas de conformidade;
- execução dos controles de segurança definidos nesta política;
- aprovação humana nos casos previstos neste documento.

---

## 2. Prevalência das fontes normativas

A prevalência deverá ser determinada de acordo com o assunto tratado.

### 2.1 OpenAPI 02.33.10

A OpenAPI 02.33.10 deverá prevalecer para:

- rotas;
- métodos HTTP;
- `operationId`;
- payloads;
- schemas;
- enums;
- cabeçalhos;
- códigos HTTP;
- contratos de erro.

### 2.2 Especificação Funcional 02.33

A Especificação Funcional 02.33 deverá prevalecer para:

- regras de negócio;
- requisitos funcionais, identificados por RF;
- requisitos não funcionais, identificados por RNF;
- estados;
- fluxos;
- critérios de aceitação, identificados por CA;
- testes sentinela, identificados por TS;
- mensagens funcionais.

### 2.3 ADR-001 v1.5

A ADR-001 v1.5 deverá prevalecer para:

- arquitetura;
- stack tecnológica;
- fronteiras de domínio;
- padrões técnicos;
- governança de engenharia;
- decisões de infraestrutura e operação.

### 2.4 Tratamento de conflitos

Quando houver conflito entre documentos, deverá ser aplicada a seguinte regra:

1. a OpenAPI deverá prevalecer nos aspectos da superfície HTTP;
2. a Especificação Funcional deverá prevalecer nos aspectos funcionais;
3. a ADR deverá prevalecer nos aspectos arquiteturais e técnicos;
4. conflitos que não puderem ser resolvidos por essa regra deverão bloquear a alteração e ser submetidos à decisão humana formal.

---

## 3. Compatibilidade documental

Para a superfície HTTP, deverá ser utilizado exclusivamente o seguinte contrato:

```text
MeuRemedio_OpenAPI_02.33.10_COMPLETO.yaml
```

Reproduções históricas da OpenAPI (02.32, 02.33, 02.33.1, 02.33.2, 02.33.3, 02.33.4, 02.33.5, 02.33.6, 02.33.7, 02.33.8 e 02.33.9) não deverão ser utilizadas como fonte normativa para:

- implementação;
- geração de código;
- geração de clientes;
- documentação Swagger;
- testes de contrato;
- validações automatizadas.

A pipeline deverá verificar a versão do contrato antes de executar geração, implementação ou testes de API.

---

## 4. Modelo de desenvolvimento

O desenvolvimento deverá observar a seguinte sequência normativa:

1. validar o contrato OpenAPI vigente;
2. identificar os requisitos funcionais e não funcionais aplicáveis;
3. identificar as decisões arquiteturais aplicáveis;
4. gerar os testes correspondentes;
5. executar os testes e registrar o estado inicial esperado;
6. implementar a menor alteração necessária;
7. reexecutar os testes;
8. refatorar sem alterar o comportamento normativo;
9. executar integralmente os quality gates aplicáveis;
10. submeter a alteração à revisão humana exigida.

A implementação não deverá ser iniciada antes da geração dos testes correspondentes, salvo quando a atividade tiver como finalidade exclusiva a criação da fundação técnica necessária à execução dos próprios testes.

---

## 5. Stack autorizada

### 5.1 Frontend

Deverão ser utilizadas as seguintes tecnologias:

- Next.js;
- React;
- TypeScript em modo `strict`;
- Tailwind CSS;
- shadcn/ui;
- Radix UI;
- React Hook Form;
- Zod;
- TanStack Query.

### 5.2 Backend

Deverão ser utilizadas as seguintes tecnologias:

- NestJS;
- adaptador Fastify, quando compatível com o contrato e os requisitos;
- TypeScript em modo `strict`.

### 5.3 Persistência

Deverão ser utilizadas as seguintes tecnologias e práticas:

- PostgreSQL;
- Drizzle ORM;
- migrações SQL explícitas, versionadas e revisadas.

### 5.4 Processamento assíncrono

Deverão ser utilizados:

- pg-boss;
- padrão Outbox transacional.

### 5.5 Testes

Deverão ser utilizados, conforme o tipo de validação:

- Vitest;
- Testcontainers;
- Schemathesis;
- Spectral;
- oasdiff;
- Playwright;
- axe;
- fast-check;
- Stryker.

#### 5.5.1 Cobertura mínima

A cobertura deverá ser medida automaticamente pela pipeline de integração contínua.

**Critérios mínimos de aprovação**

- linhas (`lines`) iguais ou superiores a 80%;
- funções (`functions`) iguais ou superiores a 80%;
- instruções (`statements`) iguais ou superiores a 80%;
- ramificações (`branches`) iguais ou superiores a 75%.

**Critérios de não conformidade**

- qualquer métrica abaixo do limite estabelecido;
- redução não aprovada da cobertura existente;
- exclusão de arquivos ou componentes do cálculo sem justificativa formal;
- exclusão de componentes críticos de domínio com a finalidade de elevar artificialmente os indicadores.

Os limites deverão ser aplicados ao escopo efetivamente mantido pelo projeto. Exceções deverão ser documentadas, justificadas e aprovadas pelos responsáveis designados.

### 5.6 Observabilidade

A instrumentação deverá utilizar OpenTelemetry.

Toda operação HTTP deverá produzir telemetria suficiente para diagnóstico, auditoria e investigação operacional.

**Campos mínimos obrigatórios**

- `correlation_id`;
- `operationId`;
- timestamp;
- duração da operação;
- código de status HTTP;
- versão da aplicação.

Toda exceção deverá registrar, quando aplicável e sem exposição de dados proibidos:

- `correlation_id`;
- `operationId`;
- classificação da exceção;
- stack trace sanitizada.

**Critérios de não conformidade**

- ausência de `correlation_id`;
- ausência de contexto suficiente para investigação;
- telemetria inconsistente ou incompleta;
- registro de dados proibidos pela seção 14.2;
- impossibilidade de exportação pelo padrão OpenTelemetry.

### 5.7 Integração contínua

A automação de CI/CD deverá utilizar GitHub Actions, salvo decisão arquitetural formal em sentido diverso.

Tecnologias adicionais não deverão ser introduzidas sem justificativa técnica documentada e, quando alterarem a baseline, sem decisão arquitetural formal.

### 5.8 Toolchain e ambientes

- Node.js 24 (LTS) fixado em `.nvmrc`, com reavaliação do Node 26 após sua promoção a LTS (ADR-001 v1.5, OA-010);
- npm com `package-lock.json` versionado e `npm ci` na pipeline;
- PostgreSQL 17 no RDS e nos testes (`postgres:17` via Testcontainers);
- versões das bibliotecas da stack fixadas por lockfile e registradas em `docs/architecture/TOOLCHAIN.md` no início da fundação técnica;
- o fuso IANA depende da versão de tzdata da plataforma, que deverá ser fixada e coberta pelo TS-024.

---

## 6. Invariantes arquiteturais

A estrutura física do repositório poderá variar, desde que preserve integralmente os seguintes invariantes:

- separação entre aplicação web, API e workers;
- monólito modular;
- fronteiras explícitas de domínio;
- abordagem OpenAPI contract-first;
- rastreabilidade automatizável;
- testes compartilháveis e reproduzíveis;
- isolamento entre domínio, aplicação e infraestrutura;
- ausência de regras de negócio duplicadas no frontend.

A CI deverá validar os invariantes que puderem ser verificados automaticamente. Os demais deverão ser verificados por revisão arquitetural.

### 6.1 Estrutura de referência

A organização inicial poderá seguir a estrutura abaixo:

```text
apps/
├── api/
├── web/
└── worker/

packages/
├── contract/
├── domain/
├── shared/
└── testkit/

docs/
├── specifications/
├── architecture/
└── api/

tools/
├── generators/
└── scripts/
```

A estrutura de referência não substituirá os invariantes arquiteturais definidos nesta política.

---

## 7. Fronteiras de domínio

A implementação deverá preservar as seguintes fronteiras:

- `identity`;
- `plans`;
- `occurrences`;
- `responses`;
- `reminders`;
- `history`;
- `exports`;
- `privacy`;
- `audit`;
- `platform`.

As preferências de acessibilidade deverão permanecer sob a responsabilidade do domínio `identity` e não deverão constituir módulo principal independente sem revisão arquitetural.

Cada módulo deverá separar, de forma verificável, as seguintes responsabilidades:

- aplicação;
- domínio;
- infraestrutura;
- testes.

Dependências entre módulos deverão respeitar as fronteiras definidas na ADR. Acesso direto à persistência de outro módulo não deverá ser introduzido sem interface ou decisão explícita.

---

## 8. OpenAPI contract-first

A OpenAPI deverá ser tratada como fonte normativa da superfície HTTP.

Não deverão ser aprovadas alterações que:

- criem endpoint não documentado;
- criem payload não documentado;
- alterem schema sem atualização contratual;
- alterem enum sem atualização contratual;
- alterem código HTTP sem atualização contratual;
- alterem cabeçalho sem atualização contratual;
- alterem requisito de segurança sem atualização contratual;
- produzam documentação divergente do contrato.

Toda implementação HTTP deverá ser aprovada pelas validações de contrato definidas neste documento.

### 8.1 `operationId` canônico

O `operationId` definido na OpenAPI deverá ser considerado o identificador canônico da operação HTTP.

Deverão manter associação explícita e verificável com o `operationId`:

- controllers;
- handlers;
- adaptadores HTTP;
- testes de contrato;
- documentação técnica;
- registros de rastreabilidade.

Exemplos de identificadores canônicos:

- `createAccount`;
- `verifyAccount`;
- `createSession`;
- `getCurrentAccount`;
- `updateCurrentAccount`;
- `createPlan`;
- `updatePlan`;
- `createResponse`;
- `createExport`;
- `revokeAllSessions`.

DTOs e tipos internos poderão seguir convenções próprias, desde que implementem integralmente os schemas normativos.

---

## 9. Rastreabilidade

Toda implementação deverá manter rastreabilidade verificável e automatizável com os seguintes artefatos, quando aplicáveis:

- RF;
- CA;
- TS;
- `operationId`.

O mecanismo técnico poderá utilizar:

- comentários estruturados;
- metadados;
- decorators;
- anotações `@trace`;
- atributos de teste;
- manifestos de rastreabilidade.

Exemplo de identificadores:

```text
RF-003
CA-006
TS-015
operationId: updatePlan
```

A CI deverá reprovar:

- requisito implementado sem teste associado;
- teste sem requisito ou cenário associado;
- operação HTTP sem `operationId` associado;
- referência a identificador inexistente;
- divergência entre a matriz de rastreabilidade e os artefatos executáveis.

---

## 10. Estratégia de testes

Os testes deverão ser planejados e executados na seguinte ordem lógica:

1. testes de contrato;
2. testes unitários;
3. testes de integração;
4. testes de API;
5. testes end-to-end;
6. testes de acessibilidade;
7. testes de segurança;
8. testes de mutação, quando aplicáveis ao escopo.

A ordem física dos jobs poderá ser otimizada para paralelismo, desde que as dependências e os critérios bloqueadores sejam preservados.

---

## 11. Testes sentinela bloqueadores

O conjunto mínimo bloqueador da fundação técnica deverá conter:

- TS-001;
- TS-015;
- TS-024;
- TS-038;
- TS-040.

Adicionalmente, o QG-004 exige TS-016 e TS-017 e o QG-009 exige TS-008 e TS-023 já na fundação técnica. O conjunto efetivo bloqueador da fundação é, portanto:

- TS-001, TS-008, TS-015, TS-016, TS-017, TS-023, TS-024, TS-038 e TS-040.

Os cenários e as fixtures destes testes estão em `docs/specifications/P0_SENTINEL_TESTS.md`.

Os demais testes sentinela deverão tornar-se bloqueadores à medida que o respectivo domínio ou requisito for incluído no escopo da entrega.

Nenhum requisito deverá ser considerado concluído sem a cobertura dos testes sentinela associados.

Os testes sentinela não deverão ser removidos, ignorados ou marcados como instáveis sem justificativa formal, evidência e aprovação humana.

---

## 12. Concorrência

Na OpenAPI 02.33.10, as operações abaixo deverão utilizar concorrência otimista:

```http
PUT /plans/{plan_id}
POST /plans/{plan_id}/status-changes
```

O contrato deverá utilizar:

- `ETag` nas respostas aplicáveis;
- `If-Match` nas operações de atualização e de mudança de situação do plano (DEC-036).

Deverão ser observadas as seguintes regras:

- `row_version` deverá ser gerenciado pela persistência;
- `row_version` poderá ser apresentado em representações de leitura;
- o cliente não deverá enviar `row_version` em payloads de escrita;
- `expected_row_version` não deverá integrar o contrato HTTP;
- divergências de versão deverão retornar `409 VERSION_CONFLICT`;
- a persistência deverá impedir sobrescrita silenciosa.

### 12.1 Política de migrações

Toda alteração estrutural do banco de dados deverá possuir migração versionada.

**Requisitos obrigatórios**

- armazenamento da migração no controle de versão;
- execução validada em banco vazio;
- execução validada sobre banco existente representativo;
- compatibilidade com execução automatizada pela pipeline;
- revisão humana obrigatória;
- estratégia documentada de rollback sempre que tecnicamente viável.

**Critérios de não conformidade**

- alteração manual do schema fora de migração versionada;
- divergência entre o conjunto de migrações e o schema efetivo;
- migração não executável pela pipeline;
- alteração destrutiva sem justificativa formal;
- rollback necessário sem estratégia documentada.

Alterações destrutivas deverão apresentar análise de impacto, plano de migração e aprovação humana formal. Alterações manuais do schema em produção não deverão ser realizadas.

---

## 13. Idempotência

A utilização de `Idempotency-Key` deverá ser obrigatória nas seguintes operações:

```http
POST /accounts
POST /plans
PUT /plans/{plan_id}
POST /plans/{plan_id}/status-changes
POST /occurrences/{occurrence_id}/responses
POST /exports
POST /account-deletions
POST /sessions/revocations
```

Deverão ser observadas as seguintes regras:

- mesma chave e mesmo payload deverão retornar o resultado lógico original;
- mesma chave e payload divergente deverão retornar `409 IDEMPOTENCY_KEY_REUSED`;
- a chave, o hash da requisição e o snapshot da resposta deverão ser persistidos conforme a política de retenção;
- retries não deverão produzir efeitos funcionais duplicados.

### 13.1 Sessões

A operação abaixo não deverá ser criada ou restaurada:

```http
DELETE /sessions
```

A revogação global de sessões deverá ocorrer exclusivamente por:

```http
POST /sessions/revocations
```

A operação deverá exigir:

- sessão autenticada;
- reautenticação;
- `Idempotency-Key`.

### 13.2 Ownership

Toda operação privada deverá aplicar ownership na camada de aplicação e na camada de persistência.

Validações exclusivamente no frontend não deverão ser consideradas controle de autorização.

A tentativa de acesso a recurso pertencente a outro titular deverá retornar:

```http
404 RESOURCE_NOT_FOUND
```

A CI e os testes de integração deverão produzir evidência da aplicação do ownership.

### 13.3 Proteção contra BOLA e IDOR

Nenhuma rota privada deverá ser aprovada sem cobertura automatizada de acesso horizontal.

O cenário mínimo deverá contemplar a tentativa de acesso de um titular a recurso pertencente a outro titular.

O resultado esperado deverá ser:

```http
404 RESOURCE_NOT_FOUND
```

O TS-023 deverá ser executado para o conjunto de rotas privadas definido no escopo.

### 13.4 Tempo civil e DST

As seguintes regras deverão ser implementadas sem alteração semântica:

- horário civil inexistente deverá avançar para o primeiro instante válido;
- horário civil ambíguo deverá utilizar o primeiro instante cronológico;
- instantes deverão ser persistidos em UTC;
- o fuso da conta deverá utilizar identificador IANA;
- regras temporais deverão utilizar `Clock` injetável;
- o fuso da conta deverá permanecer imutável no MVP.

Qualquer alteração dessas regras dependerá de nova decisão arquitetural e atualização da baseline funcional.

---

## 14. Segurança

### 14.1 Controles mínimos

A implementação deverá assegurar:

- TLS 1.3 em trânsito;
- criptografia em repouso;
- `correlation_id` nas respostas e registros aplicáveis;
- proteção CSRF nas mutações autenticadas (cookie `mr_csrf` com `X-CSRF-Token` e validação de `Origin`, conforme ADR-001 v1.5 OA-008 e OpenAPI 02.33.10);
- ownership validado no servidor;
- menor privilégio;
- gestão segura de segredos;
- análise estática e de dependências;
- trilha de auditoria para eventos críticos.

### 14.2 Dados proibidos em logs

Não deverão ser registrados:

- senhas;
- tokens;
- segredos;
- e-mails completos;
- conteúdo de saúde;
- PDFs;
- documentos clínicos;
- credenciais;
- payloads integrais que contenham dados pessoais sensíveis.

Exceções não deverão ser introduzidas sem avaliação formal de Segurança e Privacidade.

---

## 15. Dados utilizados por agentes de IA

Agentes de IA não deverão utilizar:

- dados de produção;
- credenciais reais;
- dados reais de saúde;
- dados pessoais reais;
- documentos clínicos reais;
- segredos operacionais.

São considerados artefatos aceitáveis:

- mocks;
- fixtures;
- dados sintéticos;
- dados anonimizados, quando a anonimização tiver sido validada.

Dados sintéticos deverão ser identificados como tais e não deverão reproduzir informações reais de titulares.

---

## 16. Geração de código e artefatos

A geração automatizada deverá observar a seguinte sequência:

1. validar a OpenAPI;
2. identificar requisitos e rastreabilidade;
3. gerar ou atualizar testes;
4. executar os testes aplicáveis;
5. gerar ou alterar a implementação;
6. atualizar a documentação técnica;
7. atualizar a pipeline, quando necessário;
8. executar os quality gates;
9. submeter a alteração à revisão humana aplicável.

Nenhum agente deverá alterar comportamento normativo sem atualização da fonte correspondente e aprovação formal.

### 16.1 Feature flags

Funcionalidades incompletas, experimentais ou submetidas a liberação gradual deverão ser protegidas por feature flags.

**Requisitos obrigatórios**

- ativação controlada por configuração;
- desativação sem necessidade de novo deploy, quando tecnicamente aplicável;
- documentação da finalidade, do responsável e do estado padrão;
- definição do público ou ambiente de ativação;
- estratégia e prazo de remoção após estabilização.

**Critérios de não conformidade**

- utilização de código morto como mecanismo de rollout;
- dependência de branches de longa duração para ativação funcional;
- utilização de comentários para desativação de comportamento;
- flag sem responsável ou plano de remoção;
- utilização de feature flag para contornar teste, rastreabilidade, contrato ou controle de segurança.

Feature flags não deverão substituir testes, rastreabilidade, validações de contrato ou controles de segurança.

---

## 17. Critérios de aprovação

A aprovação de uma entrega estará condicionada ao atendimento integral dos critérios aplicáveis:

- conformidade com a OpenAPI vigente;
- compilação TypeScript bem-sucedida;
- lint aprovado;
- testes de contrato aprovados;
- testes unitários aprovados;
- testes de integração aprovados;
- testes de API aprovados;
- testes end-to-end aprovados;
- testes de acessibilidade aprovados, quando aplicáveis;
- testes de segurança aprovados;
- rastreabilidade completa;
- documentação atualizada;
- revisão humana concluída;
- aprovações de CODEOWNERS obtidas quando exigidas.

A entrega deverá ser considerada não conforme se qualquer critério aplicável permanecer pendente, falho ou sem evidência.

---

## 18. Condições de bloqueio

A execução deverá ser interrompida e submetida à decisão humana quando ocorrer qualquer uma das seguintes condições:

- conflito entre a implementação e a OpenAPI;
- conflito entre a implementação e a Especificação Funcional;
- conflito entre a implementação e a ADR;
- comportamento funcional não definido;
- risco relevante à LGPD, à segurança ou à privacidade;
- inclusão de funcionalidade clínica;
- alteração de regra normativa;
- impossibilidade de produzir evidência verificável;
- falha em quality gate bloqueador.

A ausência de definição não deverá ser suprida por suposição do agente.

---

## 19. Testes de contrato

Toda alteração na superfície HTTP deverá executar:

- Spectral;
- Schemathesis;
- oasdiff.

A pipeline deverá reprovar alterações que apresentem:

- endpoint não documentado;
- endpoint documentado sem implementação correspondente;
- `operationId` ausente ou divergente;
- schema divergente;
- enum divergente;
- código HTTP divergente;
- cabeçalho divergente;
- requisito de segurança divergente;
- incompatibilidade contratual não aprovada.

### 19.1 Quality gates executáveis

Todos os gates definidos nesta seção deverão ser considerados bloqueadores quando aplicáveis ao escopo da entrega.

A pipeline deverá interromper a promoção da alteração quando qualquer gate aplicável estiver em estado não conforme.

#### QG-001 - OpenAPI

**Finalidade**

Assegurar a aderência integral ao contrato normativo.

**Ferramentas**

- Spectral;
- Schemathesis;
- oasdiff.

**Critérios de aprovação**

- ausência de erros bloqueadores do Spectral;
- ausência de incompatibilidade não aprovada no oasdiff;
- aprovação dos cenários aplicáveis do Schemathesis;
- resolução de todas as referências internas;
- unicidade dos `operationId`.

**Critérios de não conformidade**

- endpoint não documentado;
- schema, enum, cabeçalho ou código HTTP divergente;
- referência interna inválida;
- `operationId` ausente ou duplicado;
- alteração incompatível sem aprovação.

#### QG-002 - Build e análise estática de código

**Finalidade**

Assegurar a integridade da compilação e a conformidade com as convenções de código.

**Ferramentas**

- TypeScript;
- ESLint.

**Critérios de aprovação**

- ausência de erros de compilação;
- ausência de erros de lint.

**Critérios de não conformidade**

- qualquer erro de compilação;
- qualquer erro de lint configurado como bloqueador.

#### QG-003 - Testes unitários

**Finalidade**

Assegurar o comportamento das regras isoladas e funções puras.

**Ferramenta**

- Vitest.

**Critérios de aprovação**

- aprovação integral dos testes aplicáveis;
- cobertura das regras alteradas;
- ausência de testes ignorados sem justificativa aprovada.

**Critérios de não conformidade**

- qualquer teste aplicável com falha;
- requisito alterado sem teste correspondente;
- teste desabilitado sem aprovação.

#### QG-004 - Testes de integração

**Finalidade**

Assegurar o comportamento da persistência, das transações, da concorrência, da idempotência, da Outbox e dos jobs.

**Ferramentas**

- Vitest;
- Testcontainers;
- PostgreSQL real em container.

**Cobertura mínima da fundação técnica**

- TS-001;
- TS-015;
- TS-016;
- TS-017;
- TS-024;
- TS-038.

**Critérios de aprovação**

- aprovação integral dos cenários aplicáveis;
- execução contra PostgreSQL real;
- ausência de efeitos duplicados nos cenários de retry e retomada.

**Critérios de não conformidade**

- qualquer cenário sentinela aplicável com falha;
- utilização exclusiva de mock onde banco real for exigido;
- comportamento não determinístico sem causa formalmente aceita.

#### QG-005 - Segurança estática e segredos

**Finalidade**

Identificar vulnerabilidades de código e exposição de segredos.

**Ferramentas**

- CodeQL;
- Semgrep;
- Gitleaks.

**Critérios de aprovação**

- ausência de achados críticos ou altos não aprovados;
- ausência de segredo exposto.

**Critérios de não conformidade**

- achado crítico ou alto sem exceção formal;
- segredo, token ou credencial detectado;
- regra de segurança desabilitada sem aprovação.

#### QG-006 - Dependências e cadeia de suprimentos

**Finalidade**

Assegurar a conformidade das dependências, licenças e artefatos de software.

**Ferramentas**

- npm audit;
- ferramenta de SCA adotada pelo projeto;
- geração de SBOM;
- Trivy para imagens Docker ou OCI produzidas pelo projeto.

**Critérios de aprovação**

- ausência de vulnerabilidade crítica;
- ausência de vulnerabilidade alta sem exceção aprovada;
- SBOM gerada em formato SPDX ou CycloneDX;
- SBOM armazenada como artefato da pipeline ou publicada conforme a política operacional vigente;
- ausência de dependência proibida;
- licenças avaliadas conforme a política do projeto.

**Formatos aceitos para SBOM**

- SPDX;
- CycloneDX.

**Critérios de não conformidade**

- vulnerabilidade crítica;
- vulnerabilidade alta sem tratamento ou exceção formal;
- dependência proibida;
- ausência de SBOM quando exigida.

#### QG-007 - Testes end-to-end

**Finalidade**

Assegurar o comportamento observável das jornadas do usuário.

**Ferramenta**

- Playwright.

**Cobertura mínima**

Toda jornada afetada pela alteração deverá possuir cobertura E2E correspondente. O conjunto mínimo, conforme o escopo implementado, deverá contemplar:

- conta e verificação;
- autenticação e sessões;
- planos;
- ocorrências;
- respostas;
- histórico;
- exportação;
- privacidade.

**Critérios de aprovação**

- aprovação integral das jornadas críticas aplicáveis;
- validação dos estados de tela definidos na especificação;
- ausência de sucesso declarado sem confirmação do servidor.

**Critérios de não conformidade**

- qualquer jornada crítica aplicável com falha;
- estado obrigatório de tela sem cobertura;
- comportamento divergente da especificação.

#### QG-008 - Acessibilidade

**Finalidade**

Assegurar a conformidade automatizável com os requisitos de acessibilidade.

**Ferramentas**

- Playwright;
- axe.

**Critérios de aprovação**

- ausência de violação crítica;
- ausência de violação grave não aprovada;
- cobertura das telas essenciais aplicáveis.

**Critérios de não conformidade**

- violação crítica;
- violação grave sem tratamento ou exceção formal;
- ausência de teste para tela essencial alterada.

A avaliação automatizada não substituirá as validações manuais de teclado, foco, leitura linear e zoom quando exigidas.

#### QG-009 - Ownership e acesso horizontal

**Finalidade**

Assegurar o isolamento entre titulares.

**Cobertura mínima**

- TS-008;
- TS-023.

**Critérios de aprovação**

- todos os acessos cruzados aplicáveis retornam `404 RESOURCE_NOT_FOUND`;
- nenhuma resposta revela a existência de recurso pertencente a outro titular.

**Critérios de não conformidade**

- acesso indevido;
- código de resposta divergente;
- enumeração de recurso;
- rota privada sem cobertura de ownership.

#### QG-010 - Testes de mutação

**Finalidade**

Assegurar a eficácia dos testes e detectar asserções insuficientes.

**Ferramenta**

- Stryker.

**Limites normativos de maturidade**

- Foundation: `Mutation Score` igual ou superior a 80%;
- Mature: `Mutation Score` igual ou superior a 85%;
- Critical Domains: `Mutation Score` igual ou superior a 90%.

O limite mínimo obrigatório do projeto deverá ser Foundation. Domínios classificados como críticos poderão adotar limites superiores mediante decisão arquitetural formal.

**Critérios de não conformidade**

- `Mutation Score` inferior ao limite aplicável ao nível de maturidade do domínio;
- mutantes sobreviventes em invariantes críticas sem justificativa formal;
- exclusões indevidas do escopo de mutação.

O limite poderá ser revisto por decisão técnica documentada, sem redução silenciosa na pipeline.

#### QG-011 - Rastreabilidade

**Finalidade**

Assegurar vínculo verificável entre especificação, contrato, testes e implementação.

**Critérios de aprovação**

- todos os endpoints possuem `operationId` rastreável;
- a rastreabilidade é verificável por ferramenta automatizada executada na pipeline;
- requisitos alterados possuem testes associados;
- testes referenciam identificadores válidos;
- a matriz de rastreabilidade não contém referência inexistente.

**Critérios de não conformidade**

- requisito sem teste;
- teste sem requisito ou cenário associado;
- endpoint sem rastreabilidade;
- identificador inexistente;
- divergência entre matriz e implementação.

#### QG-012 - Aprovação humana

**Finalidade**

Assegurar controle formal sobre alterações sensíveis ou normativas.

**Critérios de aprovação**

- revisão humana concluída;
- aprovação dos CODEOWNERS aplicáveis;
- ausência de solicitação de alteração pendente;
- evidências dos gates anexadas ou acessíveis no PR.

**Critérios de não conformidade**

- ausência de aprovação obrigatória;
- revisão pendente;
- alteração normativa sem responsável designado;
- gate obrigatório sem evidência.

### 19.2 Ordem da pipeline

A pipeline deverá executar os gates na ordem lógica abaixo, admitindo paralelismo quando não houver dependência técnica:

1. validação OpenAPI;
2. build e lint;
3. testes unitários;
4. testes de integração;
5. testes de contrato contra implementação executável;
6. análises de segurança;
7. análise de dependências e SBOM;
8. testes end-to-end;
9. testes de acessibilidade;
10. testes de mutação;
11. validação de rastreabilidade;
12. aprovação humana.

A promoção deverá ser interrompida no primeiro gate bloqueador em estado não conforme.

### 19.3 Workflow GitHub Actions de referência

O workflow abaixo constitui referência operacional. A implementação poderá ser adaptada, desde que preserve os quality gates, os critérios bloqueadores e as dependências definidas nesta política.

```yaml
name: ci

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  openapi:
    name: QG-001 OpenAPI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run openapi:lint
      - run: npm run openapi:diff

  build:
    name: QG-002 Build
    needs: openapi
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint

  unit:
    name: QG-003 Unit
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:unit

  integration:
    name: QG-004 Integration
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:integration

  contract:
    name: QG-001 Contract Runtime
    needs:
      - unit
      - integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:contract

  security:
    name: QG-005 Security
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run security

  ownership:
    name: QG-009 Ownership
    needs: integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:ownership

  dependencies:
    name: QG-006 Dependencies
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run sbom

  e2e:
    name: QG-007 E2E
    needs:
      - contract
      - security
      - dependencies
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:e2e

  accessibility:
    name: QG-008 Accessibility
    needs: e2e
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:a11y

  mutation:
    name: QG-010 Mutation
    needs: integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run test:mutation

  traceability:
    name: QG-011 Traceability
    needs:
      - contract
      - ownership
      - e2e
      - accessibility
      - mutation
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run traceability:check
```

O workflow de referência não substitui as configurações de proteção de branch e CODEOWNERS necessárias ao QG-012. O QG-012 é verificado pela proteção de branch e pelo CODEOWNERS, e não por job de workflow. A validação de rastreabilidade documental (`python validate_all.py`) executa em workflow próprio (`traceability-validation.yml`) e também é check obrigatório.

O workflow apresentado possui caráter ilustrativo. A implementação poderá utilizar matrizes, paralelismo, workflows reutilizáveis ou outras otimizações, desde que preserve:

- os quality gates aplicáveis;
- os critérios de aprovação;
- os critérios de bloqueio;
- a ordem lógica e as dependências das validações.


### 19.4 Mapeamento entre gates e ferramentas

| Gate | Ferramentas ou evidências mínimas |
|---|---|
| QG-001 | Spectral, Schemathesis e oasdiff |
| QG-002 | TypeScript e ESLint |
| QG-003 | Vitest |
| QG-004 | Vitest, Testcontainers e PostgreSQL |
| QG-005 | CodeQL, Semgrep e Gitleaks |
| QG-006 | npm audit, SCA, SBOM e Trivy quando aplicável |
| QG-007 | Playwright |
| QG-008 | Playwright e axe |
| QG-009 | TS-008 e TS-023 |
| QG-010 | Stryker |
| QG-011 | verificador automatizado de rastreabilidade |
| QG-012 | CODEOWNERS, proteção de branch e aprovação humana |

### 19.5 Mapeamento entre artefatos e tipos de teste

| Artefato normativo | Cobertura mínima esperada |
|---|---|
| RF | testes unitários e de integração, conforme a natureza do requisito |
| CA | testes de integração, API ou E2E |
| TS | teste executável no nível adequado ao cenário |
| OpenAPI | testes de contrato |
| RNF de segurança | análise de segurança e teste aplicável |
| RNF de acessibilidade | teste automatizado e validação manual aplicável |
| Fluxos | testes de integração ou E2E |
| Estados de tela | testes de componente ou E2E |

### 19.6 Estrutura de referência dos testes

A organização dos testes poderá seguir a estrutura abaixo:

```text
tests/
├── contract/
├── unit/
├── integration/
├── api/
├── e2e/
├── accessibility/
├── security/
└── mutation/
```

A estrutura física poderá variar. A cobertura, a rastreabilidade e os quality gates não poderão ser suprimidos.

### 19.7 Convenções de pull request

Todo pull request deverá informar, quando aplicável:

- objetivo da alteração;
- `operationId` afetados;
- RF afetados;
- CA afetados;
- TS afetados;
- impacto na OpenAPI;
- impacto no banco e nas migrações;
- impacto em segurança e privacidade;
- evidências dos testes executados;
- riscos conhecidos;
- plano de rollback, quando aplicável.

A ausência de informações aplicáveis deverá impedir a aprovação até a regularização.

### 19.8 CODEOWNERS e aprovações

Alterações nas áreas abaixo deverão exigir aprovação humana dos responsáveis designados:

- OpenAPI;
- ADRs;
- Especificação Funcional;
- migrações SQL;
- autenticação;
- sessões;
- autorização e ownership;
- segurança;
- privacidade;
- exclusão e expurgo de conta;
- retenção e restore;
- infraestrutura de produção;
- workflows de CI/CD que alterem quality gates.

Agentes de IA poderão propor alterações nessas áreas, mas não poderão aprová-las nem incorporá-las à baseline de forma autônoma.

Cada área protegida deverá possuir responsável formal definido no arquivo CODEOWNERS do repositório. Enquanto houver um único mantenedor, o responsável interino é `@carlosyano`, a ser substituído por responsáveis designados para Segurança e Privacidade, Arquitetura e QA. A ausência de responsável designado deverá ser tratada como não conformidade operacional e deverá bloquear a aprovação da alteração.

### 19.9 Scripts de referência

O repositório deverá fornecer comandos equivalentes aos seguintes:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:ownership
npm run test:e2e
npm run test:a11y
npm run security
npm run sbom
npm run test:mutation
npm run traceability:check
npm run openapi:lint
npm run openapi:diff
```

Os nomes poderão variar, desde que exista documentação objetiva do mapeamento entre scripts e quality gates.

### 19.10 Geração de artefatos

Toda geração automatizada deverá observar a seguinte ordem:

1. contrato OpenAPI, quando houver alteração contratual aprovada;
2. testes correspondentes;
3. implementação;
4. documentação técnica;
5. pipeline e automações necessárias;
6. evidências de conformidade.

Implementação sem testes prévios deverá ser considerada não conforme, ressalvada a fundação técnica necessária para viabilizar a execução dos próprios testes.

---

## 20. Modelo de governança

O processo deverá observar o seguinte modelo:

1. agentes de IA poderão produzir artefatos, testes, implementação e documentação;
2. os testes deverão anteceder a implementação correspondente;
3. a conformidade deverá ser verificada por pipeline automatizada;
4. as evidências deverão permanecer associadas ao pull request ou à execução da pipeline;
5. alterações sensíveis ou normativas dependerão de aprovação humana formal;
6. nenhuma alteração deverá integrar a baseline sem conformidade com este documento.

Agentes de IA não poderão:

- aprovar a própria alteração;
- reduzir silenciosamente quality gates;
- alterar fontes normativas sem autorização;
- ignorar falhas bloqueadoras;
- substituir evidência executável por declaração textual de conformidade.

Nenhuma alteração normativa deverá integrar a baseline sem evidência objetiva de conformidade e aprovação explícita dos responsáveis designados.


### 20.1 Alteração da baseline normativa

As alterações abaixo deverão produzir nova ADR ou atualização formal de ADR existente:

- alteração da stack tecnológica;
- alteração dos quality gates;
- alteração da estratégia de testes;
- alteração das regras de ownership;
- alteração das regras de concorrência;
- alteração das regras de idempotência;
- alteração dos critérios de aprovação;
- alteração dos controles de segurança;
- alteração dos requisitos de rastreabilidade.

A simples modificação deste documento não constituirá aprovação normativa.

Toda proposta de alteração da baseline deverá apresentar:

- justificativa;
- impacto arquitetural;
- impacto funcional, quando aplicável;
- impacto operacional;
- impacto em segurança e privacidade;
- plano de migração, quando aplicável;
- estratégia de rollback, quando aplicável;
- aprovação humana formal.

Quando aplicável, a pipeline deverá validar a existência e a referência da ADR correspondente. A redução de quality gates ou controles não deverá ser realizada exclusivamente por alteração de workflow, configuração ou deste documento.

### 20.2 Classificação da baseline

Esta baseline possui a seguinte classificação:

- maturidade: Desenvolvimento (produção bloqueada até o encerramento de GX-001 a GX-006);
- modelo contratual: Contract-First;
- modelo de desenvolvimento: Test-First;
- modelo operacional: IA-First;
- governança: Human Approved;
- automação: CI/CD Governado.

A classificação deverá ser revista sempre que houver alteração material na arquitetura, nos quality gates, no modelo de desenvolvimento ou nos controles de governança.


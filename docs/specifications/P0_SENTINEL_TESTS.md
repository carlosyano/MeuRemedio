# MeuRemedio — Testes Sentinela Bloqueadores da Fundação (cenários e fixtures)

> **Status:** apoio à Especificação Funcional 02.33 (Anexo C). Detalha, sem alterar o comportamento normativo, os testes que bloqueiam a fundação técnica: **TS-001, TS-008, TS-015, TS-016, TS-017, TS-023, TS-024, TS-038 e TS-040** (AGENTS.md §11; QG-004 e QG-009). Em conflito, a Especificação, a OpenAPI e a ADR prevalecem. Estado inicial esperado (Test-First): todos **vermelhos** até a fundação mínima existir.

## Convenções comuns

- Banco: PostgreSQL 17 real via Testcontainers; nenhum mock de persistência (QG-004).
- Relógio: `Clock` injetável. Padrão dos cenários: `2026-10-05T11:05:00Z`.
- Dados sintéticos apenas (AGENTS.md §15). Usuários de teste: `ana.silva@example.com` (U1) e `bruno.costa@example.com` (U2), ambos `ACTIVE`, `America/Sao_Paulo`.
- Plano padrão P1 (U1): `Comprimido`, `1 comprimido`, `TABLET`, `ORAL`, início `2026-10-01`, horários `08:00`.
- Toda mutação autenticada envia `X-CSRF-Token` válido e `Idempotency-Key` quando exigida, salvo quando o cenário testa o contrário.
- Cada teste carrega os IDs normativos (`@trace RF-… CA-… TS-… operationId`).

---

## TS-001 — Concorrência TAKEN × NOT_TAKEN
**Rastreia:** RF-006, RN-008, CA-007 · `createResponse` · nível: integração.

**Fixture:** ocorrência O1 de P1, `PROGRAMMED`, `scheduled_at=2026-10-05T11:00:00Z`.

**Passos (100 iterações, cada uma com ocorrência nova):**
1. Preparar duas conexões HTTP e uma barreira de sincronização.
2. Disparar simultaneamente `POST /occurrences/{O1}/responses` com `{"type":"TAKEN","reason":null}` e `{"type":"NOT_TAKEN","reason":"FORGOT"}`, com `Idempotency-Key` distintas.

**Esperado em todas as iterações:** exatamente um `201` e um `409 STATE_CONFLICT`; 1 linha em `responses`; `occurrences.status` igual ao tipo aceito; `is_late=false`; corpo do 409 em `application/problem+json` com `correlation_id`.

**Proibido:** 0 ou 2 linhas de resposta; dois `201`; qualquer `5xx`; deadlock exposto ao cliente; estado final divergente da resposta aceita.

**Estado (PR 5):** a base de banco está em `tests/integration/db-core.spec.ts` (PostgreSQL 17 real): em 60 corridas simultâneas, exatamente uma resposta vence e a outra viola `responses_occurrence_id_key`. O teste HTTP completo permanece pendente (requer a API).

---

## TS-008 — Acesso horizontal (BOLA) em recurso individual
**Rastreia:** RN-002, RNF-003, CA-012 · `getPlan` (e `updatePlan`, `deletePlan`) · QG-009.

**Fixture:** P1 pertence a U1. Sessão de U2.

**Passos:** U2 chama `GET /plans/{P1}`, `PUT /plans/{P1}` (com `If-Match` válido, `X-CSRF-Token` e `Idempotency-Key`) e `DELETE /plans/{P1}`. Repetir com um UUID inexistente.

**Esperado:** `404 RESOURCE_NOT_FOUND` em todos; resposta para o recurso de U1 **indistinguível** da resposta para UUID inexistente (mesmos status, `code`, `title`, `detail`; apenas `correlation_id` e `instance` variam); P1 inalterado; 1 `audit_events` com `action=ownership.denied` por tentativa no recurso de U1.

**Proibido:** 403; qualquer diferença de corpo ou cabeçalho que revele existência; efeito colateral em P1.

---

## TS-023 — BOLA/IDOR em todas as rotas privadas
**Rastreia:** RNF-003, CA-012 · todas as operações privadas · QG-009.

**Fixture:** U1 possui plano P1, ocorrência O1, exportação E1 (`COMPLETED`). Sessão de U2.

**Passos:** o teste é **gerado a partir da OpenAPI**: para cada `operationId` privado com parâmetro de caminho (`getPlan`, `updatePlan`, `deletePlan`, `createResponse`, `getExport`, `cancelExport`, `downloadExport`), U2 usa o identificador de U1. Para rotas de coleção (`listPlans`, `listOccurrences`, `getHistory`, `getPrivacy`, `getCurrentAccount`), U2 deve ver apenas os próprios dados (vazio).

**Esperado:** `404 RESOURCE_NOT_FOUND` nas rotas por identificador; coleções sem nenhum item de U1; 1 evento `ownership.denied` por tentativa.

**Falha obrigatória do teste:** se existir operação privada sem caso correspondente (cobertura medida contra a OpenAPI), o teste reprova.

---

## TS-015 — Idempotência com payload divergente
**Rastreia:** RF-003, CA-013, ERR-006 · `createPlan` (e `updatePlan`) · nível: integração.

**Passos:**
1. `POST /plans` com `Idempotency-Key: K1` e payload A (P1) → `201`.
2. Repetir `K1` com payload B (`medication_name="Outro"`) → `409 IDEMPOTENCY_KEY_REUSED`.
3. Repetir `K1` com payload A com propriedades em outra ordem → mesmo status, corpo lógico e `ETag` do passo 1.
4. U2 usa `K1` com payload A → `201` (escopo por titular).
5. Duas chamadas simultâneas com `K2` e o mesmo payload → um único efeito.

**Esperado:** exatamente 1 plano para o par (U1, payload A); 1 linha de `idempotency_records` por (operação, escopo, chave); passo 5 gera 1 plano.

**Proibido:** segundo plano; o `409` do passo 2 sobrescrever o snapshot original.

**Estado (PR 8):** a base de banco está em `tests/integration/db-platform.spec.ts` (PostgreSQL 17 real): unicidade por (operação, escopo, chave), escopo por titular (passo 4) e 10 inserções simultâneas com a mesma chave gravando um único registro (passo 5). O teste HTTP completo permanece pendente (requer a API).

---

## TS-038 — Matriz de idempotência
**Rastreia:** DEC-009, AGENTS §13 · `createAccount`, `createPlan`, `updatePlan`, `createResponse`, `createExport`, `requestAccountDeletion`, `revokeAllSessions`.

**Passos (para cada uma das 7 operações):**
1. Requisição válida com chave `Kx` → resultado R1.
2. Replay idêntico → mesmo status, corpo lógico e cabeçalhos relevantes (`ETag`), sem novo efeito.
3. Mesma chave com payload divergente → `409 IDEMPOTENCY_KEY_REUSED`, sem novo efeito.
4. Sem `Idempotency-Key` → `400 VALIDATION_FAILED`.
5. Avançar o relógio 7 dias + 1 s → a chave expirou e é tratada como nova.

**Observações:** `createAccount` usa escopo `public`. Em `updatePlan`, o `If-Match` integra o hash da requisição.

**Decisão (aprovada em 04/10/2026 pelo mantenedor, interino):** em `requestAccountDeletion` e `revokeAllSessions` o efeito revoga a própria sessão; o replay da mesma chamada **retorna `401`**, pois a autenticação precede a consulta ao registro de idempotência. O cliente trata um `401` posterior à confirmação da ação como resultado já alcançado. O TS-038 cobre os passos 1 a 5 com chamadas feitas antes da revogação e acrescenta o passo 6: replay após a revogação retorna `401` sem novo efeito.

**Estado (PR 8):** a base de banco está em `tests/integration/db-platform.spec.ts`: o esquema aceita exatamente as operações que declaram `Idempotency-Key` na OpenAPI, usa escopo `public` só em `createAccount` e fixa `expires_at = created_at + 7 dias` (passo 5). Os passos HTTP permanecem pendentes.

---

## TS-024 — DST e tempo civil
**Rastreia:** RN-013, OA-003 · geração de ocorrências · nível: unitário + propriedade (`fast-check`) + integração.

**Regras:** instantes em UTC; horário civil **inexistente** avança para o primeiro instante válido; **ambíguo** usa o primeiro instante cronológico; `deadline_at = scheduled_at + 60 min`.

| Fuso | Data local | Hora do plano | Tipo | `scheduled_at` esperado (UTC) |
|---|---|---|---|---|
| America/New_York | 2026-03-08 | 02:30 | inexistente | 2026-03-08T07:00:00Z (03:00 EDT) |
| America/New_York | 2026-11-01 | 01:30 | ambíguo | 2026-11-01T05:30:00Z (EDT, 1º instante) |
| Europe/Lisbon | 2026-03-29 | 01:30 | inexistente | 2026-03-29T01:00:00Z (02:00 WEST) |
| Europe/Lisbon | 2026-10-25 | 01:30 | ambíguo | 2026-10-25T00:30:00Z (WEST, 1º instante) |
| America/Santiago | 2026-09-06 | 00:30 | inexistente | 2026-09-06T04:00:00Z (01:00 local) |
| America/Santiago | 2026-04-04 | 23:30 | ambíguo | 2026-04-05T02:30:00Z (1º instante) |
| Australia/Lord_Howe | 2026-10-04 | 02:15 | inexistente | 2026-10-03T15:30:00Z (02:30 local, +30 min) |
| Australia/Lord_Howe | 2026-04-05 | 01:45 | ambíguo | 2026-04-04T14:45:00Z (1º instante) |
| America/Sao_Paulo | qualquer | 08:00 | sem DST | 11:00Z o ano inteiro |

Os valores foram calculados com `zoneinfo` e o tzdata do ambiente de referência; devem ser recalculados se a política de um fuso mudar (a versão de tzdata é fixada pela plataforma).

**Esperado:** exatamente 1 ocorrência por (plano, data, horário) mesmo no dia de repetição de hora; `local_time` preserva o horário pedido (`02:30`); histórico e deadlines coerentes.

**Estado (PR 2):** a parte pura (resolução de data, hora e fuso em instante UTC, e o prazo de 60 minutos) está em `tests/unit/civil-time.spec.ts`, com as fixtures acima, o dia inteiro de cada transição contra um oráculo minuto a minuto e as propriedades abaixo. O gerador de ocorrências está em `tests/unit/occurrence-slots.spec.ts` (slots por janela de datas civis, com propriedades) e `tests/integration/ts-024.spec.ts` (PostgreSQL 17 real): as 8 fixtures acima com `local_time` preservado, 1 ocorrência por (plano, data, horário) no dia de hora repetida, reexecução e execuções simultâneas sem inserir nem alterar linhas. A janela de datas é explícita: os limites do horizonte móvel de 30 dias (regra definida na DEC-027) e o disparo via Outbox/job horário seguem pendentes, assim como a validação IANA em `createAccount` (requer a API).

**Propriedades (fast-check, 2024–2030, os 5 fusos acima):** nunca gera duas ocorrências para o mesmo (plano, data, horário); `scheduled_at` é monotônico por dia; o resultado independe do fuso do servidor; reexecutar o gerador não altera linhas.

---

## TS-016 — Falha do despachante: Outbox preserva o trabalho
**Rastreia:** RNF-007, OA-002 · nível: integração.

**Passos:** com o despachante/pg-boss forçado a falhar, `POST /plans` (P1) → `201`. Verificar `outbox_events`. Restaurar o despachante.

**Esperado:** evento gravado na **mesma transação** do plano (`dispatched_at IS NULL`); após a retomada, despachado exatamente uma vez; nenhum evento perdido; nenhuma ocorrência duplicada.

**Proibido:** resposta de sucesso sem evento persistido; perda silenciosa.

**Estado (PR 8):** a base de banco está em `tests/integration/db-platform.spec.ts`: plano e evento na mesma transação (ROLLBACK descarta os dois; COMMIT deixa o evento pendente) e consumidores concorrentes com `FOR UPDATE SKIP LOCKED` recebem eventos disjuntos. Despachante e pg-boss permanecem pendentes.

---

## TS-017 — Retomada de worker sem efeito duplicado
**Rastreia:** RF-005, OA-002 · nível: integração.

**Passos:** worker de lembrete interrompido (kill) após enviar ao provedor falso e antes do `ack`; reiniciar. Repetir interrompendo antes do envio.

**Esperado:** no máximo 1 e-mail por ocorrência (o provedor falso conta envios); `email_reminders` termina em `SENT` ou, sem confirmação, em `DELIVERY_UNKNOWN` **sem reenvio cego**; reexecução do gerador e do job de prazo não altera estados.

**Estado (PR 8):** só a reivindicação disjunta de eventos do Outbox está coberta (`tests/integration/db-platform.spec.ts`); `email_reminders` (ENT-009), o worker e o provedor falso permanecem pendentes.

---

## TS-040 — Contrato: OpenAPI, implementação e testes não divergem
**Rastreia:** RNF-014, QG-001 · todas as operações.

**Verificações (todas obrigatórias):**
1. Spectral sem erros bloqueadores; `operationId` únicos; referências resolvidas.
2. `oasdiff` sem incompatibilidade em relação à versão aprovada anterior.
3. A tabela de rotas da aplicação em execução é **idêntica** à OpenAPI (caminhos, métodos, `operationId`); nenhuma rota extra.
4. Schemathesis (casos positivos e negativos, com sessão e CSRF) sem falhas nas 27 operações; todo status retornado está documentado.
5. `Problem.code` ∈ enum fechado ERR-001..ERR-015; `X-Correlation-ID` presente; `ETag` onde documentado.
6. `createSession`: `Set-Cookie` com `mr_session` (`HttpOnly; Secure; SameSite=Lax`) e `mr_csrf` (`Secure; SameSite=Lax`).
7. Toda referência `x-traceability` existe na matriz; o SHA-256 do contrato confere com a matriz.

**Estado (PR 3):** as verificações estáticas estão implementadas em `tests/contract/ts-040.spec.ts` (regras R01 a R17: `operationId` e referências; enum de `Problem.code` x erros da matriz; mapeamento erro x operação nos dois sentidos; 429; `Idempotency-Key`; CSRF; rotas públicas e BOLA; `application/problem+json`; `X-Correlation-ID`; `ETag` e `If-Match`; cookies documentados; rastreabilidade; nome e SHA-256 da OpenAPI) e provadas por `tests/contract/ts-040.negative.spec.ts` (cada regra reprova uma mutação do contrato). O lint Spectral roda em `npm run openapi:lint`.

**Pendentes (dependem de ferramenta externa ou da API):** verificação 2 (`oasdiff`), 3 (rotas da aplicação x OpenAPI), 4 (Schemathesis) e a emissão real dos cookies (6).

**Decisões de 04/10/2026 (resolvidas na OpenAPI 02.33.3):** GAP-008, o 410 de `createResponse` foi removido do contrato; GAP-009, `X-Correlation-ID` é exigido em toda resposta (regra R12). Não há mais exceções registradas nas regras R05 e R12.

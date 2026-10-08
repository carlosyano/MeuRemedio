# Decisões Claude

Registro das decisões **não críticas** tomadas pelo agente (Claude) durante a implementação, por delegação do mantenedor em 08/10/2026 (`CLAUDE.md`, "Fluxo de trabalho autônomo"). Este documento é de apoio e **não é fonte normativa**: em conflito, prevalecem a OpenAPI, a Especificação, a ADR e o `AGENTS.md`. Uma Decisão Claude que preencha lacuna da Especificação vai também para um PR normativo (DEC-xxx), com merge do mantenedor.

Cada entrada traz: contexto, alternativas analisadas, decisão, riscos e onde se aplica. O mantenedor pode revogar qualquer entrada; nesse caso, ela fica marcada como **Revogada**, com a data.

| ID | Tema | Situação |
|---|---|---|
| DC-001 | Campos `type` e `title` do Problem | Vigente |
| DC-002 | Origem do `X-Correlation-ID` | Vigente |
| DC-003 | Erros do framework e rotas fora do contrato | Vigente |
| DC-004 | Validação de toda resposta contra o contrato | Vigente |
| DC-005 | NestJS 12 com decorators legados e `@Inject` explícito | Vigente |
| DC-006 | "Prazo atingido" na DEC-027 | Vigente |
| DC-007 | Códigos e mensagens de `field_errors` | Vigente |
| DC-008 | Emissão do token de verificação pelo worker | Vigente |
| DC-009 | Quais respostas viram snapshot de idempotência | Vigente |
| DC-010 | Serialização e hash da requisição idempotente | Vigente |

---

## DC-001 — Campos `type` e `title` do Problem (08/10/2026)

- **Contexto:** a OpenAPI exige `type` (uri-reference) e `title`, mas só os mostra em exemplos, com a URL ilustrativa `https://api.example.invalid`.
- **Alternativas:** URL absoluta configurável por ambiente; `about:blank`; URI relativa.
- **Decisão:** `type = /problems/<codigo em minúsculas>` (relativa, independe do ambiente). `title` é o texto dos exemplos da OpenAPI, e `detail` é a mensagem ao usuário do catálogo ERR. Um teste de contrato confere `title` e `detail` contra a OpenAPI e a matriz.
- **Riscos:** baixos. Trocar por URL absoluta depois só muda o prefixo.
- **Aplica-se a:** `apps/api/src/platform/http/problem-catalog.ts`.

## DC-002 — Origem do `X-Correlation-ID` (08/10/2026)

- **Contexto:** a OpenAPI declara o cabeçalho só nas respostas.
- **Alternativas:** aceitar o valor enviado pelo cliente; gerar sempre no servidor.
- **Decisão:** o servidor gera um UUID v4 novo por requisição e ignora o valor do cliente. Isso evita injeção de valores arbitrários nos logs e entrada fora do contrato.
- **Riscos:** nenhum funcional. Se um proxy precisar propagar o ID, a mudança entra por decisão própria.
- **Aplica-se a:** `apps/api/src/platform/http/correlation.ts`.

## DC-003 — Erros do framework e rotas fora do contrato (08/10/2026)

- **Contexto:** rota ou método inexistente e erros do Fastify (JSON malformado, corpo grande, tipo de conteúdo) não têm status próprio no contrato.
- **Decisão:** rota ou método fora do contrato respondem `404 RESOURCE_NOT_FOUND`. Erros 400, 413 e 415 do framework viram `400 VALIDATION_FAILED`; qualquer outro vira `500 INTERNAL_ERROR`. O `HEAD` automático do Fastify fica desligado.
- **Riscos:** baixos. O 405 não é usado porque não está no catálogo fechado.
- **Aplica-se a:** `apps/api/src/platform/http/problem-filter.ts` e `app.ts`.

## DC-004 — Validação de toda resposta contra o contrato (08/10/2026)

- **Contexto:** a ADR (S1) pede validação de requisição e resposta.
- **Alternativas:** validar só em testes; validar sempre.
- **Decisão:** validar sempre, no hook `onSend`. Uma resposta fora do contrato não sai: vira `500 INTERNAL_ERROR`, e o desvio vai para o log, com `correlation_id`.
- **Riscos:** custo de CPU pequeno (validadores compilados e em cache). Reavaliar se o perfil de desempenho (PP-001) apontar impacto.
- **Aplica-se a:** `apps/api/src/platform/http/contract-enforcement.ts`.

## DC-005 — NestJS 12 com decorators legados e `@Inject` explícito (08/10/2026)

- **Contexto:** o NestJS 12 é ESM nativo, como o repositório, mas o Vitest transpila com oxc, que não emite `emitDecoratorMetadata`.
- **Alternativas:** NestJS 11 (CommonJS); transpilar os testes com SWC; injeção explícita.
- **Decisão:** NestJS 12.1.2 com `experimentalDecorators` e injeção sempre por `@Inject(token)`.
- **Riscos:** esquecer o `@Inject` causa falha de DI na subida, que os testes de API detectam.
- **Aplica-se a:** `apps/api` e `docs/architecture/TOOLCHAIN.md`.

## DC-006 — "Prazo atingido" na DEC-027 (08/10/2026)

- **Contexto:** a DEC-027 diz "se `deadline_at` já foi atingido"; a RN-009, "sem resposta até 60 minutos".
- **Decisão:** atingido significa `deadline_at <= instante da geração` (inclusivo).
- **Riscos:** nenhum. A diferença é de um instante exato.
- **Aplica-se a:** `packages/domain/src/generation-horizon.ts` (`initialOccurrenceState`).

## DC-007 — Códigos e mensagens de `field_errors` (08/10/2026)

- **Contexto:** o contrato define `FieldError { field, code, message }`, mas não o vocabulário.
- **Decisão:** `field` é o caminho do campo com ponto (`times.0`) ou o nome do parâmetro (`Idempotency-Key`, `plan_id`). `code` é `REQUIRED`, `INVALID` (parâmetro) ou a palavra-chave do JSON Schema em maiúsculas (`FORMAT`, `PATTERN`, `ADDITIONALPROPERTIES`...). `message` é "Campo obrigatório." ou "Valor inválido.". O código reservado `PASSWORD_COMPROMISED` (DEC-029) será usado pelo cadastro.
- **Riscos:** baixos. A interface mostra as mensagens do catálogo e destaca os campos.
- **Aplica-se a:** `apps/api/src/platform/contract/openapi-contract.ts`.

## DC-008 — Emissão do token de verificação pelo worker (08/10/2026)

- **Contexto:** o CA-001 pede "1 conta PENDING_VERIFICATION e 1 token de 24 h" no cadastro. O token em claro nunca é persistido (ENT-002), o payload do Outbox leva só identificadores (ENT-012) e efeitos externos nascem do Outbox (ADR §7). O token em claro precisa chegar ao e-mail sem passar pelo banco.
- **Alternativas:**
  1. gerar o token na requisição e levá-lo no payload do Outbox: viola ENT-002 e ENT-012;
  2. gerar na requisição e cifrar no payload: exige gestão de chave (KMS) só para isso;
  3. enviar o e-mail de forma síncrona na requisição: viola ADR §7;
  4. a requisição grava a conta e um evento `identity.verification_requested` (payload `{ user_id }`) na mesma transação; o worker, ao despachar, emite o token (grava só o hash, invalida o anterior) e envia o e-mail.
- **Decisão:** alternativa 4. O "1 token de 24 h" do CA-001 passa a valer após o despacho do evento, e os 24 h contam da emissão. Se o despacho falhar, o Outbox retoma (TS-016), e o usuário também pode pedir o reenvio (`resendVerification`).
- **Riscos:** baixos. O teste de aceite do CA-001 verifica o token depois de processar o Outbox. Por ser uma interpretação de temporalidade do CA-001, a decisão pode ser formalizada numa DEC no próximo PR normativo.
- **Aplica-se a:** módulo `identity` (`createAccount`) e worker de e-mail.

## DC-009 — Quais respostas viram snapshot de idempotência (08/10/2026)

- **Contexto:** a Especificação manda devolver "o resultado original" no replay, e o DATA_MODEL só exclui explicitamente o `409 DUPLICATE_CONFIRMATION_REQUIRED`. Não diz se um erro (400, 409, 422, 503...) consome a chave.
- **Alternativas:** persistir toda resposta; persistir só as de sucesso.
- **Decisão:** só respostas **2xx** viram snapshot. Um erro desfaz a transação inteira, e a mesma chave pode ser reenviada depois de corrigido o problema. Assim, falhas transitórias (503) não ficam congeladas por 7 dias, e o `409` de payload divergente nunca sobrescreve o snapshot (TS-015).
- **Riscos:** baixos. Um erro repetido com a mesma chave é reavaliado, sem efeito duplicado, porque nada foi gravado.
- **Aplica-se a:** `apps/api/src/platform/idempotency/idempotency.ts`.

## DC-010 — Serialização e hash da requisição idempotente (08/10/2026)

- **Contexto:** chamadas simultâneas com a mesma chave devem produzir um único efeito (TS-015, passo 5), e "payload igual" precisa de definição estável.
- **Alternativas:** `INSERT ... ON CONFLICT` com registro provisório; `SELECT ... FOR UPDATE`, que não trava linha inexistente; advisory lock de transação.
- **Decisão:** `pg_advisory_xact_lock` sobre `(operação, escopo, chave)` no início da transação do comando: a segunda chamada espera a primeira e então faz o replay. O hash é o SHA-256 do JSON canônico (chaves de objeto ordenadas, arrays na ordem) das partes da requisição: o corpo e, quando houver, os parâmetros e o `If-Match` (TS-038).
- **Riscos:** colisão do hash de 64 bits do advisory lock só serializa chaves distintas, sem erro de correção.
- **Aplica-se a:** `apps/api/src/platform/idempotency/idempotency.ts`.

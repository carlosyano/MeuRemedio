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
| DC-011 | Janela e chave do rate limit | Vigente |
| DC-012 | Hash de requisição idempotente com HMAC | Vigente |
| DC-013 | Biblioteca de Argon2id | Vigente |
| DC-014 | Versão fixada da lista de senhas comprometidas | Vigente |
| DC-015 | Conjunto de fusos aceitos no cadastro | Vigente |

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

## DC-011 — Janela e chave do rate limit (08/10/2026)

- **Contexto:** o RNF-006 fixa 20 req/min por IP em rotas públicas e 100 req/min por titular; a DEC-019 manda usar contadores UNLOGGED com "janela por chave", sem dizer o tipo de janela.
- **Alternativas:** janela fixa; janela deslizante (log ou contador ponderado); token bucket.
- **Decisão:** janela fixa de 1 minuto alinhada ao minuto UTC, com incremento atômico (`INSERT ... ON CONFLICT DO UPDATE`). A chave persistida é o SHA-256 do IP (rotas públicas) ou do UUID do titular (rotas autenticadas), nunca o valor em claro. O excedente recebe `Retry-After` com os segundos até o fim da janela (mínimo 1). O IP vem de `request.ip` do Fastify; atrás do balanceador (ECS/ALB), o `trustProxy` precisa ser configurado na implantação, senão todos os clientes compartilham o IP do balanceador.
- **Riscos:** a janela fixa admite até 2× o limite na virada do minuto, o que é aceitável para o MVP. O `trustProxy` entra na checklist de implantação.
- **Aplica-se a:** `apps/api/src/platform/rate-limit/`.

## DC-012 — Hash de requisição idempotente com HMAC (08/10/2026)

- **Contexto:** o `request_hash` de `idempotency_records` cobre o corpo, que no `createAccount` inclui a senha. Um SHA-256 simples permitiria a quem lê o banco testar senhas por força bruta rápida, anulando o Argon2id.
- **Alternativas:** excluir a senha do hash, o que deixaria um payload divergente só na senha virar replay em vez de 409; HMAC com segredo do servidor.
- **Decisão:** HMAC-SHA-256 com segredo do servidor (`REQUEST_HASH_KEY`, 32 bytes ou mais, do Secrets Manager em produção) em todas as operações idempotentes.
- **Riscos:** trocar o segredo invalida os hashes guardados, e replays dentro dos 7 dias responderiam 409. A rotação deve ser rara e planejada.
- **Aplica-se a:** `apps/api/src/platform/idempotency/idempotency.ts` e `main.ts`.

## DC-013 — Biblioteca de Argon2id (08/10/2026)

- **Contexto:** a RN-017 e o OA-009 pedem Argon2id (19 MiB, t=2, p=1).
- **Alternativas:** `argon2` 0.45.1 (addon nativo via `node-gyp-build`, com `cross-env` como dependência de execução); `@node-rs/argon2` (N-API pré-compilado, sem dependências).
- **Decisão:** `@node-rs/argon2` **2.2.1**. A 2.2.2 tinha 2 dias de publicada; a anterior tem 4 semanas de uso. O padrão da biblioteca é Argon2id, e o teste confere o prefixo `$argon2id$v=19$m=19456,t=2,p=1$`.
- **Riscos:** baixos. A calibração de desempenho fica no spike S7.
- **Aplica-se a:** `apps/api/src/modules/identity/infrastructure/password-hasher.ts`.

## DC-014 — Versão fixada da lista de senhas comprometidas (08/10/2026)

- **Contexto:** a DEC-029 cita `Passwords/Common-Credentials/10-million-password-list-top-100000.txt` do SecLists, mas o arquivo foi removido em 08/05/2025 (commit `4ff3ff8`) por duplicar `xato-net-10-million-passwords-100000.txt`, que hoje tem 7 linhas a menos.
- **Alternativas:** usar o arquivo atual equivalente; usar o arquivo nomeado na versão anterior à remoção.
- **Decisão:** fixar o arquivo nomeado na DEC-029 no commit `2d5dc75`, o último em que ele existe, com SHA-256 `e30e15fa...` conferido na carga e a licença MIT junto (`apps/api/assets/compromised-passwords/`).
- **Riscos:** a lista não recebe atualizações do upstream. Trocá-la exige PR próprio.
- **Aplica-se a:** `apps/api/assets/compromised-passwords/` e `compromised-passwords.ts`.

## DC-015 — Conjunto de fusos aceitos no cadastro (08/10/2026)

- **Contexto:** a DEC-023 e a OpenAPI pedem "IANA canônico reconhecido pela versão de tzdata fixada na plataforma (Node/ICU)". O ICU do Node 24 usa os identificadores canônicos do CLDR, que às vezes divergem dos da IANA (`Asia/Calcutta` x `Asia/Kolkata`, `Europe/Kiev` x `Europe/Kyiv`).
- **Alternativas:** aceitar só `Intl.supportedValuesOf('timeZone')`; versionar a lista de zonas da tzdata (`zone1970.tab`) e aceitar os canônicos IANA; aceitar aliases e canonicalizar.
- **Decisão:** aceitar exatamente `Intl.supportedValuesOf('timeZone')` (leitura literal de "reconhecido pela plataforma"). A interface web vai oferecer a mesma lista, o que mantém o comportamento consistente. Todos os fusos brasileiros estão nela; aliases (`Brazil/East`) e nomes inexistentes recebem 400.
- **Riscos:** alguns canônicos IANA modernos (`Asia/Kolkata`) não são aceitos, mas o equivalente aparece na lista oferecida. Reavaliar se a tzdata ou o ICU mudarem.
- **Aplica-se a:** `apps/api/src/modules/identity/application/create-account.ts`.

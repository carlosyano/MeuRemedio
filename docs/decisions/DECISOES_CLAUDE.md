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
| DC-016 | Versão do pg-boss | Vigente |
| DC-017 | Enfileiramento transacional e backoff do Outbox | Vigente |
| DC-018 | Produtor do TS-016 antes dos planos | Vigente |
| DC-019 | Respostas do verifyAccount | Vigente |
| DC-020 | Invalidação de tokens no reenvio e na falha de envio | Vigente |
| DC-021 | Token de verificação no fragmento do link | Vigente |
| DC-022 | Processo do worker na base de código da API | Vigente |
| DC-023 | Falhas de login indistinguíveis | Vigente |
| DC-024 | Janela e reinício do contador de falhas de login | Vigente |
| DC-025 | Cookie de sessão e registro de atividade | Vigente |
| DC-026 | Ordem dos controles de acesso e regra de Origin | Vigente |
| DC-027 | Pepper único do HMAC de e-mail | Vigente |
| DC-028 | Token de confirmação de duplicidade de plano | Vigente |
| DC-029 | Normalização, período e validações de `createPlan` | Vigente |
| DC-030 | Ordem e cursor de `listPlans` | Vigente |
| DC-031 | Identificador de caminho fora do formato | Vigente |
| DC-032 | Auditoria `ownership.denied` e `audit_events` append-only | Vigente |
| DC-033 | Geração de ocorrências do plano pelo Outbox | Vigente |
| DC-034 | Exclusão de plano já excluído | Vigente |
| DC-035 | Ocorrências na edição de plano | Vigente |
| DC-036 | Escopo e ordem de `listOccurrences` | Vigente |
| DC-037 | Quando uma ocorrência aceita resposta | Vigente |
| DC-038 | Job de prazo NO_RESPONSE | Vigente |
| DC-039 | Job horário do horizonte | Vigente |
| DC-040 | Lembretes por e-mail sem reenvio cego | Vigente |
| DC-041 | Período e conteúdo de `getHistory` | Vigente |
| DC-042 | Exportação em PDF | Vigente |
| DC-043 | Conta, preferências e revogação global de sessões | Vigente |
| DC-044 | Redefinição de senha | Vigente |
| DC-045 | Área de privacidade e pedido de exclusão da conta | Vigente |
| DC-046 | Expurgo da conta, tombstone e reconciliação de restore | Vigente |
| DC-047 | Schemathesis na CI e entradas que viravam 500 | Vigente |
| DC-048 | QG-006 (SBOM e licenças) e QG-009 na CI | Vigente |
| DC-049 | QG-005: Gitleaks, Semgrep e CodeQL; actions fixadas por SHA | Vigente |
| DC-050 | QG-010: testes de mutação no domínio | Vigente |
| DC-051 | Conta pendente antiga (TS-028) e cobertura de TS-002, TS-012 e TS-025 | Vigente |
| DC-052 | Fundação da aplicação web e entrada (TL-002) | Vigente |
| DC-053 | Cadastro (TL-001), confirmação de e-mail e redefinição de senha na web | Vigente |

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

## DC-016 — Versão do pg-boss (08/10/2026)

- **Contexto:** o OA-002 aprova o pg-boss, mas a linha 12 publica versões quase diárias.
- **Decisão:** fixar a **12.34.0**, com 2 semanas de publicada em 08/10/2026 (ESM, MIT, `npm audit` limpo).
- **Riscos:** baixos. Subir de versão entra por PR próprio, com os testes do Outbox.
- **Aplica-se a:** `apps/api/package.json` e `docs/architecture/TOOLCHAIN.md`.

## DC-017 — Enfileiramento transacional e backoff do Outbox (08/10/2026)

- **Contexto:** o TS-016 exige que nenhum evento se perca e que o despacho ocorra exatamente uma vez. A Especificação não define retentativa.
- **Alternativas:** enviar ao pg-boss fora da transação e deduplicar por `singletonKey`; enfileirar na mesma transação.
- **Decisão:** um evento por transação (`FOR UPDATE SKIP LOCKED`), com o job enfileirado na **mesma transação** que marca `dispatched_at` (opção `db` do `send` do pg-boss) e o id do job igual ao id do evento. Na falha, `attempts` incrementa, `last_error_code` registra só o código, e o evento volta após `2^attempts` s, até 300 s.
- **Riscos:** baixos. O backoff máximo de 5 min atrasa no máximo esse tempo depois de uma indisponibilidade longa.
- **Aplica-se a:** `apps/api/src/platform/outbox/dispatcher.ts`.

## DC-018 — Produtor do TS-016 antes dos planos (08/10/2026)

- **Contexto:** o TS-016 descreve `POST /plans` como produtor, mas o módulo de planos ainda não existe.
- **Decisão:** provar o despachante com o `createAccount` como produtor, que já grava evento no Outbox. O cenário com `POST /plans` entra com o módulo de planos.
- **Riscos:** nenhum. O despachante é genérico por tipo de evento.
- **Aplica-se a:** `tests/integration/ts-016.spec.ts`.

## DC-019 — Respostas do verifyAccount (08/10/2026)

- **Contexto:** o contrato prevê 204 (inclusive para token já consumido), 409 e 410, mas não diz quando usar cada um.
- **Decisão:** token já consumido responde 204 sem efeito. Token desconhecido, expirado (24 h) ou substituído responde **410 `TOKEN_EXPIRED`**, sem distinguir os casos, o que não revela se o token existiu. Token válido de conta fora de `PENDING_VERIFICATION` responde **409 `STATE_CONFLICT`**.
- **Riscos:** baixos. A mensagem do ERR-008 ("Este link não pode mais ser usado. Solicite um novo.") serve para os três casos de 410.
- **Aplica-se a:** `apps/api/src/modules/identity/application/verify-account.ts`.

## DC-020 — Invalidação de tokens no reenvio e na falha de envio (08/10/2026)

- **Contexto:** a RN-017 diz que "novo token invalida o anterior", e a OpenAPI diz que o reenvio "invalida o token anterior". Pela DC-008, o token novo é emitido pelo worker.
- **Decisão:** o `resendVerification` invalida os tokens abertos já na requisição (sem esperar o worker), e o worker invalida de novo ao emitir. Se o envio do e-mail falha, o pg-boss refaz o job, e a nova execução emite outro token, substituindo o que não chegou ao usuário.
- **Riscos:** se o e-mail sair e a confirmação do job se perder, o usuário recebe 2 e-mails e só o último link vale. É aceitável para a verificação; o lembrete de dose tem regra própria (TS-017).
- **Aplica-se a:** `resend-verification.ts` e `issue-verification.ts`.

## DC-021 — Token de verificação no fragmento do link (08/10/2026)

- **Contexto:** o link de verificação precisa levar o token, e logs não podem conter tokens (RNF de logs).
- **Decisão:** link `${WEB_BASE_URL}/conta/verificar#token=<token>`. O fragmento não é enviado ao servidor web nem aparece no `Referer`; a aplicação web lê o token e chama `verifyAccount`.
- **Riscos:** nenhum. A rota exata da aplicação web pode mudar quando ela for construída.
- **Aplica-se a:** `issue-verification.ts`.

## DC-022 — Processo do worker na base de código da API (08/10/2026)

- **Contexto:** o AGENTS §6 exige separação entre aplicação web, API e workers, e a estrutura de referência reserva `apps/worker`. Os consumidores precisam dos módulos de domínio que vivem em `apps/api`.
- **Alternativas:** pacote `apps/worker` importando `apps/api` por exports e project references; processo separado com o mesmo código.
- **Decisão:** o worker é um **processo e uma implantação separados** (`apps/api/src/worker.ts`, entrada `worker-main.ts`) que reaproveitam os módulos da API. `apps/worker/README.md` aponta para eles.
- **Riscos:** baixos. Mover para `apps/worker` depois é mecânico.
- **Aplica-se a:** `apps/api/src/worker.ts`, `worker-main.ts` e `apps/worker/README.md`.

## DC-023 — Falhas de login indistinguíveis (08/10/2026)

- **Contexto:** a OpenAPI exige que e-mail inexistente e senha incorreta sejam indistinguíveis (401). A Especificação diz que a conta nova não autentica antes da verificação, mas não define a resposta.
- **Decisão:** senha errada, e-mail inexistente e conta fora de `ACTIVE` (pendente ou com exclusão agendada) respondem o mesmo `401 AUTHENTICATION_REQUIRED` e contam como falha para o bloqueio. Para e-mail inexistente, a senha é verificada contra um hash Argon2id de referência, o que equaliza o tempo de resposta.
- **Riscos:** o usuário com conta pendente não recebe "verifique seu e-mail" no login. A interface pode orientar o reenvio da verificação sem revelar o estado da conta.
- **Aplica-se a:** `apps/api/src/modules/identity/application/sessions.ts`.

## DC-024 — Janela e reinício do contador de falhas de login (08/10/2026)

- **Contexto:** o DEC-016 e o CA-004 fixam 5 falhas em 15 min e 15 min de bloqueio, mas não o tipo de janela nem o efeito de um login bem-sucedido.
- **Decisão:** a janela começa na primeira falha e vale 15 min. A 5ª falha dentro dela ainda responde 401 e bloqueia por 15 min a partir dali. Durante o bloqueio, toda tentativa (inclusive com a senha certa) responde 423 com `Retry-After` e não conta nova falha. Login bem-sucedido apaga o contador.
- **Riscos:** baixos. O rate limit por IP limita a varredura de e-mails.
- **Aplica-se a:** `apps/api/src/modules/identity/application/login-throttle.ts`.

## DC-025 — Cookie de sessão e registro de atividade (08/10/2026)

- **Contexto:** a sessão expira por inatividade (30 min) e por duração absoluta (24 h); o DATA_MODEL diz "atualizado com throttling", sem o intervalo.
- **Decisão:** os cookies usam `Max-Age` de 24 h (duração absoluta), e o servidor controla a inatividade. A atividade é gravada no máximo 1 vez por minuto, com `idle_expires_at = mín(agora + 30 min, absolute_expires_at)`. Sessões expiradas não são marcadas como revogadas na leitura; a limpeza fica para um job futuro.
- **Riscos:** a inatividade efetiva pode passar de 30 min por até 1 min, o que é aceitável.
- **Aplica-se a:** `sessions.ts` e `session-cookies.ts`.

## DC-026 — Ordem dos controles de acesso e regra de Origin (08/10/2026)

- **Contexto:** as mutações autenticadas exigem sessão (401) e CSRF (403), e o OA-008 manda validar Origin "ou Sec-Fetch-Site".
- **Decisão:** um único guard roda antes da validação do corpo, nesta ordem: sessão (401), rate limit por titular (429) e, só nas mutações, CSRF (403). O CSRF exige que o `X-CSRF-Token`, o cookie `mr_csrf` e o HMAC esperado da sessão coincidam (comparação em tempo constante) e que o `Origin` esteja na lista do ambiente. Sem `Origin`, exige `Sec-Fetch-Site: same-origin`; sem nenhum dos dois, recusa. Os testes de segurança ficam em `tests/security`, nos caminhos planejados pela matriz, e rodam no projeto de integração.
- **Riscos:** clientes sem `Origin` nem `Sec-Fetch-Site` (fora de navegador) não conseguem fazer mutações, o que é intencional no MVP (a API é same-site com a aplicação web).
- **Aplica-se a:** `apps/api/src/platform/http/access.guard.ts` e `vitest.config.ts`.

## DC-027 — Pepper único do HMAC de e-mail (08/10/2026)

- **Contexto:** o bloqueio de login (DEC-016) e o tombstone (RN-019) usam HMAC do e-mail normalizado com pepper em KMS.
- **Decisão:** um único segredo, `EMAIL_PEPPER` (32 bytes ou mais), serve aos dois usos, mantendo um só valor para guardar e rotacionar no Secrets Manager/KMS.
- **Riscos:** rotacionar o pepper zera os contadores de falha (efêmeros) e exige recalcular os tombstones, o que deve entrar no procedimento de rotação.
- **Aplica-se a:** `apps/api/src/app.ts` e `main.ts`.

## DC-028 — Token de confirmação de duplicidade de plano (10/10/2026)

- **Contexto:** RN-016 e o schema `DuplicateConfirmation` exigem um token opaco de uso único, com TTL de 10 min, vinculado ao titular e ao hash do payload sem o próprio token. O modelo de dados não tinha onde guardar esse token.
- **Alternativas:** (a) token assinado sem estado (HMAC de titular, hash e expiração), que não garante o uso único; (b) tabela de plataforma com o hash do token e consumo atômico; (c) reaproveitar `idempotency_records`, o que mistura propósitos, e o 409 não pode virar snapshot.
- **Decisão:** (b). A tabela de plataforma `plan_duplicate_confirmations` (migração `0005_plans`) guarda o SHA-256 do token, o titular (FK em cascata), o HMAC do payload canônico sem o token, `expires_at = issued_at + 10 min` e `consumed_at`. O token tem o formato `dup_` seguido de 32 bytes aleatórios em base64url. Quando há candidato a duplicidade, o token só vale se for do titular e do mesmo payload, se não tiver sido consumido e se estiver dentro do prazo; nesse caso, ele é consumido na transação que cria o plano. Token inválido, vencido, já usado ou de outro payload equivale a token ausente: o servidor responde outro 409 com um token novo. Sem candidato, o plano é criado e o token informado é ignorado (não é consumido). A verificação de duplicidade é serializada por titular (advisory lock), então duas criações equivalentes simultâneas resultam em um 201 e um 409. O 409 confirma a transação, para que o token novo fique gravado, mas não grava snapshot de idempotência.
- **Riscos:** tokens vencidos se acumulam até existir um job de limpeza (o índice em `expires_at` já existe). O token em claro só aparece na resposta.
- **Aplica-se a:** `apps/api/migrations/0005_plans.sql`, `modules/plans/application/create-plan.ts` e DATA_MODEL §4.

## DC-029 — Normalização, período e validações de `createPlan` (10/10/2026)

- **Contexto:** RN-016 define a normalização (trim, colapso de espaços, remoção de diacríticos, sem distinção de caixa) e a "interseção de períodos", mas não detalha os limites. A Especificação também não fixa o código de erro de `end_date < start_date`.
- **Decisão:** a normalização decompõe o texto em NFD, remove as marcas combinantes, colapsa qualquer espaço Unicode (inclusive NBSP e tab), apara e converte para minúsculas. `end_date` é data civil inclusiva, então períodos que se tocam no mesmo dia se sobrepõem. `medication_name` e `dose_text` são gravados aparados, sem colapsar os espaços internos. Texto que fica vazio depois da normalização retorna 400 `VALIDATION_FAILED`. `end_date < start_date` retorna 422 `BUSINESS_RULE_VIOLATION` com `field_errors` em `end_date`, por ser uma regra entre campos que o schema não expressa. `schedule_times` volta em ordem crescente.
- **Riscos:** nenhum relevante; a regra é pura e está coberta por `tests/unit/plan-rules.spec.ts`.
- **Aplica-se a:** `packages/domain/src/plan-rules.ts` e `modules/plans/application/create-plan.ts`.

## DC-030 — Ordem e cursor de `listPlans` (10/10/2026)

- **Contexto:** a OpenAPI fixa a paginação por cursor (padrão 20, máximo 100), mas não a ordem.
- **Decisão:** os planos vêm do mais recente para o mais antigo, por `(created_at DESC, id DESC)`. O cursor é o base64url de `{t, i}`, com o `created_at` em microssegundos UTC e o `id` do último item entregue. A página seguinte começa depois dessa posição (keyset), sem repetir nem pular itens, mesmo quando o `created_at` coincide. Cursor malformado retorna 400 `VALIDATION_FAILED`. O cursor não é assinado: ele só posiciona a busca, que é sempre filtrada pelo titular da sessão.
- **Riscos:** um plano criado durante a paginação pode não aparecer nas páginas seguintes (comportamento normal de keyset).
- **Aplica-se a:** `modules/plans/application/read-plans.ts` e `platform/http/keyset-cursor.ts`, que serve às outras listas (`listOccurrences`, DC-036).

## DC-031 — Identificador de caminho fora do formato (10/10/2026)

- **Contexto:** `getPlan` e `deletePlan` não declaram 400 na OpenAPI, então um 400 sairia do contrato e viraria 500.
- **Alternativas:** (a) 400 apenas onde o contrato declara, com comportamento diferente em cada operação; (b) 404 em todas.
- **Decisão:** (b). Parâmetro de caminho fora do formato (por exemplo, um `plan_id` que não é UUID) retorna 404 `RESOURCE_NOT_FOUND`, indistinguível de um UUID inexistente. Todas as operações com parâmetro de caminho declaram 404.
- **Riscos:** nenhum; a resposta não revela existência (TS-008).
- **Aplica-se a:** `platform/http/contract-enforcement.ts`.

## DC-032 — Auditoria `ownership.denied` e `audit_events` append-only (10/10/2026)

- **Contexto:** CA-012 e TS-008 exigem auditar a tentativa de acesso a recurso de outro titular. ENT-013 define a trilha como append-only.
- **Decisão:** o evento `ownership.denied` (ator, tipo e id do recurso, `DENIED` e o `correlation_id` da resposta) é registrado quando o recurso existe e pertence a outro titular. UUID inexistente não gera evento, porque não há recurso a proteger, e a resposta é idêntica nos dois casos. `audit_events` (migração `0005_plans`) rejeita UPDATE e DELETE por trigger. A retenção de 180 dias e a pseudonimização no expurgo entram com os respectivos jobs, em migração própria. O catálogo de ações fica fechado no código (`platform/audit/audit.ts`), e o banco exige o formato `dominio.acao`.
- **Riscos:** a gravação do evento acrescenta uma escrita ao caminho negado, o que gera uma pequena diferença de tempo entre o recurso alheio e o inexistente.
- **Aplica-se a:** `platform/audit/audit.ts` e `modules/plans/application/read-plans.ts`. As próximas rotas por id seguem o mesmo padrão.

## DC-033 — Geração de ocorrências do plano pelo Outbox (10/10/2026)

- **Contexto:** RN-018 determina gerar as ocorrências ao criar ou editar o plano, via Outbox.
- **Decisão:** `createPlan` grava o evento `plans.occurrences_requested` (payload só com `plan_id`, agregado `medication_plan`) na mesma transação do plano. O worker consome a fila e chama `generateOccurrencesForHorizon` com o instante atual truncado em segundos. Como a geração é idempotente (RN-007), reentregas não duplicam ocorrências (TS-003). Até o worker processar o evento, o plano existe sem ocorrências.
- **Riscos:** há um atraso entre a criação do plano e o aparecimento das ocorrências, limitado pelo laço do despachante (1 s por padrão) e pelo polling da fila.
- **Aplica-se a:** `modules/plans/application/create-plan.ts`, `modules/occurrences/application/occurrences-requested.ts`, `worker.ts` e `platform/outbox/dispatcher.ts`.

## DC-034 — Exclusão de plano já excluído (10/10/2026)

- **Contexto:** a OpenAPI descreve `deletePlan` como "exclusão lógica idempotente" (204), mas `getPlan` trata o plano DELETED como 404. Não estava definido o que responder ao excluir de novo um plano próprio já excluído.
- **Alternativas:** (a) 404, como na leitura; (b) 204 sem alteração.
- **Decisão:** (b). Excluir de novo um plano próprio já DELETED devolve 204 e não altera `deleted_at`, `row_version` nem as ocorrências, de modo que a repetição de uma chamada com timeout não vira erro para o cliente. Plano inexistente ou de outro titular continua com 404 (auditado no segundo caso, DC-032).
- **Riscos:** o titular consegue saber que um id que já foi seu existe. Isso não expõe dado de outro titular.
- **Aplica-se a:** `modules/plans/application/delete-plan.ts`.

## DC-035 — Ocorrências na edição de plano (10/10/2026)

- **Contexto:** TS-004 e TS-027 determinam preservar as ocorrências iniciadas (`scheduled_at <= instante da ação`) e cancelar apenas as futuras PROGRAMMED. RN-018 manda regerar pelo Outbox.
- **Alternativas:** (a) cancelar só os slots que mudaram; (b) cancelar todas as futuras PROGRAMMED e regerar.
- **Decisão:** (b). Toda edição, inclusive a que só muda nome ou dose, cancela as futuras PROGRAMMED do plano e grava `plans.occurrences_requested`. O worker regera o horizonte com a configuração e os snapshots novos. Futuras já respondidas ficam, e o índice de unicidade impede regerar o mesmo slot. Horários retirados recebem `removed_at` (a FK das ocorrências antigas é preservada), e os mantidos conservam o id. Pela DEC-027, um horário novo cujo prazo do dia já passou nasce NO_RESPONSE na regeração.
- **Riscos:** cada edição produz linhas CANCELED no horizonte (até 300 por plano com 10 horários). Até o worker regerar, o plano fica sem ocorrências futuras.
- **Aplica-se a:** `modules/plans/application/update-plan.ts` e `plan-write.ts`.

## DC-036 — Escopo e ordem de `listOccurrences` (10/10/2026)

- **Contexto:** a OpenAPI resume `listOccurrences` como "Listar ocorrencias acionaveis", filtrável por `status` e paginada por cursor, sem definir o recorte de tempo, o filtro padrão nem a ordem. O lembrete web consulta a rota a cada 60 s (RF-005), e o horizonte guarda até 30 dias de ocorrências futuras.
- **Alternativas:** (a) todas as ocorrências do titular, em ordem cronológica; (b) só as já alcançadas (`scheduled_at <= agora`), da mais recente para a mais antiga.
- **Decisão:** (b). A lista traz só as ocorrências já alcançadas de planos ACTIVE do titular, ordenadas por `(scheduled_at DESC, id DESC)`, com o cursor da DC-030. Sem `status`, vêm todos os estados menos CANCELED, porque as canceladas são resíduo das edições (DC-035). Com `status` (lista separada por vírgula, `style: form`, `explode: false`), vêm exatamente os estados pedidos. Ocorrências de plano excluído ficam fora da lista (TS-005).
- **Riscos:** a agenda das doses futuras não sai desta rota. Se a interface precisar dela, a decisão vira proposta de DEC com um filtro de período no contrato.
- **Aplica-se a:** `modules/occurrences/application/read-occurrences.ts` e `platform/contract/openapi-contract.ts` (lista separada por vírgula em query).

## DC-037 — Quando uma ocorrência aceita resposta (10/10/2026)

- **Contexto:** RN-008 aceita só a primeira resposta, e RN-009 permite a resposta tardia, mas a Especificação não diz se uma ocorrência futura pode ser respondida, nem o que fazer com a ocorrência CANCELED ou de plano excluído. `createResponse` documenta 404 e 409, sem 422.
- **Alternativas:** (a) aceitar qualquer PROGRAMMED, mesmo futura; (b) aceitar PROGRAMMED ou NO_RESPONSE já alcançada (`scheduled_at <= agora`).
- **Decisão:** (b), em linha com a DC-036. Ocorrência futura, já respondida ou CANCELED recebe 409 `STATE_CONFLICT`. Ocorrência de plano excluído recebe 404, como o próprio plano, sem auditoria. A de outro titular recebe 404 idêntico e gera `ownership.denied` com `resource_type = occurrence` (DC-032). `is_late` é verdadeiro quando o prazo já foi atingido (`deadline_at <= captured_at`), mesmo que o job de prazo ainda não tenha passado a ocorrência para NO_RESPONSE. Nesse caso, `no_response_reached_at` continua nulo, e quando o marco existe ele é preservado (TS-007).
- **Riscos:** quem toma a dose alguns minutos antes do horário precisa esperar o horário para registrar. O `detail` fixo do `STATE_CONFLICT` no catálogo ("Esta ocorrência já recebeu uma resposta.") não descreve bem a ocorrência futura ou cancelada. As duas questões podem ir para uma DEC se a interface pedir.
- **Aplica-se a:** `modules/responses/application/create-response.ts`.

## DC-038 — Job de prazo NO_RESPONSE (10/10/2026)

- **Contexto:** RN-009 e CA-008 mandam passar a NO_RESPONSE, uma única vez, a ocorrência sem resposta 60 minutos após `scheduled_at`, e a Especificação (seção 6) fixa o job de prazo a cada minuto. Não estão definidos o valor do marco `no_response_reached_at`, o tratamento das passadas perdidas com o worker parado nem o das ocorrências de plano excluído.
- **Alternativas:** para o marco, (a) o `deadline_at` ou (b) o instante da varredura. Para as passadas perdidas, (a) reexecutar todas ou (b) só a mais recente.
- **Decisão:** o marco é o instante da varredura, como na geração tardia da DEC-027: ele registra quando o sistema percebeu o prazo. A varredura é um agendamento do pg-boss (`* * * * *`, fila `occurrences.deadline_sweep`) com `missed: 'once'`, porque uma passada alcança todos os prazos vencidos. Ela trabalha em lotes de 1.000 com `FOR UPDATE SKIP LOCKED`, e a corrida com `createResponse` termina em estado único (TS-013). As ocorrências iniciadas de plano excluído também passam a NO_RESPONSE, porque o histórico continua sendo fato.
- **Riscos:** com o worker parado, o marco fica atrasado em relação ao prazo real. A diferença aparece no histórico como o momento em que o sistema registrou o prazo.
- **Aplica-se a:** `modules/occurrences/application/deadline-sweep.ts` e `worker.ts`.

## DC-039 — Job horário do horizonte (10/10/2026)

- **Contexto:** a Especificação (seção 6) prevê um job horário que mantém o horizonte de 30 dias, sem dizer quais planos ele cobre nem o que fazer com passadas perdidas.
- **Alternativas:** (a) todos os planos ACTIVE; (b) só os planos ACTIVE de conta ACTIVE.
- **Decisão:** (b). A fila `occurrences.horizon_refresh` é agendada no pg-boss em `0 * * * *` com `missed: 'once'`. Cada passada gera o horizonte da DEC-027 para cada plano ACTIVE de conta ACTIVE, um plano por transação, com a geração idempotente (RN-007). A conta em exclusão (DELETION_SCHEDULED) fica de fora, porque o acesso dela já foi bloqueado (RN-012).
- **Riscos:** a passada percorre todos os planos em sequência, o que pede revisão quando o volume crescer, por exemplo lotes ou uma fila por plano. Uma data civil nova pode levar até 1 hora para entrar no fim do horizonte, sem efeito prático, porque esse fim fica 30 dias à frente.
- **Aplica-se a:** `modules/occurrences/application/horizon-refresh.ts` e `worker.ts`.

## DC-040 — Lembretes por e-mail sem reenvio cego (10/10/2026)

- **Contexto:** RN-018 fixa no máximo 1 e-mail por ocorrência, em `scheduled_at`, sem nome do medicamento, dose ou link com token. A DEC-005 e o FL-004 adotam DELIVERY_UNKNOWN com conciliação e sem reenvio cego, e o TS-017 exige retomada do worker sem e-mail duplicado. Não estão definidos o disparo, a janela de conciliação, o texto do e-mail, a supressão nem o uso dos retries de RNF-007 (1 s, 2 s e 4 s, só para operações idempotentes).
- **Alternativas:** para o disparo, (a) job agendado por ocorrência na geração ou (b) varredura a cada minuto. Para a tentativa, (a) registrar depois do envio ou (b) registrar antes, como incerta.
- **Decisão:**
  - **Disparo:** varredura a cada minuto (fila `reminders.sweep`, `* * * * *`, `missed: 'once'`). Ela cria o lembrete REQUESTED de cada ocorrência PROGRAMMED com `scheduled_at <= agora < deadline_at`, de plano ACTIVE e conta ACTIVE, e grava o evento `reminders.email_requested` no Outbox na mesma transação. O `UNIQUE(occurrence_id)` garante o lembrete único. Se o worker ficar parado até depois do prazo, o lembrete não sai, porque a ocorrência já está atrasada.
  - **Envio:** o consumidor bloqueia o lembrete e, antes de chamar o provedor, confirma a tentativa como DELIVERY_UNKNOWN (`attempts = 1`, `reconcile_until = +24 h`). Só um lembrete REQUESTED é enviado. Reentrega, retomada ou erro incerto nunca reenviam, e a queda antes do envio também termina em DELIVERY_UNKNOWN, como o TS-017 admite. Aceite vira SENT com o `provider_message_id`. Recusa definitiva (`EmailRejectedError`, inclusive provedor não configurado) vira FAILED PROVIDER_REJECTED. Não há retry, porque o envio de e-mail não é idempotente (RNF-007).
  - **Supressão:** ocorrência respondida vira FAILED SUPPRESSED_RESPONDED. Ocorrência cancelada, plano excluído ou conta em exclusão viram FAILED SUPPRESSED_DELETION (TS-034).
  - **Conciliação:** evidência positiva dentro da janela (`confirmReminderDelivery`, para o futuro consumidor de eventos do SES, que identifica o lembrete pela `reference` enviada como tag) vira SENT. Com a janela encerrada, FAILED DELIVERY_UNCONFIRMED.
  - **Texto:** substituído pela DEC-031 (10/10/2026). O assunto é "Lembrete: <nome> às <HH:MM>", e o corpo traz o nome do medicamento (snapshot da ocorrência), o horário local previsto e o endereço raiz da aplicação, sem dose nem token. A versão inicial era genérica, sem nome nem horário.
- **Riscos:** a falha entre a confirmação da tentativa e o envio perde o lembrete, que fica registrado como incerto. Sem o adaptador SES (OA-004), não existe conciliação positiva, e todo envio incerto termina FAILED DELIVERY_UNCONFIRMED.
- **Aplica-se a:** `modules/reminders/application/email-reminders.ts`, `platform/email/email-sender.ts`, `worker.ts` e `migrations/0006_reminders.sql`.

## DC-041 — Período e conteúdo de `getHistory` (10/10/2026)

- **Contexto:** RN-010 fixa o período civil inclusivo de até 12 meses, aplicado como intervalo semiaberto no fuso da conta, e CA-009 a ordem decrescente. Não estão definidos como contar os "12 meses", quais ocorrências entram nem o erro de período inválido (`getHistory` só documenta 400).
- **Alternativas:** para o recorte, (a) filtrar por `local_scheduled_date` ou (b) por `scheduled_at` no intervalo `[início do dia start, início do dia seguinte a end)`, com o início do dia resolvido no fuso da conta.
- **Decisão:**
  - **Recorte:** (b), como manda a RN-010. A meia-noite inexistente avança, como no tempo civil (`resolveCivilInstant`).
  - **Limite de 12 meses:** `end` vai no máximo até a véspera de `start` + 12 meses (01/01/2026 a 31/12/2026 passa; até 01/01/2027, não). Quando o dia de `start` não existe no mês de chegada, como 29/02, vale o último dia desse mês.
  - **Erros:** `end` antes de `start` ou período maior que 12 meses retornam 400 `VALIDATION_FAILED` no campo `end`, com `code` BEFORE_START ou PERIOD_TOO_LONG. Data ausente ou inexistente é barrada pelo contrato.
  - **Conteúdo:** entram as ocorrências do titular já alcançadas (`scheduled_at <= agora`), sem as CANCELED, com a resposta (ou `null`). As de plano excluído continuam, porque o histórico é preservado (TS-005, TS-037).
  - **Ordem e paginação:** `(scheduled_at DESC, id DESC)`, com o cursor da DC-030.
- **Riscos:** as ocorrências futuras do período não aparecem, porque histórico é o que já aconteceu. As CANCELED somem do histórico, mas continuam no banco.
- **Aplica-se a:** `packages/domain/src/history-window.ts` e `modules/history/application/read-history.ts`.

## DC-042 — Exportação em PDF (10/10/2026)

- **Contexto:** RF-008, RN-011 e FL-005 definem o pedido assíncrono, o snapshot, o PDF privado e pesquisável com expiração em 24 h, o cancelamento e o download com 410 depois da expiração. Não estão definidos a biblioteca do PDF, o armazenamento fora da AWS, o conteúdo do documento, o tratamento das falhas nem as respostas de download para os estados sem arquivo.
- **Decisão:**
  - **Biblioteca:** pdfkit 0.20.2 (MIT, publicada em 30/08/2026, `npm audit` sem achados), com fonte padrão Helvetica (WinAnsi), o que deixa o texto pesquisável. O pdf-lib foi descartado por estar sem manutenção desde 2022.
  - **Armazenamento:** porta `ObjectStorage` com chave determinística `exports/<titular>/<pedido>.pdf`, que nunca sai na API. Há um adaptador em memória (testes) e outro em disco (`EXPORT_STORAGE_DIR`, desenvolvimento). O adaptador S3 entra com a infraestrutura AWS, e sem armazenamento configurado as exportações falham.
  - **Validação:** o período segue a regra da DC-041. Fora dela, `createExport` retorna 422 `BUSINESS_RULE_VIOLATION` em `end_date`, que é o código que a operação documenta.
  - **Processamento:** o consumidor de `exports.requested` congela o snapshot e passa o pedido a PROCESSING antes de gerar o PDF. Na retomada, reaproveita o snapshot. Erro do armazenamento é relançado para o pg-boss refazer, e snapshot ilegível leva a FAILED TECHNICAL_FAILURE. A conclusão só acontece se o pedido continuar PROCESSING. Se ele foi cancelado no meio, o arquivo é removido. Na conclusão ficam o checksum e o tamanho, `expires_at = completed_at + 24 h`, e o snapshot é descartado.
  - **Job a cada minuto** (`exports.expiry_sweep`): COMPLETED vencido passa a EXPIRED, com o arquivo removido. PROCESSING parado há 30 minutos ou mais passa a FAILED TECHNICAL_FAILURE.
  - **Leitura:** COMPLETED vencido já aparece como EXPIRED, antes mesmo de o job passar.
  - **Download:** responde só para COMPLETED dentro do prazo, com `Cache-Control: no-store`, `Content-Disposition: attachment` e checksum conferido. Arquivo expirado retorna 410 `RESOURCE_EXPIRED`. REQUESTED, PROCESSING, FAILED e CANCELED retornam 404, porque não há arquivo e o contrato não prevê outro código.
  - **Conteúdo:** o PDF traz o período e o fuso, o instante de geração, um aviso de que é registro declaratório e não prescrição, e para cada ocorrência alcançada a data, o horário, o medicamento, a dose e a resposta (com motivo, instante e atraso). Não traz nome nem e-mail do titular, e a ordem é decrescente, como no histórico.
- **Riscos:** o PDF contém dado de saúde. A proteção vem da sessão, da titularidade, do armazenamento privado e da expiração. Uma falha ao apagar um arquivo pode deixar o objeto órfão, sem acesso pela API porque a chave nunca sai. A política de ciclo de vida do bucket S3 deve cobrir esse caso.
- **Aplica-se a:** `modules/exports/**`, `platform/storage/object-storage.ts`, `worker.ts`, `main.ts`, `worker-main.ts` e `migrations/0007_exports.sql`.

## DC-043 — Conta, preferências e revogação global de sessões (10/10/2026)

- **Contexto:** `updateCurrentAccount` altera só o nome, as preferências de acessibilidade são substituídas por `PUT` e `revokeAllSessions` exige senha, `Idempotency-Key` e CSRF (TS-044). Não estão definidos o tratamento de espaços no nome nem a proteção contra tentativa de senha em série na reautenticação, que hoje só teria o limite por titular de 100 requisições por minuto.
- **Alternativas para a reautenticação:** (a) só o limite por titular; (b) contar as falhas no bloqueio do login (RN-005).
- **Decisão:**
  - **Nome:** gravado sem espaços nas pontas. Só espaços retorna 400 `VALIDATION_FAILED` em `name`.
  - **Preferências:** substituídas por inteiro e devolvidas.
  - **Reautenticação:** (b). A `Idempotency-Key` é consultada antes da senha, para o replay e o payload divergente seguirem o TS-038. Senha errada retorna 401 sem revogar e conta uma falha no mesmo contador do login (HMAC do e-mail). Com o bloqueio ativo, a reautenticação recebe 401 sem conferir a senha, porque a operação não documenta 423. Sucesso zera o contador, como no login, e revoga todas as sessões do titular com `REVOKE_ALL`, limpando os cookies.
- **Riscos:** quem tem uma sessão roubada pode bloquear o login do titular por 15 minutos errando a senha cinco vezes. É o mesmo efeito de tentar o login com o e-mail dele, já aceito na RN-005.
- **Lacuna normativa (DEC-032):** a OpenAPI 02.33.4 não documenta 400 em `createSession`, `revokeAllSessions` e `requestAccountDeletion`. Corpo inválido ou falta da `Idempotency-Key` nessas operações sai do contrato e vira 500. A correção vai em PR normativo, e o passo 4 do TS-038 em `revokeAllSessions` fica como `it.todo` até lá.
- **Aplica-se a:** `modules/identity/application/account-settings.ts` e `revoke-all-sessions.ts`.

## DC-044 — Redefinição de senha (14/10/2026)

- **Contexto:** a OpenAPI define `requestPasswordReset` (202 neutro) e `confirmPasswordReset` (204, 400, 409, 410) e a RN-017 fixa o token de 60 min, de uso único, com o novo pedido invalidando o anterior. Não estão definidos: quais estados de conta recebem o link, quando usar 409 e 410, o tratamento de token já usado, o momento da checagem da senha comprometida e o efeito no bloqueio de login.
- **Alternativas para token já usado:** (a) 204 sem efeito, como no `verifyAccount` (DC-019); (b) 410 `TOKEN_EXPIRED`. A opção (a) diria ao usuário que uma senha diferente foi gravada sem gravar nada.
- **Decisão:**
  - **Pedido:** só conta `ACTIVE` recebe o link. Conta inexistente, `PENDING_VERIFICATION` ou `DELETION_SCHEDULED` recebe a mesma resposta, sem efeito. Quem não verificou a conta usa o reenvio da verificação antes. O pedido invalida os tokens abertos na própria requisição e grava `identity.password_reset_requested` no Outbox; o worker emite o token e envia o e-mail, no molde da DC-008, DC-020 e DC-021, com o link `${WEB_BASE_URL}/conta/redefinir-senha#token=<token>`.
  - **Confirmação:** (b). Token desconhecido, usado, expirado ou substituído responde 410 `TOKEN_EXPIRED`, sem distinguir os casos. Token válido de conta fora de `ACTIVE` responde 409 `STATE_CONFLICT` e o token continua aberto. A senha da lista local é recusada antes de olhar o token (400 `PASSWORD_COMPROMISED`, TS-036), sem consumi-lo, para o usuário tentar outra senha com o mesmo link.
  - **Efeitos do sucesso:** grava o hash Argon2id, consome o token, invalida os demais abertos, revoga todas as sessões da conta com `PASSWORD_RESET` e zera o contador de falhas de login (RN-005), como o login bem-sucedido (DC-024).
- **Riscos:** o pedido só tem o limite por IP das rotas públicas, então alguém pode enviar vários e-mails de redefinição a um endereço alheio trocando de IP; cada pedido invalida o link anterior, sem mudar a senha. Zerar o bloqueio na redefinição é aceitável porque quem tem o link controla o e-mail da conta.
- **Aplica-se a:** `modules/identity/application/request-password-reset.ts` e `confirm-password-reset.ts`; migração `0008_password_reset.sql`.

## DC-045 — Área de privacidade e pedido de exclusão da conta (14/10/2026)

- **Contexto:** `getPrivacy` precisa do canal externo de direitos, que depende do GX-002 e ainda não existe. `requestAccountDeletion` responde com `deletion_request_id`, mas o modelo de dados não tem tabela de pedidos de exclusão. A Especificação não diz como a reautenticação se protege de tentativas em série, nem quando usar o 409.
- **Alternativas para o `deletion_request_id`:** (a) nova tabela de pedidos; (b) id do evento `account.deletion_requested` na auditoria (`audit_events`, append-only, sem FK, sobrevive ao expurgo); (c) UUID só no snapshot de idempotência, perdido em 7 dias.
- **Decisão:**
  - **Canal externo:** configuração da implantação (`RIGHTS_CHANNEL_URL`, opção `externalRightsChannel` do `createApp`), obrigatória no `main.ts`. Sem ela, `getPrivacy` responde 503 `DEPENDENCY_UNAVAILABLE`, porque o contrato exige `external_channel`. Os testes usam um endereço sintético `.invalid`.
  - **Direitos e prazos:** `ACCESS_HISTORY`, `EXPORT_PDF` e `DELETE_ACCOUNT`, com os prazos fixos do contrato (Q-001).
  - **Pedido de exclusão:** (b). O pedido grava `account.deletion_requested` (recurso `user_account`, sem e-mail nem senha) e devolve o id do evento. A reautenticação segue a DC-043: a `Idempotency-Key` é consultada antes da senha, a senha errada retorna 401 e conta no bloqueio do login, e com o bloqueio ativo a reautenticação recebe 401. A conta passa a `DELETION_SCHEDULED`, com `purge_due_at` 30 dias depois do pedido (o limite da RN-012), todas as sessões são revogadas com `ACCOUNT_DELETION` e os cookies são limpos. Conta que já não está `ACTIVE` (pedido concorrente de outra sessão) recebe 409 `STATE_CONFLICT`.
- **Riscos:** a auditoria tem retenção provisória de 180 dias (GX-003); depois disso o id do pedido deixa de ser rastreável. O expurgo em 30 dias e o tombstone entram no próximo PR.
- **Aplica-se a:** `modules/privacy/application/request-account-deletion.ts`, `privacy-summary.ts` e `infrastructure/privacy.controller.ts`; `platform/audit/audit.ts`; `apps/api/src/main.ts`.

## DC-046 — Expurgo da conta, tombstone e reconciliação de restore (14/10/2026)

- **Contexto:** a RN-012 exige o expurgo em até 30 dias e a RN-019 define o tombstone (user_id + HMAC do e-mail, 180 dias) para a reconciliação de restore (TS-029). Não estão definidos a cadência do job, o que conta como "dados do titular" fora das tabelas com FK para `users`, o tratamento dos PDFs no armazenamento e o momento da reconciliação.
- **Alternativas para a reconciliação:** (a) script manual no procedimento de restore; (b) a mesma passada do expurgo remove toda conta cujo id está num tombstone.
- **Decisão:**
  - **Cadência:** job `privacy.purge_sweep` a cada 15 minutos. São expurgadas as contas `DELETION_SCHEDULED` com `purge_due_at` até 1 hora à frente, para o expurgo nunca passar dos 30 dias mesmo com uma passada perdida.
  - **Escopo:** além das tabelas que saem por `ON DELETE CASCADE`, saem os snapshots de idempotência do titular (`scope_key`, que podem conter dados do plano), os eventos do Outbox dos agregados dele e o contador de falhas de login (cuja chave é o mesmo HMAC do e-mail do tombstone). Os PDFs são removidos do armazenamento antes de apagar as linhas; se o armazenamento falhar, nada é apagado e a passada seguinte refaz. A trilha de auditoria permanece: não tem FK e o `actor_user_id` fica pseudônimo quando a conta deixa de existir (append-only, ENT-013).
  - **Reconciliação:** (b), antes do expurgo em cada passada. Conta restaurada de backup anterior ao expurgo é removida de novo, sem tocar em conta nova criada com o mesmo e-mail (outro `user_id`). Tombstones com 180 dias saem na mesma passada.
  - **Configuração:** o worker passa a exigir `EMAIL_PEPPER`, o mesmo segredo da API.
- **Riscos:** entre o restore e a primeira passada (até 15 minutos) a conta restaurada pode entrar. O procedimento de restore deve rodar o job uma vez (ou manter a API fora do ar) antes de reabrir o acesso; isso entra no runbook de restore quando a infraestrutura existir (GX-003). Backups com mais de 180 dias não têm tombstone para reconciliar, o que exige retenção de backup menor que 180 dias.
- **Aplica-se a:** `modules/privacy/application/account-purge.ts`, migração `0009_purge_tombstones.sql`, `worker.ts` e `worker-main.ts`.

## DC-047 — Schemathesis na CI e entradas que viravam 500 (14/10/2026)

- **Contexto:** o TS-040 exige Schemathesis sem falhas nas 27 operações. Rodar o fuzzing contra a API exige sessão válida, mas três operações encerram a sessão ou bloqueiam o login, e o rate limit de 100 requisições por minuto por titular transformaria quase tudo em 429. A primeira execução achou dois defeitos: `Content-Type` malformado em `deletePlan` e `cancelExport` virava 400 do framework, que essas operações não declaram, e por isso 500 (DC-004); e texto com o caractere NUL (U+0000), que o PostgreSQL não armazena, virava 500 no banco.
- **Alternativas para o `Content-Type`:** (a) declarar 400 nas operações sem corpo (mudança normativa); (b) ignorar corpo e `Content-Type` nas operações sem `requestBody` no contrato, antes do parser.
- **Decisão:**
  - **Execução:** Schemathesis 4.29.4 fixado, em job próprio da CI (`QG-001 Schemathesis`), com fases de exemplos, cobertura e fuzzing, semente fixa e 25 exemplos por operação. A fase 1 cobre 24 operações com uma sessão válida; a fase 2 roda `deleteCurrentSession` com sessão própria e `revokeAllSessions` e `requestAccountDeletion` com a sessão da fase 1 (a senha gerada nunca é a do titular). As sessões são abertas antes do fuzzing, porque senhas erradas bloqueiam o login (RN-005). Cookie e `X-CSRF-Token` entram por cabeçalho, sem serem gerados como dado; a falta de autenticação é testada pelo check `ignored_auth`.
  - **Rate limit:** `createApp` aceita `rateLimits`, que só esse teste eleva. Produção e os demais testes usam os limites do RNF-006.
  - **`Content-Type`:** (b). Uma operação sem corpo não tem o que interpretar, e a correção não altera o contrato.
  - **NUL:** texto com U+0000 no corpo, na query, no caminho ou em cabeçalho do contrato recebe 400 `VALIDATION_FAILED` no campo (`INVALID`).
- **Riscos:** `createResponse` e `downloadExport` recebem quase só 404 no fuzzing (o Schemathesis não conhece ids válidos sem links na OpenAPI); esses caminhos são cobertos pelos testes de integração. Os 429 do rate limit não são exercitados aqui (estão em `rate-limit.spec.ts`).
- **Aplica-se a:** `platform/contract/openapi-contract.ts`, `platform/http/contract-enforcement.ts`, `platform/rate-limit/rate-limiter.ts`, `app.ts`, `tests/schemathesis/` e `.github/workflows/ci.yml`.

## DC-048 — QG-006 (SBOM e licenças) e QG-009 na CI (14/10/2026)

- **Contexto:** o QG-006 exige `npm audit`, SBOM em SPDX ou CycloneDX e "licenças avaliadas conforme a política do projeto", mas o projeto não tem política de licenças. O QG-009 exige o TS-008 e o TS-023 como gate.
- **Alternativas para a SBOM:** (a) ferramenta externa (CycloneDX CLI, Syft); (b) `npm sbom`, embutido no npm 11.
- **Decisão:**
  - **SBOM:** (b), em CycloneDX, só das dependências de produção (`--omit dev`), publicada como artefato `sbom-cyclonedx` do job `QG-006 Dependencies`. Sem dependência nova.
  - **Política de licenças:** só licenças permissivas (0BSD, Apache-2.0, BlueOak-1.0.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0, ISC, MIT, Unlicense). Em expressão SPDX, `OR` passa com uma alternativa aceita e `AND` exige todas. Componente sem licença declarada só passa com exceção revisada, presa à versão: hoje `png-js@2.0.0` (MIT no arquivo LICENSE) e `ssh2@1.17.0` (MIT no campo legado `licenses`). Os pacotes do workspace ficam fora. A lista de senhas comprometidas (MIT, DEC-029) não é pacote npm e segue documentada no próprio diretório.
  - **QG-009:** `npm run test:ownership` roda o TS-023, que cobre todas as rotas privadas e inclui o cenário do TS-008, em job próprio.
  - Os jobs novos não entram como obrigatórios no ruleset sem decisão do mantenedor.
- **Riscos:** a política é provisória até existir parecer jurídico sobre licenças; ampliá-la exige nova DC. O Trivy entra quando o projeto produzir imagem de contêiner.
- **Aplica-se a:** `tools/scripts/sbom.mjs`, `tools/scripts/license-policy.mjs`, `package.json` e `.github/workflows/ci.yml`.

## DC-049 — QG-005: Gitleaks, Semgrep e CodeQL; actions fixadas por SHA (14/10/2026)

- **Contexto:** o QG-005 exige CodeQL, Semgrep e Gitleaks, reprovando achado crítico ou alto sem exceção formal e qualquer segredo exposto. A primeira varredura do Gitleaks no histórico achou 12 ocorrências da regra genérica `generic-api-key`, todas senhas e tokens sintéticos dos testes e exemplos da OpenAPI. O Semgrep não achou nada de severidade `ERROR`; os avisos eram actions do GitHub fixadas por tag, que pode ser movida.
- **Decisão:**
  - **Gitleaks** 8.30.1 em todo o histórico, baixado da release oficial com o SHA-256 conferido. Exceção única em `.gitleaks.toml`: a regra `generic-api-key` não vale em `tests/` e nas OpenAPI da raiz, onde os dados são sintéticos por regra (AGENTS.md §15). As demais regras valem em todo o repositório.
  - **Semgrep** 1.170.0 fixado, com os rulesets `p/default`, `p/typescript` e `p/nodejs`. Reprova achado de severidade `ERROR` (alta); os avisos ficam no log. As regras vêm do registro do Semgrep a cada execução.
  - **CodeQL** com as consultas `security-extended`, em workflow próprio (PR, `main` e semanal), publicando o resultado na aba Security. O job reprova resultado com `security-severity` >= 7.0 (alta ou crítica).
  - **Actions** do GitHub fixadas pelo SHA do commit, com a versão em comentário.
- **Riscos:** as regras do registro do Semgrep e do CodeQL mudam sem PR, e um achado novo pode reprovar um PR sem relação com ele. Nesse caso, o achado é tratado ou recebe exceção formal (DC). Atualizar uma action exige trocar o SHA.
- **Aplica-se a:** `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/workflows/traceability-validation.yml`, `.gitleaks.toml`, `tools/security/requirements.txt` e `tools/scripts/sarif-gate.mjs`.

## DC-050 — QG-010: testes de mutação no domínio (14/10/2026)

- **Contexto:** o QG-010 exige Stryker com Mutation Score de pelo menos 80% (Foundation) e trata exclusão indevida do escopo como não conformidade. O código de `apps/api` depende do PostgreSQL: mutá-lo exigiria rodar a suíte de integração por mutante, com horas por execução. Com o Vitest 5, o `@stryker-mutator/vitest-runner` 10.0.0 não ativa os mutantes: todos sobreviviam, inclusive os que os testes matam quando aplicados à mão.
- **Alternativas para o runner:** (a) `vitest-runner`, que não funciona com o Vitest 5; (b) runner `command`, que executa o Vitest uma vez por mutante e ativa o mutante pela variável `__STRYKER_ACTIVE_MUTANT__`; (c) voltar para o Vitest 4.
- **Decisão:**
  - **Escopo desta etapa:** `packages/domain` inteiro (tempo civil, horizonte, janela do histórico, slots de ocorrência e regras de plano), com os testes unitários do domínio (`vitest.mutation.config.ts`). As regras de domínio que vivem em `apps/api` entram quando forem extraídas para funções puras ou quando houver orçamento de CI para mutação com banco.
  - **Runner:** (b), com o Vitest chamado direto pelo Node, `--bail 1` e tempo-limite de 60 s por mutante, para não contar sobrevivente como timeout.
  - **Limites:** `break` em 80% (Foundation), `low` 85% e `high` 90%. O job `QG-010 Mutation` publica o relatório HTML como artefato.
  - **Dependências:** só o `@stryker-mutator/core` 10.0.0. A transitiva `qs` recebe `overrides` para 6.16.0, que corrige duas vulnerabilidades moderadas.
- **Riscos:** a execução leva de 10 a 20 minutos e roda a cada PR. Os mutantes sobreviventes listados no relatório indicam asserções a reforçar e devem ser tratados em PRs seguintes.
- **Aplica-se a:** `stryker.config.mjs`, `vitest.mutation.config.ts`, `package.json` e `.github/workflows/ci.yml`.

## DC-051 — Conta pendente antiga (TS-028) e cobertura de TS-002, TS-012 e TS-025 (14/10/2026)

- **Contexto:** o TS-028 pede que a conta pendente antiga seja "removida sem órfãos", mas a Especificação não diz a partir de quando a conta pendente é antiga. O `DATA_MODEL.md` já previa o índice `(status, created_at) WHERE status = 'PENDING_VERIFICATION'` para essa limpeza. O TS-002 pede o lembrete com falha "FAILED auditado" e a ocorrência intacta; o TS-012 e o TS-025 tinham cobertura sem a marca de rastreabilidade.
- **Alternativas para o prazo:** 7 dias (igual à idempotência), 30 dias (igual ao expurgo da conta, Q-001) ou nenhum.
- **Decisão:**
  - **TS-028:** a conta que segue `PENDING_VERIFICATION` 30 dias depois do cadastro é removida na passada do expurgo (DC-046), pelo mesmo caminho: tokens, eventos do Outbox, contador de login e o snapshot do `createAccount`, que tem escopo `public` e é localizado pelo `user_id` da resposta. Não grava tombstone: a conta nunca foi ativada, e uma cópia restaurada continua pendente e antiga, então a passada seguinte a remove de novo. O e-mail fica livre para novo cadastro. Como o prazo preenche lacuna da Especificação, ele foi proposto como DEC-033 no PR normativo da matriz 2.1.9.
  - **TS-002:** "auditado" é o próprio registro do lembrete (`email_reminders` com `FAILED`, `failure_code` e tentativas), sem evento em `audit_events`. O teste confere também que a ocorrência não muda.
  - **TS-012:** o CRM só tem o formato validado pelo contrato (RN-001), e a criação do plano não faz chamada externa.
  - **TS-025:** coberto pelas constraints nomeadas de `db-core.spec.ts`.
- **Riscos:** quem cadastrar e não verificar em 30 dias precisa se cadastrar de novo; o reenvio da verificação continua disponível até lá.
- **Aplica-se a:** `modules/privacy/application/account-purge.ts` e aos testes `ts-028.spec.ts`, `reminders.spec.ts`, `plans.spec.ts` e `db-core.spec.ts`.

## DC-052 — Fundação da aplicação web e entrada (TL-002) (14/10/2026)

- **Contexto:** o mantenedor escolheu, em 14/10/2026, começar a aplicação web com estilo neutro e aplicar o design system depois. A ADR fixa Next.js, React, TypeScript strict e Tailwind e exige Playwright e axe (QG-007 e QG-008). Não estavam definidos: como o navegador chega à API com os cookies da sessão e o CSRF, a mensagem de credencial inválida no login e a forma de rodar os testes E2E.
- **Alternativas para chegar à API:** (a) o navegador chama a API em outra origem (CORS e cookies entre sites); (b) a aplicação encaminha `/api/*` à API (mesma origem).
- **Decisão:**
  - **Origem única:** (b), por `rewrites` do Next com `MEUREMEDIO_API_URL` lida no build. Os cookies `mr_session` e `mr_csrf` ficam na origem da aplicação, sem CORS, e a API recebe o `Origin` dela.
  - **Cliente da API** (`src/lib/api-client.ts`): mutações levam o `X-CSRF-Token` copiado do cookie `mr_csrf` e a `Idempotency-Key` quando exigida. Problem vira `ApiProblem`; falha de rede ou resposta sem Problem vira `ApiUnavailable`. Nada é repetido nem enfileirado offline (TS-010). As mensagens ao usuário são as do catálogo de erros da Especificação.
  - **Entrar (TL-002):** credencial inválida, conta pendente ou e-mail inexistente mostram a mesma mensagem, "E-mail ou senha incorretos.", sem revelar se o e-mail existe. O bloqueio mostra a mensagem do ERR-004 com os minutos do `Retry-After`. Sem sessão, a área logada leva a `/entrar?proximo=<caminho>`, e o destino só é aceito se for caminho interno (sem redirecionamento aberto).
  - **Segurança das respostas:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restrita e `Cache-Control: no-store` nas páginas. A CSP com nonce fica para um PR próprio do spike de segurança do frontend (S6).
  - **Imagens:** otimização desligada (`images.unoptimized`). O `sharp`, dependência opcional do Next, traz binários da libvips em LGPL-3.0 e nunca é carregado. A política de licenças (DC-048) aceita a LGPL só na família `@img/sharp-*`, com esse motivo.
  - **E2E:** Playwright com Chromium contra PostgreSQL real (Testcontainers), a API compilada e a aplicação em modo de produção (`next build` e `next start`), em série. O rate limit fica elevado só nesse ambiente. axe verifica WCAG 2.2 A e AA em cada tela. Um único job cobre o QG-007 e o QG-008.
  - **Estilo:** neutro, com contraste AA, foco visível e respeito a `prefers-reduced-motion`.
- **Riscos:** a URL da API fica fixada no build da aplicação. A CSP ainda não existe. As demais telas (TL-001, TL-003 a TL-008) entram em PRs seguintes.
- **Aplica-se a:** `apps/web`, `tests/e2e`, `tools/scripts/license-policy.mjs`, `package.json`, `eslint.config.mjs` e `.github/workflows/ci.yml`.

## DC-053 — Cadastro (TL-001), confirmação de e-mail e redefinição de senha na web (14/10/2026)

- **Contexto:** o cadastro exige aceitar os Termos de uso e o Aviso de privacidade em versões informadas pelo cliente, mas os textos finais dependem de parecer jurídico (GX-001 a GX-006). O fuso da conta não muda depois do cadastro (RN-013). O e-mail já cadastrado responde 409 `STATE_CONFLICT` (DEC-030), cuja mensagem de catálogo ("Esta ocorrência já recebeu uma resposta.") não serve ao cadastro.
- **Decisão:**
  - **Textos legais:** páginas `/termos` e `/aviso-de-privacidade` com texto provisório e versão `2026-10`, marcadas como provisórias. Elas precisam ser substituídas pelos textos aprovados antes de qualquer uso com dados reais.
  - **Fuso:** vem do navegador (`Intl`) e pode ser trocado numa lista; a tela avisa que ele não muda depois.
  - **Validação:** a tela confere antes de enviar as mesmas regras do contrato (nome, e-mail, senha, aceites) e mostra o erro em cada campo, com o resumo do ERR-001. Os erros que só a API conhece (senha comprometida, fuso recusado) aparecem no campo com a mensagem de `field_errors`.
  - **E-mail já cadastrado:** "Já existe uma conta com este e-mail. Entre ou redefina a senha." A DEC-030 já expõe a existência do e-mail no cadastro.
  - **Idempotência:** a `Idempotency-Key` é a mesma enquanto o payload não muda, então repetir um envio que falhou na rede não cria conta nova, e um payload diferente usa chave nova.
  - **Links com token:** o token é lido do fragmento e removido da URL na hora, para não ficar no histórico. Confirmação: link usado ou expirado mostra o ERR-008 e leva ao reenvio; conta fora de `PENDING_VERIFICATION` mostra "Esta conta não está aguardando confirmação.". Redefinição: o ERR-008 leva a pedir outro link, e a confirmação divergente é recusada na tela. No sucesso, a tela avisa que todas as sessões foram encerradas.
  - **Pedidos neutros** (reenvio e esqueci a senha): a tela mostra a mensagem da própria resposta 202, sem revelar se a conta existe.
  - **E2E:** o `global-setup` sobe também o worker, com os e-mails gravados num arquivo, para os testes lerem os links.
- **Riscos:** os textos legais são placeholders, o que reforça que não pode haver uso com dados reais antes dos gates GX. A lista de fusos do navegador pode ter nomes que a API não aceita; nesse caso o erro aparece no campo.
- **Aplica-se a:** `apps/web/src/app/cadastro`, `conta/*`, `termos`, `aviso-de-privacidade`, `components/fields.tsx`, `components/email-request-form.tsx`, `lib/forms.ts` e `tests/e2e`.

## DC-054 — Planos (TL-003) e editor de plano (TL-004) na web (15/10/2026)

- **Contexto:** a Especificação lista os estados das telas de planos (TL-003: carregando, lista vazia, lista, erro, sem permissão, conflito de versão) e do editor (TL-004: novo, editando, validação, confirmação de possível duplicidade, salvando, sucesso, conflito, timeout), mas não diz onde a lista mostra o conflito de versão, quanto tempo o cliente espera antes do estado de timeout, como a exclusão é confirmada nem os rótulos das formas e vias.
- **Alternativas para o timeout:** (a) sem limite no cliente, só a falha de rede; (b) 30 s, o mesmo tempo limite padrão da RNF-007; (c) um tempo menor, como 10 s, com risco de abortar requisições lentas que dariam certo.
- **Decisão:**
  - **Tempo limite:** (b). O cliente da API aborta a requisição sem resposta em 30 s e lança `ApiTimeout`, que também é `ApiUnavailable`. Nada é repetido automaticamente (TS-010). No editor, o estado de timeout diz que não se sabe se o plano foi salvo e que repetir o envio não cria outro plano: o mesmo payload usa a mesma `Idempotency-Key`, e a API devolve o resultado original (CA-013).
  - **Duplicidade (RN-016):** o 409 mostra os candidatos (nome e dose) e duas ações, "Criar mesmo assim", que reenvia com o `duplicate_confirmation_token` e uma nova chave (o corpo muda, então a chave muda), e "Revisar o plano", que volta ao formulário com os valores digitados.
  - **Conflito de versão:** a lista só lê; quem grava é o editor, com `If-Match` do ETag lido. Por isso o estado de conflito de versão do TL-003 aparece no editor aberto a partir da lista, com a mensagem do ERR-005 e o botão "Recarregar plano", que traz a versão atual e descarta a edição local. A `Idempotency-Key` da edição considera o ETag, para que o envio depois de recarregar seja um pedido novo.
  - **Sem permissão:** sem sessão, as telas levam a `/entrar?proximo=` (TS-019); plano inexistente, excluído ou de outro titular mostra o ERR-003, sem nenhum dado do plano (TS-008).
  - **Exclusão:** botão no editor com confirmação na própria página (sem `window.confirm`), avisando que o histórico já registrado é mantido (TS-037).
  - **Formulário:** a tela confere antes de enviar as regras do contrato `PlanWrite` e a regra de término igual ou posterior ao início (ERR-009); o CRM só tem o formato conferido (RN-001, TS-012). A data de início padrão é hoje no fuso da conta. Os horários são de 1 a 10, únicos, no fuso da conta, e saem ordenados.
  - **Rótulos:** formas e vias em pt-BR, na ordem dos enums da OpenAPI. Na lista, "Comprimido, via oral"; a via `OTHER` aparece como "outra via".
  - **Sucesso:** só com a resposta da API (RN-015). O editor volta à lista, que mostra "Plano criado.", "Plano salvo." ou "Plano excluído." uma vez.
  - **Lista:** 20 planos por página, com "Carregar mais" pelo cursor (RNF-010).
  - **Navegação:** a área logada ganha a navegação "Hoje" e "Planos".
- **Riscos:** os rótulos de forma e via são escolha desta DC e podem mudar com o design system ou com revisão de conteúdo. Uma requisição abortada pelo tempo limite pode ter sido gravada; o aviso orienta repetir, e a idempotência evita o efeito em dobro.
- **Aplica-se a:** `apps/web/src/app/planos`, `components/app-nav.tsx`, `components/fields.tsx`, `lib/api-client.ts`, `lib/plan-form.ts`, `lib/use-account.ts` e aos testes `tests/e2e/plans.spec.ts`, `tests/unit/web-plan-form.spec.ts` e `tests/unit/web-api-client.spec.ts`.

## DC-055 — Ocorrências na tela Hoje (TL-005) (15/10/2026)

- **Contexto:** o TL-005 exige os estados carregando, vazio, acionável, respondendo, sucesso, conflito e desconectado, e a RN-018 manda o lembrete web consultar `listOccurrences` a cada 60 s. A Especificação não diz quais ocorrências a tela mostra, como o motivo do NOT_TAKEN é pedido, o que é "desconectado" nem os rótulos dos motivos.
- **Alternativas para o recorte:** (a) todas as ocorrências alcançadas, inclusive as respondidas; (b) só as que ainda aceitam resposta, PROGRAMMED e NO_RESPONSE alcançadas (DC-036, DC-037).
- **Decisão:**
  - **Recorte:** (b), da mais recente para a mais antiga, com até 100 itens (o máximo do contrato). Se houver mais, a tela avisa que as anteriores ficam no histórico (TL-006). A ocorrência NO_RESPONSE mostra "Sem resposta no prazo de 60 minutos." e continua aceitando resposta (RN-009).
  - **Consulta a cada 60 s:** enquanto a página está aberta, a lista é consultada de novo a cada 60 s (RF-005, RN-018). Não há notificação do sistema nem som: o lembrete web é a própria lista atualizada.
  - **Resposta:** "Tomei" registra TAKEN. "Não tomei" abre a escolha do motivo, opcional ("Prefiro não informar" vem marcado), e "Confirmar" registra NOT_TAKEN. A `Idempotency-Key` é estável por ocorrência e corpo. A resposta aceita tira o item da lista e mostra "Resposta registrada: ...". O 409 `STATE_CONFLICT` (ERR-007) e o 404 mostram a mensagem do catálogo e recarregam a lista.
  - **Desconectado:** quando a consulta falha ou o navegador avisa que ficou sem rede, a tela mostra "Sem conexão com o serviço. A lista pode estar desatualizada." e mantém a última lista, com "Tentar agora". Ao voltar a rede, a lista é consultada de novo. Nada é enfileirado e o sucesso só aparece com a resposta da API (RN-015, TS-010).
  - **Tempo limite:** o mesmo da DC-054 (30 s). O aviso diz que não se sabe se a resposta foi registrada e que repetir não registra duas vezes (CA-013).
  - **Horário:** a tela mostra o `local_time` e a data civil da própria ocorrência ("Hoje, 08:00" ou "14/10/2026, 08:00"), sem converter fuso.
  - **Motivos:** Esqueci; Não tinha o medicamento; Preocupação com efeito colateral; Decidi não tomar; Outro motivo.
- **Riscos:** os rótulos dos motivos podem mudar com revisão de conteúdo. Um titular com mais de 100 ocorrências sem resposta só vê as 100 mais recentes na tela Hoje.
- **Aplica-se a:** `apps/web/src/app/hoje/today-screen.tsx`, `lib/occurrences.ts` e aos testes `tests/e2e/occurrences.spec.ts`, `tests/e2e/support/seed.ts` e `tests/unit/web-occurrences.spec.ts`.

## DC-056 — Histórico (TL-006) na web (15/10/2026)

- **Contexto:** o TL-006 exige os estados filtros, carregando, vazio, resultados, período inválido e erro. A DC-041 já fixou o recorte, o limite de 12 meses e os erros de `getHistory`. Não estavam definidos o período inicial da tela nem como cada ocorrência é descrita.
- **Alternativas para o período inicial:** (a) nenhum, com a consulta só depois de escolher as datas; (b) os últimos 30 dias, consultados ao abrir; (c) os últimos 12 meses.
- **Decisão:**
  - **Período inicial:** (b), de hoje menos 29 dias até hoje, no fuso da conta. A consulta roda ao abrir a tela.
  - **Período inválido:** antes de consultar, a tela confere a mesma regra da API: datas obrigatórias, término igual ou posterior ao início e no máximo 12 meses inclusivos, com o 29/02 indo ao último dia do mês. As mensagens são as da API (DC-041). Um 400 da API com `field_errors` em `start` ou `end` aparece no campo.
  - **Situação de cada ocorrência:** "Tomei" ou "Não tomei", com o motivo quando houver e "registrado com atraso" quando a resposta é tardia. Sem resposta, aparece "Aguardando resposta" (PROGRAMMED ainda no prazo) ou "Sem resposta" (NO_RESPONSE). As ocorrências de plano excluído continuam (TS-037).
  - **Paginação:** 20 por página, com "Carregar mais" pelo cursor.
  - **Erro:** a mensagem do catálogo com "Tentar de novo", sem mostrar resultado anterior como se fosse atual (TS-010).
  - **Navegação:** "Histórico" entra na navegação da área logada.
- **Riscos:** a regra de período fica duplicada na web (`lib/history.ts`) e no domínio (`historyWindow`). Os testes unitários dos dois lados cobrem os mesmos limites, e a API continua sendo a referência.
- **Aplica-se a:** `apps/web/src/app/historico`, `lib/history.ts`, `components/app-nav.tsx` e aos testes `tests/e2e/history.spec.ts`, `tests/e2e/support/seed.ts` e `tests/unit/web-history.spec.ts`.

## DC-057 — Exportação (TL-007) na web (15/10/2026)

- **Contexto:** o TL-007 exige os estados solicitando, processando, concluída, falha, expirada e sem permissão. O contrato tem `createExport`, `getExport`, `cancelExport` e `downloadExport`, mas não tem uma operação para listar as exportações do titular. Sem ela, a tela só conhece o pedido que acabou de criar.
- **Alternativas para guardar o pedido:** (a) só na memória da página, e o pedido se perde ao recarregar; (b) no armazenamento do navegador; (c) no endereço da página (`/exportacao?pedido=<id>`), que sobrevive ao recarregamento e não guarda nada no navegador. O `getExport` continua exigindo a sessão e a titularidade.
- **Decisão:**
  - **Pedido no endereço:** (c). Depois do 202, a tela vai para `/exportacao?pedido=<id>`. Uma lista de exportações exigiria uma nova operação no contrato e fica como lacuna, sem urgência: o PDF expira em 24 h (RN-011).
  - **Solicitar:** o período segue a regra do histórico (DC-041) e começa nos últimos 30 dias. A `Idempotency-Key` é estável para o mesmo período. O 422 da API em `end_date` aparece no campo da data final.
  - **Processando:** REQUESTED e PROCESSING mostram "Gerando o PDF…", com consulta a cada 2 s e o botão "Cancelar exportação" (CA-016). Se o pedido terminou antes do cancelamento (409 `STATE_CONFLICT`), a tela avisa "Esta exportação já terminou e não pode mais ser cancelada." e mostra o estado atual. A mensagem do catálogo para o `STATE_CONFLICT` fala de ocorrência e não serve aqui (DC-037).
  - **Concluída:** "PDF pronto." com o instante de expiração no fuso da conta e o link "Baixar PDF", que aponta para `downloadExport` na própria origem.
  - **Falha:** a falha técnica orienta a pedir nova exportação, e a conta fora de ACTIVE tem mensagem própria. **Expirada:** ERR-012 (CA-011), sem link de download. **Sem permissão:** pedido inexistente ou de outro titular mostra o ERR-003, sem nenhum dado do pedido (TS-008).
  - **Navegação:** "Exportar" entra na navegação da área logada.
- **Riscos:** quem sair da página sem guardar o endereço perde o acompanhamento daquele pedido e precisa solicitar outro. O identificador do pedido fica no histórico do navegador, mas sozinho não dá acesso ao arquivo.
- **Aplica-se a:** `apps/web/src/app/exportacao`, `lib/exports.ts`, `components/app-nav.tsx` e aos testes `tests/e2e/exports.spec.ts`, `tests/e2e/support/seed.ts` e `tests/unit/web-exports.spec.ts`.
- **Atualização (DEC-034, OpenAPI 02.33.6):** a lacuna da lista foi resolvida com `listExports`. A tela mantém o pedido no endereço e mostra, abaixo do formulário, as 10 exportações mais recentes, cada uma com link para acompanhá-la (`exportacao/recent-exports.tsx`).

## DC-058 — Privacidade (TL-008) na web (15/10/2026)

- **Contexto:** o TL-008 exige os estados carregando, dados, confirmação destrutiva, reautenticação, exclusão agendada e erro. `requestAccountDeletion` exige senha e a confirmação textual `EXCLUIR MINHA CONTA`. A senha errada retorna 401 sem excluir (DC-043, DC-045), o mesmo status da sessão encerrada.
- **Alternativas para o 401 da reautenticação:** (a) tratar todo 401 como sessão encerrada e levar à entrada; (b) consultar `getCurrentAccount` depois do 401: se a sessão continua válida, o problema é a senha.
- **Decisão:**
  - **Dados:** os direitos automatizados viram links para as telas (histórico e exportação). O canal externo de direitos (RF-011) aparece como link, e os prazos de retenção do contrato aparecem em pt-BR.
  - **Confirmação destrutiva:** o botão "Excluir minha conta" abre, na própria página, os avisos (acesso encerrado na hora, remoção em até 30 dias, sem como desfazer), o campo da confirmação textual e o da senha atual. A tela confere os dois antes de enviar.
  - **Reautenticação:** (b). Senha errada mostra "Senha incorreta." no campo e um aviso de que, depois de 5 tentativas erradas, é preciso aguardar 15 minutos, porque o bloqueio do login também vale aqui. Sessão encerrada leva à entrada. O 409 `STATE_CONFLICT` mostra "A exclusão desta conta já foi solicitada."
  - **Exclusão agendada:** o 202 mostra que o acesso foi encerrado em todos os dispositivos e até quando os dados serão removidos (`purge_due_at`, no fuso da conta), sem a navegação da área logada.
  - **Navegação:** "Privacidade" entra na navegação, que passa a quebrar linha em telas estreitas.
- **Riscos:** o aviso das 5 tentativas não distingue a senha errada do bloqueio já ativo, porque a API responde 401 nos dois casos.
- **Aplica-se a:** `apps/web/src/app/privacidade`, `lib/privacy.ts`, `components/app-nav.tsx` e aos testes `tests/e2e/privacy.spec.ts` e `tests/unit/web-privacy.spec.ts`.

## DC-059 — Content-Security-Policy com nonce na web (spike S6) (15/10/2026)

- **Contexto:** a ADR-001 prevê o spike S6 ("Next.js seguro") e a DC-052 deixou a CSP para um PR próprio. Com nonce, o Next exige que todas as páginas sejam renderizadas por requisição, porque o nonce precisa ser novo em cada resposta. As páginas da aplicação eram geradas no build.
- **Alternativas:** (a) CSP sem nonce, com `'unsafe-inline'` nos scripts, o que deixa a CSP sem efeito contra injeção de script; (b) CSP com hashes (SRI) e páginas estáticas, que ainda é experimental no Next e não cobre os scripts inline de cada renderização; (c) nonce por requisição gerado no `proxy.ts`, com todas as páginas dinâmicas.
- **Decisão:**
  - **CSP:** (c). O `proxy.ts` gera 128 bits aleatórios em base64 e envia a política na requisição, de onde o Next lê o nonce e o aplica aos próprios scripts, e na resposta. A política é `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`; `style-src 'self' 'nonce-…'`; `img-src 'self' blob: data:`; `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. Em produção não há `'unsafe-inline'` nem `'unsafe-eval'`. No desenvolvimento entra `'unsafe-eval'`, que o React exige para as pilhas de erro.
  - **Fora do proxy:** `/api` (respostas JSON e PDF da API), `/_next/static`, `/_next/image` e os prefetches de navegação, que não são documentos HTML.
  - **Renderização:** o layout raiz chama `connection()`, e todas as páginas passam a ser renderizadas por requisição. As páginas já eram leves e sem cache (`Cache-Control: no-store`, DC-052).
  - **HTTPS:** a política não usa `upgrade-insecure-requests`, que quebraria o E2E em `http://localhost`. O TLS 1.3 e o HSTS ficam na borda da infraestrutura.
  - **Prova:** um E2E confere o cabeçalho, o nonce novo a cada requisição, o nonce em todos os scripts e a ausência de violação de CSP numa jornada autenticada por todas as telas. Um teste unitário fixa a política.
- **Riscos:** a renderização por requisição aumenta o custo de servidor por página. Uma biblioteca futura que injete estilo ou script inline vai ser bloqueada, e o E2E de CSP acusa isso.
- **Aplica-se a:** `apps/web/src/proxy.ts`, `lib/csp.ts`, `app/layout.tsx` e aos testes `tests/e2e/csp.spec.ts` e `tests/unit/web-csp.spec.ts`.

## DC-060 — QG-011: rastreabilidade dos testes na CI (15/10/2026)

- **Contexto:** o QG-011 (AGENTS.md) reprova requisito sem teste, teste sem requisito, endpoint sem rastreabilidade e identificador inexistente, e exige verificação automática na pipeline. O `validate_all.py` confere a matriz e as fontes, mas não lê os testes, e roda só quando um documento normativo muda. A convenção `// @trace` na primeira linha de cada teste já existia sem verificação: dois testes de infraestrutura não a seguiam, e o `getHealth` aparecia só num comentário.
- **Alternativas:** (a) estender o `validate_all.py`, que é ferramenta da baseline documental e normativa; (b) um script Node próprio (`tools/scripts/trace-check.mjs`), testado como os outros gates, e um job `QG-011 Traceability` na CI que roda os dois.
- **Decisão:**
  - **Ferramenta:** (b). Todo `*.spec.ts` em `tests/` começa com `// @trace <IDs>`, com IDs dos catálogos da matriz (RF, RNF, CA, TS, ERR, RN, ENT, FL, TL, US, DEC e os QG) ou operationIds. O texto depois do primeiro `(` é comentário livre.
  - **Isenção:** teste de infraestrutura sem ID normativo começa com `// @trace-exempt <motivo>`. O motivo é obrigatório e fica visível na revisão. Hoje são dois: o runner de migrações e as premissas da toolchain.
  - **Reprova:** arquivo sem cabeçalho, identificador inexistente, `@trace` vazio, operação do contrato sem nenhum teste, e RF ou TS sem teste quando a matriz não os marca como `planned`.
  - **Pendência sem reprovar:** RF ou TS sem teste cujos artefatos na matriz estão `planned`. Hoje são RF-012 e TS-030 (incidente, procedimento operacional, GAP-004), TS-031 (rotação de chave), TS-032 (direito externo) e TS-039 (desempenho). O job lista esses itens a cada execução.
  - **CI:** o job `QG-011 Traceability (matriz, testes e contrato)` roda o `validate_all.py` e o `trace:check` em todo PR e na `main`. Ele ainda não é check obrigatório no ruleset: incluí-lo é decisão do mantenedor.
- **Riscos:** o gate confere a presença e a validade dos IDs, não se o teste de fato prova o requisito. Isso continua na revisão e nos testes sentinela.
- **Aplica-se a:** `tools/scripts/trace-check.mjs`, `package.json`, `.github/workflows/ci.yml`, `CLAUDE.md` e aos cabeçalhos de `tests/integration/migrate.spec.ts`, `tests/unit/toolchain.spec.ts` e `tests/integration/api-health.spec.ts`.

## DC-061 — Conta na web: nome, acessibilidade e sessões (15/10/2026)

- **Contexto:** a API já tem `updateCurrentAccount` (só o nome, CA-015), as preferências de acessibilidade (RF-009) e `revokeAllSessions` (TS-044), mas a lista de telas da Especificação (TL-001 a TL-008) não inclui uma tela de conta. A RF-009 pede persistir as preferências, sem dizer como a interface as aplica.
- **Alternativas para aplicar as preferências:** (a) só guardar, sem efeito na interface; (b) aplicar no elemento raiz em toda tela da área logada: escala pelo `font-size` da raiz, que o Tailwind acompanha porque usa `rem`, e alto contraste por uma marca `data-contrast` que troca as cores.
- **Decisão:**
  - **Tela `/conta`:** nome editável (sem espaços nas pontas e obrigatório, como na DC-043), e-mail e fuso só para leitura, com o aviso de que o fuso não muda (RN-013).
  - **Acessibilidade:** (b). A tela tem "Tamanho do texto" (as escalas do contrato, de 100% a 200%) e "Alto contraste". As preferências são aplicadas assim que a API confirma, e a navegação da área logada as busca e aplica a cada tela. O alto contraste usa preto sobre branco, contornos pretos e links sublinhados. A troca de estilo é feita pelo CSSOM, que a CSP com nonce permite (DC-059).
  - **Encerrar todas as sessões:** pede a senha atual na própria página. A senha errada é tratada como na DC-058: a tela confere a sessão para separá-la da sessão encerrada e avisa sobre o bloqueio. No sucesso, a tela diz que todas as sessões, inclusive a atual, foram encerradas e leva à entrada.
  - **Navegação:** "Conta" entra na navegação da área logada.
- **Riscos:** fora da área logada (entrada, cadastro), as preferências não se aplicam, porque dependem da sessão. A troca de escala acontece depois do primeiro desenho da página, o que pode causar um salto visual breve.
- **Aplica-se a:** `apps/web/src/app/conta`, `lib/accessibility.ts`, `components/app-nav.tsx`, `app/globals.css` e aos testes `tests/e2e/account.spec.ts` e `tests/unit/web-accessibility.spec.ts`.

## DC-062 — Banco indisponível responde 503 DEPENDENCY_UNAVAILABLE (22/10/2026)

- **Contexto:** a Especificação define o ERR-011 (`DEPENDENCY_UNAVAILABLE`, 503, "não declarar sucesso") e a OpenAPI o declara em todas as operações (DEC-026), mas não diz quais falhas o produzem. Até aqui, só `getPrivacy` sem canal externo configurado respondia 503; com o PostgreSQL fora do ar, toda operação respondia 500 `INTERNAL_ERROR`, o que trata indisponibilidade passageira como defeito.
- **Alternativas:** (a) manter 500 para tudo que não é Problem; (b) classificar as falhas de conexão com o PostgreSQL como 503 no filtro de Problem; (c) sondar o banco antes de cada requisição.
- **Decisão:** (b). Viram 503: erros de rede do Node.js na conexão (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH`, `ENOTFOUND`, `EAI_AGAIN`, `EPIPE`), tempo-limite de conexão do pool e conexão encerrada (mensagens do `pg` e do `pg-pool`), SQLSTATE da classe 08 e `57P01`, `57P02`, `57P03` e `53300`, inclusive quando chegam como causa encadeada ou dentro de `AggregateError`. O resto segue 500 (DEC-026). O 503 vai ao log como aviso, com `correlation_id`, e a resposta não traz detalhe técnico nem `Retry-After` (o contrato o permite, mas a Especificação não fixa um valor).
- **Riscos:** uma falha de rede que não é do banco (por exemplo, de outra dependência que use os mesmos códigos) também vira 503, o que continua correto para o cliente. Falha no meio de uma transação pode ter sido confirmada pelo servidor antes da queda da conexão; a idempotência das mutações críticas cobre a repetição.
- **Aplica-se a:** `apps/api/src/platform/db/dependency-errors.ts`, `platform/http/problem-filter.ts` e aos testes `tests/api/errors/err-011.spec.ts` e `tests/unit/dependency-errors.spec.ts`.

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

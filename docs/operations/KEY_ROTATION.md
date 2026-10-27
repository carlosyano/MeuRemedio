# Rotação dos segredos do servidor (RNF-012, TS-031)

Procedimento operacional da rotação dos segredos HMAC da API. A decisão está na DC-065 (`docs/decisions/DECISOES_CLAUDE.md`), e o comportamento é provado por `tests/security/ts-031.spec.ts` e `tests/unit/keyring.spec.ts`.

## 1. Segredos e efeito da troca

| Variável | Uso | O que depende da chave antiga | Retenção mínima da chave antiga |
|---|---|---|---|
| `CSRF_KEY` | HMAC do token CSRF vinculado à sessão (`mr_csrf`, OA-008) | mutações das sessões abertas | 24 h (duração absoluta da sessão) |
| `REQUEST_HASH_KEY` | HMAC do hash da requisição idempotente (DC-012) e da confirmação de duplicidade de plano (DC-028) | replay das 7 mutações críticas e tokens de duplicidade | 168 h (retenção dos snapshots) |
| `EMAIL_PEPPER` | HMAC do e-mail no bloqueio de login (DEC-016) e no tombstone (RN-019) | bloqueios de login em curso | 15 min (duração do bloqueio) |

O token de sessão (`mr_session`) é guardado como SHA-256, sem segredo do servidor: a leitura autorizada de uma sessão aberta não depende de nenhuma dessas chaves. O tombstone é reconciliado pelo `user_id`, e o HMAC do e-mail nele não é relido. O worker usa só o `EMAIL_PEPPER` atual, porque apenas grava.

## 2. Rotação planejada

1. Gerar a chave nova no serviço de segredos (32 bytes aleatórios, base64).
2. Publicar na API a chave nova em `NOME` e a antiga em `NOME_PREVIOUS` (lista separada por vírgula, da mais recente para a mais antiga). Atualizar o `EMAIL_PEPPER` do worker.
3. Reiniciar as tarefas da API. A chave nova assina tudo o que nasce depois, e a antiga só verifica.
4. Depois da retenção mínima da tabela acima, remover a chave antiga de `NOME_PREVIOUS` e reiniciar de novo. Para simplificar, aguardar 168 h para as três.

## 3. Rotação por comprometimento (incidente, RF-012)

1. Publicar a chave nova **sem** a comprometida em `NOME_PREVIOUS`, e reiniciar.
2. Efeitos aceitos:
   - `CSRF_KEY`: as sessões abertas recebem `403 CSRF_VALIDATION_FAILED` nas mutações e precisam entrar de novo. Revogar as sessões em lote fecha a janela.
   - `REQUEST_HASH_KEY`: o replay de um pedido anterior responde `409 IDEMPOTENCY_KEY_REUSED` em vez do snapshot, e os tokens de duplicidade em aberto deixam de valer.
   - `EMAIL_PEPPER`: os bloqueios de login em curso são perdidos.
3. Registrar a rotação no incidente (`docs/operations/RIGHTS_AND_INCIDENTS.md` §3, contenção).

## 4. Fora deste procedimento

A criptografia em repouso (RNF-002) e as chaves do banco, do armazenamento de exportações e dos backups ficam no serviço gerenciado (KMS), com rotação própria. A prova correspondente entra com a infraestrutura.

## 5. Na AWS (DC-071)

Cada segredo é um recipiente do Secrets Manager criado pelo Terraform (`meuremedio-<ambiente>/CSRF_KEY`, `/REQUEST_HASH_KEY` e `/EMAIL_PEPPER`), cifrado com a chave KMS do projeto. O valor nunca passa pelo Terraform: o operador grava o JSON abaixo, e o ECS injeta `current` em `NOME` e `previous` em `NOME_PREVIOUS`.

```json
{ "current": "<base64 de 32 bytes>", "previous": "" }
```

- Gerar a chave sem que ela apareça no histórico do shell: `openssl rand -base64 32`, colada direto no comando ou no console.
- Gravar: `aws secretsmanager put-secret-value --secret-id meuremedio-homologacao/CSRF_KEY --secret-string file://valor.json` e apagar o `valor.json` em seguida.
- Na rotação planejada, mover a chave atual para `previous` (lista separada por vírgula) e gravar a nova em `current`. Depois, forçar nova implantação dos serviços (`aws ecs update-service --force-new-deployment`), porque o ECS só lê o segredo ao iniciar a tarefa.
- `previous` precisa existir no JSON, mesmo vazio: o ECS não inicia a tarefa se a chave do JSON faltar.

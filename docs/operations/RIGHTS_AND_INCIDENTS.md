# MeuRemedio — Procedimentos Operacionais: Direitos do Titular (RF-011) e Incidentes (RF-012)

> **Status:** APROVADA em 04/10/2026 pelo mantenedor, em caráter interino (DEC-022), apoio à Especificação Funcional 02.33. Procedimentos **sem endpoint HTTP**: a OpenAPI só expõe `getPrivacy`, que informa o canal externo e os prazos de retenção. Prazos legais, base legal e textos finais dependem de GX-001, GX-002 e GX-006 e de parecer jurídico.

## 1. Princípios

- Acesso operacional por papéis IAM dedicados, com MFA, fora da API HTTP; a API tem um único papel (TITULAR).
- Toda ação operacional executa por script versionado (`npm run ops -- <comando>`, código em `apps/api/src/ops`, com `DATABASE_URL` e o principal IAM em `OPS_OPERATOR`) e gera `audit_events` (ator, ação, resultado, `correlation_id`).
- Nenhum dado de saúde, e-mail completo, token ou conteúdo da solicitação em logs (RNF-008, TS-032).
- Dados reais de titulares nunca são usados em desenvolvimento ou por agentes de IA (AGENTS.md §15).

## 2. Solicitações externas de direitos (RF-011, ENT-016)

| Etapa | Ação | Evidência |
|---|---|---|
| 1. Recebimento | Pedido chega ao canal externo aprovado em GX-002 (o canal é exposto em `getPrivacy.external_channel`). | Mensagem arquivada no canal |
| 2. Protocolo | Script `rights:register` cria o registro com protocolo `DSR-AAAAMMDD-NNNN`, tipo (`ACCESS`, `CORRECTION`, `DELETION`, `PORTABILITY`, `OPPOSITION`, `OTHER`), `due_at` conforme GX-002. | Linha em `external_rights_requests` |
| 2a. Andamento | Script `rights:advance` muda o status só para a frente (`RECEIVED` → `IN_PROGRESS` → `ANSWERED` → `CLOSED`); `ANSWERED` grava `answered_at`. | `audit_events` (`rights.request_updated`) |
| 3. Verificação | Confirmar identidade a partir do e-mail da conta, sem pedir dados de saúde. | Registro de verificação |
| 4. Execução | Acesso/portabilidade: usar o fluxo de exportação do titular quando possível. Exclusão: orientar o fluxo `requestAccountDeletion` ou executar `account:request-deletion` com auditoria. Correção de e-mail: script com dupla verificação que revoga todas as sessões. | `audit_events` |
| 5. Resposta | Responder pelo canal externo citando o protocolo. | Cópia da resposta |
| 6. Encerramento | Status `ANSWERED` e depois `CLOSED`. | `answered_at` preenchido |

O conteúdo da solicitação permanece no canal externo; o banco guarda apenas protocolo, tipo, datas e status.

Uso dos scripts (DC-066). O e-mail da conta, quando houver, entra só pela entrada padrão e serve para ligar o `user_id`; ele não é gravado, auditado nem impresso. A saída é uma linha JSON com o protocolo, e os erros não repetem os valores recebidos. Códigos de saída: 0 (sucesso), 2 (uso inválido) e 3 (recusa do procedimento).

```bash
printf '%s' 'email.da.conta@example.com' | npm run ops -- rights:register --channel email-privacidade \
  --type ACCESS --received-at 2026-10-23T09:15:00-03:00 --due-at <prazo GX-002> --email-stdin
npm run ops -- rights:advance --protocol DSR-20261023-0001 --status IN_PROGRESS
```

## 3. Incidentes de segurança (RF-012, ENT-015)

| Etapa | Ação |
|---|---|
| Detecção e triagem | Alerta de observabilidade, achado de segurança ou relato. Classificar `LOW`, `MEDIUM`, `HIGH` ou `CRITICAL`. |
| Registro | Script `incident:open` grava em `incident_records` (schema `security`), sem dados de titulares; evidências vão para cofre segregado e só a referência é gravada. |
| Contenção | Revogar sessões (em lote), rotacionar segredos e chaves (`docs/operations/KEY_ROTATION.md` §3), desativar feature flag, bloquear acesso afetado. |
| Preservação | Snapshot de logs e artefatos em armazenamento com retenção imutável; cadeia de custódia registrada. |
| Decisão | O controlador decide sobre comunicação à autoridade e aos titulares (GX-001, GX-006); a decisão fica em `decision_summary`. |
| Encerramento | Relatório pós-incidente, ações corretivas e `closed_at`. |

Cobertura de teste: TS-030 (registro, contenção, decisão e relatório) e TS-032 (protocolo sem exposição em logs).

## 4. Pendências

- Canal, prazos e textos (GX-002) e parecer sobre prazos legais (GX-001).
- Lista de contatos e exercício de incidente com fornecedores (GX-006).
- Prazo de retenção de `audit_events` (GX-003).

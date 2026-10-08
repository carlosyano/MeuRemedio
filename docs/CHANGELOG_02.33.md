# Registro de alterações — revisão 02.33 (04/10/2026)

Resultado da análise de completude do `PROJECT_CONTEXT.md` e das fontes normativas. **Aprovação humana registrada em 04/10/2026** pelo mantenedor (carlosyano), em caráter interino (AGENTS.md §19.8 e §20.1). Ver a seção "Aprovação" ao final.

## Versões

| Artefato | Antes | Depois |
|---|---|---|
| OpenAPI | 02.33.1 | **02.33.2** |
| Especificação Funcional | 02.32 | **02.33** |
| ADR-001 | v1.4 | **v1.5** |
| AGENTS.md | 1.2 | **1.3** |
| Matriz de rastreabilidade | 2.0.0 | **2.1.0** |
| PROJECT_CONTEXT.md | — | **1.1** |

## Bloqueios corrigidos

| # | Achado | Correção | Onde |
|---|---|---|---|
| 1 | Limite de sessões (CA-003) sem erro nem resposta no contrato | ERR-013 `SESSION_LIMIT_REACHED` (409) em `createSession` | OpenAPI; Spec DEC-011, RN-004, CA-003, TS-018 |
| 2 | Duplicidade de plano inexecutável | ERR-014 `DUPLICATE_CONFIRMATION_REQUIRED` (409), `DuplicateConfirmationProblem`, `duplicate_confirmation_token`, critério de duplicidade, TTL 10 min | OpenAPI; Spec DEC-012, RN-016, CA-017, TS-043 |
| 3 | CSRF exigido, mas ausente do contrato | `csrfToken` (`X-CSRF-Token`), cookie `mr_csrf`, validação de Origin, 403 `CSRF_VALIDATION_FAILED` em 11 operações | OpenAPI; Spec DEC-013, RNF-016, CA-018, TS-041, ERR-015; ADR OA-008 |
| 4 | Especificação 02.32 desatualizada | Seção 13 regenerada da OpenAPI (27 ops, 21 paths, 53 schemas); FL-005 e CANCELED; CA-006 com `If-Match` | Spec DEC-014, FL-005, CA-015, CA-016, TS-042, TS-044 |
| 5 | Modelo físico inexistente | Dicionário completo: 17 entidades, 182 campos, constraints e índices | `docs/architecture/DATA_MODEL.md` |
| 6 | Comportamentos indefinidos | Gerador, prazo e lembretes (RN-018); tokens, Argon2id e lista de senhas (RN-017); chave do bloqueio (RN-005); tombstone (RN-019); rate limit; limite de relógio; PP-001 | Spec DEC-015 a DEC-021; ADR OA-009, OA-011 |

## Lacunas médias corrigidas

- **429 em todas as operações** (exceto `getHealth`) conforme RNF-006.
- **`If-Match` ausente** documentado (400); ETag obsoleto: 409 `VERSION_CONFLICT`.
- **`Problem.code`** com enum fechado (ERR-001 a ERR-015); `Conflict` e `Gone` com exemplos por código.
- **DST (TS-024)** com fixtures calculadas (New York, Lisboa, Santiago, Lord Howe); `America/Sao_Paulo` sem DST.
- **TS bloqueadores** com cenários e dados concretos: TS-001, 008, 015, 016, 017, 023, 024, 038, 040.
- **RF-011 e RF-012** como procedimentos operacionais (`docs/operations/RIGHTS_AND_INCIDENTS.md`).
- **Infraestrutura e toolchain** detalhadas na ADR OA-010 (Node 24 LTS, npm, PostgreSQL 17, Terraform, `sa-east-1`, ECS Fargate, CD com OIDC).

## Inconsistências corrigidas

- AGENTS: maturidade "Produção" → "Desenvolvimento"; job `security` com `setup-node` e `npm ci`; QG-009 no workflow; conjunto bloqueador da fundação ampliado.
- ADR: títulos 14.1 a 14.5 realinhados ao texto; numeração 14.7 restaurada; status "EM APROVAÇÃO".
- Matriz: títulos de RF-001, RF-003, RF-006 e RF-010 corrigidos.
- RNF-010: removido "dinheiro decimal exato". RN-001/TS-012: CRM valida apenas o formato.
- OpenAPI: schema órfão `Accepted` removido; `getAccessibilityPreferences` rastreado a RF-009; descrições adicionadas às operações.
- `validate_all.py`: caminho fixo da OpenAPI atualizado para 02.33.2.
- PROJECT_CONTEXT: P0 ampliado, GX, decisões pendentes, bash além de PowerShell, opções de proteção da `main`.

## Aprovação (04/10/2026)

Aprovador: Carlos Yano (`@carlosyano`), mantenedor, em caráter interino. Aprovadas conforme a recomendação:

1. DEC-011 a DEC-025 (Especificação 02.33) e ADR OA-008 a OA-011.
2. TS-038: manter `401` no replay de `revokeAllSessions` e `requestAccountDeletion` após a revogação da própria sessão.
3. Proteção da `main`: opção C, como exceção formal (pull request e check obrigatórios por disciplina; sem push direto; agentes de IA sem permissão de merge).
4. Responsáveis: `@carlosyano` interino para desenvolver; jurista ou DPO a designar antes de dados reais ou produção.
5. PerformanceProfile PP-001 v1: aprovado como provisório; recalibrar após os spikes de infraestrutura.
6. Retenção de `audit_events`: padrão provisório de 180 dias configuráveis; definitivo em GX-003.

Efeitos: matriz 2.1.1 (hashes da Especificação e da ADR atualizados; GAP-005 resolvido; GAP-006 reduzido). OpenAPI 02.33.2 e AGENTS.md 1.3 inalterados.

## Ainda em aberto

1. Parecer jurídico e de privacidade (GX-001 a GX-006) e designação do responsável definitivo.
2. Retenção definitiva de `audit_events` (GX-003) e conteúdo final de `incident_records` (GX-006).
3. Schema Drizzle e migrações: primeira entrega da fundação Test-First.
4. Matriz: `entities` sobrescreve a linha da entidade pelo último campo do dicionário (GAP-007); preservado por compatibilidade com o schema.

## Verificação executada (revisão 02.33)

- OpenAPI 02.33.2: validador OpenAPI 3.1 sem erros e Spectral (`spectral:oas`) sem erros nem avisos.
- Especificação e ADR: validação estrutural do `.docx` aprovada.
- `validate_all.py` e `traceability-check.py`: PASS no ambiente local (schema real) e no CI do GitHub.

## Revisão 02.33.3 da OpenAPI (04/10/2026)

Decisão do mantenedor ("A e A") sobre as lacunas encontradas pelo TS-040:

1. **GAP-008:** o 410 foi removido de `createResponse` (sem base normativa na Especificação).
2. **GAP-009:** `X-Correlation-ID` passou a ser documentado em toda resposta, inclusive 202, 204 e `getHealth` (10 respostas ajustadas).

Efeitos: OpenAPI `02.33.3` (arquivo renomeado), matriz `2.1.3` (hashes, `response_statuses` de `createResponse`, lacunas resolvidas), `AGENTS.md` 1.4 e referências atualizadas na Especificação e na ADR. As regras R05 e R12 do TS-040 ficaram sem exceções.

## Revisão 02.33.4 da OpenAPI (06/10/2026)

Decisão do mantenedor sobre a lacuna encontrada ao planejar o esqueleto da API (**GAP-010**): o contrato 02.33.3 não documentava `500` e 23 operações não documentavam `503`, então uma falha inesperada (defeito ou dependência fora do ar) produziria um status fora do contrato.

1. **DEC-026 / ERR-016:** novo código `INTERNAL_ERROR` (500, `Problem`, sem alteração confirmada), com resposta `InternalError` em todas as 27 operações. Mensagem ao usuário: "Não foi possível concluir a solicitação agora. Tente novamente em instantes." Detalhes técnicos só no log, com `correlation_id`.
2. **ERR-011:** `503 DEPENDENCY_UNAVAILABLE` passa a ser declarado em todas as operações (`getHealth` mantém o schema `Health` no 503).
3. **TS-040:** nova regra R18 exige 500 e 503 em toda operação e ERR-011 e ERR-016 mapeando todas as operações.

Efeitos: OpenAPI `02.33.4` (arquivo renomeado), matriz `2.1.4` (hashes, `response_statuses`, ERR-011, ERR-016, DEC-026, `R-GAP010`), `AGENTS.md` 1.5, Especificação (tabela de erros, DEC-026, nota de revisão e referências vigentes) e ADR (referências vigentes). **Incompatibilidade aprovada:** acrescentar `INTERNAL_ERROR` ao enum fechado `Problem.code` é incompatível para clientes gerados do contrato anterior (o oasdiff acusa 100 ocorrências de `response-property-enum-value-added`, uma por resposta de erro). É o efeito esperado de um catálogo fechado; as ocorrências ficam registradas em `tools/oasdiff/approved-breaking.txt` com referência ao DEC-026.

**Aprovação:** pendente, no pull request desta revisão (AGENTS.md §19.8 e §20.1).

## DEC-027: limites do horizonte de geração (08/10/2026)

Lacuna encontrada ao implementar o gerador de ocorrências (TS-024): RF-004 e RN-018 citavam o horizonte móvel de 30 dias sem definir onde ele começa e termina, nem o que fazer, na criação do plano, com horários do dia que já passaram.

1. **DEC-027:** o horizonte vai da data civil atual no fuso da conta (ou de `start_date`, se posterior) até a data atual + 30 dias, inclusive, limitado a `end_date`.
2. Horários do dia que já passaram também são gerados: se `deadline_at` já foi atingido, a ocorrência nasce `NO_RESPONSE`, com `no_response_reached_at` igual ao instante da geração; antes do prazo, nasce `PROGRAMMED`.
3. **RN-018** passa a remeter à DEC-027.

Efeitos: Especificação (tabela de decisões, RN-018 e nota de revisão no Anexo C), matriz `2.1.5` (hash da Especificação, RN-018, DEC-027 e catálogo de decisões) e `maxProperties` de `decisions` no schema (26 → 27). OpenAPI, ADR e `AGENTS.md` inalterados. A implementação (teste vermelho e verde do gerador) vem em PR separado.

**Aprovação:** texto confirmado pelo mantenedor em 08/10/2026; aprovação formal no pull request desta revisão (AGENTS.md §19.8 e §20.1).

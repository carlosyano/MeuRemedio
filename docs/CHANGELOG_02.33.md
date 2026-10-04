# Registro de alterações — revisão 02.33 (04/10/2026)

Resultado da análise de completude do `PROJECT_CONTEXT.md` e das fontes normativas. **Todas as decisões novas são propostas e dependem de aprovação humana** (AGENTS.md §19.8 e §20.1).

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

## Não resolvido (exige decisão ou etapa posterior)

1. Aprovação humana de DEC-011 a DEC-025 e de OA-008 a OA-011.
2. **TS-038:** replay de `revokeAllSessions` e `requestAccountDeletion` após a revogação da própria sessão (retorna 401 antes da idempotência).
3. Proteção da `main` (opções A, B ou C em PROJECT_CONTEXT §8.1).
4. Responsáveis reais: `@carlosyano` é interino em `CODEOWNERS`, nos GX e nos artefatos de teste.
5. Retenção de `audit_events` (GX-003); aprovação do PP-001.
6. Schema Drizzle e migrações: primeira entrega da fundação Test-First (validadas em PostgreSQL real).
7. Matriz: `entities` sobrescreve a linha da entidade pelo último campo do dicionário (GAP-007); preservado por compatibilidade com o schema.
8. `.github/workflows/traceability-validation.yml`: atualizar se listar nomes de artefatos.

## Verificação executada

- OpenAPI 02.33.2: validador OpenAPI 3.1 sem erros e Spectral (`spectral:oas`) sem erros nem avisos.
- Especificação e ADR: validação estrutural do `.docx` aprovada.
- `validate_all.py` e `traceability-check.py` (versões do projeto): **PASS**, com hashes das quatro fontes conferidos, 27 operações e catálogos consistentes. O schema JSON da matriz não estava disponível: a etapa de schema rodou contra um schema permissivo. **Reexecute `python validate_all.py` com o schema real.**

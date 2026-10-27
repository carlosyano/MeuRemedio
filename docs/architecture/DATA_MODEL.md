# MeuRemedio — Modelo de Dados Físico e Dicionário Completo

> **Status:** APROVADO em 04/10/2026 pelo mantenedor (interino); alinhado à Especificação Funcional 02.33 (Anexo C) e à ADR-001 v1.5. Dados em PostgreSQL 17. Os schemas Drizzle e as migrações SQL serão derivados deste documento na fundação Test-First e validados contra PostgreSQL real (Testcontainers). Este arquivo não é fonte normativa independente: em conflito, prevalecem a OpenAPI (HTTP), a Especificação (comportamento) e a ADR (arquitetura).

## 1. Convenções

- Tabelas e colunas em `snake_case`; enums nativos PostgreSQL com os mesmos valores dos enums da OpenAPI.
- Instantes em `timestamptz` (UTC); datas e horários civis em `date`/`time`, interpretados no `account_timezone` da conta (RN-013).
- Toda tabela com `user_id` aplica ownership na consulta (`WHERE user_id = :sessionUser`) e na camada de aplicação (AGENTS §13.2).
- Classes LGPD usadas: `identificação`, `credencial`, `saúde sensível`, `operacional` (ADR §16.1: Confidencial/Sensível). Todo campo persistido tem classe (ADR §16.5).
- Colunas `row_version` são incrementadas pela persistência (1 vez por edição) e expostas apenas como `ETag`/representação de leitura.
- Chaves estrangeiras `ON DELETE` explícitas; expurgo de conta remove dados do titular e mantém apenas `purge_tombstones` (FL-001).
- Segredos (senha, tokens, cookie de sessão) nunca em claro: apenas hash (Argon2id para senha; SHA-256 para tokens de alta entropia).

## 2. Resumo das entidades

| ID | Tabela | Finalidade | Campos |
|---|---|---|---:|
| ENT-001 | `users` | Conta, identidade, fuso, status, consentimentos, preferências e versão. | 18 |
| ENT-002 | `verification_tokens` | Token hash de verificação, emissão, expiração e uso. | 8 |
| ENT-003 | `password_reset_tokens` | Token hash de redefinição, emissão, expiração e uso. | 8 |
| ENT-004 | `sessions` | Sessão hash, atividade, expirações, revogação e versão. | 10 |
| ENT-005 | `medication_plans` | Plano declaratório, período, status e versão. | 18 |
| ENT-006 | `schedule_times` | Horário civil único por plano. | 5 |
| ENT-007 | `occurrences` | Ocorrência civil, instantes, estado, snapshots e versão. | 16 |
| ENT-008 | `responses` | Resposta TAKEN/NOT_TAKEN, motivo, captura e atraso. | 8 |
| ENT-009 | `email_reminders` | Envio, tentativas, estado, conciliação e erro. | 13 |
| ENT-010 | `export_requests` | Pedido, snapshot, arquivo privado, checksum e expiração. | 17 |
| ENT-011 | `idempotency_records` | Chave, hash da requisição e snapshot da resposta. | 10 |
| ENT-012 | `outbox_events` | Evento transacional para processamento assíncrono. | 10 |
| ENT-013 | `audit_events` | Trilha imutável e minimizada de ações críticas. | 9 |
| ENT-014 | `purge_tombstones` | Impressão irreversível para impedir restauração indevida. | 5 |
| ENT-015 | `incident_records` | Registro segregado de incidente de segurança. | 9 |
| ENT-016 | `external_rights_requests` | Protocolo de solicitação externa de direito. | 10 |
| ENT-017 | `performance_profiles` | Perfil versionado e reproduzível de desempenho. | 8 |

Tabelas de plataforma (não são ENT do domínio): `rate_limit_counters`; `login_failure_counters`; `schema pgboss`.

## 3. Dicionário por entidade

### ENT-001 — `users`

Conta, identidade, fuso, status, consentimentos, preferências e versão.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `name` | varchar | sim | 1..120 | texto UTF-8 | - | não | - | identificação | trim; 1..120 |
| `email_normalized` | varchar | sim | 254 | e-mail minúsculo, trim | - | único | - | identificação | normalizar antes de consultar/persistir |
| `password_hash` | text | sim | Argon2id PHC | hash adaptativo | - | não | - | credencial | nunca armazenar senha em claro |
| `status` | account_status | sim | - | PENDING_VERIFICATION\|ACTIVE\|DELETION_SCHEDULED | PENDING_VERIFICATION | não | - | operacional | transições fechadas (FL-001) |
| `account_timezone` | varchar | sim | 64 | IANA canônico | - | não | - | operacional | imutável no MVP |
| `terms_version` | varchar | sim | 1..30 | texto | - | não | - | operacional | versão aceita no cadastro |
| `privacy_notice_version` | varchar | sim | 1..30 | texto | - | não | - | operacional | versão reconhecida no cadastro |
| `terms_accepted_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = created_at no cadastro |
| `privacy_acknowledged_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = created_at no cadastro |
| `text_scale` | smallint | sim | - | 100\|125\|150\|175\|200 | 100 | não | - | operacional | CHECK enum |
| `high_contrast` | boolean | sim | - | true\|false | false | não | - | operacional | - |
| `verified_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | preenchido em FL-001 |
| `deletion_requested_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | preenchido em exclusão |
| `purge_due_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | <= deletion_requested_at + 30 dias |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |
| `row_version` | bigint | sim | 64 bits | >=1 | 1 | não | - | operacional | incrementado 1x por edição; exposto como ETag |

**Constraints e índices:**
- UNIQUE(email_normalized)
- CHECK(text_scale IN (100,125,150,175,200))
- CHECK(status<>'ACTIVE' OR verified_at IS NOT NULL)
- Índice parcial (status,created_at) WHERE status='PENDING_VERIFICATION' (limpeza TS-028)

### ENT-002 — `verification_tokens`

Token hash de verificação, emissão, expiração e uso.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) ON DELETE CASCADE | operacional | - |
| `token_hash` | bytea | sim | 32 bytes | SHA-256 do token | - | único | - | credencial | token em claro nunca persistido |
| `issued_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `expires_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = issued_at + 24 h |
| `used_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | consumo atômico (UPDATE ... WHERE used_at IS NULL) |
| `superseded_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | preenchido ao reenviar (TS-021) |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |

**Constraints e índices:**
- UNIQUE(token_hash)
- Índice (user_id) WHERE used_at IS NULL AND superseded_at IS NULL

### ENT-003 — `password_reset_tokens`

Token hash de redefinição, emissão, expiração e uso.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) ON DELETE CASCADE | operacional | - |
| `token_hash` | bytea | sim | 32 bytes | SHA-256 do token | - | único | - | credencial | token em claro nunca persistido |
| `issued_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `expires_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = issued_at + 60 min |
| `used_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | uso único |
| `superseded_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | novo pedido invalida anteriores |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |

**Constraints e índices:**
- UNIQUE(token_hash); CHECK octet_length(token_hash) = 32; CHECK expires_at = issued_at + 60 min
- Índice (user_id) WHERE used_at IS NULL AND superseded_at IS NULL
- Migração: `0008_password_reset.sql`

### ENT-004 — `sessions`

Sessão hash, atividade, expirações, revogação e versão.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) ON DELETE CASCADE | operacional | - |
| `secret_hash` | bytea | sim | 32 bytes | SHA-256 do segredo do cookie | - | único | - | credencial | segredo em claro só no cookie |
| `last_activity_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado com throttling |
| `idle_expires_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = last_activity_at + 30 min |
| `absolute_expires_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = created_at + 24 h |
| `revoked_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `revoked_reason` | session_revoked_reason | não | - | LOGOUT\|REVOKE_ALL\|PASSWORD_RESET\|ACCOUNT_DELETION\|EXPIRED | null | não | - | operacional | obrigatório quando revoked_at != null |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `row_version` | bigint | sim | 64 bits | >=1 | 1 | não | - | operacional | incrementado 1x por edição; exposto como ETag |

**Constraints e índices:**
- UNIQUE(secret_hash)
- Limite de 3 sessões ativas: SELECT ... FOR UPDATE em users(id) + COUNT na mesma transação
- Índice (user_id) WHERE revoked_at IS NULL

### ENT-005 — `medication_plans`

Plano declaratório, período, status e versão.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) | operacional | ownership em toda consulta |
| `status` | plan_status | sim | - | ACTIVE\|CANCELED\|INTERRUPTED\|DELETED | ACTIVE | não | - | operacional | DELETED oculto da operação; CANCELED e INTERRUPTED pela changePlanStatus (DEC-036) |
| `medication_name` | varchar | sim | 1..120 | texto | - | não | - | saúde sensível | trim; 1..120 |
| `medication_name_norm` | varchar | sim | 1..120 | trim, espaços colapsados, sem diacríticos, minúsculo | - | não | - | saúde sensível | derivado; usado na detecção de duplicidade (RN-016) |
| `dose_text` | varchar | sim | 1..80 | texto | - | não | - | saúde sensível | trim; 1..80 |
| `dose_text_norm` | varchar | sim | 1..80 | mesma normalização | - | não | - | saúde sensível | derivado |
| `medication_form` | medication_form | sim | - | TABLET\|CAPSULE\|LIQUID\|DROPS\|INJECTION\|CREAM\|OINTMENT\|INHALER\|PATCH\|OTHER | - | não | - | saúde sensível | enum fechado |
| `administration_route` | administration_route | sim | - | ORAL\|TOPICAL\|INHALED\|NASAL\|OPHTHALMIC\|OTIC\|RECTAL\|VAGINAL\|SUBCUTANEOUS\|INTRAMUSCULAR\|OTHER | - | não | - | saúde sensível | enum fechado |
| `instructions` | varchar | não | 0..500 | texto | null | não | - | saúde sensível | - |
| `prescriber_name` | varchar | não | 0..120 | texto | null | não | - | saúde sensível | sem validação externa (RN-001) |
| `prescriber_crm` | varchar | não | <=13 | ^[A-Z]{2}-\d{4,10}$ | null | não | - | saúde sensível | somente formato (TS-012) |
| `start_date` | date | sim | - | YYYY-MM-DD | - | não | - | saúde sensível | data civil no fuso da conta |
| `end_date` | date | não | - | YYYY-MM-DD | null | não | - | saúde sensível | >= start_date |
| `deleted_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | exclusão lógica (FL-002) |
| `status_reason` | plan_status_reason | não | - | MEDICAL_ADVICE\|SIDE_EFFECT\|IMPROVED\|COST_OR_ACCESS\|OWN_DECISION\|OTHER | null | não | - | saúde sensível | motivo da última mudança de situação (DEC-036); obrigatório em CANCELED e INTERRUPTED |
| `status_note` | varchar | não | 1..200 | texto | null | não | - | saúde sensível | observação opcional da última mudança; só com motivo |
| `status_changed_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | instante da última mudança; num plano ACTIVE, marca a retomada: o gerador só cria horários posteriores a ele |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |
| `row_version` | bigint | sim | 64 bits | >=1 | 1 | não | - | operacional | incrementado 1x por edição; exposto como ETag |

**Constraints e índices:**
- CHECK(end_date IS NULL OR end_date>=start_date)
- CHECK(status<>'DELETED' OR deleted_at IS NOT NULL)
- `plans_status_change_pair_chk`: CHECK((status_reason IS NULL) = (status_changed_at IS NULL))
- `plans_status_note_chk`: CHECK(status_note IS NULL OR (char_length(status_note) BETWEEN 1 AND 200 AND status_reason IS NOT NULL))
- `plans_stopped_requires_reason_chk`: CHECK(status NOT IN ('CANCELED','INTERRUPTED') OR status_reason IS NOT NULL)
- Só a última mudança de situação fica guardada, sem o histórico das anteriores (limitação aceita na DEC-036)
- Índice (user_id,status)
- Índice (user_id,medication_name_norm,dose_text_norm) WHERE status='ACTIVE'

### ENT-006 — `schedule_times`

Horário civil único por plano.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `plan_id` | uuid | sim | 128 bits | UUID | - | não | medication_plans(id) | saúde sensível | - |
| `time_of_day` | time | sim | HH:MM | ^([01]\d\|2[0-3]):[0-5]\d$ | - | único por plano ativo | - | saúde sensível | segundos = 0 |
| `removed_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | remoção lógica preserva FK de ocorrências |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |

**Constraints e índices:**
- UNIQUE(plan_id,time_of_day) WHERE removed_at IS NULL
- No máximo 10 horários ativos por plano: trigger com bloqueio da linha do plano (RN-006); o mínimo de 1 é validado pelo serviço na transação do plano

### ENT-007 — `occurrences`

Ocorrência civil, instantes, estado, snapshots e versão.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) | operacional | denormalizado para ownership |
| `plan_id` | uuid | sim | 128 bits | UUID | - | não | medication_plans(id) | saúde sensível | - |
| `schedule_time_id` | uuid | sim | 128 bits | UUID | - | não | schedule_times(id) | saúde sensível | - |
| `local_scheduled_date` | date | sim | - | YYYY-MM-DD | - | composta | - | saúde sensível | fuso da conta |
| `local_time` | time | sim | HH:MM | HH:MM | - | composta | - | saúde sensível | - |
| `scheduled_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | saúde sensível | DST: inexistente avança; ambíguo = 1º instante (OA-003) |
| `deadline_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = scheduled_at + 60 min |
| `status` | occurrence_status | sim | - | PROGRAMMED\|NO_RESPONSE\|TAKEN\|NOT_TAKEN\|CANCELED | PROGRAMMED | não | - | saúde sensível | transições fechadas (FL-003) |
| `no_response_reached_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | instante da varredura de prazo ou da geração tardia (DC-038, DEC-027); preservado na resposta tardia |
| `medication_name_snapshot` | varchar | sim | 1..120 | texto | - | não | - | saúde sensível | cópia imutável do plano |
| `dose_text_snapshot` | varchar | sim | 1..80 | texto | - | não | - | saúde sensível | cópia imutável do plano |
| `is_late` | boolean | sim | - | true\|false | false | não | - | operacional | true se resposta após deadline_at |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |
| `row_version` | bigint | sim | 64 bits | >=1 | 1 | não | - | operacional | incrementado 1x por edição; exposto como ETag |

**Constraints e índices:**
- UNIQUE(plan_id,local_scheduled_date,local_time) WHERE status<>'CANCELED' (RN-007)
- Índice (status,deadline_at) WHERE status='PROGRAMMED' (job de prazo)
- Índice (user_id,local_scheduled_date DESC)

### ENT-008 — `responses`

Resposta TAKEN/NOT_TAKEN, motivo, captura e atraso.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `occurrence_id` | uuid | sim | 128 bits | UUID | - | único | occurrences(id) | saúde sensível | UNIQUE: primeira resposta vence |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) | operacional | ownership |
| `type` | response_type | sim | - | TAKEN\|NOT_TAKEN | - | não | - | saúde sensível | - |
| `reason` | not_taken_reason | não | - | FORGOT\|UNAVAILABLE\|SIDE_EFFECT_CONCERN\|CHOSE_NOT_TO_TAKE\|OTHER | null | não | - | saúde sensível | proibido quando type=TAKEN |
| `captured_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | instante do servidor |
| `is_late` | boolean | sim | - | true\|false | - | não | - | operacional | - |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |

**Constraints e índices:**
- UNIQUE(occurrence_id)
- CHECK(type<>'TAKEN' OR reason IS NULL)
- Imutável: UPDATE bloqueado por trigger; DELETE permitido ao expurgo em cascata (REVOKE por papel entra com os papéis IAM)

### ENT-009 — `email_reminders`

Envio, tentativas, estado, conciliação e erro.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `occurrence_id` | uuid | sim | 128 bits | UUID | - | único | occurrences(id) | operacional | 1 lembrete por ocorrência (RN-018) |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) | operacional | - |
| `status` | reminder_status | sim | - | REQUESTED\|DELIVERY_UNKNOWN\|SENT\|FAILED | REQUESTED | não | - | operacional | SENT = aceito pelo provedor |
| `attempts` | smallint | sim | - | 0..3 | 0 | não | - | operacional | retries 1 s, 2 s, 4 s (RNF-007) |
| `provider_message_id` | varchar | não | <=128 | id do SES | null | não | - | operacional | não registrar em logs com e-mail |
| `requested_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `last_attempt_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `reconcile_until` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | fim da janela de conciliação |
| `sent_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `failure_code` | varchar | não | <=64 | DELIVERY_UNCONFIRMED\|PROVIDER_REJECTED\|SUPPRESSED_DELETION\|SUPPRESSED_RESPONDED | null | não | - | operacional | obrigatório em FAILED |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |

**Constraints e índices:**
- UNIQUE(occurrence_id) (`email_reminders_occurrence_id_key`)
- FK (occurrence_id, user_id) → occurrences(id, user_id) (`email_reminders_occurrence_owner_fk`)
- CHECK: `failure_code` obrigatório e de lista fechada só em FAILED; `sent_at` em SENT; `reconcile_until` em DELIVERY_UNKNOWN
- Índice (status,reconcile_until) WHERE status='DELIVERY_UNKNOWN'

### ENT-010 — `export_requests`

Pedido, snapshot, arquivo privado, checksum e expiração.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | não | users(id) | operacional | ownership |
| `status` | export_status | sim | - | REQUESTED\|PROCESSING\|COMPLETED\|FAILED\|EXPIRED\|CANCELED | REQUESTED | não | - | operacional | CANCELED só de REQUESTED/PROCESSING |
| `start_date` | date | sim | - | YYYY-MM-DD | - | não | - | operacional | período <= 12 meses |
| `end_date` | date | sim | - | YYYY-MM-DD | - | não | - | operacional | >= start_date |
| `snapshot` | jsonb | não | <= 5 MB | histórico congelado | null | não | - | saúde sensível | anulado em estado terminal; criptografia em repouso |
| `file_object_key` | varchar | não | <=512 | chave S3 privada | null | não | - | saúde sensível | nunca exposta na API |
| `file_sha256` | bytea | não | 32 bytes | SHA-256 do PDF | null | não | - | operacional | obrigatório em COMPLETED |
| `file_size_bytes` | bigint | não | 64 bits | >0 | null | não | - | operacional | - |
| `requested_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `completed_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `expires_at` | timestamptz | cond. | us UTC | RFC 3339 UTC | null | não | - | operacional | obrigatório em COMPLETED; = completed_at + 24 h |
| `canceled_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `failure_reason` | export_failure_reason | não | - | TECHNICAL_FAILURE\|ACCOUNT_NOT_ACTIVE | null | não | - | operacional | obrigatório em FAILED |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |
| `row_version` | bigint | sim | 64 bits | >=1 | 1 | não | - | operacional | incrementado 1x por edição; exposto como ETag |

**Constraints e índices:**
- CHECK(status<>'COMPLETED' OR (file_sha256, completed_at e expires_at preenchidos e expires_at = completed_at + 24 h)) (`export_requests_completed_chk`)
- CHECK(end_date>=start_date AND end_date<=start_date+INTERVAL '12 months') (`export_requests_period_chk`; o serviço aplica a contagem inclusiva da DC-041)
- CHECK: `failure_reason` só e sempre em FAILED; `canceled_at` em CANCELED; `file_sha256` de 32 bytes; `snapshot` até 5 MB
- Índice (status,expires_at) WHERE status='COMPLETED'
- Índice (status,updated_at) WHERE status='PROCESSING' (processamento parado, DC-042)
- Índice (user_id,requested_at DESC,id DESC) (`export_requests_user_requested_idx`; lista do titular com cursor, `listExports`, DEC-034)

### ENT-011 — `idempotency_records`

Chave, hash da requisição e snapshot da resposta.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `operation_id` | varchar | sim | <=64 | operationId da OpenAPI | - | composta | - | operacional | somente operações mutáveis (8; `changePlanStatus` pela 0014, DEC-036) |
| `scope_key` | varchar | sim | <=64 | user_id (UUID) ou 'public' | - | composta | - | operacional | createAccount usa 'public' |
| `key` | varchar | sim | 1..100 | ^[A-Za-z0-9._~:+/=-]+$ | - | composta | - | operacional | validado pelo contrato |
| `request_hash` | bytea | sim | 32 bytes | SHA-256 do corpo canônico + parâmetros | - | não | - | operacional | divergência => ERR-006 |
| `response_status` | smallint | sim | - | 100..599 | - | não | - | operacional | - |
| `response_headers` | jsonb | não | <=4 KB | ETag, X-Correlation-ID | null | não | - | operacional | sem Set-Cookie |
| `response_body` | jsonb | não | <=64 KB | snapshot da resposta | null | não | - | saúde sensível | pode conter dados do plano |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |
| `expires_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = created_at + 7 dias |

**Constraints e índices:**
- UNIQUE(operation_id,scope_key,key)
- Índice (expires_at) para expurgo
- 409 DUPLICATE_CONFIRMATION_REQUIRED não é persistido

### ENT-012 — `outbox_events`

Evento transacional para processamento assíncrono.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `aggregate_type` | varchar | sim | <=40 | texto | - | não | - | operacional | - |
| `aggregate_id` | uuid | sim | 128 bits | UUID | - | não | - | operacional | sem FK (sobrevive ao expurgo do agregado) |
| `event_type` | varchar | sim | <=80 | ex.: occurrence.reminder_due | - | não | - | operacional | - |
| `payload` | jsonb | sim | <=8 KB | somente identificadores | - | não | - | operacional | proibido conteúdo de saúde e e-mail |
| `available_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `dispatched_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `attempts` | integer | sim | - | >=0 | 0 | não | - | operacional | - |
| `last_error_code` | varchar | não | <=64 | texto | null | não | - | operacional | sem stack trace |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |

**Constraints e índices:**
- Índice (available_at) WHERE dispatched_at IS NULL
- Gravada na mesma transação da alteração de domínio

### ENT-013 — `audit_events`

Trilha imutável e minimizada de ações críticas.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `occurred_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `actor_user_id` | uuid | não | 128 bits | UUID | null | não | - | identificação | sem FK; pseudonimizado no expurgo |
| `action` | varchar | sim | <=80 | ex.: auth.login_failed, ownership.denied | - | não | - | operacional | catálogo fechado em código |
| `resource_type` | varchar | não | <=40 | texto | null | não | - | operacional | `medication_plan` ou `occurrence` |
| `resource_id` | uuid | não | 128 bits | UUID | null | não | - | operacional | - |
| `outcome` | audit_outcome | sim | - | SUCCESS\|DENIED\|FAILED | - | não | - | operacional | - |
| `correlation_id` | uuid | sim | 128 bits | UUID | - | não | - | operacional | - |
| `metadata` | jsonb | não | <=2 KB | campos minimizados | null | não | - | operacional | sem e-mail completo, senha, token ou saúde |

**Constraints e índices:**
- Append-only: REVOKE UPDATE, DELETE + trigger de bloqueio
- Retenção: padrão provisório de 180 dias, configurável (aprovado em 04/10/2026); prazo definitivo em GX-003 (parecer jurídico pendente)

### ENT-014 — `purge_tombstones`

Impressão irreversível para impedir restauração indevida.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `user_id` | uuid | sim | 128 bits | UUID | - | único | - | identificação | sem FK; usado na reconciliação de restore (TS-029) |
| `email_hmac` | bytea | sim | 32 bytes | HMAC-SHA-256(email_normalized, pepper KMS) | - | não | - | identificação | irreversível sem o pepper |
| `purged_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | - |
| `expires_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | = purged_at + 180 dias |

**Constraints e índices:**
- UNIQUE(user_id); CHECK octet_length(email_hmac) = 32; CHECK expires_at = purged_at + 180 dias
- Índice (expires_at); em `users`, índice (purge_due_at) WHERE status = 'DELETION_SCHEDULED' para o job de expurgo
- Não bloqueia novo cadastro com o mesmo e-mail (DEC-018)
- Migração: `0009_purge_tombstones.sql`

### ENT-015 — `incident_records`

Registro segregado de incidente de segurança.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `opened_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | - |
| `severity` | incident_severity | sim | - | LOW\|MEDIUM\|HIGH\|CRITICAL | - | não | - | operacional | - |
| `status` | incident_status | sim | - | OPEN\|CONTAINED\|RESOLVED\|CLOSED | OPEN | não | - | operacional | - |
| `summary` | varchar | sim | <=500 | texto sem dados pessoais | - | não | - | operacional | proibido dado de titular |
| `evidence_ref` | varchar | não | <=512 | referência a cofre de evidências | null | não | - | operacional | evidência fora do banco |
| `decision_summary` | varchar | não | <=1000 | texto | null | não | - | operacional | decisão sobre notificação |
| `closed_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |

**Constraints e índices:**
- Schema segregado `security`; acesso por papel IAM operacional, sem exposição na API HTTP
- CHECKs: `summary` de 1 a 500, `evidence_ref` até 512, `decision_summary` até 1000 e obrigatória em `CLOSED`; `closed_at` exatamente em `CLOSED` e não antes de `opened_at` (DC-067)
- Migração: `0013_incidents.sql` (os GRANTs do papel operacional entram com a infraestrutura)

### ENT-016 — `external_rights_requests`

Protocolo de solicitação externa de direito.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `protocol` | varchar | sim | <=30 | DSR-YYYYMMDD-NNNN | - | único | - | identificação | protocolo não revela dados |
| `received_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | - |
| `channel` | varchar | sim | <=40 | canal aprovado em GX-002 | - | não | - | operacional | - |
| `right_type` | rights_type | sim | - | ACCESS\|CORRECTION\|DELETION\|PORTABILITY\|OPPOSITION\|OTHER | - | não | - | operacional | - |
| `user_id` | uuid | não | 128 bits | UUID | null | não | - | identificação | sem FK |
| `status` | rights_status | sim | - | RECEIVED\|IN_PROGRESS\|ANSWERED\|CLOSED | RECEIVED | não | - | operacional | - |
| `due_at` | timestamptz | sim | us UTC | RFC 3339 UTC | - | não | - | operacional | prazo aprovado em GX-002 |
| `answered_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | - |
| `updated_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | atualizado a cada escrita |

**Constraints e índices:**
- UNIQUE(protocol)
- Conteúdo da solicitação permanece no canal externo; nada de PII em logs (TS-032)
- Protocolo pelo dia UTC do recebimento; `answered_at` preenchido exatamente em `ANSWERED` e `CLOSED`; índice dos pedidos em aberto por `due_at` (DC-066)
- Migração: `0012_rights_requests.sql`

### ENT-017 — `performance_profiles`

Perfil versionado e reproduzível de desempenho.

| Campo | Tipo | Obrig. | Tam./prec. | Formato/valores | Padrão | Unicidade | FK | LGPD | Validação |
|---|---|---|---|---|---|---|---|---|---|
| `id` | uuid | sim | 128 bits | UUID v4 | gen_random_uuid() | PK | - | operacional | gerado no servidor |
| `profile_key` | varchar | sim | <=40 | ex.: PP-001 | - | composta | - | operacional | - |
| `version` | integer | sim | - | >=1 | - | composta | - | operacional | - |
| `definition` | jsonb | sim | <=64 KB | conteúdo de docs/specifications/performance-profile.v1.yaml | - | não | - | operacional | - |
| `definition_sha256` | bytea | sim | 32 bytes | SHA-256 da definição | - | não | - | operacional | - |
| `approved_at` | timestamptz | não | us UTC | RFC 3339 UTC | null | não | - | operacional | TS-039 inválido sem aprovação |
| `approved_by` | varchar | não | <=120 | identificação do aprovador | null | não | - | identificação | - |
| `created_at` | timestamptz | sim | us UTC | RFC 3339 UTC | now() | não | - | operacional | UTC |

**Constraints e índices:**
- UNIQUE(profile_key,version)
- Perfil registrado é imutável (trigger `performance_profiles_immutable`); a única escrita posterior aceita é aprovar uma vez o perfil que ainda não tem aprovação (DC-064)
- Migração: `0011_performance_profiles.sql`

## 4. Tabelas de plataforma

- `rate_limit_counters`: UNLOGGED; (scope text, key_hash bytea, window_start timestamptz, count int); PK(scope,key_hash,window_start); limpeza por job a cada 5 min (DEC-019).
- `login_failure_counters`: UNLOGGED; (email_hash bytea PK, window_start, failures smallint, locked_until timestamptz); chave = HMAC do e-mail normalizado, inclusive e-mails inexistentes (DEC-016).
- `plan_duplicate_confirmations`: token de confirmação de duplicidade de plano (RN-016, DC-028); (token_hash bytea PK = SHA-256 do token, user_id FK users ON DELETE CASCADE, request_hash bytea = HMAC do payload sem o token, issued_at, expires_at = issued_at + 10 min, consumed_at < expires_at); uso único garantido pelo consumo atômico no serviço.
- `schema pgboss`: Gerenciado pela biblioteca pg-boss (OA-002); fora do dicionário de domínio.

## 5. Regras de completude

- Cada campo possui as 11 propriedades exigidas pela Especificação §5.1 (campo, tipo, obrigatoriedade, tamanho, formato, padrão, unicidade, FK, LGPD, validação e entidade).
- Os campos expostos pela API devem ser equivalentes aos schemas da OpenAPI 02.33.8, comprovado por testes de contrato (RNF-014, TS-040).
- Pendências explícitas: retenção definitiva de `audit_events` (GX-003; padrão provisório de 180 dias configuráveis) e conteúdo final de `incident_records` (GX-006).

## 6. Estado de implementação (migrações)

| Migração | Entidades | Situação |
|---|---|---|
| `apps/api/migrations/0001_core.sql` | ENT-001 `users`, ENT-004 `sessions`, ENT-005 `medication_plans`, ENT-006 `schedule_times`, ENT-007 `occurrences`, ENT-008 `responses` | Implementada e coberta por `tests/integration/db-core.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0002_platform.sql` | ENT-011 `idempotency_records`, ENT-012 `outbox_events` | Implementada e coberta por `tests/integration/db-platform.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0003_identity.sql` | ENT-002 `verification_tokens` e a tabela de plataforma `rate_limit_counters` (UNLOGGED) | Implementada e coberta por `tests/integration/db-identity.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0004_login_failures.sql` | Tabela de plataforma `login_failure_counters` (UNLOGGED, DEC-016) | Implementada e coberta por `tests/security/ts-033.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0005_plans.sql` | ENT-013 `audit_events` (append-only por trigger) e a tabela de plataforma `plan_duplicate_confirmations` (DC-028) | Implementada e coberta por `tests/integration/db-plans.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0006_reminders.sql` | ENT-009 `email_reminders` (DC-040) | Implementada e coberta por `tests/integration/db-reminders.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0007_exports.sql` | ENT-010 `export_requests` (DC-042) | Implementada e coberta por `tests/integration/db-exports.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0010_exports_list.sql` | Índice `export_requests_user_requested_idx` de ENT-010 (`listExports`, DEC-034) | Implementada e coberta por `tests/integration/exports-list.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0011_performance_profiles.sql` | ENT-017 `performance_profiles` (imutável depois de registrado, DC-064) | Implementada e coberta por `tests/integration/db-performance.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0012_rights_requests.sql` | ENT-016 `external_rights_requests` (DC-066) | Implementada e coberta por `tests/integration/db-rights.spec.ts` e `tests/security/ts-032.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0013_incidents.sql` | ENT-015 `security.incident_records` (DC-067) | Implementada e coberta por `tests/integration/db-incidents.spec.ts` e `tests/security/ts-030.spec.ts` (PostgreSQL 17 real) |
| `apps/api/migrations/0014_plan_status.sql` | Situação de ENT-005 (CANCELED, INTERRUPTED, `status_reason`, `status_note`, `status_changed_at`) e `changePlanStatus` em `idempotency_records_operation_chk` (DEC-036) | Implementada e coberta por `tests/integration/plans-status.spec.ts` e `tests/integration/db-core.spec.ts` (PostgreSQL 17 real) |
| Demais entidades | ENT-003 (o schema do pg-boss é criado pela biblioteca) | Pendentes; entram em migrações próprias junto de cada funcionalidade |

**Rollback:** as migrações criam apenas objetos novos, sem dados nem dependentes externos; o rollback é uma migração nova que remove os objetos criados (a lista está no cabeçalho de cada arquivo). Uma migração aplicada nunca é editada.

Decisões de implementação derivadas deste modelo:

- **Titularidade no próprio esquema (defesa em profundidade contra BOLA):** chaves estrangeiras compostas garantem que a ocorrência pertence ao titular do plano (`occurrences_plan_owner_fk`), que o horário pertence ao plano (`occurrences_time_plan_fk`) e que a resposta pertence ao titular da ocorrência (`responses_occurrence_owner_fk`).
- **Limite de 10 horários ativos:** trigger com bloqueio da linha do plano (serializa inserções concorrentes). O mínimo de 1 horário é regra de serviço, validada junto com o plano.
- **Limite de 3 sessões ativas:** regra de serviço (transação com bloqueio do titular), não do esquema (TS-018).
- **Imutabilidade de `responses`:** o trigger bloqueia UPDATE; o DELETE segue permitido para o expurgo em cascata (FL-001).
- **Idempotência no esquema:** `operation_id` restrito às 8 operações com `Idempotency-Key` na OpenAPI (o teste compara com o contrato); escopo `'public'` só em `createAccount` e UUID do titular nas demais; chave no formato do contrato; `expires_at = created_at + 168 horas` (horas absolutas, independentes do fuso da conexão e do DST), com default `now() + 168 horas` para quando `created_at` também usa o default; quem informa `created_at` (Clock injetável) informa `expires_at`; snapshot sem `Set-Cookie` em qualquer caixa. Como `scope_key` é texto (`'public'` ou UUID) e não admite FK, o trigger `users_purge_idempotency` remove os snapshots do titular no expurgo da conta (FL-001), pois `response_body` pode conter dados de saúde. Não persistir o `409` e não sobrescrever o snapshot são regras de serviço (TS-015).
- **Outbox:** `payload` é objeto JSON de até 8 KB; `aggregate_id` sem FK (sobrevive ao expurgo); índice parcial dos pendentes sustenta a reivindicação com `FOR UPDATE SKIP LOCKED`. Payload apenas com identificadores é regra de serviço.
- **Schemas Drizzle:** cada módulo mapeia as próprias tabelas em `apps/api/src/modules/<módulo>/infrastructure/schema.ts`, agregadas em `apps/api/src/platform/db/schema.ts`. O SQL das migrações é a fonte do esquema; o Drizzle só tipa o acesso e não declara constraints, FKs nem índices (as FKs entre módulos ficam só no SQL). `tests/integration/drizzle-schema.spec.ts` exige que tabelas, colunas, tipos, nulidade, presença de default, chave primária e enums do Drizzle coincidam com o banco migrado.
- **Constraints nomeadas:** cada regra tem nome (`users_email_normalized_chk`, `occurrences_deadline_chk` etc.), e os testes verificam qual regra disparou.


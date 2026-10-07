-- 0002_platform: idempotencia e Outbox transacional.
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-011 e ENT-012); AGENTS.md §13; ADR-001 v1.5 OA-002.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Ficam no servico (nao no esquema): o 409 nao e persistido nem sobrescreve o snapshot original
-- (TS-015), e o payload do Outbox leva somente identificadores, sem saude nem e-mail.

-- ---------- ENT-011 idempotency_records ----------
-- Snapshot sem Set-Cookie: objeto JSON cujas chaves nao sao 'set-cookie' em nenhuma caixa.
CREATE FUNCTION idempotency_headers_ok(headers jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(headers) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(headers) AS k WHERE lower(k) = 'set-cookie')
$$;

CREATE TABLE idempotency_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id     varchar(64) NOT NULL,
  scope_key        varchar(64) NOT NULL,
  key              varchar(100) NOT NULL,
  request_hash     bytea NOT NULL,
  response_status  smallint NOT NULL,
  response_headers jsonb,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  CONSTRAINT idempotency_records_scope_key_key UNIQUE (operation_id, scope_key, key),
  -- As 7 mutacoes com Idempotency-Key na OpenAPI 02.33.3 (o teste compara com o contrato).
  CONSTRAINT idempotency_records_operation_chk CHECK (operation_id IN (
    'createAccount', 'createPlan', 'updatePlan', 'createResponse',
    'createExport', 'requestAccountDeletion', 'revokeAllSessions'
  )),
  -- createAccount e anonima (escopo 'public'); as demais usam o UUID do titular.
  CONSTRAINT idempotency_records_scope_chk CHECK (
    CASE WHEN operation_id = 'createAccount' THEN scope_key = 'public'
         ELSE scope_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    END
  ),
  CONSTRAINT idempotency_records_key_format_chk CHECK (key ~ '^[A-Za-z0-9._~:+/=-]+$'),
  CONSTRAINT idempotency_records_request_hash_len_chk CHECK (octet_length(request_hash) = 32),
  CONSTRAINT idempotency_records_status_chk CHECK (response_status BETWEEN 100 AND 599),
  CONSTRAINT idempotency_records_expiry_chk CHECK (expires_at = created_at + interval '7 days'),
  CONSTRAINT idempotency_records_headers_chk CHECK (
    response_headers IS NULL
    OR (idempotency_headers_ok(response_headers) AND octet_length(response_headers::text) <= 4096)
  ),
  CONSTRAINT idempotency_records_body_size_chk CHECK (
    response_body IS NULL OR octet_length(response_body::text) <= 65536
  )
);
CREATE INDEX idempotency_records_expires_idx ON idempotency_records (expires_at);

-- ---------- ENT-012 outbox_events ----------
-- Gravado na mesma transacao da alteracao de dominio. aggregate_id sem FK: o evento sobrevive
-- ao expurgo do agregado.
CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type  varchar(40) NOT NULL,
  aggregate_id    uuid NOT NULL,
  event_type      varchar(80) NOT NULL,
  payload         jsonb NOT NULL,
  available_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error_code varchar(64),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT outbox_events_payload_chk CHECK (
    jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192
  )
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (available_at) WHERE dispatched_at IS NULL;

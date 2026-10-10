-- 0005_plans: trilha de auditoria e tokens de confirmacao de duplicidade de plano.
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-013 e secao 4, "Tabelas de plataforma");
-- Especificacao 02.33 RN-016 e CA-012; OpenAPI 02.33.4 DuplicateConfirmation; DC-028.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Ficam no servico: o catalogo fechado de acoes de auditoria, o consumo atomico do token
-- (UPDATE ... WHERE consumed_at IS NULL) e o vinculo do token ao hash do payload.
-- Rollback (objetos novos, sem dependentes): nova migracao com
--   DROP TABLE plan_duplicate_confirmations, audit_events; DROP FUNCTION audit_events_append_only();
--   DROP TYPE audit_outcome;

-- ---------- ENT-013 audit_events ----------
CREATE TYPE audit_outcome AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

CREATE TABLE audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  -- Sem FK: a trilha sobrevive ao expurgo da conta (pseudonimizada no expurgo, ENT-013).
  actor_user_id   uuid,
  action          varchar(80) NOT NULL,
  resource_type   varchar(40),
  resource_id     uuid,
  outcome         audit_outcome NOT NULL,
  correlation_id  uuid NOT NULL,
  metadata        jsonb,
  CONSTRAINT audit_events_action_chk CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT audit_events_metadata_chk CHECK (
    metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 2048)
  )
);
CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, occurred_at);

-- Append-only (ENT-013): UPDATE e DELETE sao rejeitados por trigger. A retencao (180 dias,
-- provisoria) e a pseudonimizacao no expurgo entram com seus jobs, em migracao propria.
CREATE FUNCTION audit_events_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events e somente de insercao'
    USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'audit_events_append_only';
END
$$;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- ---------- plan_duplicate_confirmations (RN-016, DC-028) ----------
-- Token opaco de uso unico com TTL de 10 min, vinculado ao titular e ao hash do payload sem o
-- proprio token. Persistido so o SHA-256 do token.
CREATE TABLE plan_duplicate_confirmations (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL,
  -- HMAC-SHA-256 (segredo do servidor) do payload canonico sem duplicate_confirmation_token.
  request_hash  bytea NOT NULL,
  issued_at     timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  CONSTRAINT plan_duplicate_confirmations_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT plan_duplicate_confirmations_token_hash_chk CHECK (octet_length(token_hash) = 32),
  CONSTRAINT plan_duplicate_confirmations_request_hash_chk CHECK (octet_length(request_hash) = 32),
  CONSTRAINT plan_duplicate_confirmations_expiry_chk CHECK (expires_at = issued_at + interval '10 minutes'),
  CONSTRAINT plan_duplicate_confirmations_consumed_chk CHECK (
    consumed_at IS NULL OR consumed_at < expires_at
  )
);
CREATE INDEX plan_duplicate_confirmations_user_idx ON plan_duplicate_confirmations (user_id);
CREATE INDEX plan_duplicate_confirmations_expires_idx ON plan_duplicate_confirmations (expires_at);

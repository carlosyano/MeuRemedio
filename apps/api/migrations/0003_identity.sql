-- 0003_identity: tokens de verificacao de conta e contadores de rate limit.
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-002 e secao 4, "Tabelas de plataforma");
-- Especificacao 02.33 RN-017 (token de 24 h, uso unico) e DEC-019 (rate limit em PostgreSQL).
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Ficam no servico (nao no esquema): consumo atomico do token (UPDATE ... WHERE used_at IS NULL)
-- e invalidacao do token anterior ao reenviar (superseded_at).
-- Rollback (tabelas novas, sem dependentes): nova migracao com
--   DROP TABLE rate_limit_counters, verification_tokens;

-- ---------- ENT-002 verification_tokens ----------
CREATE TABLE verification_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  -- SHA-256 do token de alta entropia; o token em claro nunca e persistido.
  token_hash     bytea NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  superseded_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT verification_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT verification_tokens_token_hash_chk CHECK (octet_length(token_hash) = 32),
  -- 24 horas absolutas (independe do TimeZone da conexao).
  CONSTRAINT verification_tokens_expiry_chk CHECK (expires_at = issued_at + interval '24 hours')
);
CREATE INDEX verification_tokens_open_idx ON verification_tokens (user_id)
  WHERE used_at IS NULL AND superseded_at IS NULL;

-- ---------- rate_limit_counters (DEC-019) ----------
-- UNLOGGED: contadores efemeros, sem WAL; a perda num crash apenas zera as janelas.
CREATE UNLOGGED TABLE rate_limit_counters (
  scope         text NOT NULL,
  -- SHA-256 da chave (IP ou titular); a chave em claro nao e persistida.
  key_hash      bytea NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL,
  CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (scope, key_hash, window_start),
  CONSTRAINT rate_limit_counters_key_hash_chk CHECK (octet_length(key_hash) = 32),
  CONSTRAINT rate_limit_counters_count_chk CHECK (count >= 1)
);

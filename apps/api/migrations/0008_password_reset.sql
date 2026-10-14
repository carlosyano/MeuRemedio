-- 0008_password_reset: tokens de redefinicao de senha.
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-003); Especificacao 02.33 RN-017 (token de 60 min,
-- uso unico, novo token invalida o anterior).
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Ficam no servico (nao no esquema): consumo atomico do token (linha bloqueada com FOR UPDATE) e
-- invalidacao dos tokens anteriores a cada novo pedido (superseded_at).
-- Rollback (tabela nova, sem dependentes): nova migracao com DROP TABLE password_reset_tokens;

CREATE TABLE password_reset_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  -- SHA-256 do token de alta entropia; o token em claro nunca e persistido.
  token_hash     bytea NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  superseded_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT password_reset_tokens_token_hash_chk CHECK (octet_length(token_hash) = 32),
  -- 60 minutos absolutos (independe do TimeZone da conexao).
  CONSTRAINT password_reset_tokens_expiry_chk CHECK (expires_at = issued_at + interval '60 minutes')
);
CREATE INDEX password_reset_tokens_open_idx ON password_reset_tokens (user_id)
  WHERE used_at IS NULL AND superseded_at IS NULL;

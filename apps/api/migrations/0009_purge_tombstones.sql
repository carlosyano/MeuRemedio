-- 0009_purge_tombstones: impressao minimizada das contas expurgadas e indice do job de expurgo.
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-014); Especificacao 02.33 RN-012 (expurgo em ate
-- 30 dias) e RN-019 (tombstone com user_id + HMAC-SHA-256 do e-mail, 180 dias, usado na
-- reconciliacao de restore; nao impede novo cadastro).
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Rollback (tabela nova, sem dependentes): nova migracao com
--   DROP TABLE purge_tombstones; DROP INDEX users_purge_due_idx;

-- ---------- ENT-014 purge_tombstones ----------
CREATE TABLE purge_tombstones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem FK: a conta ja nao existe; o id serve a reconciliacao de restore (TS-029).
  user_id     uuid NOT NULL,
  -- HMAC-SHA-256(email_normalized, pepper); irreversivel sem o pepper.
  email_hmac  bytea NOT NULL,
  purged_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  CONSTRAINT purge_tombstones_user_id_key UNIQUE (user_id),
  CONSTRAINT purge_tombstones_email_hmac_chk CHECK (octet_length(email_hmac) = 32),
  -- 180 dias absolutos (independe do TimeZone da conexao).
  CONSTRAINT purge_tombstones_expiry_chk CHECK (expires_at = purged_at + interval '180 days')
);
CREATE INDEX purge_tombstones_expires_idx ON purge_tombstones (expires_at);

-- Contas aguardando o expurgo, na ordem do prazo.
CREATE INDEX users_purge_due_idx ON users (purge_due_at) WHERE status = 'DELETION_SCHEDULED';

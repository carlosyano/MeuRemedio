-- 0004_login_failures: contadores de falha de login (DEC-016, RN-005).
-- Fonte: docs/architecture/DATA_MODEL.md secao 4 ("Tabelas de plataforma").
-- Chave = HMAC-SHA-256 do e-mail normalizado com pepper do servidor, inclusive de e-mails
-- inexistentes; o e-mail em claro nao e persistido. Janela, limite (5 em 15 min) e bloqueio
-- (15 min) sao regras de servico.
-- Rollback (tabela nova, sem dependentes): nova migracao com DROP TABLE login_failure_counters;

-- UNLOGGED: contadores efemeros, sem WAL; a perda num crash apenas zera as janelas.
CREATE UNLOGGED TABLE login_failure_counters (
  email_hash    bytea PRIMARY KEY,
  window_start  timestamptz NOT NULL,
  failures      smallint NOT NULL,
  locked_until  timestamptz,
  CONSTRAINT login_failure_counters_email_hash_chk CHECK (octet_length(email_hash) = 32),
  CONSTRAINT login_failure_counters_failures_chk CHECK (failures >= 1)
);

-- 0010_exports_list: indice da listagem de exportacoes do titular (listExports, DEC-034).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-010); OpenAPI 02.33.6 listExports.
-- A lista ordena por (requested_at, id) decrescente, com cursor por chave (DC-030).
-- Rollback (indice novo, sem dependentes): nova migracao com
--   DROP INDEX export_requests_user_requested_idx;

CREATE INDEX export_requests_user_requested_idx
  ON export_requests (user_id, requested_at DESC, id DESC);

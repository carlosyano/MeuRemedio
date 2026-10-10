-- 0007_exports: pedidos de exportacao em PDF (ENT-010).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-010); Especificacao 02.33 RF-008, RN-011, FL-005;
-- DC-042.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Ficam no servico: as transicoes do FL-005, o congelamento do snapshot no processamento e o
-- descarte do snapshot e do arquivo nos estados terminais.
-- Rollback (objetos novos, sem dependentes): nova migracao com
--   DROP TABLE export_requests; DROP TYPE export_failure_reason, export_status;

CREATE TYPE export_status AS ENUM (
  'REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELED'
);
CREATE TYPE export_failure_reason AS ENUM ('TECHNICAL_FAILURE', 'ACCOUNT_NOT_ACTIVE');

CREATE TABLE export_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status          export_status NOT NULL DEFAULT 'REQUESTED',
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  -- Historico congelado (saude sensivel): anulado nos estados terminais.
  snapshot        jsonb,
  file_object_key varchar(512),
  file_sha256     bytea,
  file_size_bytes bigint,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz,
  canceled_at     timestamptz,
  failure_reason  export_failure_reason,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     bigint NOT NULL DEFAULT 1,
  -- RN-010: periodo de no maximo 12 meses (o servico aplica a contagem inclusiva da DC-041).
  CONSTRAINT export_requests_period_chk CHECK (
    end_date >= start_date AND end_date <= start_date + interval '12 months'
  ),
  -- RN-011: PDF com checksum e expiracao em 24 h.
  CONSTRAINT export_requests_completed_chk CHECK (
    status <> 'COMPLETED' OR (
      file_sha256 IS NOT NULL AND completed_at IS NOT NULL
      AND expires_at IS NOT NULL AND expires_at = completed_at + interval '24 hours'
    )
  ),
  CONSTRAINT export_requests_sha256_chk CHECK (file_sha256 IS NULL OR octet_length(file_sha256) = 32),
  CONSTRAINT export_requests_size_chk CHECK (file_size_bytes IS NULL OR file_size_bytes > 0),
  CONSTRAINT export_requests_failure_chk CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL)),
  CONSTRAINT export_requests_canceled_chk CHECK (status <> 'CANCELED' OR canceled_at IS NOT NULL),
  CONSTRAINT export_requests_snapshot_chk CHECK (
    snapshot IS NULL OR octet_length(snapshot::text) <= 5242880
  ),
  CONSTRAINT export_requests_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX export_requests_expiry_idx ON export_requests (status, expires_at)
  WHERE status = 'COMPLETED';
CREATE INDEX export_requests_processing_idx ON export_requests (status, updated_at)
  WHERE status = 'PROCESSING';

-- 0013_incidents: registro segregado de incidentes de seguranca (RF-012, TS-030, DC-067).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-015); docs/operations/RIGHTS_AND_INCIDENTS.md §3.
-- Schema segregado security: o acesso por papel IAM operacional (GRANTs) entra com a
-- infraestrutura; a API HTTP nao le nem grava esta tabela. Conteudo final pendente do GX-006.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Rollback (objetos novos, sem dependentes): nova migracao com
--   DROP SCHEMA security CASCADE;

CREATE SCHEMA security;

-- ---------- ENT-015 security.incident_records ----------
CREATE TYPE security.incident_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE security.incident_status AS ENUM ('OPEN', 'CONTAINED', 'RESOLVED', 'CLOSED');

CREATE TABLE security.incident_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  severity          security.incident_severity NOT NULL,
  status            security.incident_status NOT NULL DEFAULT 'OPEN',
  -- Tamanhos por CHECK nomeado (e nao varchar(n)), para o teste provar a regra que disparou.
  -- Texto sem dado de titular (conferido nos scripts operacionais).
  summary           varchar NOT NULL,
  -- Referencia ao cofre de evidencias; a evidencia nao entra no banco.
  evidence_ref      varchar,
  -- Decisao sobre a comunicacao a autoridade e aos titulares (GX-001, GX-006).
  decision_summary  varchar,
  closed_at         timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_records_summary_chk CHECK (char_length(summary) BETWEEN 1 AND 500),
  CONSTRAINT incident_records_evidence_chk CHECK (char_length(evidence_ref) BETWEEN 1 AND 512),
  -- Encerrar exige a decisao registrada.
  CONSTRAINT incident_records_decision_chk CHECK (
    char_length(decision_summary) BETWEEN 1 AND 1000
    AND (status <> 'CLOSED' OR decision_summary IS NOT NULL)
  ),
  -- closed_at existe exatamente em CLOSED, e nao antes da abertura.
  CONSTRAINT incident_records_closed_chk CHECK (
    (closed_at IS NOT NULL) = (status = 'CLOSED')
    AND (closed_at IS NULL OR closed_at >= opened_at)
  )
);

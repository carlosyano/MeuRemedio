-- 0012_rights_requests: protocolo das solicitacoes externas de direitos (RF-011, TS-032, DC-066).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-016); docs/operations/RIGHTS_AND_INCIDENTS.md §2.
-- O conteudo da solicitacao permanece no canal externo: nenhuma coluna o guarda.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Rollback (tabela nova, sem dependentes): nova migracao com
--   DROP TABLE external_rights_requests; DROP TYPE rights_status; DROP TYPE rights_type;

-- ---------- ENT-016 external_rights_requests ----------
CREATE TYPE rights_type AS ENUM
  ('ACCESS', 'CORRECTION', 'DELETION', 'PORTABILITY', 'OPPOSITION', 'OTHER');
CREATE TYPE rights_status AS ENUM ('RECEIVED', 'IN_PROGRESS', 'ANSWERED', 'CLOSED');

CREATE TABLE external_rights_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tamanhos por CHECK nomeado (e nao varchar(n)), para o teste provar a regra que disparou.
  protocol     varchar NOT NULL,
  received_at  timestamptz NOT NULL,
  channel      varchar NOT NULL,
  right_type   rights_type NOT NULL,
  -- Sem FK: o protocolo sobrevive ao expurgo da conta (evidencia do atendimento).
  user_id      uuid,
  status       rights_status NOT NULL DEFAULT 'RECEIVED',
  due_at       timestamptz NOT NULL,
  answered_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_rights_requests_protocol_key UNIQUE (protocol),
  -- DSR-AAAAMMDD-NNNN: data e sequencia, sem dado do titular.
  CONSTRAINT external_rights_requests_protocol_chk CHECK (protocol ~ '^DSR-[0-9]{8}-[0-9]{4}$'),
  CONSTRAINT external_rights_requests_channel_chk CHECK (char_length(channel) BETWEEN 1 AND 40),
  CONSTRAINT external_rights_requests_due_chk CHECK (due_at > received_at),
  -- A resposta existe exatamente nos estados ANSWERED e CLOSED, e nao antes do recebimento.
  CONSTRAINT external_rights_requests_answered_chk CHECK (
    (answered_at IS NOT NULL) = (status IN ('ANSWERED', 'CLOSED'))
    AND (answered_at IS NULL OR answered_at >= received_at)
  )
);
CREATE INDEX external_rights_requests_open_due_idx
  ON external_rights_requests (due_at) WHERE status IN ('RECEIVED', 'IN_PROGRESS');

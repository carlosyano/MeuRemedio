-- 0006_reminders: lembretes por e-mail (ENT-009).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-009); Especificacao 02.33 RN-018, FL-004 e DEC-005;
-- DC-040.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Ficam no servico: as transicoes REQUESTED -> DELIVERY_UNKNOWN -> SENT/FAILED, a supressao depois
-- da resposta ou da exclusao e a ausencia de reenvio cego.
-- Rollback (objetos novos, sem dependentes): nova migracao com
--   DROP TABLE email_reminders; DROP TYPE reminder_status;

CREATE TYPE reminder_status AS ENUM ('REQUESTED', 'DELIVERY_UNKNOWN', 'SENT', 'FAILED');

CREATE TABLE email_reminders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id       uuid NOT NULL,
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status              reminder_status NOT NULL DEFAULT 'REQUESTED',
  attempts            smallint NOT NULL DEFAULT 0,
  provider_message_id varchar(128),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  last_attempt_at     timestamptz,
  reconcile_until     timestamptz,
  sent_at             timestamptz,
  failure_code        varchar(64),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- RN-018: no maximo 1 e-mail de lembrete por ocorrencia.
  CONSTRAINT email_reminders_occurrence_id_key UNIQUE (occurrence_id),
  -- Defesa em profundidade contra BOLA: o lembrete pertence ao titular da ocorrencia.
  CONSTRAINT email_reminders_occurrence_owner_fk FOREIGN KEY (occurrence_id, user_id)
    REFERENCES occurrences (id, user_id) ON DELETE CASCADE,
  CONSTRAINT email_reminders_attempts_chk CHECK (attempts BETWEEN 0 AND 3),
  -- failure_code de lista fechada, obrigatorio em FAILED e ausente nos demais estados.
  CONSTRAINT email_reminders_failure_code_chk CHECK (
    (status = 'FAILED' AND failure_code IS NOT NULL AND failure_code IN (
      'DELIVERY_UNCONFIRMED', 'PROVIDER_REJECTED', 'SUPPRESSED_DELETION', 'SUPPRESSED_RESPONDED'))
    OR (status <> 'FAILED' AND failure_code IS NULL)
  ),
  CONSTRAINT email_reminders_sent_chk CHECK (status <> 'SENT' OR sent_at IS NOT NULL),
  -- DELIVERY_UNKNOWN sempre tem o fim da janela de conciliacao (DEC-005).
  CONSTRAINT email_reminders_reconcile_chk CHECK (
    status <> 'DELIVERY_UNKNOWN' OR reconcile_until IS NOT NULL
  )
);
CREATE INDEX email_reminders_reconcile_idx ON email_reminders (status, reconcile_until)
  WHERE status = 'DELIVERY_UNKNOWN';

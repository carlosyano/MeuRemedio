-- 0014_plan_status: situacao do plano com cancelar, interromper e retomar (DEC-036).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-005); Especificacao 02.33 DEC-036; OpenAPI 02.33.8
-- (PlanStatus, PlanStatusReason, changePlanStatus).
-- O plano guarda so a ultima mudanca de situacao (motivo, observacao e instante), sem historico.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- ALTER TYPE ... ADD VALUE roda na transacao da migracao, mas o valor novo nao pode ser usado nela:
-- por isso os CHECKs comparam status::text.
-- Rollback: valores de enum nao se removem; nova migracao com
--   ALTER TABLE medication_plans DROP COLUMN status_reason, DROP COLUMN status_note,
--     DROP COLUMN status_changed_at; DROP TYPE plan_status_reason;
--   e idempotency_records_operation_chk sem changePlanStatus (com os planos CANCELED e
--   INTERRUPTED e os registros de changePlanStatus tratados antes).

ALTER TYPE plan_status ADD VALUE 'CANCELED' BEFORE 'DELETED';
ALTER TYPE plan_status ADD VALUE 'INTERRUPTED' BEFORE 'DELETED';

CREATE TYPE plan_status_reason AS ENUM (
  'MEDICAL_ADVICE', 'SIDE_EFFECT', 'IMPROVED', 'COST_OR_ACCESS', 'OWN_DECISION', 'OTHER'
);

ALTER TABLE medication_plans
  ADD COLUMN status_reason     plan_status_reason,
  ADD COLUMN status_note       varchar,
  ADD COLUMN status_changed_at timestamptz,
  -- Motivo e instante andam juntos: ou nunca houve mudanca, ou ha os dois.
  ADD CONSTRAINT plans_status_change_pair_chk CHECK (
    (status_reason IS NULL) = (status_changed_at IS NULL)
  ),
  -- Observacao opcional de 1 a 200 caracteres, so junto de um motivo.
  ADD CONSTRAINT plans_status_note_chk CHECK (
    status_note IS NULL OR (char_length(status_note) BETWEEN 1 AND 200 AND status_reason IS NOT NULL)
  ),
  -- Cancelado e interrompido sempre tem o motivo.
  ADD CONSTRAINT plans_stopped_requires_reason_chk CHECK (
    status::text NOT IN ('CANCELED', 'INTERRUPTED') OR status_reason IS NOT NULL
  );

-- changePlanStatus entra nas mutacoes com Idempotency-Key (AGENTS.md §13; o teste compara com o
-- contrato).
ALTER TABLE idempotency_records
  DROP CONSTRAINT idempotency_records_operation_chk,
  ADD CONSTRAINT idempotency_records_operation_chk CHECK (operation_id IN (
    'createAccount', 'createPlan', 'updatePlan', 'changePlanStatus', 'createResponse',
    'createExport', 'requestAccountDeletion', 'revokeAllSessions'
  ));

-- 0016_treatment_reasons: motivo do tratamento (DEC-038).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-018); Especificacao 02.33 DEC-038; OpenAPI 02.33.10
-- (TreatmentReason, TreatmentReasonRef, listTreatmentReasons, treatment_reason_snapshot).
-- O motivo e dado de saude sensivel declarado pelo titular: sai com a conta (ON DELETE CASCADE) e e
-- apagado pela aplicacao quando nenhum plano nao excluido o usa.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Rollback (objetos novos): nova migracao com
--   ALTER TABLE occurrences DROP COLUMN treatment_reason_snapshot;
--   ALTER TABLE medication_plans DROP COLUMN treatment_reason_id;
--   DROP TABLE treatment_reasons;

-- ---------- ENT-018 treatment_reasons ----------
CREATE TABLE treatment_reasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Nome como foi gravado da primeira vez; name_norm segue normalizePlanText (como na RN-016).
  name        varchar NOT NULL,
  name_norm   varchar NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treatment_reasons_id_user_key UNIQUE (id, user_id),
  CONSTRAINT treatment_reasons_user_name_key UNIQUE (user_id, name_norm),
  CONSTRAINT treatment_reasons_name_len_chk CHECK (
    char_length(name) BETWEEN 1 AND 80 AND char_length(name_norm) BETWEEN 1 AND 80
  )
);

-- Um motivo por plano; ownership pela FK composta. Apagar o motivo so desfaz o vinculo
-- (SET NULL apenas na coluna do motivo, PostgreSQL 15+).
ALTER TABLE medication_plans
  ADD COLUMN treatment_reason_id uuid,
  ADD CONSTRAINT plans_treatment_reason_owner_fk FOREIGN KEY (treatment_reason_id, user_id)
    REFERENCES treatment_reasons (id, user_id) ON DELETE SET NULL (treatment_reason_id);
CREATE INDEX plans_treatment_reason_idx ON medication_plans (treatment_reason_id)
  WHERE treatment_reason_id IS NOT NULL;

-- Nome do motivo quando a ocorrencia foi gerada, como medication_name_snapshot.
ALTER TABLE occurrences
  ADD COLUMN treatment_reason_snapshot varchar,
  ADD CONSTRAINT occurrences_treatment_reason_snapshot_len_chk CHECK (
    char_length(treatment_reason_snapshot) BETWEEN 1 AND 80
  );

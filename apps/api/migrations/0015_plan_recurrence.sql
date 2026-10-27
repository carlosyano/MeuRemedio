-- 0015_plan_recurrence: periodicidade do plano (DEC-037).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-005); Especificacao 02.33 DEC-037; OpenAPI 02.33.9
-- (PlanRecurrence, PlanRecurrenceKind, Weekday).
-- Dias da semana em mascara de bits (segunda = 1, terca = 2, ..., domingo = 64): cabe num smallint,
-- nao repete dia e tem limite simples por CHECK.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Rollback: nova migracao com
--   ALTER TABLE medication_plans DROP COLUMN recurrence_kind, DROP COLUMN recurrence_weekdays,
--     DROP COLUMN recurrence_interval_days; DROP TYPE plan_recurrence_kind;
--   (os planos que nao sao DAILY passam a gerar todos os dias).

CREATE TYPE plan_recurrence_kind AS ENUM ('DAILY', 'WEEKDAYS', 'EVERY_N_DAYS');

ALTER TABLE medication_plans
  ADD COLUMN recurrence_kind          plan_recurrence_kind NOT NULL DEFAULT 'DAILY',
  ADD COLUMN recurrence_weekdays      smallint,
  ADD COLUMN recurrence_interval_days smallint,
  -- Cada periodicidade tem exatamente o seu parametro.
  ADD CONSTRAINT plans_recurrence_shape_chk CHECK (
    (recurrence_kind = 'DAILY' AND recurrence_weekdays IS NULL AND recurrence_interval_days IS NULL)
    OR (recurrence_kind = 'WEEKDAYS' AND recurrence_weekdays IS NOT NULL
        AND recurrence_interval_days IS NULL)
    OR (recurrence_kind = 'EVERY_N_DAYS' AND recurrence_interval_days IS NOT NULL
        AND recurrence_weekdays IS NULL)
  ),
  -- Pelo menos um dia, no maximo os sete.
  ADD CONSTRAINT plans_recurrence_weekdays_chk CHECK (recurrence_weekdays BETWEEN 1 AND 127),
  ADD CONSTRAINT plans_recurrence_interval_chk CHECK (recurrence_interval_days BETWEEN 2 AND 365);

-- 0001_core: tabelas centrais do dominio.
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-001 e ENT-004 a ENT-008); enums = OpenAPI 02.33.3.
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.

-- ---------- enums ----------
CREATE TYPE account_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'DELETION_SCHEDULED');
CREATE TYPE session_revoked_reason AS ENUM ('LOGOUT', 'REVOKE_ALL', 'PASSWORD_RESET', 'ACCOUNT_DELETION', 'EXPIRED');
CREATE TYPE plan_status AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE medication_form AS ENUM ('TABLET', 'CAPSULE', 'LIQUID', 'DROPS', 'INJECTION', 'CREAM', 'OINTMENT', 'INHALER', 'PATCH', 'OTHER');
CREATE TYPE administration_route AS ENUM ('ORAL', 'TOPICAL', 'INHALED', 'NASAL', 'OPHTHALMIC', 'OTIC', 'RECTAL', 'VAGINAL', 'SUBCUTANEOUS', 'INTRAMUSCULAR', 'OTHER');
CREATE TYPE occurrence_status AS ENUM ('PROGRAMMED', 'NO_RESPONSE', 'TAKEN', 'NOT_TAKEN', 'CANCELED');
CREATE TYPE response_type AS ENUM ('TAKEN', 'NOT_TAKEN');
CREATE TYPE not_taken_reason AS ENUM ('FORGOT', 'UNAVAILABLE', 'SIDE_EFFECT_CONCERN', 'CHOSE_NOT_TO_TAKE', 'OTHER');

-- ---------- ENT-001 users ----------
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    varchar(120) NOT NULL,
  email_normalized        varchar(254) NOT NULL,
  password_hash           text NOT NULL,
  status                  account_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  account_timezone        varchar(64) NOT NULL,
  terms_version           varchar(30) NOT NULL,
  privacy_notice_version  varchar(30) NOT NULL,
  terms_accepted_at       timestamptz NOT NULL,
  privacy_acknowledged_at timestamptz NOT NULL,
  text_scale              smallint NOT NULL DEFAULT 100,
  high_contrast           boolean NOT NULL DEFAULT false,
  verified_at             timestamptz,
  deletion_requested_at   timestamptz,
  purge_due_at            timestamptz,
  row_version             bigint NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized_key UNIQUE (email_normalized),
  CONSTRAINT users_name_len_chk CHECK (char_length(name) >= 1),
  CONSTRAINT users_email_normalized_chk CHECK (email_normalized = lower(btrim(email_normalized))),
  CONSTRAINT users_active_requires_verified_chk CHECK (status <> 'ACTIVE' OR verified_at IS NOT NULL),
  CONSTRAINT users_text_scale_chk CHECK (text_scale IN (100, 125, 150, 175, 200)),
  CONSTRAINT users_timezone_chk CHECK (account_timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$'),
  CONSTRAINT users_purge_window_chk CHECK (
    purge_due_at IS NULL OR deletion_requested_at IS NULL
    OR purge_due_at <= deletion_requested_at + interval '30 days'
  ),
  CONSTRAINT users_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX users_pending_verification_idx ON users (status, created_at) WHERE status = 'PENDING_VERIFICATION';

-- ---------- ENT-004 sessions ----------
CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  secret_hash         bytea NOT NULL,
  last_activity_at    timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      session_revoked_reason,
  row_version         bigint NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_secret_hash_key UNIQUE (secret_hash),
  CONSTRAINT sessions_secret_hash_len_chk CHECK (octet_length(secret_hash) = 32),
  CONSTRAINT sessions_revocation_pair_chk CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT sessions_expiry_order_chk CHECK (idle_expires_at > created_at AND absolute_expires_at > created_at),
  CONSTRAINT sessions_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX sessions_active_by_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- ---------- ENT-005 medication_plans ----------
CREATE TABLE medication_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status               plan_status NOT NULL DEFAULT 'ACTIVE',
  medication_name      varchar(120) NOT NULL,
  medication_name_norm varchar(120) NOT NULL,
  dose_text            varchar(80) NOT NULL,
  dose_text_norm       varchar(80) NOT NULL,
  medication_form      medication_form NOT NULL,
  administration_route administration_route NOT NULL,
  instructions         varchar(500),
  prescriber_name      varchar(120),
  prescriber_crm       varchar(13),
  start_date           date NOT NULL,
  end_date             date,
  deleted_at           timestamptz,
  row_version          bigint NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_id_user_key UNIQUE (id, user_id),
  CONSTRAINT plans_name_len_chk CHECK (char_length(medication_name) >= 1 AND char_length(medication_name_norm) >= 1),
  CONSTRAINT plans_dose_len_chk CHECK (char_length(dose_text) >= 1 AND char_length(dose_text_norm) >= 1),
  CONSTRAINT plans_period_chk CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT plans_deleted_requires_ts_chk CHECK (status <> 'DELETED' OR deleted_at IS NOT NULL),
  CONSTRAINT plans_crm_format_chk CHECK (prescriber_crm IS NULL OR prescriber_crm ~ '^[A-Z]{2}-[0-9]{4,10}$'),
  CONSTRAINT plans_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX plans_user_status_idx ON medication_plans (user_id, status);
CREATE INDEX plans_duplicate_lookup_idx ON medication_plans (user_id, medication_name_norm, dose_text_norm) WHERE status = 'ACTIVE';

-- ---------- ENT-006 schedule_times ----------
CREATE TABLE schedule_times (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES medication_plans (id) ON DELETE CASCADE,
  time_of_day time NOT NULL,
  removed_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_times_id_plan_key UNIQUE (id, plan_id),
  CONSTRAINT schedule_times_minute_chk CHECK (extract(second FROM time_of_day) = 0)
);
CREATE UNIQUE INDEX schedule_times_active_unique ON schedule_times (plan_id, time_of_day) WHERE removed_at IS NULL;

-- RN-006: no maximo 10 horarios ativos por plano. O minimo de 1 e regra de servico (validada no
-- plano completo, na mesma transacao). O bloqueio da linha do plano serializa insercoes concorrentes.
CREATE FUNCTION schedule_times_enforce_max() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  active_count integer;
BEGIN
  IF NEW.removed_at IS NULL THEN
    PERFORM 1 FROM medication_plans WHERE id = NEW.plan_id FOR UPDATE;
    SELECT count(*) INTO active_count FROM schedule_times
     WHERE plan_id = NEW.plan_id AND removed_at IS NULL AND id <> NEW.id;
    IF active_count >= 10 THEN
      RAISE EXCEPTION 'plano % excede 10 horarios ativos', NEW.plan_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'schedule_times_max_10_chk';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER schedule_times_max_10
  BEFORE INSERT OR UPDATE OF removed_at, plan_id ON schedule_times
  FOR EACH ROW EXECUTE FUNCTION schedule_times_enforce_max();

-- ---------- ENT-007 occurrences ----------
CREATE TABLE occurrences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id                  uuid NOT NULL,
  schedule_time_id         uuid NOT NULL,
  local_scheduled_date     date NOT NULL,
  local_time               time NOT NULL,
  scheduled_at             timestamptz NOT NULL,
  deadline_at              timestamptz NOT NULL,
  status                   occurrence_status NOT NULL DEFAULT 'PROGRAMMED',
  no_response_reached_at   timestamptz,
  medication_name_snapshot varchar(120) NOT NULL,
  dose_text_snapshot       varchar(80) NOT NULL,
  is_late                  boolean NOT NULL DEFAULT false,
  row_version              bigint NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT occurrences_id_user_key UNIQUE (id, user_id),
  -- Defesa em profundidade contra BOLA: a ocorrencia sempre pertence ao titular do plano
  -- e o horario sempre pertence ao plano da ocorrencia.
  CONSTRAINT occurrences_plan_owner_fk FOREIGN KEY (plan_id, user_id)
    REFERENCES medication_plans (id, user_id) ON DELETE CASCADE,
  CONSTRAINT occurrences_time_plan_fk FOREIGN KEY (schedule_time_id, plan_id)
    REFERENCES schedule_times (id, plan_id) ON DELETE CASCADE,
  CONSTRAINT occurrences_minute_chk CHECK (extract(second FROM local_time) = 0),
  CONSTRAINT occurrences_deadline_chk CHECK (deadline_at = scheduled_at + interval '60 minutes'),
  CONSTRAINT occurrences_no_response_marker_chk CHECK (status <> 'NO_RESPONSE' OR no_response_reached_at IS NOT NULL),
  CONSTRAINT occurrences_row_version_chk CHECK (row_version >= 1)
);
-- RN-007: no maximo uma ocorrencia nao cancelada por plano, data civil e horario.
CREATE UNIQUE INDEX occurrences_slot_active_unique ON occurrences (plan_id, local_scheduled_date, local_time) WHERE status <> 'CANCELED';
CREATE INDEX occurrences_deadline_idx ON occurrences (status, deadline_at) WHERE status = 'PROGRAMMED';
CREATE INDEX occurrences_user_date_idx ON occurrences (user_id, local_scheduled_date DESC);

-- ---------- ENT-008 responses ----------
CREATE TABLE responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type          response_type NOT NULL,
  reason        not_taken_reason,
  captured_at   timestamptz NOT NULL,
  is_late       boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- RN-008: somente a primeira resposta e aceita; a corrida entre TAKEN e NOT_TAKEN termina aqui.
  CONSTRAINT responses_occurrence_id_key UNIQUE (occurrence_id),
  CONSTRAINT responses_occurrence_owner_fk FOREIGN KEY (occurrence_id, user_id)
    REFERENCES occurrences (id, user_id) ON DELETE CASCADE,
  CONSTRAINT responses_reason_chk CHECK (type <> 'TAKEN' OR reason IS NULL)
);

-- Resposta aceita e imutavel (RN-008). So o UPDATE e bloqueado: o DELETE em cascata do expurgo
-- da conta (FL-001) precisa continuar possivel; privilegios de DELETE por papel entram com os papeis IAM.
CREATE FUNCTION responses_block_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'responses sao imutaveis' USING ERRCODE = 'integrity_constraint_violation';
END
$$;
CREATE TRIGGER responses_immutable BEFORE UPDATE ON responses
  FOR EACH ROW EXECUTE FUNCTION responses_block_update();

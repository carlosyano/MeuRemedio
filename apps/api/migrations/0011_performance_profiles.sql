-- 0011_performance_profiles: perfil versionado de desempenho (TS-039, DEC-021, DC-064).
-- Fonte: docs/architecture/DATA_MODEL.md (ENT-017); docs/specifications/performance-profile.v1.yaml
-- (PP-001 v1, change_control: qualquer alteracao exige nova versao, novo hash e aprovacao).
-- Toda regra de integridade tem constraint NOMEADA, para os testes provarem qual regra disparou.
-- Rollback (tabela nova, sem dependentes): nova migracao com
--   DROP TABLE performance_profiles; DROP FUNCTION performance_profiles_immutable();

-- ---------- ENT-017 performance_profiles ----------
CREATE TABLE performance_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tamanhos por CHECK nomeado (e nao varchar(n)), para o teste provar a regra que disparou.
  profile_key        varchar NOT NULL,
  version            integer NOT NULL,
  definition         jsonb NOT NULL,
  -- SHA-256 do JSON canonico da definicao (chaves ordenadas, sem espacos), calculado no servico.
  definition_sha256  bytea NOT NULL,
  approved_at        timestamptz,
  approved_by        varchar,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_profiles_key_version_key UNIQUE (profile_key, version),
  CONSTRAINT performance_profiles_profile_key_chk CHECK (char_length(profile_key) BETWEEN 1 AND 40),
  CONSTRAINT performance_profiles_version_chk CHECK (version >= 1),
  CONSTRAINT performance_profiles_definition_chk
    CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 65536),
  CONSTRAINT performance_profiles_sha256_chk CHECK (octet_length(definition_sha256) = 32),
  -- Aprovacao e aprovador andam juntos; sem aprovacao, a evidencia e invalida (TS-039).
  CONSTRAINT performance_profiles_approval_chk
    CHECK ((approved_at IS NULL) = (approved_by IS NULL) AND char_length(approved_by) <= 120)
);

-- Perfil registrado nao muda: a unica escrita aceita e a aprovacao de um perfil ainda sem ela.
-- Mudanca de definicao entra como nova versao; a exclusao tambem e recusada.
CREATE FUNCTION performance_profiles_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.approved_at IS NULL
     AND NEW.approved_at IS NOT NULL
     AND NEW.id = OLD.id
     AND NEW.profile_key = OLD.profile_key
     AND NEW.version = OLD.version
     AND NEW.definition = OLD.definition
     AND NEW.definition_sha256 = OLD.definition_sha256
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'performance_profiles e imutavel depois de registrado (nova versao)'
    USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'performance_profiles_immutable';
END
$$;
CREATE TRIGGER performance_profiles_immutable
  BEFORE UPDATE OR DELETE ON performance_profiles
  FOR EACH ROW EXECUTE FUNCTION performance_profiles_immutable();

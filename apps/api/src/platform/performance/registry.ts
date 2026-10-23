// Registro dos perfis de desempenho em ENT-017 performance_profiles (migracao 0011, DC-064).
// O perfil registrado nao muda (trigger performance_profiles_immutable): a mesma versao com outra
// definicao e conflito, e a unica escrita posterior aceita e a aprovacao de um perfil sem ela.
import type pg from 'pg';
import type { JsonObject } from '../db/types.js';
import { definitionSha256, type PerformanceProfile } from './profile.js';

/** A versao ja existe com outra definicao: a mudanca exige nova versao (change_control). */
export class PerformanceProfileConflict extends Error {
  constructor(profileKey: string, version: number) {
    super(
      `${profileKey} v${String(version)} ja registrado com outra definicao; registre nova versao`,
    );
    this.name = 'PerformanceProfileConflict';
  }
}

/** A definicao guardada nao confere com o SHA-256 guardado. */
export class PerformanceProfileTampered extends Error {
  constructor(profileKey: string, version: number) {
    super(`${profileKey} v${String(version)}: definicao nao confere com o SHA-256 registrado`);
    this.name = 'PerformanceProfileTampered';
  }
}

/** Registra o perfil; repetir com a mesma definicao nao altera nada. */
export async function registerProfile(pool: pg.Pool, profile: PerformanceProfile): Promise<void> {
  await pool.query(
    `INSERT INTO performance_profiles
       (profile_key, version, definition, definition_sha256, approved_at, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (profile_key, version) DO NOTHING`,
    [
      profile.profileKey,
      profile.version,
      JSON.stringify(profile.definition),
      profile.definitionSha256,
      profile.approvedAt,
      profile.approvedBy,
    ],
  );
  const { rows } = await pool.query<{ definition_sha256: Buffer; approved_at: Date | null }>(
    `SELECT definition_sha256, approved_at FROM performance_profiles
      WHERE profile_key = $1 AND version = $2`,
    [profile.profileKey, profile.version],
  );
  const stored = rows[0];
  if (stored === undefined || !stored.definition_sha256.equals(profile.definitionSha256)) {
    throw new PerformanceProfileConflict(profile.profileKey, profile.version);
  }
  if (stored.approved_at === null && profile.approvedAt !== null) {
    await pool.query(
      `UPDATE performance_profiles SET approved_at = $3, approved_by = $4
        WHERE profile_key = $1 AND version = $2 AND approved_at IS NULL`,
      [profile.profileKey, profile.version, profile.approvedAt, profile.approvedBy],
    );
  }
}

/** Le os perfis registrados, conferindo cada definicao contra o hash guardado. */
export async function loadProfiles(pool: pg.Pool): Promise<PerformanceProfile[]> {
  const { rows } = await pool.query<{
    profile_key: string;
    version: number;
    definition: JsonObject;
    definition_sha256: Buffer;
    approved_at: Date | null;
    approved_by: string | null;
  }>(
    `SELECT profile_key, version, definition, definition_sha256, approved_at, approved_by
       FROM performance_profiles ORDER BY profile_key, version`,
  );
  return rows.map((row) => {
    if (!definitionSha256(row.definition).equals(row.definition_sha256)) {
      throw new PerformanceProfileTampered(row.profile_key, row.version);
    }
    return {
      profileKey: row.profile_key,
      version: row.version,
      definition: row.definition,
      definitionSha256: row.definition_sha256,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
    };
  });
}

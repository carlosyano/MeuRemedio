// PerformanceProfile (ENT-017, DEC-021): definicao versionada de docs/specifications/
// performance-profile.v<N>.yaml. O SHA-256 cobre o JSON canonico da definicao (chaves ordenadas,
// sem espacos), e nao os bytes do YAML: comentarios e formatacao nao mudam o perfil, e o hash pode
// ser recalculado a partir do jsonb guardado no banco (DC-064).
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { JsonObject } from '../db/types.js';

export interface PerformanceProfile {
  readonly profileKey: string;
  readonly version: number;
  readonly definition: JsonObject;
  readonly definitionSha256: Buffer;
  /** null enquanto o perfil nao foi aprovado; evidencia sob perfil sem aprovacao e invalida. */
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON com as chaves dos objetos em ordem lexicografica e sem espacos. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const definitionSha256 = (definition: JsonObject): Buffer =>
  createHash('sha256').update(canonicalJson(definition), 'utf8').digest();

// Estados do YAML que valem como aprovacao (PP-001 v1: approved_provisional).
const APPROVED_STATUSES = new Set(['approved', 'approved_provisional']);

/** Monta o perfil a partir da definicao ja lida (YAML ou jsonb do banco). */
export function profileFromDefinition(definition: unknown): PerformanceProfile {
  if (!isObject(definition)) throw new Error('perfil de desempenho deve ser um objeto');
  const { profile_key: profileKey, version } = definition;
  if (typeof profileKey !== 'string' || profileKey.length === 0 || profileKey.length > 40) {
    throw new Error('perfil de desempenho sem profile_key valido');
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('perfil de desempenho sem version inteira >= 1');
  }
  const approved =
    typeof definition['status'] === 'string' &&
    APPROVED_STATUSES.has(definition['status']) &&
    typeof definition['approved_at'] === 'string' &&
    typeof definition['approved_by'] === 'string';
  const approvedAt = approved ? new Date(`${String(definition['approved_at'])}T00:00:00Z`) : null;
  if (approvedAt !== null && Number.isNaN(approvedAt.getTime())) {
    throw new Error('perfil de desempenho com approved_at invalido (AAAA-MM-DD)');
  }
  return {
    profileKey,
    version,
    definition,
    definitionSha256: definitionSha256(definition),
    approvedAt,
    approvedBy: approved ? String(definition['approved_by']) : null,
  };
}

/** Le o YAML do perfil (o YAML 1.2 do pacote `yaml` entrega datas como texto). */
export const parseProfile = (yamlText: string): PerformanceProfile =>
  profileFromDefinition(parse(yamlText) as unknown);

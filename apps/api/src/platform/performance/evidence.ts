// Validacao da evidencia de desempenho (TS-039: evidencia sem perfil e invalida; DC-064).
// A evidencia so vale quando referencia um perfil registrado e aprovado pela chave, pela versao e
// pelo SHA-256 da definicao, e traz o que o perfil exige: percentis por operationId do mix,
// conclusao das exportacoes e CPU/memoria de cada componente do ambiente (acceptance.report).
// So a evidencia valida e confrontada com os objetivos do perfil (RNF-004, RNF-005, taxa de erro).
import type { JsonObject } from '../db/types.js';
import type { PerformanceProfile } from './profile.js';

export type EvidenceProblemCode =
  | 'PROFILE_MISSING'
  | 'PROFILE_UNKNOWN'
  | 'PROFILE_HASH_MISMATCH'
  | 'PROFILE_NOT_APPROVED'
  | 'EXECUTED_AT_MISSING'
  | 'OPERATION_MISSING'
  | 'RESULT_MALFORMED'
  | 'EXPORT_COMPLETION_MISSING'
  | 'RESOURCES_MISSING';

export interface EvidenceProblem {
  readonly code: EvidenceProblemCode;
  /** operationId, entrada do mix ou componente do ambiente a que o problema se refere. */
  readonly path?: string;
}

export interface EvidenceObjectives {
  readonly 'RNF-004': {
    readonly passed: boolean;
    readonly limit_ms: number;
    readonly worst_p95_ms: number;
    readonly operation: string;
  };
  readonly 'RNF-005': {
    readonly passed: boolean;
    readonly limit_ms: number;
    readonly p95_ms: number;
  };
  readonly error_rate: {
    readonly passed: boolean;
    readonly limit_percent: number;
    readonly error_rate_percent: number;
  };
}

export type EvidenceVerdict =
  | { readonly valid: false; readonly problems: readonly EvidenceProblem[] }
  | {
      readonly valid: true;
      readonly passed: boolean;
      readonly profile: { readonly profile_key: string; readonly version: number };
      readonly objectives: EvidenceObjectives;
    };

interface Timing {
  readonly p50_ms: number;
  readonly p95_ms: number;
  readonly p99_ms: number;
}

interface OperationResult extends Timing {
  readonly requests: number;
  readonly errors: number;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMeasure = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isTiming = (value: JsonObject): boolean =>
  isMeasure(value['p50_ms']) &&
  isMeasure(value['p95_ms']) &&
  isMeasure(value['p99_ms']) &&
  value['p50_ms'] <= value['p95_ms'] &&
  value['p95_ms'] <= value['p99_ms'];

const isOperationResult = (value: unknown): value is OperationResult =>
  isObject(value) &&
  isCount(value['requests']) &&
  value['requests'] > 0 &&
  isCount(value['errors']) &&
  value['errors'] <= value['requests'] &&
  isTiming(value);

const isExportCompletion = (value: unknown): value is Timing =>
  isObject(value) && isCount(value['count']) && value['count'] > 0 && isTiming(value);

// Instante RFC 3339 com fuso explicito.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Le o limite em segundos de um objetivo do perfil ("p95 interativo <= 2 s") em milissegundos. */
function objectiveLimitMs(profile: PerformanceProfile, requirement: string): number {
  const objectives = profile.definition['objectives'];
  const text = isObject(objectives) ? objectives[requirement] : undefined;
  const match = typeof text === 'string' ? /<=\s*(\d+(?:\.\d+)?)\s*s\b/.exec(text) : null;
  if (match?.[1] === undefined) {
    throw new Error(
      `${profile.profileKey} v${String(profile.version)} sem limite legivel para ${requirement}`,
    );
  }
  return Number(match[1]) * 1000;
}

function errorRateLimitPercent(profile: PerformanceProfile): number {
  const acceptance = profile.definition['acceptance'];
  const limit = isObject(acceptance) ? acceptance['error_rate_max_percent'] : undefined;
  if (!isMeasure(limit)) {
    throw new Error(
      `${profile.profileKey} v${String(profile.version)} sem acceptance.error_rate_max_percent`,
    );
  }
  return limit;
}

const keysOf = (value: unknown): string[] => (isObject(value) ? Object.keys(value) : []);

/** Componentes do ambiente com recursos alocados ("2 vCPU / 4 GB"); region e afins ficam fora. */
function computeComponents(profile: PerformanceProfile): string[] {
  const environment = profile.definition['environment'];
  if (!isObject(environment)) return [];
  return Object.entries(environment)
    .filter(([, description]) => typeof description === 'string' && /\bvCPU\b/.test(description))
    .map(([component]) => component);
}

/** Resolve a referencia ao perfil; devolve o problema que a invalida, se houver. */
function resolveProfile(
  reference: unknown,
  profiles: readonly PerformanceProfile[],
): PerformanceProfile | EvidenceProblem {
  if (
    !isObject(reference) ||
    typeof reference['profile_key'] !== 'string' ||
    typeof reference['version'] !== 'number' ||
    typeof reference['definition_sha256'] !== 'string' ||
    !SHA256_HEX.test(reference['definition_sha256'])
  ) {
    return { code: 'PROFILE_MISSING' };
  }
  const profile = profiles.find(
    (candidate) =>
      candidate.profileKey === reference['profile_key'] &&
      candidate.version === reference['version'],
  );
  if (profile === undefined) return { code: 'PROFILE_UNKNOWN' };
  if (profile.definitionSha256.toString('hex') !== reference['definition_sha256']) {
    return { code: 'PROFILE_HASH_MISMATCH' };
  }
  if (profile.approvedAt === null) return { code: 'PROFILE_NOT_APPROVED' };
  return profile;
}

/** Valida a evidencia contra os perfis registrados e, se valida, confronta os objetivos. */
export function validateEvidence(
  evidence: unknown,
  profiles: readonly PerformanceProfile[],
): EvidenceVerdict {
  if (!isObject(evidence)) return { valid: false, problems: [{ code: 'PROFILE_MISSING' }] };
  const profile = resolveProfile(evidence['profile'], profiles);
  if (!('profileKey' in profile)) return { valid: false, problems: [profile] };

  const problems: EvidenceProblem[] = [];
  const executedAt = evidence['executed_at'];
  if (
    typeof executedAt !== 'string' ||
    !RFC3339.test(executedAt) ||
    Number.isNaN(Date.parse(executedAt))
  ) {
    problems.push({ code: 'EXECUTED_AT_MISSING' });
  }

  const operations = isObject(evidence['operations']) ? evidence['operations'] : {};
  const load = profile.definition['load'];
  // Entrada do mix "a_or_b" e satisfeita por qualquer uma das operacoes.
  for (const entry of keysOf(isObject(load) ? load['mix_percent'] : undefined)) {
    if (!entry.split('_or_').some((operationId) => operationId in operations)) {
      problems.push({ code: 'OPERATION_MISSING', path: entry });
    }
  }
  const results: [string, OperationResult][] = [];
  for (const [operationId, result] of Object.entries(operations)) {
    if (isOperationResult(result)) results.push([operationId, result]);
    else problems.push({ code: 'RESULT_MALFORMED', path: operationId });
  }
  if (Object.keys(operations).length === 0) problems.push({ code: 'OPERATION_MISSING' });

  const exportCompletion = evidence['export_completion'];
  if (!isExportCompletion(exportCompletion)) problems.push({ code: 'EXPORT_COMPLETION_MISSING' });

  const resources = isObject(evidence['resources']) ? evidence['resources'] : {};
  for (const component of computeComponents(profile)) {
    const usage = resources[component];
    if (
      !isObject(usage) ||
      !isMeasure(usage['cpu_percent_max']) ||
      !isMeasure(usage['memory_mb_max'])
    ) {
      problems.push({ code: 'RESOURCES_MISSING', path: component });
    }
  }

  if (problems.length > 0 || !isExportCompletion(exportCompletion)) {
    return { valid: false, problems };
  }

  const interactiveLimit = objectiveLimitMs(profile, 'RNF-004');
  const exportLimit = objectiveLimitMs(profile, 'RNF-005');
  const errorLimit = errorRateLimitPercent(profile);
  // RNF-004 por operationId: a pior p95 decide (DC-064).
  const [worstOperation, worst] = results.reduce((current, candidate) =>
    candidate[1].p95_ms > current[1].p95_ms ? candidate : current,
  );
  const requests = results.reduce((sum, [, result]) => sum + result.requests, 0);
  const errors = results.reduce((sum, [, result]) => sum + result.errors, 0);
  const errorRatePercent = (errors / requests) * 100;
  const objectives: EvidenceObjectives = {
    'RNF-004': {
      passed: worst.p95_ms <= interactiveLimit,
      limit_ms: interactiveLimit,
      worst_p95_ms: worst.p95_ms,
      operation: worstOperation,
    },
    'RNF-005': {
      passed: exportCompletion.p95_ms <= exportLimit,
      limit_ms: exportLimit,
      p95_ms: exportCompletion.p95_ms,
    },
    error_rate: {
      passed: errorRatePercent <= errorLimit,
      limit_percent: errorLimit,
      error_rate_percent: errorRatePercent,
    },
  };
  return {
    valid: true,
    passed:
      objectives['RNF-004'].passed && objectives['RNF-005'].passed && objectives.error_rate.passed,
    profile: { profile_key: profile.profileKey, version: profile.version },
    objectives,
  };
}

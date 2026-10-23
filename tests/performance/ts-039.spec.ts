// @trace TS-039 RNF-004 RNF-005 ENT-017 DEC-021 (evidencia de desempenho, DC-064)
// TS-039: evidencia de desempenho sem perfil e invalida. A evidencia so vale quando referencia um
// PerformanceProfile registrado e aprovado pela chave, pela versao e pelo SHA-256 da definicao, e
// traz o que o perfil exige (percentis por operationId, tempo de exportacao e consumo de recursos).
// So a evidencia valida e confrontada com os objetivos (RNF-004 e RNF-005).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  parseProfile,
  type PerformanceProfile,
} from '../../apps/api/src/platform/performance/profile.js';
import { validateEvidence } from '../../apps/api/src/platform/performance/evidence.js';

const profileYaml = readFileSync(
  new URL('../../docs/specifications/performance-profile.v1.yaml', import.meta.url),
  'utf8',
);
const pp001 = parseProfile(profileYaml);

// SHA-256 da definicao aprovada em 04/10/2026. Mudar o YAML exige nova versao e nova aprovacao
// (change_control do PP-001): este valor so muda junto com a versao.
const PP001_V1_SHA256 = '32d4890a7bca89a7b617eae2d18e7dbd4c66a5e46f797a3cf29e9515256252aa';

const timing = (p95: number) => ({ p50_ms: p95 / 2, p95_ms: p95, p99_ms: p95 * 1.5 });

/** Evidencia completa e dentro dos objetivos; cada caso altera so o que testa. */
function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: { profile_key: 'PP-001', version: 1, definition_sha256: PP001_V1_SHA256 },
    executed_at: '2026-11-04T11:05:15Z',
    operations: {
      listOccurrences: { requests: 31_500, errors: 3, ...timing(400) },
      createResponse: { requests: 18_000, errors: 0, ...timing(600) },
      listPlans: { requests: 9_000, errors: 0, ...timing(300) },
      getHistory: { requests: 9_000, errors: 1, ...timing(900) },
      createPlan: { requests: 4_000, errors: 0, ...timing(700) },
      updatePlan: { requests: 3_200, errors: 0, ...timing(800) },
      createSession: { requests: 6_300, errors: 0, ...timing(1_200) },
      getExport: { requests: 4_500, errors: 0, ...timing(200) },
      createExport: { requests: 4_500, errors: 0, ...timing(500) },
    },
    export_completion: { count: 4_500, ...timing(12_000) },
    resources: {
      api: { cpu_percent_max: 71, memory_mb_max: 1_900 },
      worker: { cpu_percent_max: 88, memory_mb_max: 2_700 },
      database: { cpu_percent_max: 54, memory_mb_max: 2_100 },
    },
    ...overrides,
  };
}

const codes = (verdict: ReturnType<typeof validateEvidence>): string[] =>
  verdict.valid ? [] : verdict.problems.map((problem) => problem.code);

describe('PP-001 v1 (docs/specifications/performance-profile.v1.yaml)', () => {
  it('carrega chave, versao e aprovacao do perfil', () => {
    expect(pp001.profileKey).toBe('PP-001');
    expect(pp001.version).toBe(1);
    expect(pp001.approvedAt?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(pp001.approvedBy).toBe('Carlos Yano (mantenedor, interino)');
  });

  it('o SHA-256 da definicao e o da versao aprovada', () => {
    expect(pp001.definitionSha256.toString('hex')).toBe(PP001_V1_SHA256);
  });

  it('o hash nao depende da ordem das chaves nem da formatacao', () => {
    expect(canonicalJson({ b: [1, { d: 'x', c: null }], a: true })).toBe(
      '{"a":true,"b":[1,{"c":null,"d":"x"}]}',
    );
    const reordered = parseProfile(
      'version: 1\nprofile_key: PP-001\napproved_by: "Carlos Yano (mantenedor, interino)"\n' +
        profileYaml
          .split('\n')
          .filter((line) => !/^(profile_key|version|approved_by):/.test(line))
          .join('\n'),
    );
    expect(reordered.definitionSha256.equals(pp001.definitionSha256)).toBe(true);
  });

  it('perfil sem aprovacao fica sem approvedAt', () => {
    const draft = parseProfile(
      profileYaml
        .replace('status: approved_provisional', 'status: draft')
        .replace(/^approved_at:.*$/m, '')
        .replace(/^approved_by:.*$/m, ''),
    );
    expect(draft.approvedAt).toBeNull();
    expect(draft.approvedBy).toBeNull();
  });

  it('recusa definicao sem profile_key ou sem versao inteira positiva', () => {
    expect(() => parseProfile('version: 1\n')).toThrow(/profile_key/);
    expect(() => parseProfile('profile_key: PP-001\nversion: 0\n')).toThrow(/version/);
    expect(() => parseProfile('- 1\n- 2\n')).toThrow();
  });
});

describe('TS-039: evidencia sem perfil e invalida', () => {
  it('aceita a evidencia completa do perfil aprovado e confronta os objetivos', () => {
    const verdict = validateEvidence(evidence(), [pp001]);
    expect(verdict).toMatchObject({
      valid: true,
      passed: true,
      objectives: {
        'RNF-004': { passed: true, worst_p95_ms: 1_200, operation: 'createSession' },
        'RNF-005': { passed: true, p95_ms: 12_000 },
        error_rate: { passed: true },
      },
    });
  });

  it.each([
    ['sem referencia ao perfil', { profile: undefined }],
    ['referencia vazia', { profile: {} }],
    ['referencia que nao e objeto', { profile: 'PP-001' }],
    ['sem o hash da definicao', { profile: { profile_key: 'PP-001', version: 1 } }],
  ])('%s: PROFILE_MISSING', (_case, overrides) => {
    const verdict = validateEvidence(evidence(overrides), [pp001]);
    expect(verdict.valid).toBe(false);
    expect(codes(verdict)).toContain('PROFILE_MISSING');
  });

  it('evidencia que nem e objeto e invalida', () => {
    expect(codes(validateEvidence(null, [pp001]))).toEqual(['PROFILE_MISSING']);
    expect(codes(validateEvidence([], [pp001]))).toEqual(['PROFILE_MISSING']);
  });

  it('perfil ou versao nao registrados: PROFILE_UNKNOWN', () => {
    const unknownVersion = evidence({
      profile: { profile_key: 'PP-001', version: 2, definition_sha256: PP001_V1_SHA256 },
    });
    expect(codes(validateEvidence(unknownVersion, [pp001]))).toEqual(['PROFILE_UNKNOWN']);
    expect(codes(validateEvidence(evidence(), []))).toEqual(['PROFILE_UNKNOWN']);
  });

  it('hash diferente do registrado: PROFILE_HASH_MISMATCH', () => {
    const tampered = evidence({
      profile: { profile_key: 'PP-001', version: 1, definition_sha256: 'ab'.repeat(32) },
    });
    expect(codes(validateEvidence(tampered, [pp001]))).toEqual(['PROFILE_HASH_MISMATCH']);
  });

  it('perfil registrado sem aprovacao: PROFILE_NOT_APPROVED', () => {
    const draft: PerformanceProfile = { ...pp001, approvedAt: null, approvedBy: null };
    expect(codes(validateEvidence(evidence(), [draft]))).toEqual(['PROFILE_NOT_APPROVED']);
  });

  it('operacao do mix sem resultado: OPERATION_MISSING', () => {
    const { getHistory: _omitted, ...rest } = evidence().operations as Record<string, unknown>;
    const verdict = validateEvidence(evidence({ operations: rest }), [pp001]);
    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.problems).toContainEqual({ code: 'OPERATION_MISSING', path: 'getHistory' });
  });

  it('createPlan_or_updatePlan aceita uma das duas e exige ao menos uma', () => {
    const operations = evidence().operations as Record<string, unknown>;
    const { updatePlan: _u, ...onlyCreate } = operations;
    expect(validateEvidence(evidence({ operations: onlyCreate }), [pp001]).valid).toBe(true);
    const { createPlan: _c, updatePlan: _u2, ...neither } = operations;
    const verdict = validateEvidence(evidence({ operations: neither }), [pp001]);
    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.problems).toContainEqual({
      code: 'OPERATION_MISSING',
      path: 'createPlan_or_updatePlan',
    });
  });

  it.each([
    ['percentis fora de ordem', { requests: 10, errors: 0, p50_ms: 900, p95_ms: 500, p99_ms: 950 }],
    ['percentil negativo', { requests: 10, errors: 0, p50_ms: -1, p95_ms: 500, p99_ms: 950 }],
    ['sem requisicoes', { requests: 0, errors: 0, ...timing(500) }],
    ['mais erros que requisicoes', { requests: 10, errors: 11, ...timing(500) }],
    ['sem p99', { requests: 10, errors: 0, p50_ms: 100, p95_ms: 500 }],
  ])('%s: RESULT_MALFORMED', (_case, result) => {
    const operations = { ...(evidence().operations as object), listPlans: result };
    const verdict = validateEvidence(evidence({ operations }), [pp001]);
    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.problems).toContainEqual({ code: 'RESULT_MALFORMED', path: 'listPlans' });
  });

  it('sem o tempo de conclusao da exportacao: EXPORT_COMPLETION_MISSING', () => {
    const verdict = validateEvidence(evidence({ export_completion: undefined }), [pp001]);
    expect(codes(verdict)).toEqual(['EXPORT_COMPLETION_MISSING']);
  });

  it('sem consumo de CPU e memoria de cada componente do ambiente: RESOURCES_MISSING', () => {
    const verdict = validateEvidence(
      evidence({ resources: { api: { cpu_percent_max: 70, memory_mb_max: 1_000 } } }),
      [pp001],
    );
    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.problems).toEqual([
      { code: 'RESOURCES_MISSING', path: 'worker' },
      { code: 'RESOURCES_MISSING', path: 'database' },
    ]);
  });

  it('sem instante de execucao: EXECUTED_AT_MISSING', () => {
    expect(codes(validateEvidence(evidence({ executed_at: 'ontem' }), [pp001]))).toEqual([
      'EXECUTED_AT_MISSING',
    ]);
  });

  it('a evidencia invalida nao e confrontada com os objetivos', () => {
    const verdict = validateEvidence(evidence({ profile: undefined }), [pp001]);
    expect(verdict).not.toHaveProperty('objectives');
    expect(verdict).not.toHaveProperty('passed');
  });
});

describe('objetivos do PP-001 sobre a evidencia valida', () => {
  it('RNF-004: p95 de qualquer operacao acima de 2 s reprova', () => {
    const operations = {
      ...(evidence().operations as object),
      getHistory: { requests: 9_000, errors: 0, ...timing(2_001) },
    };
    expect(validateEvidence(evidence({ operations }), [pp001])).toMatchObject({
      valid: true,
      passed: false,
      objectives: { 'RNF-004': { passed: false, worst_p95_ms: 2_001, operation: 'getHistory' } },
    });
  });

  it('RNF-004: p95 de exatamente 2 s aprova', () => {
    const operations = {
      ...(evidence().operations as object),
      getHistory: { requests: 9_000, errors: 0, ...timing(2_000) },
    };
    expect(validateEvidence(evidence({ operations }), [pp001])).toMatchObject({ passed: true });
  });

  it('RNF-005: p95 de conclusao da exportacao acima de 30 s reprova', () => {
    expect(
      validateEvidence(evidence({ export_completion: { count: 10, ...timing(30_001) } }), [pp001]),
    ).toMatchObject({ valid: true, passed: false, objectives: { 'RNF-005': { passed: false } } });
  });

  it('taxa de erro acima de 0,1% reprova', () => {
    const operations = {
      ...(evidence().operations as object),
      listOccurrences: { requests: 31_500, errors: 200, ...timing(400) },
    };
    const verdict = validateEvidence(evidence({ operations }), [pp001]);
    expect(verdict).toMatchObject({ valid: true, passed: false });
    if (!verdict.valid) return;
    expect(verdict.objectives.error_rate.passed).toBe(false);
    expect(verdict.objectives.error_rate.error_rate_percent).toBeCloseTo((201 / 90_000) * 100, 6);
  });
});

// @trace ENT-017 TS-039 DEC-021 (docs/architecture/DATA_MODEL.md, DC-064)
// ENT-017 performance_profiles no PostgreSQL 17 REAL: perfil versionado, imutavel depois de
// registrado e com o SHA-256 da definicao. A evidencia de desempenho e validada contra os perfis
// lidos do banco (TS-039).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { validateEvidence } from '../../apps/api/src/platform/performance/evidence.js';
import { parseProfile } from '../../apps/api/src/platform/performance/profile.js';
import {
  loadProfiles,
  PerformanceProfileConflict,
  PerformanceProfileTampered,
  registerProfile,
} from '../../apps/api/src/platform/performance/registry.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';
import { expectPgError } from './support/pg-errors.js';

let db: PostgresHandle;
let pool: pg.Pool;

const pp001 = parseProfile(
  readFileSync(
    new URL('../../docs/specifications/performance-profile.v1.yaml', import.meta.url),
    'utf8',
  ),
);

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 4 });
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE performance_profiles');
});

const insertProfile = (row: {
  profile_key?: string;
  version?: number;
  definition?: unknown;
  definition_sha256?: Buffer;
  approved_at?: string | null;
  approved_by?: string | null;
}) =>
  pool.query(
    `INSERT INTO performance_profiles
       (profile_key, version, definition, definition_sha256, approved_at, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.profile_key ?? 'PP-001',
      row.version ?? 1,
      JSON.stringify(row.definition ?? { profile_key: 'PP-001' }),
      row.definition_sha256 ?? randomBytes(32),
      row.approved_at === undefined ? '2026-10-04T00:00:00Z' : row.approved_at,
      row.approved_by === undefined ? 'Carlos Yano (mantenedor, interino)' : row.approved_by,
    ],
  );

describe('ENT-017 performance_profiles', () => {
  it('uma linha por (profile_key, version)', async () => {
    await insertProfile({});
    await insertProfile({ version: 2 });
    await expectPgError(insertProfile({}), {
      code: '23505',
      constraint: 'performance_profiles_key_version_key',
    });
  });

  it.each([
    ['versao menor que 1', { version: 0 }, 'performance_profiles_version_chk'],
    ['chave vazia', { profile_key: '' }, 'performance_profiles_profile_key_chk'],
    [
      'chave com mais de 40 caracteres',
      { profile_key: 'P'.repeat(41) },
      'performance_profiles_profile_key_chk',
    ],
    [
      'hash sem 32 bytes',
      { definition_sha256: randomBytes(31) },
      'performance_profiles_sha256_chk',
    ],
    ['definicao que nao e objeto', { definition: [1, 2] }, 'performance_profiles_definition_chk'],
    [
      'definicao acima de 64 KB',
      { definition: { blob: 'x'.repeat(65_536) } },
      'performance_profiles_definition_chk',
    ],
    ['aprovacao sem aprovador', { approved_by: null }, 'performance_profiles_approval_chk'],
    ['aprovador sem aprovacao', { approved_at: null }, 'performance_profiles_approval_chk'],
    [
      'aprovador com mais de 120 caracteres',
      { approved_by: 'a'.repeat(121) },
      'performance_profiles_approval_chk',
    ],
  ])('recusa %s', async (_case, row, constraint) => {
    await expectPgError(insertProfile(row), { code: '23514', constraint });
  });

  it('aceita perfil ainda sem aprovacao e permite aprovar uma unica vez', async () => {
    await insertProfile({ approved_at: null, approved_by: null });
    await pool.query(
      `UPDATE performance_profiles SET approved_at = '2026-10-04T00:00:00Z', approved_by = 'Revisor'`,
    );
    await expectPgError(pool.query(`UPDATE performance_profiles SET approved_by = 'Outro'`), {
      code: '42501',
      constraint: 'performance_profiles_immutable',
    });
  });

  it.each([
    ['a definicao', `UPDATE performance_profiles SET definition = '{"x":1}'`],
    ['o hash', `UPDATE performance_profiles SET definition_sha256 = '\\x${'00'.repeat(32)}'`],
    ['a versao', 'UPDATE performance_profiles SET version = 2'],
    ['a chave', `UPDATE performance_profiles SET profile_key = 'PP-002'`],
    ['a linha (exclusao)', 'DELETE FROM performance_profiles'],
  ])('nao altera %s depois de registrado', async (_case, statement) => {
    await insertProfile({});
    await expectPgError(pool.query(statement), {
      code: '42501',
      constraint: 'performance_profiles_immutable',
    });
  });
});

describe('registro do PP-001 e TS-039 com os perfis do banco', () => {
  it('registra o perfil e o le de volta com o mesmo hash e a aprovacao', async () => {
    await registerProfile(pool, pp001);
    const [loaded, ...others] = await loadProfiles(pool);
    expect(others).toEqual([]);
    expect(loaded?.profileKey).toBe('PP-001');
    expect(loaded?.version).toBe(1);
    expect(loaded?.definitionSha256.equals(pp001.definitionSha256)).toBe(true);
    expect(loaded?.approvedAt?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(loaded?.approvedBy).toBe(pp001.approvedBy);
  });

  it('registrar de novo a mesma definicao nao duplica nem falha', async () => {
    await registerProfile(pool, pp001);
    await registerProfile(pool, pp001);
    expect((await pool.query('SELECT 1 FROM performance_profiles')).rowCount).toBe(1);
  });

  it('a mesma versao com outra definicao e recusada: mudanca exige nova versao', async () => {
    await registerProfile(pool, pp001);
    const changed = parseProfile(
      readFileSync(
        new URL('../../docs/specifications/performance-profile.v1.yaml', import.meta.url),
        'utf8',
      ).replace('concurrent_sessions: 50', 'concurrent_sessions: 10'),
    );
    await expect(registerProfile(pool, changed)).rejects.toBeInstanceOf(PerformanceProfileConflict);
  });

  it('a leitura recusa definicao que nao confere com o hash guardado', async () => {
    await insertProfile({ definition: { profile_key: 'PP-001', version: 1 } });
    await expect(loadProfiles(pool)).rejects.toBeInstanceOf(PerformanceProfileTampered);
  });

  it('a evidencia sem perfil e invalida e a que referencia o PP-001 do banco e aceita', async () => {
    await registerProfile(pool, pp001);
    const profiles = await loadProfiles(pool);
    const timing = { p50_ms: 100, p95_ms: 300, p99_ms: 500 };
    const operations = Object.fromEntries(
      [
        'listOccurrences',
        'createResponse',
        'listPlans',
        'getHistory',
        'createPlan',
        'createSession',
        'getExport',
        'createExport',
      ].map((operationId) => [operationId, { requests: 1_000, errors: 0, ...timing }]),
    );
    const resources = { cpu_percent_max: 50, memory_mb_max: 1_000 };
    const evidence = {
      profile: {
        profile_key: 'PP-001',
        version: 1,
        definition_sha256: pp001.definitionSha256.toString('hex'),
      },
      executed_at: '2026-11-04T11:05:15Z',
      operations,
      export_completion: { count: 5, p50_ms: 4_000, p95_ms: 9_000, p99_ms: 9_500 },
      resources: { api: resources, worker: resources, database: resources },
    };
    expect(validateEvidence(evidence, profiles)).toMatchObject({ valid: true, passed: true });
    expect(validateEvidence({ ...evidence, profile: undefined }, profiles).valid).toBe(false);
  });
});

// @trace ERR-001 RNF-003 DEC-036 DEC-038 (400 VALIDATION_FAILED nas operacoes com entrada)
// ERR-001: toda operacao que a matriz liga ao erro recusa a entrada fora do contrato (corpo vazio,
// campo de tipo ou formato errado, consulta fora dos limites) com 400 antes de qualquer efeito.
// Cada operacao tem ao menos duas entradas invalidas; a tabela precisa cobrir exatamente as
// operacoes da matriz.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, genericUrl, persistedState } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-001');
let h: Harness;
let ana: LoggedIn;

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

interface InvalidInput {
  readonly query?: string;
  readonly body?: unknown;
}

/** Entradas invalidas por operacao (corpo para as mutacoes, consulta para as listagens). */
const INVALID: Record<string, readonly InvalidInput[]> = {
  createAccount: [
    { body: {} },
    {
      body: {
        name: 'Ana Silva',
        email: 'nao-e-um-email',
        password: PASSWORD,
        account_timezone: 'America/Sao_Paulo',
        terms_version: '2026-10',
        privacy_notice_version: '2026-10',
        terms_accepted: true,
        privacy_notice_acknowledged: true,
      },
    },
  ],
  verifyAccount: [{ body: {} }, { body: { token: 123 } }],
  resendVerification: [{ body: {} }, { body: { email: 'nao-e-um-email' } }],
  requestPasswordReset: [{ body: {} }, { body: { email: 'nao-e-um-email' } }],
  confirmPasswordReset: [{ body: {} }, { body: { token: 'token', new_password: 1 } }],
  createSession: [
    { body: {} },
    { body: { email: 'ana.silva@example.com', password: PASSWORD, extra: true } },
  ],
  updateAccessibilityPreferences: [
    { body: {} },
    { body: { text_scale: 'ENORME', high_contrast: 'sim' } },
  ],
  listPlans: [{ query: '?limit=0' }, { query: '?limit=101' }],
  listTreatmentReasons: [{ query: '?limit=0' }, { query: '?cursor=nao-e-cursor' }],
  createPlan: [{ body: {} }, { body: { ...PLAN, schedule_times: ['25:00'] } }],
  updatePlan: [{ body: {} }, { body: { ...PLAN, medication_form: 'NAO_EXISTE' } }],
  changePlanStatus: [{ body: {} }, { body: { action: 'PAUSE', reason: 'OTHER' } }],
  listOccurrences: [{ query: '?status=NAO_EXISTE' }, { query: '?limit=0' }],
  createResponse: [{ body: {} }, { body: { type: 'TALVEZ', reason: null } }],
  getHistory: [{ query: '' }, { query: '?start=2026-13-01&end=2026-10-01' }],
  listExports: [{ query: '?limit=0' }, { query: '?limit=abc' }],
  createExport: [{ body: {} }, { body: { start_date: 'ontem', end_date: '2026-10-01' } }],
  requestAccountDeletion: [{ body: {} }, { body: { password: PASSWORD, confirmation: 1 } }],
  updateCurrentAccount: [{ body: {} }, { body: { name: 1 } }],
  revokeAllSessions: [{ body: {} }, { body: { password: 1 } }],
};

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.activeUser('ana.silva@example.com');
  ana = await login(h, 'ana.silva@example.com');
});

describe('ERR-001 VALIDATION_FAILED (400)', () => {
  it('a tabela de entradas invalidas cobre exatamente as operacoes da matriz', () => {
    expect(entry).toMatchObject({ code: 'VALIDATION_FAILED', http_status: 400 });
    expect(Object.keys(INVALID).sort()).toEqual([...entry.operationIds].sort());
  });

  it.each(entry.operationIds)('%s', async (operationId) => {
    const operation = h.contract.operation(operationId);
    const auth = operation.public ? {} : operation.method === 'GET' ? ana.read : ana.mutation;
    const before = await persistedState(h.pool);
    for (const input of INVALID[operationId] ?? []) {
      const response = await h.call(
        operationId,
        operation.method,
        `${genericUrl(operation)}${input.query ?? ''}`,
        {
          headers: { ...auth, 'idempotency-key': 'err-001', 'if-match': '"1"' },
          ...(input.body === undefined ? {} : { body: input.body }),
        },
      );
      expectProblem(response, 'VALIDATION_FAILED');
    }
    expect(await persistedState(h.pool)).toBe(before);
  });
});

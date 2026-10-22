// @trace ERR-007 RN-005 CA-016 TS-042 (409 STATE_CONFLICT pelo estado do recurso)
// ERR-007: a operacao valida no formato, mas incompativel com o estado atual do recurso, responde
// 409 sem efeito: segunda resposta a mesma ocorrencia (RN-005), cancelamento de exportacao ja
// concluida (CA-016) e tokens validos de conta fora do estado esperado.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  startHarness,
  type Harness,
  type HttpResult,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';
import { completedExport, issueToken, mutate, occurrenceOn } from './support/fixtures.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-007');
let h: Harness;
let ana: LoggedIn;
let anaId: string;

/** Leva o recurso a um estado incompativel e devolve a chamada que precisa ser recusada. */
const SCENARIOS: Record<string, () => Promise<() => Promise<HttpResult>>> = {
  createResponse: async () => {
    const url = `/occurrences/${await occurrenceOn(h, ana, '2026-10-05')}/responses`;
    const taken = await mutate(h, ana, 'createResponse', url, { type: 'TAKEN', reason: null });
    expect(taken.status).toBe(201);
    return () => mutate(h, ana, 'createResponse', url, { type: 'NOT_TAKEN', reason: 'FORGOT' });
  },
  cancelExport: async () => {
    const url = `/exports/${await completedExport(h, ana)}`;
    return () => mutate(h, ana, 'cancelExport', url, undefined);
  },
  verifyAccount: async () => {
    const token = await issueToken(h, 'verification', anaId, NOW);
    return () => h.call('verifyAccount', 'POST', '/accounts/verify', { body: { token } });
  },
  confirmPasswordReset: async () => {
    const token = await issueToken(h, 'password_reset', anaId, NOW);
    await h.pool.query("UPDATE users SET status = 'PENDING_VERIFICATION' WHERE id = $1", [anaId]);
    return () =>
      h.call('confirmPasswordReset', 'POST', '/password-resets', {
        body: { token, new_password: 'Outra-Senha-Sintetica-77' },
      });
  },
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
  anaId = await h.activeUser('ana.silva@example.com');
  ana = await login(h, 'ana.silva@example.com');
});

describe('ERR-007 STATE_CONFLICT (409)', () => {
  it('os cenarios cobrem exatamente as operacoes da matriz', () => {
    expect(entry).toMatchObject({ code: 'STATE_CONFLICT', http_status: 409 });
    expect(Object.keys(SCENARIOS).sort()).toEqual([...entry.operationIds].sort());
  });

  it.each(entry.operationIds)('%s', async (operationId) => {
    const scenario = SCENARIOS[operationId];
    if (scenario === undefined) throw new Error(operationId);
    const refused = await scenario();
    const before = await persistedState(h.pool);
    expectProblem(await refused(), 'STATE_CONFLICT');
    expect(await persistedState(h.pool)).toBe(before);
  });
});

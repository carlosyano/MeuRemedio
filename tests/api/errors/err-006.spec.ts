// @trace ERR-006 TS-038 RNF-003 (409 IDEMPOTENCY_KEY_REUSED com payload divergente)
// ERR-006: a mesma Idempotency-Key com outro payload responde 409 sem novo efeito nem sobrescrita
// do resultado guardado, que continua sendo devolvido no replay identico. Em
// requestAccountDeletion o 202 revoga todas as sessoes, e uma segunda chamada por HTTP so chega
// ao caso de uso com sessao valida em pedidos simultaneos: o caso e conferido no proprio caso de
// uso (DC-063), como em tests/integration/privacy.spec.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestAccountDeletion } from '../../../apps/api/src/modules/privacy/application/request-account-deletion.js';
import {
  PASSWORD,
  login,
  startHarness,
  type Harness,
  type HttpResult,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';
import { PLAN, createPlan, occurrenceOn } from './support/fixtures.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-006');
let h: Harness;
let ana: LoggedIn;
let anaId: string;

const ACCOUNT = {
  name: 'Bruno Costa',
  email: 'bruno.costa@example.com',
  password: PASSWORD,
  account_timezone: 'America/Sao_Paulo',
  terms_version: '2026-10',
  privacy_notice_version: '2026-10',
  terms_accepted: true,
  privacy_notice_acknowledged: true,
} as const;

interface Scenario {
  /** Prepara o recurso e devolve a URL, os cabecalhos extras e os dois payloads. */
  readonly prepare: () => Promise<{
    url: string;
    headers?: Record<string, string>;
    first: unknown;
    divergent: unknown;
  }>;
  /** Sessao da repeticao (revokeAllSessions revoga a sessao da primeira chamada). */
  readonly replaySession?: () => Promise<LoggedIn>;
}

const SCENARIOS: Record<string, Scenario> = {
  createAccount: {
    prepare: () =>
      Promise.resolve({
        url: '/accounts',
        first: ACCOUNT,
        divergent: { ...ACCOUNT, name: 'Bruno Costa Divergente' },
      }),
  },
  createPlan: {
    prepare: () =>
      Promise.resolve({
        url: '/plans',
        first: PLAN,
        divergent: { ...PLAN, medication_name: 'Outro Comprimido' },
      }),
  },
  updatePlan: {
    prepare: async () => ({
      url: `/plans/${await createPlan(h, ana)}`,
      headers: { 'if-match': '"1"' },
      first: { ...PLAN, medication_name: 'Comprimido Novo' },
      divergent: { ...PLAN, medication_name: 'Comprimido Divergente' },
    }),
  },
  createResponse: {
    prepare: async () => ({
      url: `/occurrences/${await occurrenceOn(h, ana, '2026-10-05')}/responses`,
      first: { type: 'TAKEN', reason: null },
      divergent: { type: 'NOT_TAKEN', reason: 'FORGOT' },
    }),
  },
  createExport: {
    prepare: () =>
      Promise.resolve({
        url: '/exports',
        first: { start_date: '2026-10-01', end_date: '2026-10-05' },
        divergent: { start_date: '2026-09-01', end_date: '2026-10-05' },
      }),
  },
  revokeAllSessions: {
    prepare: () =>
      Promise.resolve({
        url: '/sessions/revocations',
        first: { password: PASSWORD },
        divergent: { password: 'Outra-Senha-2026' },
      }),
    replaySession: () => login(h, 'ana.silva@example.com'),
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

/** Resposta sem o cabecalho de correlacao, que muda a cada chamada. */
const comparable = ({ status, body }: HttpResult) => ({ status, body });

describe('ERR-006 IDEMPOTENCY_KEY_REUSED (409)', () => {
  it('a matriz liga ERR-006 as mutacoes com Idempotency-Key', () => {
    expect(entry).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', http_status: 409 });
    expect([...entry.operationIds].sort()).toEqual(
      [...Object.keys(SCENARIOS), 'requestAccountDeletion'].sort(),
    );
  });

  it.each(Object.keys(SCENARIOS))('%s', async (operationId) => {
    const scenario = SCENARIOS[operationId];
    if (scenario === undefined) throw new Error(operationId);
    const { url, headers = {}, first, divergent } = await scenario.prepare();
    const operation = h.contract.operation(operationId);
    const send = (session: LoggedIn | undefined, body: unknown) =>
      h.call(operationId, operation.method, url, {
        body,
        headers: {
          ...(operation.public ? {} : (session?.mutation ?? {})),
          'idempotency-key': 'err-006',
          ...headers,
        },
      });

    const original = await send(ana, first);
    expect(original.status, JSON.stringify(original.body)).toBeLessThan(300);
    const session = (await scenario.replaySession?.()) ?? ana;
    const before = await persistedState(h.pool);
    expectProblem(await send(session, divergent), 'IDEMPOTENCY_KEY_REUSED');
    expect(await persistedState(h.pool)).toBe(before);
    expect(comparable(await send(session, first))).toEqual(comparable(original));
  });

  it('requestAccountDeletion: no caso de uso, a mesma chave com outra senha', async () => {
    const run = (password: string) =>
      h.app.get(RequestAccountDeletion).execute({
        userId: anaId,
        idempotencyKey: 'err-006',
        password,
        correlationId: randomUUID(),
      });
    expect((await run(PASSWORD)).status).toBe(202);
    const before = await persistedState(h.pool);
    await expect(run('Outra-Senha-2026')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(await persistedState(h.pool)).toBe(before);
  });
});

// @trace ERR-015 CA-012 (403 CSRF_VALIDATION_FAILED nas mutacoes autenticadas)
// ERR-015: toda mutacao autenticada com sessao valida responde 403 sem X-CSRF-Token, com o token de
// outra sessao, sem o cookie mr_csrf, com Origin fora da lista e sem Origin nem Sec-Fetch-Site,
// sem alterar o estado (ADR-001 v1.5 OA-008). As operacoes vem da matriz e precisam ser
// exatamente as mutacoes privadas do contrato.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, genericUrl } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-015');
let h: Harness;
let ana: LoggedIn;
let bruno: LoggedIn;

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
  await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

/** Estado que uma chamada recusada nao pode alterar. */
const state = async (): Promise<string> =>
  JSON.stringify(
    (
      await h.pool.query(
        `SELECT (SELECT count(*) FROM medication_plans) AS plans,
                (SELECT count(*) FROM export_requests) AS exports,
                (SELECT count(*) FROM sessions WHERE revoked_at IS NULL) AS sessions,
                (SELECT count(*) FROM idempotency_records) AS idempotency,
                (SELECT string_agg(name || row_version::text || status, ',' ORDER BY id)
                   FROM users) AS users`,
      )
    ).rows,
  );

describe('ERR-015 CSRF_VALIDATION_FAILED (403)', () => {
  it('a matriz liga ERR-015 exatamente as mutacoes privadas do contrato', () => {
    expect(entry).toMatchObject({ code: 'CSRF_VALIDATION_FAILED', http_status: 403 });
    const mutations = h.contract.operations
      .filter((op) => !op.public && op.method !== 'GET')
      .map((op) => op.operationId);
    expect([...entry.operationIds].sort()).toEqual(mutations.sort());
  });

  it.each(entry.operationIds)('%s', async (operationId) => {
    const operation = h.contract.operation(operationId);
    const session = `mr_session=${ana.sessionCookie}`;
    const before = await state();
    const variants: Record<string, string>[] = [
      { cookie: `${session}; mr_csrf=${ana.csrf}`, origin: ORIGIN },
      { cookie: `${session}; mr_csrf=${bruno.csrf}`, 'x-csrf-token': bruno.csrf, origin: ORIGIN },
      { cookie: session, 'x-csrf-token': ana.csrf, origin: ORIGIN },
      {
        cookie: `${session}; mr_csrf=${ana.csrf}`,
        'x-csrf-token': ana.csrf,
        origin: 'https://atacante.example.invalid',
      },
      { cookie: `${session}; mr_csrf=${ana.csrf}`, 'x-csrf-token': ana.csrf },
      {
        cookie: `${session}; mr_csrf=${ana.csrf}`,
        'x-csrf-token': ana.csrf,
        'sec-fetch-site': 'cross-site',
      },
    ];
    for (const headers of variants) {
      const response = await h.call(operationId, operation.method, genericUrl(operation), {
        headers: { ...headers, 'idempotency-key': 'err-015' },
      });
      expectProblem(response, 'CSRF_VALIDATION_FAILED');
    }
    expect(await state()).toBe(before);
  });
});

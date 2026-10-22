// @trace ERR-002 RN-004 CA-012 (401 AUTHENTICATION_REQUIRED sem sessao valida)
// ERR-002: toda operacao privada responde 401 sem cookie de sessao, com segredo desconhecido, com
// sessao encerrada e com sessao expirada por inatividade (RN-004), sem alterar o estado. Em
// createSession, credencial invalida tambem e 401. As operacoes vem da matriz.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  startHarness,
  type Harness,
  type HttpResult,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, genericUrl, unknownSessionToken } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-002');
let h: Harness;

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
});

const privateOperations = (): string[] =>
  h.contract.operations.filter((op) => !op.public).map((op) => op.operationId);

async function callWith(operationId: string, cookie: string | undefined): Promise<HttpResult> {
  const operation = h.contract.operation(operationId);
  return h.call(operationId, operation.method, genericUrl(operation), {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      'idempotency-key': 'err-002',
    },
  });
}

/** Estado que uma chamada recusada nao pode alterar. */
const state = async (): Promise<string> =>
  JSON.stringify(
    (
      await h.pool.query(
        `SELECT (SELECT count(*) FROM medication_plans) AS plans,
                (SELECT count(*) FROM export_requests) AS exports,
                (SELECT count(*) FROM sessions WHERE revoked_at IS NULL) AS sessions,
                (SELECT count(*) FROM idempotency_records) AS idempotency,
                (SELECT string_agg(row_version::text || status, ',') FROM users) AS users`,
      )
    ).rows,
  );

describe('ERR-002 AUTHENTICATION_REQUIRED (401)', () => {
  it('a matriz liga ERR-002 a toda operacao privada e a createSession', () => {
    expect(entry).toMatchObject({ code: 'AUTHENTICATION_REQUIRED', http_status: 401 });
    expect([...entry.operationIds].sort()).toEqual(
      [...privateOperations(), 'createSession'].sort(),
    );
  });

  it.each(entry.operationIds.filter((id) => id !== 'createSession'))(
    '%s sem sessao, com segredo desconhecido, encerrada e expirada',
    async (operationId) => {
      const ended = await login(h, 'ana.silva@example.com');
      const response = await h.call('deleteCurrentSession', 'DELETE', '/sessions/current', {
        headers: ended.mutation,
      });
      expect(response.status).toBe(204);
      const idle = await login(h, 'ana.silva@example.com');
      const before = await state();
      h.now = '2026-10-05T11:35:16Z';

      for (const cookie of [
        undefined,
        `mr_session=${unknownSessionToken()}`,
        `mr_session=${ended.sessionCookie}; mr_csrf=${ended.csrf}`,
        `mr_session=${idle.sessionCookie}; mr_csrf=${idle.csrf}`,
      ]) {
        expectProblem(await callWith(operationId, cookie), 'AUTHENTICATION_REQUIRED');
      }
      expect(await state()).toBe(before);
    },
  );

  it('createSession com senha incorreta e com e-mail desconhecido', async () => {
    const before = await state();
    for (const body of [
      { email: 'ana.silva@example.com', password: 'Senha-Errada-2026' },
      { email: 'bruno.costa@example.com', password: 'Senha-Sintetica-2026' },
    ]) {
      const response = await h.call('createSession', 'POST', '/sessions', { body });
      expectProblem(response, 'AUTHENTICATION_REQUIRED');
      expect(
        response.cookies.filter((c) => c.startsWith('mr_session=') && !c.includes('Max-Age=0')),
      ).toEqual([]);
    }
    expect(await state()).toBe(before);
  });
});

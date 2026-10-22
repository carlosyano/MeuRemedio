// @trace ERR-013 RF-002 (409 SESSION_LIMIT_REACHED em createSession)
// ERR-013: com 3 sessoes ativas, uma nova entrada responde 409 sem criar sessao; encerrada uma
// delas, a entrada volta a ser aceita.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, login, startHarness, type Harness } from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-013');
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

const createSession = () =>
  h.call('createSession', 'POST', '/sessions', {
    body: { email: 'ana.silva@example.com', password: PASSWORD },
  });

describe('ERR-013 SESSION_LIMIT_REACHED (409)', () => {
  it('a matriz liga ERR-013 a createSession', () => {
    expect(entry).toMatchObject({ code: 'SESSION_LIMIT_REACHED', http_status: 409 });
    expect(entry.operationIds).toEqual(['createSession']);
  });

  it('createSession com 3 sessoes ativas', async () => {
    const first = await login(h, 'ana.silva@example.com');
    await login(h, 'ana.silva@example.com');
    await login(h, 'ana.silva@example.com');
    const before = await persistedState(h.pool);
    expectProblem(await createSession(), 'SESSION_LIMIT_REACHED', [PASSWORD]);
    expect(await persistedState(h.pool)).toBe(before);

    const ended = await h.call('deleteCurrentSession', 'DELETE', '/sessions/current', {
      headers: first.mutation,
    });
    expect(ended.status).toBe(204);
    expect((await createSession()).status).toBe(201);
  });
});

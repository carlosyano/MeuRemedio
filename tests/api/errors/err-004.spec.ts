// @trace ERR-004 RF-002 (423 ACCOUNT_TEMPORARILY_LOCKED em createSession)
// ERR-004: depois de 5 senhas erradas, a conta fica bloqueada por 15 minutos e createSession
// responde 423 mesmo com a senha certa, sem criar sessao; passado o bloqueio, a entrada volta.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, startHarness, type Harness } from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-004');
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

const createSession = (password: string) =>
  h.call('createSession', 'POST', '/sessions', {
    body: { email: 'ana.silva@example.com', password },
  });

describe('ERR-004 ACCOUNT_TEMPORARILY_LOCKED (423)', () => {
  it('a matriz liga ERR-004 a createSession', () => {
    expect(entry).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED', http_status: 423 });
    expect(entry.operationIds).toEqual(['createSession']);
  });

  it('createSession com a conta bloqueada, inclusive com a senha certa', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expectProblem(await createSession('senha-errada-2026'), 'AUTHENTICATION_REQUIRED');
    }
    const before = await persistedState(h.pool);
    expectProblem(await createSession(PASSWORD), 'ACCOUNT_TEMPORARILY_LOCKED', [PASSWORD]);
    expectProblem(await createSession('senha-errada-2026'), 'ACCOUNT_TEMPORARILY_LOCKED');
    expect(await persistedState(h.pool)).toBe(before);

    h.now = '2026-10-05T11:20:16Z';
    expect((await createSession(PASSWORD)).status).toBe(201);
  });
});

// @trace ERR-012 RN-011 CA-011 TS-011 (410 RESOURCE_EXPIRED em downloadExport)
// ERR-012: depois de 24 h, o download da exportacao responde 410 sem revelar o armazenamento.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';
import { completedExport } from './support/fixtures.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-012');
let h: Harness;
let ana: LoggedIn;

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

describe('ERR-012 RESOURCE_EXPIRED (410)', () => {
  it('a matriz liga ERR-012 a downloadExport', () => {
    expect(entry).toMatchObject({ code: 'RESOURCE_EXPIRED', http_status: 410 });
    expect(entry.operationIds).toEqual(['downloadExport']);
  });

  it('downloadExport depois de 24 h', async () => {
    const exportId = await completedExport(h, ana);
    const key = (
      await h.pool.query<{ key: string }>(
        'SELECT file_object_key AS key FROM export_requests WHERE id = $1',
        [exportId],
      )
    ).rows[0]?.key;
    expect(key).toBeTruthy();
    h.now = '2026-10-06T11:05:16Z';
    ana = await login(h, 'ana.silva@example.com');
    const before = await persistedState(h.pool);
    const response = await h.call('downloadExport', 'GET', `/exports/${exportId}/file`, {
      headers: ana.read,
    });
    expectProblem(response, 'RESOURCE_EXPIRED', [key ?? '', '.pdf']);
    expect(await persistedState(h.pool)).toBe(before);
  });
});

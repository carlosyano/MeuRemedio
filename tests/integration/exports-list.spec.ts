// @trace RF-008 RN-011 DEC-034 TS-008 TS-023 ERR-001 ERR-002 listExports createExport
// listExports contra PostgreSQL 17 real (DEC-034): pedidos de exportacao do titular em todos os
// estados, do mais recente para o mais antigo, com cursor opaco (DC-030), COMPLETED vencido ja
// exibido como EXPIRED (DC-042), sem pedidos de outro titular; cursor ou limit invalidos -> 400 e
// sem sessao -> 401.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

const NOW = '2026-10-05T07:00:00Z';
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

let ana: LoggedIn;
let anaId: string;
let bruno: LoggedIn;

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  anaId = await h.activeUser('ana.silva@example.com');
  await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

interface ExportBody {
  export_id: string;
  status: string;
  requested_at: string;
}

interface ExportPage {
  items: ExportBody[];
  page: { next_cursor: string | null; limit: number };
}

async function requestExport(session: LoggedIn, at: string): Promise<ExportBody> {
  h.now = at;
  const response = await h.call('createExport', 'POST', '/exports', {
    body: { start_date: '2026-10-01', end_date: '2026-10-31' },
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(202);
  return response.body as ExportBody;
}

const list = (session: LoggedIn, query = '') =>
  h.call('listExports', 'GET', `/exports${query}`, { headers: session.read });

describe('listExports (DEC-034)', () => {
  it('sem pedidos: pagina vazia com o limite padrao', async () => {
    const response = await list(ana);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], page: { next_cursor: null, limit: 20 } });
  });

  it('pedidos do titular, do mais recente para o mais antigo, sem os de outro titular', async () => {
    const first = await requestExport(ana, '2026-10-05T07:00:00Z');
    const second = await requestExport(ana, '2026-10-05T08:00:00Z');
    await requestExport(bruno, '2026-10-05T09:00:00Z');
    const response = await list(ana);
    expect(response.status).toBe(200);
    const page = response.body as ExportPage;
    expect(page.items.map((item) => item.export_id)).toEqual([second.export_id, first.export_id]);
    expect(page.items[0]).toEqual(second);
    expect(page.page).toEqual({ next_cursor: null, limit: 20 });
  });

  it('COMPLETED com expires_at atingido aparece como EXPIRED (DC-042)', async () => {
    await h.pool.query(
      `INSERT INTO export_requests (user_id, status, start_date, end_date, requested_at,
         file_sha256, completed_at, expires_at)
       VALUES ($1, 'COMPLETED', '2026-09-01', '2026-09-30', '2026-10-03T07:00:00Z',
         decode(repeat('ab', 32), 'hex'), '2026-10-03T08:00:00Z', '2026-10-04T08:00:00Z')`,
      [anaId],
    );
    const page = (await list(ana)).body as ExportPage;
    expect(page.items.map((item) => item.status)).toEqual(['EXPIRED']);
  });

  it('paginacao por cursor: limit e next_cursor ate o fim', async () => {
    const created = [];
    for (const at of ['2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z', '2026-10-05T09:00:00Z']) {
      created.push(await requestExport(ana, at));
    }
    const first = (await list(ana, '?limit=2')).body as ExportPage;
    expect(first.items.map((item) => item.export_id)).toEqual([
      created[2]?.export_id,
      created[1]?.export_id,
    ]);
    expect(first.page.limit).toBe(2);
    expect(first.page.next_cursor).not.toBeNull();
    const second = (
      await list(ana, `?limit=2&cursor=${encodeURIComponent(first.page.next_cursor ?? '')}`)
    ).body as ExportPage;
    expect(second.items.map((item) => item.export_id)).toEqual([created[0]?.export_id]);
    expect(second.page.next_cursor).toBeNull();
  });

  it.each([
    ['cursor fora do formato', '?cursor=nao-e-cursor'],
    ['limit abaixo do minimo', '?limit=0'],
    ['limit acima do maximo', '?limit=101'],
  ])('%s: 400 VALIDATION_FAILED', async (_nome, query) => {
    const response = await list(ana, query);
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('sem sessao: 401 AUTHENTICATION_REQUIRED', async () => {
    const response = await h.call('listExports', 'GET', '/exports', {});
    expect(response.status).toBe(401);
    expect((response.body as { code: string }).code).toBe('AUTHENTICATION_REQUIRED');
  });
});

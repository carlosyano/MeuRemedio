// @trace RF-008 RN-011 FL-005 CA-010 CA-011 CA-012 CA-013 CA-016 TS-008 TS-011 TS-015 TS-020 TS-023 TS-038 TS-042 ERR-004 ERR-006 createExport getExport cancelExport downloadExport
// Exportacao em PDF por HTTP e pelo worker contra PostgreSQL 17 real: pedido assincrono (202) pelo
// Outbox, snapshot congelado no processamento (TS-020), PDF privado e pesquisavel com expiracao em
// 24 h (RN-011, CA-010), download negado depois da expiracao sem revelar o armazenamento (CA-011,
// TS-011), cancelamento so em REQUESTED ou PROCESSING (CA-016, TS-042), idempotencia (TS-038) e
// acesso horizontal com 404 indistinguivel e auditoria (TS-008, TS-023). Escolhas: DC-042.
import { createHash } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EXPORTS_EXPIRY_QUEUE,
  expireExports,
  handleExportRequested,
} from '../../apps/api/src/modules/exports/application/process-export.js';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import type { ObjectStorage } from '../../apps/api/src/platform/storage/object-storage.js';
import { startWorker } from '../../apps/api/src/worker.js';
import { pdfText } from './support/pdf-text.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 08:00 local = 11:00Z.
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
  await h.pool.query('TRUNCATE audit_events');
  anaId = await h.activeUser('ana.silva@example.com');
  await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
});

const PLAN = {
  medication_name: 'Losartana Sintética',
  dose_text: '50 mg',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00'],
} as const;

let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

interface ExportBody {
  export_id: string;
  status: string;
  start_date: string;
  end_date: string;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
  failure_reason: string | null;
}

async function advanceTo(instant: string): Promise<void> {
  h.now = instant;
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
}

/** Plano de 05/10 com resposta TAKEN em 05/10 e NOT_TAKEN em 06/10; relogio em 07/10 07:00Z. */
async function historyFixture(): Promise<string> {
  const created = await h.call('createPlan', 'POST', '/plans', {
    body: PLAN,
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });
  expect(created.status).toBe(201);
  const planId = (created.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  const ids = (
    await h.pool.query<{ id: string; d: string }>(
      `SELECT id, to_char(local_scheduled_date, 'YYYY-MM-DD') AS d FROM occurrences
        WHERE plan_id = $1 ORDER BY scheduled_at`,
      [planId],
    )
  ).rows;
  await advanceTo('2026-10-05T11:10:00Z');
  const respond = async (date: string, body: unknown) => {
    const id = ids.find((row) => row.d === date)?.id ?? '';
    const response = await h.call('createResponse', 'POST', `/occurrences/${id}/responses`, {
      body,
      headers: { ...ana.mutation, 'idempotency-key': nextKey() },
    });
    expect(response.status).toBe(201);
  };
  await respond('2026-10-05', { type: 'TAKEN', reason: null });
  await advanceTo('2026-10-06T11:20:00Z');
  await respond('2026-10-06', { type: 'NOT_TAKEN', reason: 'SIDE_EFFECT_CONCERN' });
  await advanceTo('2026-10-07T07:00:00Z');
  return planId;
}

const createExport = (
  body: unknown = { start_date: '2026-10-01', end_date: '2026-10-31' },
  key?: string,
) =>
  h.call('createExport', 'POST', '/exports', {
    body,
    headers: { ...ana.mutation, 'idempotency-key': key ?? nextKey() },
  });

const getExport = (session: LoggedIn, id: string) =>
  h.call('getExport', 'GET', `/exports/${id}`, { headers: session.read });

const cancelExport = (session: LoggedIn, id: string) =>
  h.call('cancelExport', 'DELETE', `/exports/${id}`, { headers: session.mutation });

const download = (session: LoggedIn, id: string) =>
  h.call('downloadExport', 'GET', `/exports/${id}/file`, { headers: session.read });

const processExport = (id: string, storage: ObjectStorage = h.storage) =>
  handleExportRequested(
    { pool: h.pool, clock: { now: () => h.now }, storage },
    { event_id: '00000000-0000-4000-8000-000000000002', export_id: id },
  );

async function requested(): Promise<string> {
  const response = await createExport();
  expect(response.status).toBe(202);
  return (response.body as ExportBody).export_id;
}

const row = async (id: string) =>
  (
    await h.pool.query<{
      status: string;
      snapshot: unknown;
      file_object_key: string | null;
      file_sha256: Buffer | null;
      file_size_bytes: string | null;
    }>(
      `SELECT status, snapshot, file_object_key, file_sha256, file_size_bytes
         FROM export_requests WHERE id = $1`,
      [id],
    )
  ).rows[0];

describe('createExport e processamento (RF-008, FL-005)', () => {
  it('202 REQUESTED com o evento no Outbox; getExport mostra o pedido', async () => {
    const response = await createExport();
    expect(response.status).toBe(202);
    const body = response.body as ExportBody;
    expect(body).toEqual({
      export_id: expect.any(String) as unknown,
      status: 'REQUESTED',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
      requested_at: NOW,
      completed_at: null,
      expires_at: null,
      failure_reason: null,
    });
    const events = await h.pool.query<{ payload: { export_id: string } }>(
      `SELECT payload FROM outbox_events WHERE event_type = 'exports.requested'`,
    );
    expect(events.rows.map((r) => r.payload.export_id)).toEqual([body.export_id]);
    expect((await getExport(ana, body.export_id)).body).toEqual(body);
  });

  it.each([
    ['end_date antes de start_date', { start_date: '2026-10-31', end_date: '2026-10-01' }],
    ['mais de 12 meses', { start_date: '2025-10-01', end_date: '2026-10-01' }],
  ])('%s: 422 BUSINESS_RULE_VIOLATION em end_date', async (_caso, body) => {
    const response = await createExport(body);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      field_errors: [expect.objectContaining({ field: 'end_date' }) as unknown],
    });
    expect((await h.pool.query('SELECT 1 FROM export_requests')).rowCount).toBe(0);
  });

  it('CA-010: COMPLETED com checksum, expira em 24 h e descarta o snapshot', async () => {
    await historyFixture();
    const id = await requested();
    h.now = '2026-10-07T07:00:20Z';
    await processExport(id);
    const stored = await row(id);
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.snapshot).toBeNull();
    const file = await h.storage.get(stored?.file_object_key ?? '');
    expect(file).toBeDefined();
    expect(stored?.file_sha256).toEqual(
      createHash('sha256')
        .update(file ?? Buffer.alloc(0))
        .digest(),
    );
    expect(Number(stored?.file_size_bytes)).toBe(file?.length);
    expect((await getExport(ana, id)).body).toMatchObject({
      status: 'COMPLETED',
      completed_at: '2026-10-07T07:00:20Z',
      expires_at: '2026-10-08T07:00:20Z',
      failure_reason: null,
    });
  });

  it('RN-011: download privado, sem cache, como anexo e pesquisavel', async () => {
    await historyFixture();
    const id = await requested();
    await processExport(id);
    const response = await download(ana, id);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="meuremedio-historico-2026-10-01-a-2026-10-31.pdf"',
    );
    expect(response.raw.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = pdfText(response.raw);
    expect(text).toContain('Histórico declaratório de medicamentos');
    expect(text).toContain('01/10/2026 a 31/10/2026');
    expect(text).toContain('Losartana Sintética');
    expect(text).toContain('50 mg');
    expect(text).toContain('05/10/2026 08:00');
    expect(text).toContain('Tomado');
    expect(text).toContain('Não tomado: preocupação com efeito colateral');
    // 07/10 08:00 local ainda nao chegou no processamento: fica fora.
    expect(text).not.toContain('07/10/2026 08:00');
    expect(text).not.toMatch(/ana\.silva|Ana Silva/);
  });

  it('TS-020: edicao posterior do plano nao altera o PDF', async () => {
    const planId = await historyFixture();
    const id = await requested();
    await processExport(id);
    const before = (await download(ana, id)).raw;
    const plan = await h.call('getPlan', 'GET', `/plans/${planId}`, { headers: ana.read });
    const edited = await h.call('updatePlan', 'PUT', `/plans/${planId}`, {
      body: { ...PLAN, medication_name: 'Nome Novo Sintético' },
      headers: {
        ...ana.mutation,
        'idempotency-key': nextKey(),
        'if-match': plan.headers['etag'] ?? '',
      },
    });
    expect(edited.status).toBe(200);
    const after = (await download(ana, id)).raw;
    expect(after.equals(before)).toBe(true);
    expect(pdfText(after)).not.toContain('Nome Novo');
  });

  it('o snapshot e congelado no inicio do processamento e reaproveitado na retomada', async () => {
    await historyFixture();
    const id = await requested();
    // Primeira tentativa cai no envio ao armazenamento: o pedido fica PROCESSING com o snapshot.
    const failing: ObjectStorage = {
      put: () => Promise.reject(new Error('processo encerrado')),
      get: (key) => h.storage.get(key),
      delete: (key) => h.storage.delete(key),
    };
    await expect(processExport(id, failing)).rejects.toThrow('processo encerrado');
    expect((await row(id))?.status).toBe('PROCESSING');
    expect((await row(id))?.snapshot).not.toBeNull();
    // Apagar as respostas depois do congelamento nao muda o PDF: ele sai do snapshot.
    await h.pool.query(`DELETE FROM responses`);
    await processExport(id);
    expect((await row(id))?.status).toBe('COMPLETED');
    expect(pdfText((await download(ana, id)).raw)).toContain('Tomado');
  });

  it('conta fora de ACTIVE no processamento: FAILED ACCOUNT_NOT_ACTIVE sem arquivo', async () => {
    const id = await requested();
    await h.pool.query(`UPDATE users SET status = 'DELETION_SCHEDULED' WHERE id = $1`, [anaId]);
    await processExport(id);
    expect(await row(id)).toMatchObject({
      status: 'FAILED',
      snapshot: null,
      file_object_key: null,
    });
    expect(h.storage.size).toBe(0);
  });

  it('falha tecnica definitiva na geracao: FAILED TECHNICAL_FAILURE sem arquivo', async () => {
    const id = await requested();
    await h.pool.query(
      `UPDATE export_requests SET status = 'PROCESSING', snapshot = '{"versao": 999}' WHERE id = $1`,
      [id],
    );
    await processExport(id);
    expect(await row(id)).toMatchObject({
      status: 'FAILED',
      snapshot: null,
      file_object_key: null,
    });
    expect((await getExport(ana, id)).body).toMatchObject({
      status: 'FAILED',
      failure_reason: 'TECHNICAL_FAILURE',
    });
  });

  it('download antes de COMPLETED: 404', async () => {
    const id = await requested();
    const response = await download(ana, id);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('reentrega do evento depois de COMPLETED nao regera', async () => {
    await historyFixture();
    const id = await requested();
    await processExport(id);
    const first = (await row(id))?.file_sha256;
    h.now = '2026-10-07T08:00:00Z';
    await processExport(id);
    expect((await row(id))?.file_sha256).toEqual(first);
  });
});

describe('expiracao em 24 h (RN-011, CA-011, TS-011)', () => {
  it('apos expires_at: download 410 RESOURCE_EXPIRED sem revelar o armazenamento; getExport EXPIRED', async () => {
    await historyFixture();
    const id = await requested();
    await processExport(id);
    await advanceTo('2026-10-08T07:00:00Z');
    const response = await download(ana, id);
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ code: 'RESOURCE_EXPIRED' });
    // instance traz o caminho da requisicao; a chave do armazenamento nunca aparece.
    expect(JSON.stringify(response.body)).not.toMatch(
      new RegExp(`exports/${anaId}|s3|bucket|[.]pdf`, 'i'),
    );
    expect((await getExport(ana, id)).body).toMatchObject({ status: 'EXPIRED' });
  });

  it('o job de expiracao remove o arquivo e marca EXPIRED', async () => {
    await historyFixture();
    const id = await requested();
    await processExport(id);
    expect(h.storage.size).toBe(1);
    const sweep = (now: string) => expireExports({ pool: h.pool, storage: h.storage }, { now });
    expect(await sweep('2026-10-08T06:59:59Z')).toEqual({ expired: 0, failed: 0 });
    expect(await sweep('2026-10-08T07:00:00Z')).toEqual({ expired: 1, failed: 0 });
    expect(await row(id)).toMatchObject({ status: 'EXPIRED', file_object_key: null });
    expect(h.storage.size).toBe(0);
  });
});

describe('processamento interrompido', () => {
  it('PROCESSING parado ha mais de 30 min: o job marca FAILED TECHNICAL_FAILURE', async () => {
    await historyFixture();
    const id = await requested();
    const failing: ObjectStorage = {
      put: () => Promise.reject(new Error('armazenamento indisponivel')),
      get: (key) => h.storage.get(key),
      delete: (key) => h.storage.delete(key),
    };
    await expect(processExport(id, failing)).rejects.toThrow('armazenamento indisponivel');
    const sweep = (now: string) => expireExports({ pool: h.pool, storage: h.storage }, { now });
    expect(await sweep('2026-10-07T07:29:59Z')).toEqual({ expired: 0, failed: 0 });
    expect(await sweep('2026-10-07T07:30:00Z')).toEqual({ expired: 0, failed: 1 });
    expect(await row(id)).toMatchObject({ status: 'FAILED', snapshot: null });
  });
});

describe('cancelExport (CA-016, TS-042)', () => {
  it('REQUESTED: 204 e CANCELED; o worker nao gera depois', async () => {
    const id = await requested();
    const response = await cancelExport(ana, id);
    expect(response.status).toBe(204);
    await processExport(id);
    expect(await row(id)).toMatchObject({
      status: 'CANCELED',
      snapshot: null,
      file_object_key: null,
    });
    expect(h.storage.size).toBe(0);
  });

  it('PROCESSING: o cancelamento durante a geracao descarta o arquivo parcial', async () => {
    await historyFixture();
    const id = await requested();
    const cancelling: ObjectStorage = {
      put: async (key, body) => {
        await h.storage.put(key, body);
        expect((await cancelExport(ana, id)).status).toBe(204);
      },
      get: (key) => h.storage.get(key),
      delete: (key) => h.storage.delete(key),
    };
    await processExport(id, cancelling);
    expect(await row(id)).toMatchObject({
      status: 'CANCELED',
      snapshot: null,
      file_object_key: null,
    });
    expect(h.storage.size).toBe(0);
  });

  it.each([
    ['COMPLETED', async (id: string) => processExport(id)],
    [
      'CANCELED',
      async (id: string) => {
        await cancelExport(ana, id);
      },
    ],
  ])('estado terminal %s: 409 STATE_CONFLICT', async (_estado, reach) => {
    await historyFixture();
    const id = await requested();
    await reach(id);
    const response = await cancelExport(ana, id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
  });
});

describe('TS-008/TS-023: exportacao de outro titular', () => {
  it('getExport, cancelExport e downloadExport: 404 identico e 1 ownership.denied por tentativa', async () => {
    await historyFixture();
    const id = await requested();
    await processExport(id);
    const missing = '7b0c5e2a-0d3c-4a4e-9a51-3c0b7c1f2d11';
    const strip = (body: unknown): unknown =>
      Object.fromEntries(
        Object.entries(body as Record<string, unknown>).filter(
          ([key]) => key !== 'correlation_id' && key !== 'instance',
        ),
      );
    for (const call of [getExport, cancelExport, download]) {
      const foreign = await call(bruno, id);
      const absent = await call(bruno, missing);
      expect(foreign.status).toBe(404);
      expect(strip(foreign.body)).toEqual(strip(absent.body));
    }
    const audits = await h.pool.query<{ resource_type: string; resource_id: string }>(
      `SELECT resource_type, resource_id FROM audit_events WHERE action = 'ownership.denied'`,
    );
    expect(audits.rows).toEqual(
      Array.from({ length: 3 }, () => ({ resource_type: 'export_request', resource_id: id })),
    );
    expect((await row(id))?.status).toBe('COMPLETED');
  });
});

describe('TS-038/TS-015: idempotencia de createExport', () => {
  it('replay identico devolve o snapshot original sem novo pedido', async () => {
    const first = await createExport(undefined, 'kx');
    h.now = '2026-10-05T07:01:00Z';
    const replay = await createExport(undefined, 'kx');
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual(first.body);
    expect((await h.pool.query('SELECT 1 FROM export_requests')).rowCount).toBe(1);
  });

  it('mesma chave com payload divergente: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    await createExport(undefined, 'kx');
    const divergent = await createExport(
      { start_date: '2026-09-01', end_date: '2026-09-30' },
      'kx',
    );
    expect(divergent.status).toBe(409);
    expect(divergent.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('sem Idempotency-Key: 400', async () => {
    const response = await h.call('createExport', 'POST', '/exports', {
      body: { start_date: '2026-10-01', end_date: '2026-10-31' },
      headers: ana.mutation,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'Idempotency-Key' }] });
  });

  it('chave expirada (7 dias + 1 s) e tratada como nova', async () => {
    await createExport(undefined, 'kx');
    await advanceTo('2026-10-12T07:00:01Z');
    expect((await createExport(undefined, 'kx')).status).toBe(202);
    expect((await h.pool.query('SELECT 1 FROM export_requests')).rowCount).toBe(2);
  });
});

describe('worker: exportacao pelo Outbox e expiracao agendada', () => {
  it('agenda a expiracao e o consumidor conclui o pedido', async () => {
    await historyFixture();
    const id = await requested();
    const boss = new PgBoss({ connectionString: h.url });
    boss.on('error', () => undefined);
    const worker = await startWorker({
      pool: h.pool,
      boss,
      clock: { now: () => h.now },
      email: { send: () => Promise.resolve(undefined) },
      storage: h.storage,
      webBaseUrl: 'https://app.example.invalid',
      emailPepper: Buffer.alloc(32, 7),
      pollIntervalMs: 100,
    });
    try {
      const schedules = await boss.getSchedules(EXPORTS_EXPIRY_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(['* * * * *']);
      const limit = Date.now() + 20_000;
      while ((await row(id))?.status !== 'COMPLETED' && Date.now() < limit) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect((await row(id))?.status).toBe('COMPLETED');
    } finally {
      await worker.stop();
    }
  });
});

// @trace TS-023 TS-008 RNF-003 CA-012 RN-002 deleteCurrentSession getAccessibilityPreferences updateAccessibilityPreferences listPlans createPlan getPlan updatePlan deletePlan listOccurrences createResponse getHistory listExports createExport getExport cancelExport downloadExport getPrivacy requestAccountDeletion getCurrentAccount updateCurrentAccount revokeAllSessions
// TS-023 (BOLA/IDOR em todas as rotas privadas, QG-009), gerado a partir da OpenAPI: cada operacao
// privada precisa de um caso, ou o teste reprova.
//   - com identificador no caminho: U2 usa o identificador de U1 -> 404 RESOURCE_NOT_FOUND
//     indistinguivel do 404 de um UUID inexistente, recurso de U1 intacto e 1 ownership.denied;
//   - leitura sem identificador: U2 so ve os proprios dados (nenhum id, e-mail ou plano de U1);
//   - mutacao sem identificador: so alcanca o proprio titular (estado de U1 intacto).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleExportRequested } from '../../apps/api/src/modules/exports/application/process-export.js';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import {
  PASSWORD,
  login,
  startHarness,
  type Harness,
  type HttpResult,
  type LoggedIn,
} from '../integration/support/http.js';

const NOW = '2026-10-05T11:05:15Z';
const MEDICATION = 'Losartana Sintética';
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

interface Fixture {
  readonly planId: string;
  readonly occurrenceId: string;
  readonly exportId: string;
  readonly etag: string;
}

let ana: LoggedIn;
let anaId: string;
let bruno: LoggedIn;
let brunoId: string;
let fixture: Fixture;
let keySequence = 0;
const nextKey = (): string => {
  keySequence += 1;
  return `k-${String(keySequence)}`;
};

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  anaId = await h.activeUser('ana.silva@example.com');
  brunoId = await h.activeUser('bruno.costa@example.com');
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
  fixture = await anaResources();
});

/** U1: plano P1 com ocorrencias (O1 acionavel) e exportacao E1 COMPLETED. */
async function anaResources(): Promise<Fixture> {
  const created = await h.call('createPlan', 'POST', '/plans', {
    body: {
      medication_name: MEDICATION,
      dose_text: '50 mg',
      medication_form: 'TABLET',
      administration_route: 'ORAL',
      start_date: '2026-10-01',
      schedule_times: ['08:00'],
    },
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });
  expect(created.status).toBe(201);
  const planId = (created.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: randomUUID(), plan_id: planId },
  );
  const occurrenceId = (
    await h.pool.query<{ id: string }>(
      "SELECT id FROM occurrences WHERE plan_id = $1 AND status = 'PROGRAMMED' ORDER BY scheduled_at LIMIT 1",
      [planId],
    )
  ).rows[0]?.id;
  if (occurrenceId === undefined) throw new Error('fixture sem ocorrencia');
  const exported = await h.call('createExport', 'POST', '/exports', {
    body: { start_date: '2026-10-01', end_date: '2026-10-31' },
    headers: { ...ana.mutation, 'idempotency-key': nextKey() },
  });
  expect(exported.status).toBe(202);
  const exportId = (exported.body as { export_id: string }).export_id;
  await handleExportRequested(
    { pool: h.pool, clock: { now: () => h.now }, storage: h.storage },
    { event_id: randomUUID(), export_id: exportId },
  );
  const plan = await h.call('getPlan', 'GET', `/plans/${planId}`, { headers: ana.read });
  const etag = plan.headers['etag'];
  if (etag === undefined) throw new Error('getPlan sem ETag');
  return { planId, occurrenceId, exportId, etag };
}

/** Estado de U1 que nenhuma chamada de U2 pode alterar. */
async function anaState(): Promise<string> {
  const dump = async (sql: string) => JSON.stringify((await h.pool.query(sql, [anaId])).rows);
  return [
    await dump(
      `SELECT name, status, text_scale, high_contrast, row_version, deletion_requested_at
         FROM users WHERE id = $1`,
    ),
    await dump('SELECT id, revoked_at FROM sessions WHERE user_id = $1 ORDER BY id'),
    await dump(
      'SELECT id, status, row_version FROM medication_plans WHERE user_id = $1 ORDER BY id',
    ),
    await dump('SELECT id, status, row_version FROM occurrences WHERE user_id = $1 ORDER BY id'),
    await dump('SELECT id FROM responses WHERE user_id = $1 ORDER BY id'),
    await dump(
      'SELECT id, status, row_version FROM export_requests WHERE user_id = $1 ORDER BY id',
    ),
  ].join('\n');
}

const deniedAudits = async (): Promise<{ resource_id: string; actor_user_id: string }[]> =>
  (
    await h.pool.query<{ resource_id: string; actor_user_id: string }>(
      `SELECT resource_id, actor_user_id FROM audit_events
        WHERE action = 'ownership.denied' AND actor_user_id = $1`,
      [brunoId],
    )
  ).rows;

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** Operacoes com identificador no caminho: a chamada de U2 com o identificador informado. */
const BY_ID: Record<string, (id: string) => Call> = {
  getPlan: (id) => ({ method: 'GET', url: `/plans/${id}` }),
  updatePlan: (id) => ({
    method: 'PUT',
    url: `/plans/${id}`,
    body: {
      medication_name: 'Forjado',
      dose_text: '1',
      medication_form: 'TABLET',
      administration_route: 'ORAL',
      start_date: '2026-10-01',
      schedule_times: ['09:00'],
    },
    headers: { 'if-match': fixture.etag, 'idempotency-key': nextKey() },
  }),
  deletePlan: (id) => ({ method: 'DELETE', url: `/plans/${id}` }),
  createResponse: (id) => ({
    method: 'POST',
    url: `/occurrences/${id}/responses`,
    body: { type: 'TAKEN', reason: null },
    headers: { 'idempotency-key': nextKey() },
  }),
  getExport: (id) => ({ method: 'GET', url: `/exports/${id}` }),
  cancelExport: (id) => ({ method: 'DELETE', url: `/exports/${id}` }),
  downloadExport: (id) => ({ method: 'GET', url: `/exports/${id}/file` }),
};

/** Identificador de U1 usado em cada operacao por identificador. */
const anaIdFor = (operationId: string): string => {
  if (operationId.endsWith('Plan')) return fixture.planId;
  if (operationId === 'createResponse') return fixture.occurrenceId;
  return fixture.exportId;
};

/** Leituras sem identificador: U2 so pode receber os proprios dados. */
const READS: Record<string, Call> = {
  listPlans: { method: 'GET', url: '/plans' },
  listOccurrences: { method: 'GET', url: '/occurrences' },
  getHistory: { method: 'GET', url: '/history?start=2026-10-01&end=2026-10-31' },
  listExports: { method: 'GET', url: '/exports' },
  getPrivacy: { method: 'GET', url: '/privacy' },
  getCurrentAccount: { method: 'GET', url: '/accounts/me' },
  getAccessibilityPreferences: { method: 'GET', url: '/preferences/accessibility' },
};

/** Mutacoes sem identificador: so alcancam o proprio titular. */
const SELF_MUTATIONS: Record<string, () => Call> = {
  createPlan: () => ({
    method: 'POST',
    url: '/plans',
    body: {
      medication_name: 'Comprimido do Bruno',
      dose_text: '1 comprimido',
      medication_form: 'TABLET',
      administration_route: 'ORAL',
      start_date: '2026-10-01',
      schedule_times: ['10:00'],
    },
    headers: { 'idempotency-key': nextKey() },
  }),
  createExport: () => ({
    method: 'POST',
    url: '/exports',
    body: { start_date: '2026-10-01', end_date: '2026-10-31' },
    headers: { 'idempotency-key': nextKey() },
  }),
  updateCurrentAccount: () => ({
    method: 'PUT',
    url: '/accounts/me',
    body: { name: 'Outro Nome' },
  }),
  updateAccessibilityPreferences: () => ({
    method: 'PUT',
    url: '/preferences/accessibility',
    body: { text_scale: 200, high_contrast: true },
  }),
  deleteCurrentSession: () => ({ method: 'DELETE', url: '/sessions/current' }),
  revokeAllSessions: () => ({
    method: 'POST',
    url: '/sessions/revocations',
    body: { password: PASSWORD },
    headers: { 'idempotency-key': nextKey() },
  }),
  requestAccountDeletion: () => ({
    method: 'POST',
    url: '/account-deletions',
    body: { password: PASSWORD, confirmation: 'EXCLUIR MINHA CONTA' },
    headers: { 'idempotency-key': nextKey() },
  }),
};

const asBruno = (operationId: string, call: Call): Promise<HttpResult> =>
  h.call(operationId, call.method, call.url, {
    ...(call.body === undefined ? {} : { body: call.body }),
    headers: { ...(call.method === 'GET' ? bruno.read : bruno.mutation), ...call.headers },
  });

describe('TS-023 cobertura gerada da OpenAPI', () => {
  it('toda operacao privada tem caso, e so as com identificador no caminho sao BY_ID', () => {
    const privateOps = h.contract.operations.filter((op) => !op.public).map((op) => op.operationId);
    const covered = [...Object.keys(BY_ID), ...Object.keys(READS), ...Object.keys(SELF_MUTATIONS)];
    expect(privateOps.filter((id) => !covered.includes(id))).toEqual([]);
    expect(covered.filter((id) => !privateOps.includes(id))).toEqual([]);
    const withPathId = privateOps.filter((id) => h.contract.pathParameterNames(id).length > 0);
    expect(withPathId.sort()).toEqual(Object.keys(BY_ID).sort());
    for (const id of Object.keys(READS)) expect(h.contract.operation(id).method).toBe('GET');
    for (const id of Object.keys(SELF_MUTATIONS)) {
      expect(h.contract.operation(id).method).not.toBe('GET');
    }
  });
});

describe('TS-023 por identificador: 404 indistinguivel e ownership.denied', () => {
  it.each(Object.keys(BY_ID))('%s com o identificador de U1', async (operationId) => {
    const build = BY_ID[operationId];
    if (build === undefined) throw new Error(operationId);
    const before = await anaState();

    const foreign = await asBruno(operationId, build(anaIdFor(operationId)));
    const missing = await asBruno(operationId, build(randomUUID()));

    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const shape = (r: HttpResult) => {
      const body = r.body as Record<string, unknown>;
      return { status: r.status, code: body['code'], title: body['title'], detail: body['detail'] };
    };
    expect(shape(foreign)).toEqual(shape(missing));
    expect(await anaState()).toBe(before);
    const audits = await deniedAudits();
    expect(audits.filter((a) => a.resource_id === anaIdFor(operationId))).toHaveLength(1);
  });
});

describe('TS-023 leituras sem identificador: so os dados do proprio titular', () => {
  it.each(Object.keys(READS))('%s', async (operationId) => {
    const call = READS[operationId];
    if (call === undefined) throw new Error(operationId);
    const response = await asBruno(operationId, call);
    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    for (const forbidden of [
      anaId,
      fixture.planId,
      fixture.occurrenceId,
      fixture.exportId,
      'ana.silva',
      MEDICATION,
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('TS-023 mutacoes sem identificador: so alcancam o proprio titular', () => {
  it.each(Object.keys(SELF_MUTATIONS))('%s', async (operationId) => {
    const build = SELF_MUTATIONS[operationId];
    if (build === undefined) throw new Error(operationId);
    const before = await anaState();
    const response = await asBruno(operationId, build());
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(await anaState()).toBe(before);
  });
});

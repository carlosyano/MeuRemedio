// @trace TS-041 CA-018 RF-002 RF-003 ERR-015 deleteCurrentSession createPlan updatePlan deletePlan createResponse (ADR-001 v1.5 OA-008)
// CSRF nas mutacoes autenticadas contra PostgreSQL 17 real: double-submit (cookie mr_csrf +
// X-CSRF-Token com HMAC vinculado a sessao) e validacao de Origin (ou Sec-Fetch-Site). Falha:
// 403 CSRF_VALIDATION_FAILED sem efeito. Nesta etapa, deleteCurrentSession, createPlan, updatePlan,
// deletePlan e createResponse sao as mutacoes autenticadas implementadas; as demais entram com seus
// modulos.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, startHarness, type Harness, type LoggedIn } from '../integration/support/http.js';

let h: Harness;

/** Cabecalhos sem o Origin. */
const withoutOrigin = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'origin'));

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.truncate();
});

const logout = (headers: Record<string, string>) =>
  h.call('deleteCurrentSession', 'DELETE', '/sessions/current', { headers });

const revoked = async (session: LoggedIn): Promise<boolean> =>
  (
    await h.pool.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE id = $1',
      [session.sessionId],
    )
  ).rows[0]?.revoked ?? false;

let sequence = 0;
async function session(): Promise<LoggedIn> {
  sequence += 1;
  const email = `ana.silva+${String(sequence)}@example.com`;
  await h.activeUser(email);
  return login(h, email);
}

describe('TS-041 CSRF em deleteCurrentSession', () => {
  it('mutacao com cookie, X-CSRF-Token e Origin validos passa', async () => {
    const s = await session();
    expect((await logout(s.mutation)).status).toBe(204);
  });

  it.each([
    [
      'sem X-CSRF-Token',
      (s: LoggedIn) => ({ cookie: s.read['cookie'] ?? '', origin: s.mutation['origin'] ?? '' }),
    ],
    [
      'X-CSRF-Token errado',
      (s: LoggedIn) => ({ ...s.mutation, 'x-csrf-token': 'AAAA' + s.csrf.slice(4) }),
    ],
    [
      'sem cookie mr_csrf',
      (s: LoggedIn) => ({ ...s.mutation, cookie: `mr_session=${s.sessionCookie}` }),
    ],
    ['Origin nao permitida', (s: LoggedIn) => ({ ...s.mutation, origin: 'https://evil.example' })],
    ['sem Origin e sem Sec-Fetch-Site', (s: LoggedIn) => withoutOrigin(s.mutation)],
    [
      'sem Origin e Sec-Fetch-Site cross-site',
      (s: LoggedIn) => ({ ...withoutOrigin(s.mutation), 'sec-fetch-site': 'cross-site' }),
    ],
  ])('%s: 403 CSRF_VALIDATION_FAILED sem efeito', async (_nome, headersFor) => {
    const s = await session();
    const response = await logout(headersFor(s));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    expect(await revoked(s)).toBe(false);
  });

  it('token CSRF de outra sessao nao serve', async () => {
    const a = await session();
    const b = await session();
    const response = await logout({
      ...a.mutation,
      'x-csrf-token': b.csrf,
      cookie: `mr_session=${a.sessionCookie}; mr_csrf=${b.csrf}`,
    });
    expect(response.status).toBe(403);
    expect(await revoked(a)).toBe(false);
  });

  it('sem Origin, Sec-Fetch-Site same-origin e aceito', async () => {
    const s = await session();
    expect(
      (await logout({ ...withoutOrigin(s.mutation), 'sec-fetch-site': 'same-origin' })).status,
    ).toBe(204);
  });

  it('sem sessao, a resposta e 401 antes da verificacao de CSRF', async () => {
    expect((await logout({ origin: 'https://evil.example' })).status).toBe(401);
  });

  it.todo('as demais 6 mutacoes autenticadas (CA-018) entram com seus modulos');
});

describe('TS-041 CSRF em createPlan', () => {
  const PLAN = {
    medication_name: 'Comprimido',
    dose_text: '1 comprimido',
    medication_form: 'TABLET',
    administration_route: 'ORAL',
    start_date: '2026-10-01',
    schedule_times: ['08:00'],
  };
  const plans = async (): Promise<number> =>
    (await h.pool.query('SELECT 1 FROM medication_plans')).rowCount ?? 0;

  it.each([
    [
      'sem X-CSRF-Token',
      (s: LoggedIn) => ({ cookie: s.read['cookie'] ?? '', origin: s.mutation['origin'] ?? '' }),
    ],
    ['Origin nao permitida', (s: LoggedIn) => ({ ...s.mutation, origin: 'https://evil.example' })],
  ])('%s: 403 CSRF_VALIDATION_FAILED sem criar plano', async (_nome, headersFor) => {
    const s = await session();
    const response = await h.call('createPlan', 'POST', '/plans', {
      body: PLAN,
      headers: { ...headersFor(s), 'idempotency-key': 'k-1' },
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    expect(await plans()).toBe(0);
  });

  it('com CSRF valido, cria', async () => {
    const s = await session();
    const response = await h.call('createPlan', 'POST', '/plans', {
      body: PLAN,
      headers: { ...s.mutation, 'idempotency-key': 'k-1' },
    });
    expect(response.status).toBe(201);
  });
});

describe('TS-041 CSRF em updatePlan e deletePlan', () => {
  const PLAN = {
    medication_name: 'Comprimido',
    dose_text: '1 comprimido',
    medication_form: 'TABLET',
    administration_route: 'ORAL',
    start_date: '2026-10-01',
    schedule_times: ['08:00'],
  };

  async function planOf(s: LoggedIn): Promise<string> {
    const response = await h.call('createPlan', 'POST', '/plans', {
      body: PLAN,
      headers: { ...s.mutation, 'idempotency-key': 'k-plano' },
    });
    expect(response.status).toBe(201);
    return (response.body as { plan_id: string }).plan_id;
  }

  const state = async (planId: string) =>
    (
      await h.pool.query<{ status: string; row_version: string }>(
        'SELECT status, row_version FROM medication_plans WHERE id = $1',
        [planId],
      )
    ).rows[0];

  const withoutToken = (s: LoggedIn) => ({
    cookie: s.read['cookie'] ?? '',
    origin: s.mutation['origin'] ?? '',
  });
  const evilOrigin = (s: LoggedIn) => ({ ...s.mutation, origin: 'https://evil.example' });

  it.each([
    ['sem X-CSRF-Token', withoutToken],
    ['Origin nao permitida', evilOrigin],
  ])('updatePlan %s: 403 sem editar', async (_nome, headersFor) => {
    const s = await session();
    const planId = await planOf(s);
    const response = await h.call('updatePlan', 'PUT', `/plans/${planId}`, {
      body: { ...PLAN, dose_text: '2 comprimidos' },
      headers: { ...headersFor(s), 'idempotency-key': 'k-1', 'if-match': '"1"' },
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    expect(await state(planId)).toEqual({ status: 'ACTIVE', row_version: '1' });
  });

  it.each([
    ['sem X-CSRF-Token', withoutToken],
    ['Origin nao permitida', evilOrigin],
  ])('deletePlan %s: 403 sem excluir', async (_nome, headersFor) => {
    const s = await session();
    const planId = await planOf(s);
    const response = await h.call('deletePlan', 'DELETE', `/plans/${planId}`, {
      headers: headersFor(s),
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    expect(await state(planId)).toEqual({ status: 'ACTIVE', row_version: '1' });
  });
});

describe('TS-041 CSRF em createResponse', () => {
  it.each([
    [
      'sem X-CSRF-Token',
      (s: LoggedIn) => ({ cookie: s.read['cookie'] ?? '', origin: s.mutation['origin'] ?? '' }),
    ],
    ['Origin nao permitida', (s: LoggedIn) => ({ ...s.mutation, origin: 'https://evil.example' })],
  ])('%s: 403 sem registrar resposta', async (_nome, headersFor) => {
    const s = await session();
    const created = await h.call('createPlan', 'POST', '/plans', {
      body: {
        medication_name: 'Comprimido',
        dose_text: '1 comprimido',
        medication_form: 'TABLET',
        administration_route: 'ORAL',
        start_date: '2026-10-01',
        schedule_times: ['08:00'],
      },
      headers: { ...s.mutation, 'idempotency-key': 'k-plano' },
    });
    expect(created.status).toBe(201);
    const planId = (created.body as { plan_id: string }).plan_id;
    // A geracao e assincrona (Outbox): a ocorrencia do fixture entra direto no banco.
    const occurrenceId = (
      await h.pool.query<{ id: string }>(
        `INSERT INTO occurrences (user_id, plan_id, schedule_time_id, local_scheduled_date,
                                 local_time, scheduled_at, deadline_at, medication_name_snapshot,
                                 dose_text_snapshot)
         SELECT p.user_id, p.id, t.id, DATE '2026-10-05', '08:00', '2026-10-05T11:00:00Z',
                '2026-10-05T12:00:00Z', 'Comprimido', '1 comprimido'
           FROM medication_plans p JOIN schedule_times t ON t.plan_id = p.id
          WHERE p.id = $1
         RETURNING id`,
        [planId],
      )
    ).rows[0]?.id;
    if (occurrenceId === undefined) throw new Error('ocorrencia nao criada');
    const response = await h.call(
      'createResponse',
      'POST',
      `/occurrences/${occurrenceId}/responses`,
      {
        body: { type: 'TAKEN', reason: null },
        headers: { ...headersFor(s), 'idempotency-key': 'k-1' },
      },
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    const rows = await h.pool.query('SELECT 1 FROM responses WHERE occurrence_id = $1', [
      occurrenceId,
    ]);
    expect(rows.rowCount).toBe(0);
  });
});

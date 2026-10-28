// @trace RF-004 RF-005 RF-006 RN-008 RN-009 CA-007 CA-012 CA-013 TS-001 TS-007 TS-008 TS-015 TS-023 TS-038 ERR-004 ERR-006 DEC-035 listOccurrences createResponse
// Ocorrencias e respostas por HTTP contra PostgreSQL 17 real: lista das ocorrencias acionaveis do
// titular (DC-036), primeira resposta aceita e imutavel (RN-008, CA-007, TS-001), resposta tardia
// com is_late e marco preservado (RN-009, TS-007), idempotencia de createResponse (CA-013, TS-038)
// e acesso horizontal com 404 indistinguivel e auditoria (TS-008, TS-023). Com local_date, as
// ocorrencias daquele dia civil, inclusive as ainda nao alcancadas (DEC-035).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleOccurrencesRequested } from '../../apps/api/src/modules/occurrences/application/occurrences-requested.js';
import { login, startHarness, type Harness, type LoggedIn } from './support/http.js';

// America/Sao_Paulo (UTC-3): 08:00 local = 11:00Z, prazo 12:00Z; 20:00 local = 23:00Z.
const NOW = '2026-10-05T11:05:15Z';
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
  await h.pool.query('TRUNCATE audit_events');
});

const at = (offsetMs: number): string =>
  new Date(Date.parse(NOW) + offsetMs).toISOString().replace('.000Z', 'Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MISSING = '7b0c5e2a-0d3c-4a4e-9a51-3c0b7c1f2d11';

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

let ana: LoggedIn;
let anaId: string;
let bruno: LoggedIn;

beforeEach(async () => {
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

interface OccurrenceBody {
  occurrence_id: string;
  plan_id: string;
  local_scheduled_date: string;
  local_time: string;
  scheduled_at: string;
  deadline_at: string;
  status: string;
  medication_name_snapshot: string;
  dose_text_snapshot: string;
  is_late: boolean;
  no_response_reached_at: string | null;
  row_version: number;
}

interface PageBody {
  items: OccurrenceBody[];
  page: { next_cursor: string | null; limit: number };
}

/** Cria o plano por HTTP e gera o horizonte como o worker faria, no instante atual do relogio. */
async function planWithOccurrences(session: LoggedIn = ana): Promise<string> {
  const response = await h.call('createPlan', 'POST', '/plans', {
    body: PLAN,
    headers: { ...session.mutation, 'idempotency-key': nextKey() },
  });
  expect(response.status).toBe(201);
  const planId = (response.body as { plan_id: string }).plan_id;
  await handleOccurrencesRequested(
    { pool: h.pool, clock: { now: () => h.now } },
    { event_id: '00000000-0000-4000-8000-000000000000', plan_id: planId },
  );
  return planId;
}

/** Ocorrencia do plano no horario civil local da data informada. */
const occurrenceId = async (planId: string, date: string, time: string): Promise<string> => {
  const row = (
    await h.pool.query<{ id: string }>(
      `SELECT id FROM occurrences
        WHERE plan_id = $1 AND local_scheduled_date = $2 AND local_time = $3
          AND status <> 'CANCELED'`,
      [planId, date, time],
    )
  ).rows[0];
  if (row === undefined) throw new Error(`ocorrencia ${date} ${time} ausente`);
  return row.id;
};

const listOccurrences = (session: LoggedIn, query = '') =>
  h.call('listOccurrences', 'GET', `/occurrences${query}`, { headers: session.read });

const respond = (
  session: LoggedIn,
  id: string,
  body: unknown,
  options: { key?: string | undefined } = {},
) => {
  const headers: Record<string, string> = { ...session.mutation };
  const key = 'key' in options ? options.key : nextKey();
  if (key !== undefined) headers['idempotency-key'] = key;
  return h.call('createResponse', 'POST', `/occurrences/${id}/responses`, { body, headers });
};

const TAKEN = { type: 'TAKEN', reason: null } as const;
const FORGOT = { type: 'NOT_TAKEN', reason: 'FORGOT' } as const;

const occurrenceRow = async (id: string) =>
  (
    await h.pool.query<{
      status: string;
      is_late: boolean;
      row_version: string;
      no_response_reached_at: Date | null;
    }>(
      'SELECT status, is_late, row_version, no_response_reached_at FROM occurrences WHERE id = $1',
      [id],
    )
  ).rows[0];

const responseRows = async (id: string) =>
  (
    await h.pool.query<{
      type: string;
      reason: string | null;
      captured_at: Date;
      is_late: boolean;
    }>('SELECT type, reason, captured_at, is_late FROM responses WHERE occurrence_id = $1', [id])
  ).rows;

const deniedAudits = async () =>
  (
    await h.pool.query<{ actor_user_id: string; resource_type: string; resource_id: string }>(
      `SELECT actor_user_id, resource_type, resource_id FROM audit_events
        WHERE action = 'ownership.denied'`,
    )
  ).rows;

/** Avanca o relogio e renova as sessoes (a sessao ociosa expira em 30 min). */
async function advance(offsetMs: number): Promise<void> {
  h.now = at(offsetMs);
  ana = await login(h, 'ana.silva@example.com');
  bruno = await login(h, 'bruno.costa@example.com');
}

describe('listOccurrences: ocorrencias acionaveis do titular (RF-004, RF-005, DC-036)', () => {
  it('lista so as ocorrencias ja alcancadas (scheduled_at <= agora) com os snapshots', async () => {
    const planId = await planWithOccurrences();
    const response = await listOccurrences(ana);
    expect(response.status).toBe(200);
    const page = response.body as PageBody;
    expect(page.page).toEqual({ next_cursor: null, limit: 20 });
    expect(page.items).toEqual([
      {
        occurrence_id: await occurrenceId(planId, '2026-10-05', '08:00'),
        plan_id: planId,
        local_scheduled_date: '2026-10-05',
        local_time: '08:00',
        scheduled_at: '2026-10-05T11:00:00Z',
        deadline_at: '2026-10-05T12:00:00Z',
        status: 'PROGRAMMED',
        medication_name_snapshot: 'Comprimido',
        dose_text_snapshot: '1 comprimido',
        treatment_reason_snapshot: null,
        is_late: false,
        no_response_reached_at: null,
        row_version: 1,
      },
    ]);
  });

  it('ordena da mais recente para a mais antiga e pagina por cursor sem repetir nem pular', async () => {
    await planWithOccurrences();
    await advance(2 * DAY);
    const first = await listOccurrences(ana, '?limit=2');
    expect(first.status).toBe(200);
    const page1 = first.body as PageBody;
    expect(page1.items.map((o) => o.scheduled_at)).toEqual([
      '2026-10-07T11:00:00Z',
      '2026-10-06T23:00:00Z',
    ]);
    expect(page1.page.next_cursor).not.toBeNull();

    const second = await listOccurrences(
      ana,
      `?limit=2&cursor=${encodeURIComponent(page1.page.next_cursor ?? '')}`,
    );
    const page2 = second.body as PageBody;
    expect(page2.items.map((o) => o.scheduled_at)).toEqual([
      '2026-10-06T11:00:00Z',
      '2026-10-05T23:00:00Z',
    ]);

    const third = await listOccurrences(
      ana,
      `?limit=2&cursor=${encodeURIComponent(page2.page.next_cursor ?? '')}`,
    );
    const page3 = third.body as PageBody;
    expect(page3.items.map((o) => o.scheduled_at)).toEqual(['2026-10-05T11:00:00Z']);
    expect(page3.page.next_cursor).toBeNull();
  });

  it('cursor invalido: 400 VALIDATION_FAILED no campo cursor', async () => {
    const response = await listOccurrences(ana, '?cursor=nao-e-um-cursor');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [{ field: 'cursor' }],
    });
  });

  it('filtra por status em lista separada por virgula (style form, explode false)', async () => {
    const planId = await planWithOccurrences();
    await advance(2 * DAY);
    const answered = await occurrenceId(planId, '2026-10-06', '08:00');
    expect((await respond(ana, answered, TAKEN)).status).toBe(201);

    const taken = (await listOccurrences(ana, '?status=TAKEN')).body as PageBody;
    expect(taken.items.map((o) => o.occurrence_id)).toEqual([answered]);

    const pending = (await listOccurrences(ana, '?status=PROGRAMMED,NO_RESPONSE')).body as PageBody;
    expect(pending.items).toHaveLength(4);
    expect(pending.items.every((o) => o.status === 'PROGRAMMED')).toBe(true);
  });

  it('status fora do enum: 400 VALIDATION_FAILED', async () => {
    const response = await listOccurrences(ana, '?status=PROGRAMMED,ATRASADA');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('sem filtro, omite as CANCELED; com status=CANCELED, lista as canceladas', async () => {
    const planId = await planWithOccurrences();
    const canceled = await occurrenceId(planId, '2026-10-05', '08:00');
    await h.pool.query(`UPDATE occurrences SET status = 'CANCELED' WHERE id = $1`, [canceled]);

    expect(((await listOccurrences(ana)).body as PageBody).items).toEqual([]);
    const only = (await listOccurrences(ana, '?status=CANCELED')).body as PageBody;
    expect(only.items.map((o) => o.occurrence_id)).toEqual([canceled]);
  });

  it('omite as ocorrencias de plano excluido (TS-005)', async () => {
    const planId = await planWithOccurrences();
    expect(
      (await h.call('deletePlan', 'DELETE', `/plans/${planId}`, { headers: ana.mutation })).status,
    ).toBe(204);
    expect(((await listOccurrences(ana)).body as PageBody).items).toEqual([]);
  });

  it('TS-023: U2 nao ve nenhuma ocorrencia de U1', async () => {
    await planWithOccurrences(ana);
    const response = await listOccurrences(bruno);
    expect(response.status).toBe(200);
    expect((response.body as PageBody).items).toEqual([]);
  });
});

describe('listOccurrences com local_date: remedios do dia (DEC-035)', () => {
  const day = async (session: LoggedIn, query: string) => {
    const response = await listOccurrences(session, query);
    expect(response.status).toBe(200);
    return (response.body as PageBody).items.map(
      (o) => `${o.local_scheduled_date} ${o.local_time} ${o.status}`,
    );
  };

  it('lista as do dia, inclusive as ainda nao alcancadas; sem local_date segue so as alcancadas', async () => {
    await planWithOccurrences();
    expect(await day(ana, '?local_date=2026-10-05')).toEqual([
      '2026-10-05 20:00 PROGRAMMED',
      '2026-10-05 08:00 PROGRAMMED',
    ]);
    expect(await day(ana, '')).not.toContain('2026-10-05 20:00 PROGRAMMED');
  });

  it('so o dia pedido: outros dias ficam de fora', async () => {
    await planWithOccurrences();
    expect(await day(ana, '?local_date=2026-10-06')).toEqual([
      '2026-10-06 20:00 PROGRAMMED',
      '2026-10-06 08:00 PROGRAMMED',
    ]);
  });

  it('inclui as respondidas e combina com o filtro de status', async () => {
    const planId = await planWithOccurrences();
    expect(
      (await respond(ana, await occurrenceId(planId, '2026-10-05', '08:00'), TAKEN)).status,
    ).toBe(201);
    expect(await day(ana, '?local_date=2026-10-05')).toEqual([
      '2026-10-05 20:00 PROGRAMMED',
      '2026-10-05 08:00 TAKEN',
    ]);
    expect(await day(ana, '?local_date=2026-10-05&status=PROGRAMMED')).toEqual([
      '2026-10-05 20:00 PROGRAMMED',
    ]);
  });

  it('data invalida: 400 VALIDATION_FAILED', async () => {
    const response = await listOccurrences(ana, '?local_date=2026-13-40');
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('TS-023: U2 nao ve as ocorrencias do dia de U1', async () => {
    await planWithOccurrences();
    expect(await day(bruno, '?local_date=2026-10-05')).toEqual([]);
  });
});

describe('createResponse: primeira resposta aceita (RF-006, RN-008)', () => {
  it('TAKEN antes do prazo: 201, is_late=false, ocorrencia TAKEN com nova versao', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    const response = await respond(ana, id, TAKEN);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      response_id: expect.any(String) as unknown,
      occurrence_id: id,
      type: 'TAKEN',
      reason: null,
      captured_at: NOW,
      is_late: false,
    });
    expect(await occurrenceRow(id)).toEqual({
      status: 'TAKEN',
      is_late: false,
      row_version: '2',
      no_response_reached_at: null,
    });
    expect(await responseRows(id)).toEqual([
      { type: 'TAKEN', reason: null, captured_at: new Date(NOW), is_late: false },
    ]);
  });

  it('NOT_TAKEN com motivo e NOT_TAKEN sem motivo (reason null)', async () => {
    const planId = await planWithOccurrences();
    await advance(DAY);
    const withReason = await occurrenceId(planId, '2026-10-06', '08:00');
    const withoutReason = await occurrenceId(planId, '2026-10-05', '20:00');
    const first = await respond(ana, withReason, FORGOT);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ type: 'NOT_TAKEN', reason: 'FORGOT' });
    const second = await respond(ana, withoutReason, { type: 'NOT_TAKEN', reason: null });
    expect(second.status).toBe(201);
    expect((await occurrenceRow(withoutReason))?.status).toBe('NOT_TAKEN');
  });

  it('TAKEN com motivo: 400 VALIDATION_FAILED sem resposta gravada', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    const response = await respond(ana, id, { type: 'TAKEN', reason: 'FORGOT' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await responseRows(id)).toEqual([]);
  });

  it('segunda resposta: 409 STATE_CONFLICT e a primeira fica imutavel', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    expect((await respond(ana, id, TAKEN)).status).toBe(201);
    const second = await respond(ana, id, FORGOT);
    expect(second.status).toBe(409);
    expect(second.headers['content-type']).toContain('application/problem+json');
    expect(second.body).toMatchObject({
      code: 'STATE_CONFLICT',
      correlation_id: expect.any(String) as unknown,
    });
    expect(await responseRows(id)).toHaveLength(1);
    expect((await occurrenceRow(id))?.status).toBe('TAKEN');
  });

  it('ocorrencia CANCELED: 409 STATE_CONFLICT', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    await h.pool.query(`UPDATE occurrences SET status = 'CANCELED' WHERE id = $1`, [id]);
    const response = await respond(ana, id, TAKEN);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await responseRows(id)).toEqual([]);
  });

  it('ocorrencia futura (scheduled_at > agora): 409 STATE_CONFLICT (DC-037)', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '20:00');
    const response = await respond(ana, id, TAKEN);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'STATE_CONFLICT' });
    expect((await occurrenceRow(id))?.status).toBe('PROGRAMMED');
  });

  it('exatamente no horario (scheduled_at = agora): aceita', async () => {
    const planId = await planWithOccurrences();
    h.now = '2026-10-05T23:00:00Z';
    ana = await login(h, 'ana.silva@example.com');
    const id = await occurrenceId(planId, '2026-10-05', '20:00');
    expect((await respond(ana, id, TAKEN)).status).toBe(201);
  });

  it('ocorrencia de plano excluido: 404 sem auditoria', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    expect(
      (await h.call('deletePlan', 'DELETE', `/plans/${planId}`, { headers: ana.mutation })).status,
    ).toBe(204);
    const response = await respond(ana, id, TAKEN);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await deniedAudits()).toEqual([]);
  });
});

describe('createResponse: prazo e resposta tardia (RN-009, TS-007)', () => {
  it('apos o prazo, ainda PROGRAMMED (job atrasado): is_late=true', async () => {
    const planId = await planWithOccurrences();
    await advance(55 * MINUTE); // 12:00:15Z, prazo 12:00Z atingido
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    const response = await respond(ana, id, TAKEN);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ is_late: true });
    expect(await occurrenceRow(id)).toMatchObject({ status: 'TAKEN', is_late: true });
  });

  it('exatamente no prazo (deadline_at = agora): ja e tardia', async () => {
    const planId = await planWithOccurrences();
    h.now = '2026-10-05T12:00:00Z';
    ana = await login(h, 'ana.silva@example.com');
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    expect((await respond(ana, id, TAKEN)).body).toMatchObject({ is_late: true });
  });

  it('TS-007: NO_RESPONSE aceita a primeira resposta tardia e preserva o marco', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    await h.pool.query(
      `UPDATE occurrences SET status = 'NO_RESPONSE', no_response_reached_at = '2026-10-05T12:00:30Z'
        WHERE id = $1`,
      [id],
    );
    await advance(3 * 60 * MINUTE);
    const response = await respond(ana, id, FORGOT);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'NOT_TAKEN', is_late: true });
    expect(await occurrenceRow(id)).toEqual({
      status: 'NOT_TAKEN',
      is_late: true,
      row_version: '2',
      no_response_reached_at: new Date('2026-10-05T12:00:30Z'),
    });
    expect(((await listOccurrences(ana, '?status=NOT_TAKEN')).body as PageBody).items).toEqual([
      expect.objectContaining({
        occurrence_id: id,
        is_late: true,
        no_response_reached_at: '2026-10-05T12:00:30Z',
      }),
    ]);
  });
});

describe('TS-008/TS-023: createResponse em ocorrencia de outro titular', () => {
  it('404 identico ao inexistente, 1 ownership.denied e ocorrencia intacta', async () => {
    const planId = await planWithOccurrences(ana);
    const id = await occurrenceId(planId, '2026-10-05', '08:00');

    const foreign = await respond(bruno, id, TAKEN);
    const missing = await respond(bruno, MISSING, TAKEN);
    const malformed = await respond(bruno, 'nao-e-uuid', TAKEN);
    for (const response of [foreign, missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    }
    const strip = (body: unknown): unknown =>
      Object.fromEntries(
        Object.entries(body as Record<string, unknown>).filter(
          ([key]) => key !== 'correlation_id' && key !== 'instance',
        ),
      );
    expect(strip(foreign.body)).toEqual(strip(missing.body));

    const audits = await deniedAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ resource_type: 'occurrence', resource_id: id });
    expect(await occurrenceRow(id)).toMatchObject({ status: 'PROGRAMMED', row_version: '1' });
    expect(await responseRows(id)).toEqual([]);
  });
});

describe('TS-038/TS-015: idempotencia de createResponse (CA-013)', () => {
  it('passo 2: replay identico devolve o snapshot original sem nova resposta', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    const first = await respond(ana, id, TAKEN, { key: 'kx' });
    h.now = at(MINUTE);
    const replay = await respond(ana, id, TAKEN, { key: 'kx' });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await responseRows(id)).toHaveLength(1);
    expect((await occurrenceRow(id))?.row_version).toBe('2');
  });

  it('passo 3: mesma chave com payload divergente: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    expect((await respond(ana, id, TAKEN, { key: 'kx' })).status).toBe(201);
    const divergent = await respond(ana, id, FORGOT, { key: 'kx' });
    expect(divergent.status).toBe(409);
    expect(divergent.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await responseRows(id))[0]?.type).toBe('TAKEN');
  });

  it('passo 3: mesma chave em outra ocorrencia: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const planId = await planWithOccurrences();
    await advance(DAY);
    const a = await occurrenceId(planId, '2026-10-05', '08:00');
    const b = await occurrenceId(planId, '2026-10-06', '08:00');
    expect((await respond(ana, a, TAKEN, { key: 'kx' })).status).toBe(201);
    const other = await respond(ana, b, TAKEN, { key: 'kx' });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await responseRows(b)).toEqual([]);
  });

  it('passo 4: sem Idempotency-Key: 400 VALIDATION_FAILED', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    const response = await respond(ana, id, TAKEN, { key: undefined });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [{ field: 'Idempotency-Key' }],
    });
    expect(await responseRows(id)).toEqual([]);
  });

  it('passo 5: chave expirada (7 dias + 1 s) e nova; a ocorrencia ja respondida da 409', async () => {
    const planId = await planWithOccurrences();
    const id = await occurrenceId(planId, '2026-10-05', '08:00');
    expect((await respond(ana, id, TAKEN, { key: 'kx' })).status).toBe(201);
    await advance(7 * DAY + 1000);
    const again = await respond(ana, id, TAKEN, { key: 'kx' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await responseRows(id)).toHaveLength(1);
  });
});

describe('TS-001: concorrencia TAKEN x NOT_TAKEN (CA-007)', () => {
  it('100 iteracoes: exatamente um 201 e um 409 STATE_CONFLICT, 1 resposta e estado coerente', async () => {
    const planId = await planWithOccurrences();
    const timeId = (
      await h.pool.query<{ id: string }>(
        `SELECT id FROM schedule_times WHERE plan_id = $1 AND time_of_day = '08:00'`,
        [planId],
      )
    ).rows[0]?.id;
    for (let i = 0; i < 100; i += 1) {
      // Relogio avanca 1 min por iteracao: o limite por titular (100/min) nao interfere.
      h.now = at(i * MINUTE);
      const scheduledAt = at(i * MINUTE - 5 * MINUTE);
      const id = (
        await h.pool.query<{ id: string }>(
          `INSERT INTO occurrences (user_id, plan_id, schedule_time_id, local_scheduled_date,
                                   local_time, scheduled_at, deadline_at, medication_name_snapshot,
                                   dose_text_snapshot)
           VALUES ($1, $2, $3, DATE '2025-01-01' + $4::int, '08:00', $5,
                   $5::timestamptz + interval '60 minutes', 'Comprimido', '1 comprimido')
           RETURNING id`,
          [anaId, planId, timeId, i, scheduledAt],
        )
      ).rows[0]?.id;
      if (id === undefined) throw new Error('ocorrencia nao criada');

      const results = await Promise.all([respond(ana, id, TAKEN), respond(ana, id, FORGOT)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, `iteracao ${String(i)}`).toEqual([201, 409]);
      const winner = results.find((r) => r.status === 201);
      const loser = results.find((r) => r.status === 409);
      expect(loser?.headers['content-type']).toContain('application/problem+json');
      expect(loser?.body).toMatchObject({
        code: 'STATE_CONFLICT',
        correlation_id: expect.any(String) as unknown,
      });
      const rows = await responseRows(id);
      expect(rows).toHaveLength(1);
      const accepted = (winner?.body as { type: string }).type;
      expect(rows[0]?.type).toBe(accepted);
      expect(await occurrenceRow(id)).toMatchObject({ status: accepted, is_late: false });
    }
  });
});

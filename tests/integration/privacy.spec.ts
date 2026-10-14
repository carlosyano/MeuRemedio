// @trace RF-010 RF-011 RN-012 RN-005 CA-014 TS-038 DEC-032 ERR-002 ERR-006 ERR-007 getPrivacy requestAccountDeletion
// Privacidade por HTTP contra PostgreSQL 17 real (DC-045): getPrivacy expoe os direitos
// automatizados, o canal externo (GX-002) e os prazos de retencao; requestAccountDeletion exige
// senha, confirmacao textual e Idempotency-Key, bloqueia o acesso de imediato (RN-012: conta
// DELETION_SCHEDULED, todas as sessoes revogadas) e agenda o expurgo para 30 dias depois.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestAccountDeletion } from '../../apps/api/src/modules/privacy/application/request-account-deletion.js';
import { ProblemError } from '../../apps/api/src/platform/http/problem-catalog.js';
import {
  PASSWORD,
  RIGHTS_CHANNEL,
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from './support/http.js';

const NOW = '2026-10-05T11:05:15Z';
const CONFIRMATION = 'EXCLUIR MINHA CONTA';
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

const at = (offsetMs: number): string =>
  new Date(Date.parse(NOW) + offsetMs).toISOString().replace('.000Z', 'Z');

const requestDeletion = (
  session: LoggedIn,
  body: Record<string, unknown> = { password: PASSWORD, confirmation: CONFIRMATION },
  key: string | null = 'k-1',
) =>
  h.call('requestAccountDeletion', 'POST', '/account-deletions', {
    body,
    headers: key === null ? session.mutation : { ...session.mutation, 'idempotency-key': key },
  });

const account = async (userId: string) =>
  (
    await h.pool.query<{
      status: string;
      deletion_requested_at: Date | null;
      purge_due_at: Date | null;
    }>('SELECT status, deletion_requested_at, purge_due_at FROM users WHERE id = $1', [userId])
  ).rows[0];

const activeSessions = async (userId: string): Promise<number> =>
  Number(
    (
      await h.pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      )
    ).rows[0]?.n,
  );

describe('getPrivacy (RF-010, RF-011)', () => {
  it('200 com os direitos automatizados, o canal externo e os prazos de retencao', async () => {
    const response = await h.call('getPrivacy', 'GET', '/privacy', { headers: ana.read });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      automated_rights: ['ACCESS_HISTORY', 'EXPORT_PDF', 'DELETE_ACCOUNT'],
      external_channel: RIGHTS_CHANNEL,
      retention: {
        pdf_hours: 24,
        idempotency_days: 7,
        technical_logs_days: 30,
        account_purge_days: 30,
        tombstone_days: 180,
      },
    });
  });

  it('sem sessao: 401', async () => {
    expect((await h.call('getPrivacy', 'GET', '/privacy')).status).toBe(401);
  });
});

describe('requestAccountDeletion (RF-010, RN-012)', () => {
  it('202: conta DELETION_SCHEDULED, expurgo em 30 dias, sessoes revogadas e cookies limpos', async () => {
    const other = await login(h, 'ana.silva@example.com');
    const response = await requestDeletion(ana);
    expect(response.status).toBe(202);
    const body = response.body as Record<string, string>;
    expect(body).toEqual({
      deletion_request_id: expect.any(String) as string,
      status: 'DELETION_SCHEDULED',
      requested_at: NOW,
      purge_due_at: at(30 * 24 * 3_600_000),
    });
    expect(
      response.cookies.some((c) => c.startsWith('mr_session=;') && c.includes('Max-Age=0')),
    ).toBe(true);

    const row = await account(anaId);
    expect(row?.status).toBe('DELETION_SCHEDULED');
    expect(row?.deletion_requested_at?.toISOString()).toBe('2026-10-05T11:05:15.000Z');
    expect(row?.purge_due_at?.toISOString()).toBe('2026-11-04T11:05:15.000Z');
    expect(await activeSessions(anaId)).toBe(0);
    const reasons = await h.pool.query<{ revoked_reason: string }>(
      'SELECT DISTINCT revoked_reason FROM sessions WHERE user_id = $1',
      [anaId],
    );
    expect(reasons.rows).toEqual([{ revoked_reason: 'ACCOUNT_DELETION' }]);
    for (const session of [ana, other]) {
      const me = await h.call('getCurrentAccount', 'GET', '/accounts/me', {
        headers: session.read,
      });
      expect(me.status).toBe(401);
    }
    const brunoMe = await h.call('getCurrentAccount', 'GET', '/accounts/me', {
      headers: bruno.read,
    });
    expect(brunoMe.status).toBe(200);
  });

  it('bloqueia o login de imediato (RN-012)', async () => {
    await requestDeletion(ana);
    const attempt = await h.call('createSession', 'POST', '/sessions', {
      body: { email: 'ana.silva@example.com', password: PASSWORD },
    });
    expect(attempt.status).toBe(401);
  });

  it('registra account.deletion_requested na auditoria com o id do pedido, sem dados pessoais', async () => {
    const response = await requestDeletion(ana);
    const id = (response.body as { deletion_request_id: string }).deletion_request_id;
    const audit = await h.pool.query<{
      id: string;
      actor_user_id: string;
      resource_type: string;
      resource_id: string;
      outcome: string;
      dump: string;
    }>(
      `SELECT id, actor_user_id, resource_type, resource_id, outcome,
              row_to_json(a)::text AS dump
         FROM audit_events a WHERE action = 'account.deletion_requested'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      id,
      actor_user_id: anaId,
      resource_type: 'user_account',
      resource_id: anaId,
      outcome: 'SUCCESS',
    });
    expect(audit.rows[0]?.dump).not.toContain('ana.silva');
    expect(audit.rows[0]?.dump).not.toContain(PASSWORD);
  });

  it('senha errada: 401 sem efeito, contando no bloqueio do login (DC-043)', async () => {
    const response = await requestDeletion(ana, {
      password: 'senha-errada',
      confirmation: CONFIRMATION,
    });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect((await account(anaId))?.status).toBe('ACTIVE');
    expect(await activeSessions(anaId)).toBe(1);
    for (let i = 0; i < 4; i += 1) {
      await requestDeletion(
        ana,
        { password: `errada-${String(i)}`, confirmation: CONFIRMATION },
        `k-e${String(i)}`,
      );
    }
    const blocked = await requestDeletion(ana, undefined, 'k-certa');
    expect(blocked.status).toBe(401);
    expect((await account(anaId))?.status).toBe('ACTIVE');
  });

  it('confirmacao textual diferente: 400 sem efeito', async () => {
    const response = await requestDeletion(ana, {
      password: PASSWORD,
      confirmation: 'excluir minha conta',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await account(anaId))?.status).toBe('ACTIVE');
  });

  it('TS-038 passo 4: sem Idempotency-Key: 400 sem efeito (DEC-032)', async () => {
    const response = await requestDeletion(ana, undefined, null);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field_errors: [{ field: 'Idempotency-Key' }] });
    expect((await account(anaId))?.status).toBe('ACTIVE');
  });

  it('TS-038 passo 6: replay apos a exclusao: 401 sem novo efeito', async () => {
    expect((await requestDeletion(ana, undefined, 'kx')).status).toBe(202);
    expect((await requestDeletion(ana, undefined, 'kx')).status).toBe(401);
    const audit = await h.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'account.deletion_requested'",
    );
    expect(audit.rowCount).toBe(1);
  });

  it('pedidos simultaneos de duas sessoes: um unico agendamento', async () => {
    const other = await login(h, 'ana.silva@example.com');
    const results = await Promise.all([
      requestDeletion(ana, undefined, 'k-a'),
      requestDeletion(other, undefined, 'k-b'),
    ]);
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 202)) expect([401, 409]).toContain(r.status);
    const audit = await h.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'account.deletion_requested'",
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe('TS-038 passos 2, 3 e 5 no servico (o acesso HTTP termina com a exclusao)', () => {
  const service = () => h.app.get(RequestAccountDeletion);
  const run = (key: string, password = PASSWORD) =>
    service().execute({
      userId: anaId,
      idempotencyKey: key,
      password,
      correlationId: randomUUID(),
    });

  it('replay identico devolve o snapshot; payload divergente 409; apos 7 dias a chave e nova', async () => {
    const first = await run('kx');
    expect(first.status).toBe(202);
    // Passo 2: mesmo snapshot, sem novo efeito.
    h.now = at(60_000);
    const replay = await run('kx');
    expect(replay).toEqual(first);
    const audit = await h.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'account.deletion_requested'",
    );
    expect(audit.rowCount).toBe(1);
    // Passo 3: payload divergente.
    await expect(run('kx', 'Outra-Senha-2026')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    // Passo 5: 7 dias + 1 s depois, a chave e nova; a conta ja esta em exclusao -> 409.
    h.now = at(7 * 24 * 3_600_000 + 1000);
    const late = run('kx');
    await expect(late).rejects.toBeInstanceOf(ProblemError);
    await expect(late).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});

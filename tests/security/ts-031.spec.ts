// @trace TS-031 RNF-012 RNF-002 createSession createPlan listPlans getCurrentAccount updateAccessibilityPreferences (rotacao de chave, DC-065)
// TS-031 contra PostgreSQL 17 real: rotacao dos segredos do servidor com a leitura autorizada
// mantida. A API reinicia com chaves novas e as antigas como "anteriores": a sessao aberta continua
// lendo e mutando, o replay idempotente devolve o snapshot e o bloqueio de login persiste. A chave
// nova assina tudo o que nasce depois. Aposentada a chave antiga, a sessao continua lendo (o token
// de sessao nao depende de segredo do servidor), mas o CSRF assinado com ela deixa de valer.
import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSecrets } from '../../apps/api/src/app.js';
import { login, startHarness, type Harness, type LoggedIn } from '../integration/support/http.js';

let h: Harness;
let original: AppSecrets;

const ANA = 'ana.silva@example.com';
const BRUNO = 'bruno.costa@example.com';

const PLAN = {
  medication_name: 'Comprimido',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  start_date: '2026-10-01',
  schedule_times: ['08:00', '20:00'],
} as const;

/** Chaves novas como atuais e as do inicio da suite como anteriores. */
const rotated = (): AppSecrets => ({
  requestHashKey: randomBytes(32),
  emailPepper: randomBytes(32),
  csrfKey: randomBytes(32),
  previous: {
    requestHashKey: [original.requestHashKey],
    emailPepper: [original.emailPepper],
    csrfKey: [original.csrfKey],
  },
});

/** As mesmas chaves atuais, sem as anteriores (chave antiga aposentada). */
const retired = (secrets: AppSecrets): AppSecrets => ({
  requestHashKey: secrets.requestHashKey,
  emailPepper: secrets.emailPepper,
  csrfKey: secrets.csrfKey,
});

const csrfWith = (key: Buffer, sessionId: string): string =>
  createHmac('sha256', key).update(sessionId).digest('base64url');

const createPlan = (session: LoggedIn, key: string, body: unknown) =>
  h.call('createPlan', 'POST', '/plans', {
    body,
    headers: { ...session.mutation, 'idempotency-key': key },
  });

const listPlans = (session: LoggedIn) =>
  h.call('listPlans', 'GET', '/plans', { headers: session.read });

const updatePreferences = (session: LoggedIn) =>
  h.call('updateAccessibilityPreferences', 'PUT', '/preferences/accessibility', {
    body: { text_scale: 125, high_contrast: true },
    headers: session.mutation,
  });

const failLogin = (email: string) =>
  h.call('createSession', 'POST', '/sessions', {
    body: { email, password: 'Senha-Errada-2026' },
  });

beforeAll(async () => {
  h = await startHarness();
  original = h.secrets;
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  if (h.secrets !== original) await h.restart(original);
  await h.truncate();
  await h.activeUser(ANA);
  await h.activeUser(BRUNO);
});

describe('TS-031: rotacao com as chaves anteriores aceitas', () => {
  it('a sessao aberta antes da rotacao continua lendo', async () => {
    const ana = await login(h, ANA);
    await createPlan(ana, 'K1', PLAN);
    await h.restart(rotated());

    const plans = await listPlans(ana);
    expect(plans.status).toBe(200);
    expect((plans.body as { items: unknown[] }).items).toHaveLength(1);
    expect(
      (await h.call('getCurrentAccount', 'GET', '/accounts/me', { headers: ana.read })).status,
    ).toBe(200);
  });

  it('a sessao aberta antes da rotacao continua mutando com o CSRF assinado pela chave anterior', async () => {
    const ana = await login(h, ANA);
    await h.restart(rotated());
    expect((await updatePreferences(ana)).status).toBe(200);
  });

  it('a sessao nova recebe CSRF assinado pela chave atual', async () => {
    const secrets = rotated();
    await h.restart(secrets);
    const ana = await login(h, ANA);
    expect(ana.csrf).toBe(csrfWith(secrets.csrfKey, ana.sessionId));
    expect(ana.csrf).not.toBe(csrfWith(original.csrfKey, ana.sessionId));
  });

  it('CSRF assinado por chave desconhecida continua recusado', async () => {
    const ana = await login(h, ANA);
    await h.restart(rotated());
    const forged = csrfWith(randomBytes(32), ana.sessionId);
    const response = await h.call(
      'updateAccessibilityPreferences',
      'PUT',
      '/preferences/accessibility',
      {
        body: { text_scale: 125, high_contrast: true },
        headers: {
          cookie: `mr_session=${ana.sessionCookie}; mr_csrf=${forged}`,
          'x-csrf-token': forged,
          origin: ana.mutation['origin'] ?? '',
        },
      },
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
  });

  it('o replay idempotente gravado antes da rotacao devolve o mesmo resultado', async () => {
    const ana = await login(h, ANA);
    const first = await createPlan(ana, 'K1', PLAN);
    expect(first.status).toBe(201);
    await h.restart(rotated());

    const replay = await createPlan(ana, 'K1', PLAN);
    expect(replay.status).toBe(201);
    expect((replay.body as { plan_id: string }).plan_id).toBe(
      (first.body as { plan_id: string }).plan_id,
    );
    expect((await listPlans(ana)).body).toMatchObject({ items: [{}] });
  });

  it('a mesma chave com outro corpo continua conflito depois da rotacao', async () => {
    const ana = await login(h, ANA);
    await createPlan(ana, 'K1', PLAN);
    await h.restart(rotated());

    const reused = await createPlan(ana, 'K1', { ...PLAN, dose_text: '2 comprimidos' });
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('a confirmacao de duplicidade emitida antes da rotacao continua valendo', async () => {
    const ana = await login(h, ANA);
    await createPlan(ana, 'K1', PLAN);
    const duplicate = await createPlan(ana, 'K2', PLAN);
    expect(duplicate.status).toBe(409);
    const token = (duplicate.body as { duplicate_confirmation: { confirmation_token: string } })
      .duplicate_confirmation.confirmation_token;
    await h.restart(rotated());

    const confirmed = await createPlan(ana, 'K3', { ...PLAN, duplicate_confirmation_token: token });
    expect(confirmed.status).toBe(201);
  });

  it('o bloqueio de login iniciado antes da rotacao persiste', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await failLogin(BRUNO);
    expect((await failLogin(BRUNO)).status).toBe(423);
    await h.restart(rotated());

    const blocked = await h.call('createSession', 'POST', '/sessions', {
      body: { email: BRUNO, password: 'Senha-Sintetica-2026' },
    });
    expect(blocked.status).toBe(423);
  });
});

describe('TS-031: chave anterior aposentada', () => {
  it('a sessao continua lendo, mas o CSRF assinado pela chave aposentada e recusado', async () => {
    const ana = await login(h, ANA);
    const secrets = rotated();
    await h.restart(secrets);
    await h.restart(retired(secrets));

    expect((await listPlans(ana)).status).toBe(200);
    const mutation = await updatePreferences(ana);
    expect(mutation.status).toBe(403);
    expect(mutation.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
  });

  it('nova sessao depois da aposentadoria funciona por completo', async () => {
    const secrets = rotated();
    await h.restart(secrets);
    await h.restart(retired(secrets));
    const ana = await login(h, ANA);
    expect((await createPlan(ana, 'K1', PLAN)).status).toBe(201);
    expect((await listPlans(ana)).status).toBe(200);
  });
});

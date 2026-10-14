// @trace RNF-016 TS-010 ERR-001 ERR-004 ERR-011 ERR-013 ERR-015 ERR-016 (ADR-001 v1.5 OA-008)
// Cliente da API usado pela aplicacao web (DC-052): mutacoes levam o X-CSRF-Token lido do cookie
// mr_csrf e a Idempotency-Key quando a operacao exige; Problem vira ApiProblem com codigo, campos
// e Retry-After; falha de rede ou resposta que nao e da API vira ApiUnavailable, sem fila offline
// (TS-010); as mensagens ao usuario sao as do catalogo de erros da Especificacao.
import { describe, expect, it, vi } from 'vitest';
import {
  ApiProblem,
  ApiUnavailable,
  createApiClient,
  messageFor,
} from '../../apps/web/src/lib/api-client.js';

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      type: `/problems/${code.toLowerCase()}`,
      title: 'x',
      status,
      code,
      detail: 'x',
      instance: '/x',
      correlation_id: '11111111-1111-4111-8111-111111111111',
      ...extra,
    }),
    { status, headers: { 'content-type': 'application/problem+json; charset=utf-8' } },
  );

const client = (fetchImpl: typeof fetch, cookie = 'mr_csrf=tok-123; outro=1') =>
  createApiClient({ fetch: fetchImpl, readCookies: () => cookie });

describe('cliente da API (web)', () => {
  it('leitura: GET em /api com credenciais do mesmo site e sem X-CSRF-Token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ name: 'Ana' }, { status: 200 })),
    );
    const response = await client(fetchImpl).request<{ name: string }>({
      method: 'GET',
      path: '/accounts/me',
    });
    expect(response.body).toEqual({ name: 'Ana' });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('/api/accounts/me');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).has('x-csrf-token')).toBe(false);
  });

  it('mutacao: JSON, X-CSRF-Token do cookie mr_csrf e Idempotency-Key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const response = await client(fetchImpl).request({
      method: 'POST',
      path: '/sessions/revocations',
      body: { password: 'x' },
      idempotencyKey: 'chave-1',
    });
    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-csrf-token')).toBe('tok-123');
    expect(headers.get('idempotency-key')).toBe('chave-1');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{"password":"x"}');
  });

  it('Problem vira ApiProblem com codigo, campos e Retry-After', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => {
      const response = problem(423, 'ACCOUNT_TEMPORARILY_LOCKED');
      response.headers.set('retry-after', '840');
      return Promise.resolve(response);
    });
    const error = await client(fetchImpl)
      .request({ method: 'POST', path: '/sessions', body: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblem);
    expect(error).toMatchObject({
      status: 423,
      code: 'ACCOUNT_TEMPORARILY_LOCKED',
      retryAfterSeconds: 840,
    });
  });

  it('field_errors do 400 ficam disponiveis por campo', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        problem(400, 'VALIDATION_FAILED', {
          field_errors: [{ field: 'email', code: 'INVALID', message: 'Valor inválido.' }],
        }),
      ),
    );
    const error = await client(fetchImpl)
      .request({ method: 'POST', path: '/sessions', body: {} })
      .catch((e: unknown) => e);
    expect((error as ApiProblem).fieldErrors).toEqual([
      { field: 'email', code: 'INVALID', message: 'Valor inválido.' },
    ]);
  });

  it.each([
    ['falha de rede', () => Promise.reject(new TypeError('Failed to fetch'))],
    [
      'resposta que nao e da API (502 HTML do proxy)',
      () => Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502 })),
    ],
  ])('%s vira ApiUnavailable, sem nova tentativa', async (_nome, impl) => {
    const fetchImpl = vi.fn<typeof fetch>(impl);
    const error = await client(fetchImpl)
      .request({ method: 'POST', path: '/plans', body: {}, idempotencyKey: 'k' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnavailable);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('mutacao sem cookie mr_csrf segue sem o cabecalho (a API responde 401 ou 403)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    await client(fetchImpl, '').request({ method: 'DELETE', path: '/sessions/current' });
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('x-csrf-token')).toBe(false);
  });
});

describe('mensagens ao usuario (catalogo de erros da Especificacao)', () => {
  const problemOf = (status: number, code: string) =>
    new ApiProblem({ status, code, fieldErrors: [], retryAfterSeconds: undefined });

  it.each([
    ['VALIDATION_FAILED', 400, 'Revise os campos destacados e tente novamente.'],
    ['AUTHENTICATION_REQUIRED', 401, 'Sua sessão terminou. Entre novamente.'],
    ['RESOURCE_NOT_FOUND', 404, 'O item solicitado não foi encontrado.'],
    [
      'ACCOUNT_TEMPORARILY_LOCKED',
      423,
      'Não foi possível entrar agora. Tente novamente após o período informado.',
    ],
    ['RATE_LIMITED', 429, 'Muitas tentativas. Aguarde o tempo informado e tente novamente.'],
    [
      'DEPENDENCY_UNAVAILABLE',
      503,
      'O serviço está temporariamente indisponível. Tente novamente.',
    ],
    [
      'SESSION_LIMIT_REACHED',
      409,
      'Você já tem 3 sessões ativas. Encerre uma sessão para entrar.',
    ],
    [
      'CSRF_VALIDATION_FAILED',
      403,
      'Não foi possível validar a solicitação. Recarregue a página e tente novamente.',
    ],
    [
      'INTERNAL_ERROR',
      500,
      'Não foi possível concluir a solicitação agora. Tente novamente em instantes.',
    ],
  ])('%s', (code, status, text) => {
    expect(messageFor(problemOf(status, code))).toBe(text);
  });

  it('indisponibilidade (rede) usa a mensagem do ERR-011', () => {
    expect(messageFor(new ApiUnavailable())).toBe(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
  });

  it('erro desconhecido usa a mensagem do ERR-016', () => {
    expect(messageFor(new Error('x'))).toBe(
      'Não foi possível concluir a solicitação agora. Tente novamente em instantes.',
    );
  });
});

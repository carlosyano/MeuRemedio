// Cliente da API para a aplicacao web (DC-052). Sem dependencias: roda no navegador e nos testes.
//   - todas as chamadas vao a /api/* na propria origem (o Next encaminha a API), com os cookies;
//   - mutacoes levam o X-CSRF-Token copiado do cookie mr_csrf (double-submit, OA-008) e, quando a
//     operacao exige, a Idempotency-Key;
//   - Problem (application/problem+json) vira ApiProblem; falha de rede ou resposta que nao e da
//     API vira ApiUnavailable. Nada e repetido nem enfileirado offline (TS-010).

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: readonly FieldError[];
  readonly retryAfterSeconds: number | undefined;

  constructor(input: {
    status: number;
    code: string;
    fieldErrors: readonly FieldError[];
    retryAfterSeconds: number | undefined;
  }) {
    super(input.code);
    this.name = 'ApiProblem';
    this.status = input.status;
    this.code = input.code;
    this.fieldErrors = input.fieldErrors;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

export class ApiUnavailable extends Error {
  constructor() {
    super('API indisponivel');
    this.name = 'ApiUnavailable';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

export interface ApiClient {
  request<T = undefined>(request: ApiRequest): Promise<ApiResponse<T>>;
}

const CSRF_COOKIE = 'mr_csrf';

function cookieValue(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name && rest.length > 0) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

const isJson = (contentType: string | null, subtype: string): boolean =>
  contentType?.toLowerCase().split(';')[0]?.trim() === subtype;

function asFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { field, code, message } = item as Record<string, unknown>;
    return typeof field === 'string' && typeof code === 'string' && typeof message === 'string'
      ? [{ field, code, message }]
      : [];
  });
}

export function createApiClient(deps: {
  fetch: typeof fetch;
  readCookies: () => string;
  baseUrl?: string;
}): ApiClient {
  const baseUrl = deps.baseUrl ?? '/api';
  return {
    async request<T>(request: ApiRequest): Promise<ApiResponse<T>> {
      const headers = new Headers({ accept: 'application/json', ...request.headers });
      if (request.method !== 'GET') {
        const csrf = cookieValue(deps.readCookies(), CSRF_COOKIE);
        if (csrf !== undefined) headers.set('x-csrf-token', csrf);
      }
      if (request.idempotencyKey !== undefined) {
        headers.set('idempotency-key', request.idempotencyKey);
      }
      let body: string | undefined;
      if (request.body !== undefined) {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(request.body);
      }

      let response: Response;
      try {
        response = await deps.fetch(`${baseUrl}${request.path}`, {
          method: request.method,
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          ...(body === undefined ? {} : { body }),
        });
      } catch {
        throw new ApiUnavailable();
      }

      const contentType = response.headers.get('content-type');
      if (isJson(contentType, 'application/problem+json')) {
        const problem = (await response.json()) as Record<string, unknown>;
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new ApiProblem({
          status: response.status,
          code: typeof problem['code'] === 'string' ? problem['code'] : 'INTERNAL_ERROR',
          fieldErrors: asFieldErrors(problem['field_errors']),
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        });
      }
      // Erro sem Problem nao veio da API (proxy, rede, servidor fora do ar).
      if (!response.ok) throw new ApiUnavailable();
      const parsed: unknown = isJson(contentType, 'application/json')
        ? await response.json()
        : undefined;
      return { status: response.status, headers: response.headers, body: parsed as T };
    },
  };
}

/** Mensagens ao usuario do catalogo de erros da Especificacao (ERR-001 a ERR-016). */
const MESSAGES: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Revise os campos destacados e tente novamente.',
  AUTHENTICATION_REQUIRED: 'Sua sessão terminou. Entre novamente.',
  RESOURCE_NOT_FOUND: 'O item solicitado não foi encontrado.',
  ACCOUNT_TEMPORARILY_LOCKED:
    'Não foi possível entrar agora. Tente novamente após o período informado.',
  VERSION_CONFLICT:
    'Este plano foi alterado em outra sessão. Recarregue antes de tentar novamente.',
  IDEMPOTENCY_KEY_REUSED: 'A solicitação repetida contém dados diferentes.',
  STATE_CONFLICT: 'Esta ocorrência já recebeu uma resposta.',
  TOKEN_EXPIRED: 'Este link não pode mais ser usado. Solicite um novo.',
  BUSINESS_RULE_VIOLATION: 'A operação não atende às regras informadas.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde o tempo informado e tente novamente.',
  DEPENDENCY_UNAVAILABLE: 'O serviço está temporariamente indisponível. Tente novamente.',
  RESOURCE_EXPIRED: 'Este arquivo expirou. Solicite uma nova exportação.',
  SESSION_LIMIT_REACHED: 'Você já tem 3 sessões ativas. Encerre uma sessão para entrar.',
  DUPLICATE_CONFIRMATION_REQUIRED: 'Já existe um plano parecido. Confirme se deseja criar outro.',
  CSRF_VALIDATION_FAILED:
    'Não foi possível validar a solicitação. Recarregue a página e tente novamente.',
  INTERNAL_ERROR: 'Não foi possível concluir a solicitação agora. Tente novamente em instantes.',
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiUnavailable) return MESSAGES['DEPENDENCY_UNAVAILABLE'] ?? '';
  if (error instanceof ApiProblem) {
    return MESSAGES[error.code] ?? MESSAGES['INTERNAL_ERROR'] ?? '';
  }
  return MESSAGES['INTERNAL_ERROR'] ?? '';
}

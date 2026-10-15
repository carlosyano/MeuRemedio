// Cliente da API para a aplicacao web (DC-052). Sem dependencias: roda no navegador e nos testes.
//   - todas as chamadas vao a /api/* na propria origem (o Next encaminha a API), com os cookies;
//   - mutacoes levam o X-CSRF-Token copiado do cookie mr_csrf (double-submit, OA-008) e, quando a
//     operacao exige, a Idempotency-Key;
//   - Problem (application/problem+json) vira ApiProblem; falha de rede ou resposta que nao e da
//     API vira ApiUnavailable. Nada e repetido nem enfileirado offline (TS-010);
//   - sem resposta no tempo limite (30 s, RNF-007) vira ApiTimeout: a mutacao pode ter sido gravada,
//     e repetir com a mesma Idempotency-Key devolve o resultado original (CA-013; DC-054).

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/** Confirmacao de possivel duplicidade de plano (409 DUPLICATE_CONFIRMATION_REQUIRED, RN-016). */
export interface DuplicateConfirmation {
  readonly confirmationToken: string;
  readonly candidates: readonly {
    readonly planId: string;
    readonly medicationName: string;
    readonly doseText: string;
  }[];
}

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: readonly FieldError[];
  readonly retryAfterSeconds: number | undefined;
  readonly duplicateConfirmation: DuplicateConfirmation | undefined;

  constructor(input: {
    status: number;
    code: string;
    fieldErrors: readonly FieldError[];
    retryAfterSeconds: number | undefined;
    duplicateConfirmation?: DuplicateConfirmation | undefined;
  }) {
    super(input.code);
    this.name = 'ApiProblem';
    this.status = input.status;
    this.code = input.code;
    this.fieldErrors = input.fieldErrors;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.duplicateConfirmation = input.duplicateConfirmation;
  }
}

export class ApiUnavailable extends Error {
  constructor(message = 'API indisponivel') {
    super(message);
    this.name = 'ApiUnavailable';
  }
}

/** Sem resposta no tempo limite: o efeito da mutacao e desconhecido. */
export class ApiTimeout extends ApiUnavailable {
  constructor() {
    super('Tempo limite da API');
    this.name = 'ApiTimeout';
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

function asDuplicateConfirmation(value: unknown): DuplicateConfirmation | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { confirmation_token: token, candidates } = value as Record<string, unknown>;
  if (typeof token !== 'string' || !Array.isArray(candidates)) return undefined;
  return {
    confirmationToken: token,
    candidates: candidates.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const { plan_id, medication_name, dose_text } = item as Record<string, unknown>;
      return typeof plan_id === 'string' &&
        typeof medication_name === 'string' &&
        typeof dose_text === 'string'
        ? [{ planId: plan_id, medicationName: medication_name, doseText: dose_text }]
        : [];
    }),
  };
}

async function readResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const contentType = response.headers.get('content-type');
  if (isJson(contentType, 'application/problem+json')) {
    const problem = (await response.json()) as Record<string, unknown>;
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new ApiProblem({
      status: response.status,
      code: typeof problem['code'] === 'string' ? problem['code'] : 'INTERNAL_ERROR',
      fieldErrors: asFieldErrors(problem['field_errors']),
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      duplicateConfirmation: asDuplicateConfirmation(problem['duplicate_confirmation']),
    });
  }
  // Erro sem Problem nao veio da API (proxy, rede, servidor fora do ar).
  if (!response.ok) throw new ApiUnavailable();
  const parsed: unknown = isJson(contentType, 'application/json')
    ? await response.json()
    : undefined;
  return { status: response.status, headers: response.headers, body: parsed as T };
}

export function createApiClient(deps: {
  fetch: typeof fetch;
  readCookies: () => string;
  baseUrl?: string;
  /** Tempo limite por requisicao; padrao de 30 s (RNF-007). */
  timeoutMs?: number;
}): ApiClient {
  const baseUrl = deps.baseUrl ?? '/api';
  const timeoutMs = deps.timeoutMs ?? 30_000;
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

      // setTimeout (e nao AbortSignal.timeout) para o relogio dos testes controlar o prazo.
      // So o tempo limite aborta a requisicao, entao signal.aborted indica o tempo esgotado.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await deps.fetch(`${baseUrl}${request.path}`, {
            method: request.method,
            headers,
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            ...(body === undefined ? {} : { body }),
          });
        } catch {
          throw controller.signal.aborted ? new ApiTimeout() : new ApiUnavailable();
        }
        return await readResponse<T>(response);
      } catch (error) {
        // A leitura do corpo tambem pode ser interrompida pelo tempo limite.
        if (controller.signal.aborted && !(error instanceof ApiUnavailable)) throw new ApiTimeout();
        throw error;
      } finally {
        clearTimeout(timer);
      }
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

/** Mensagem do catalogo para o codigo; codigo desconhecido usa a do INTERNAL_ERROR. */
export function catalogMessage(code: string): string {
  return MESSAGES[code] ?? MESSAGES['INTERNAL_ERROR'] ?? '';
}

export function messageFor(error: unknown): string {
  if (error instanceof ApiUnavailable) return catalogMessage('DEPENDENCY_UNAVAILABLE');
  if (error instanceof ApiProblem) return catalogMessage(error.code);
  return catalogMessage('INTERNAL_ERROR');
}

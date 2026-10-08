// Catalogo fechado de erros ERR-001..ERR-016 (Especificacao 02.33, secao 8; OpenAPI Problem.code).
// status e detail (mensagem ao usuario) seguem a Especificacao; title segue os exemplos da OpenAPI.
// tests/contract/http-foundation.spec.ts confere o catalogo contra a matriz e a OpenAPI.

export interface ProblemDefinition {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
}

export const PROBLEM_CATALOG = {
  VALIDATION_FAILED: {
    status: 400,
    title: 'Requisicao invalida',
    detail: 'Revise os campos destacados e tente novamente.',
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    title: 'Autenticacao obrigatoria',
    detail: 'Sua sessão terminou. Entre novamente.',
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    title: 'Recurso nao encontrado',
    detail: 'O item solicitado não foi encontrado.',
  },
  ACCOUNT_TEMPORARILY_LOCKED: {
    status: 423,
    title: 'Conta temporariamente bloqueada',
    detail: 'Não foi possível entrar agora. Tente novamente após o período informado.',
  },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Versao do recurso divergente',
    detail: 'Este plano foi alterado em outra sessão. Recarregue antes de tentar novamente.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    title: 'Idempotency-Key reutilizada com payload diferente',
    detail: 'A solicitação repetida contém dados diferentes.',
  },
  STATE_CONFLICT: {
    status: 409,
    title: 'Conflito de estado',
    detail: 'Esta ocorrência já recebeu uma resposta.',
  },
  TOKEN_EXPIRED: {
    status: 410,
    title: 'Token expirado ou ja utilizado',
    detail: 'Este link não pode mais ser usado. Solicite um novo.',
  },
  BUSINESS_RULE_VIOLATION: {
    status: 422,
    title: 'Regra de negocio violada',
    detail: 'A operação não atende às regras informadas.',
  },
  RATE_LIMITED: {
    status: 429,
    title: 'Limite excedido',
    detail: 'Muitas tentativas. Aguarde o tempo informado e tente novamente.',
  },
  DEPENDENCY_UNAVAILABLE: {
    status: 503,
    title: 'Dependencia indisponivel',
    detail: 'O serviço está temporariamente indisponível. Tente novamente.',
  },
  RESOURCE_EXPIRED: {
    status: 410,
    title: 'Recurso expirado',
    detail: 'Este arquivo expirou. Solicite uma nova exportação.',
  },
  SESSION_LIMIT_REACHED: {
    status: 409,
    title: 'Limite de 3 sessoes ativas atingido',
    detail: 'Você já tem 3 sessões ativas. Encerre uma sessão para entrar.',
  },
  DUPLICATE_CONFIRMATION_REQUIRED: {
    status: 409,
    title: 'Possivel plano duplicado',
    detail: 'Já existe um plano parecido. Confirme se deseja criar outro.',
  },
  CSRF_VALIDATION_FAILED: {
    status: 403,
    title: 'Validacao CSRF ou de origem falhou',
    detail: 'Não foi possível validar a solicitação. Recarregue a página e tente novamente.',
  },
  INTERNAL_ERROR: {
    status: 500,
    title: 'Falha inesperada',
    detail: 'Não foi possível concluir a solicitação agora. Tente novamente em instantes.',
  },
} as const satisfies Record<string, ProblemDefinition>;

export type ProblemCode = keyof typeof PROBLEM_CATALOG;

/** URI relativa do tipo do problema (Problem.type, uri-reference). */
export const problemType = (code: ProblemCode): string => `/problems/${code.toLowerCase()}`;

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly instance: string;
  readonly correlation_id: string;
  readonly field_errors?: readonly FieldError[];
}

/** Maximo de field_errors aceito pelo contrato (Problem.field_errors.maxItems). */
const MAX_FIELD_ERRORS = 100;

/** Erro de aplicacao que vira Problem do catalogo na borda HTTP. */
export class ProblemError extends Error {
  public override readonly name = 'ProblemError';

  constructor(
    public readonly code: ProblemCode,
    public readonly fieldErrors: readonly FieldError[] = [],
  ) {
    super(code);
  }
}

export function buildProblem(
  code: ProblemCode,
  instance: string,
  correlationId: string,
  fieldErrors: readonly FieldError[] = [],
): Problem {
  const definition = PROBLEM_CATALOG[code];
  const problem: Problem = {
    type: problemType(code),
    title: definition.title,
    status: definition.status,
    code,
    detail: definition.detail,
    instance,
    correlation_id: correlationId,
  };
  return fieldErrors.length === 0
    ? problem
    : { ...problem, field_errors: fieldErrors.slice(0, MAX_FIELD_ERRORS) };
}

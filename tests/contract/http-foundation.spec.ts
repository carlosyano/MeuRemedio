// @trace TS-040 ERR-001 ERR-003 ERR-011 ERR-016 RNF-015 (ADR-001 v1.5 secao 12, spike S1; secao 14.10)
// Fundacao HTTP contract-first: a API carrega a OpenAPI normativa, registra rotas por operationId,
// valida requisicao e resposta contra o YAML e responde erros com o catalogo fechado de Problem.
import { describe, expect, it } from 'vitest';
import {
  OpenApiContract,
  locateNormativeOpenApi,
  toRoutePath,
} from '../../apps/api/src/platform/contract/openapi-contract.js';
import {
  ContractMismatchError,
  assertRoutesMatchContract,
  type DeclaredRoute,
} from '../../apps/api/src/platform/contract/route-check.js';
import {
  PROBLEM_CATALOG,
  problemType,
  type ProblemCode,
} from '../../apps/api/src/platform/http/problem-catalog.js';
import { asArray, asObject, asString, dig, isObject } from './support/json.js';
import { loadContract } from './support/load.js';

const ctx = loadContract();
const contract = OpenApiContract.load(locateNormativeOpenApi());
const CORRELATION = '11111111-1111-4111-8111-111111111111';

describe('OpenApiContract: carga da OpenAPI normativa', () => {
  it('localiza o arquivo normativo da raiz, sem copia dentro de pacotes', () => {
    expect(locateNormativeOpenApi().pathname.endsWith(`/${ctx.openapiFile}`)).toBe(true);
  });

  it('expõe as 27 operacoes com metodo e caminho do contrato', () => {
    expect(contract.operations).toHaveLength(27);
    expect(contract.operation('getHealth')).toMatchObject({ method: 'GET', path: '/health' });
    expect(contract.operation('updatePlan')).toMatchObject({
      method: 'PUT',
      path: '/plans/{plan_id}',
    });
    expect(() => contract.operation('naoExiste')).toThrow(/naoExiste/);
  });

  it('converte o caminho da OpenAPI para o formato de rota do Fastify', () => {
    expect(toRoutePath('/health')).toBe('/health');
    expect(toRoutePath('/occurrences/{occurrence_id}/responses')).toBe(
      '/occurrences/:occurrence_id/responses',
    );
  });
});

describe('OpenApiContract: validacao de resposta', () => {
  const health = (body: unknown, headers: Record<string, string> = {}) =>
    contract.validateResponse('getHealth', {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-correlation-id': CORRELATION,
        ...headers,
      },
      body,
    });

  it('aceita a resposta documentada', () => {
    expect(health({ status: 'UP', time: '2026-10-05T11:05:00Z' })).toEqual([]);
  });

  it('reprova corpo fora do schema, cabecalho obrigatorio ausente e tipo de conteudo errado', () => {
    expect(health({ status: 'UP', time: 'ontem' })).not.toEqual([]);
    expect(health({ status: 'UP', time: '2026-10-05T11:05:00Z', extra: 1 })).not.toEqual([]);
    expect(
      contract.validateResponse('getHealth', {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { status: 'UP', time: '2026-10-05T11:05:00Z' },
      }),
    ).toContainEqual(expect.stringMatching(/X-Correlation-ID/i));
    expect(
      health({ status: 'UP', time: '2026-10-05T11:05:00Z' }, { 'content-type': 'text/plain' }),
    ).not.toEqual([]);
  });

  it('reprova status nao documentado na operacao', () => {
    expect(
      contract.validateResponse('getHealth', {
        status: 404,
        headers: { 'content-type': 'application/problem+json', 'x-correlation-id': CORRELATION },
        body: {},
      }),
    ).toContainEqual(expect.stringMatching(/404/));
  });

  it('resolve respostas por $ref (500 InternalError em problem+json)', () => {
    const problem = {
      type: '/problems/internal_error',
      title: 'Falha inesperada',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'Não foi possível concluir a solicitação agora. Tente novamente em instantes.',
      instance: '/health',
      correlation_id: CORRELATION,
    };
    const headers = { 'content-type': 'application/problem+json', 'x-correlation-id': CORRELATION };
    expect(contract.validateResponse('getHealth', { status: 500, headers, body: problem })).toEqual(
      [],
    );
    expect(
      contract.validateResponse('getHealth', {
        status: 500,
        headers,
        body: { ...problem, code: 'NAO_CATALOGADO' },
      }),
    ).not.toEqual([]);
  });

  it('valida Problem avulso (rota fora do contrato)', () => {
    expect(
      contract.validateProblem({
        type: '/problems/resource_not_found',
        title: 'Recurso nao encontrado',
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        detail: 'O item solicitado não foi encontrado.',
        instance: '/nao-existe',
        correlation_id: CORRELATION,
      }),
    ).toEqual([]);
    expect(contract.validateProblem({ code: 'RESOURCE_NOT_FOUND' })).not.toEqual([]);
  });
});

describe('OpenApiContract: validacao de requisicao', () => {
  const validAccount = {
    name: 'Ana Silva',
    email: 'ana.silva@example.com',
    password: 'Senha-Sintetica-2026',
    account_timezone: 'America/Sao_Paulo',
    terms_version: '2026-10',
    privacy_notice_version: '2026-10',
    terms_accepted: true,
    privacy_notice_acknowledged: true,
  };

  it('requisicao conforme nao gera erros de campo', () => {
    const schema = dig(ctx.api, 'components', 'schemas', 'CreateAccountRequest');
    // Garante que o exemplo acima segue os campos obrigatorios do contrato vigente.
    for (const field of asArray(schema['required'], 'required')) {
      expect(Object.keys(validAccount)).toContain(asString(field, 'campo'));
    }
    expect(
      contract.validateRequest('createAccount', {
        params: {},
        query: {},
        headers: { 'idempotency-key': 'chave-1' },
        body: validAccount,
      }),
    ).toEqual([]);
  });

  it('corpo invalido, cabecalho obrigatorio ausente e parametro de caminho invalido viram FieldError', () => {
    const missing = contract.validateRequest('createAccount', {
      params: {},
      query: {},
      headers: {},
      body: { ...validAccount, email: 'nao-e-email' },
    });
    expect(missing.map((e) => e.field)).toEqual(
      expect.arrayContaining(['Idempotency-Key', 'email']),
    );
    for (const error of missing) {
      expect(error.code.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
    }
    const badPath = contract.validateRequest('getPlan', {
      params: { plan_id: 'nao-e-uuid' },
      query: {},
      headers: {},
      body: undefined,
    });
    expect(badPath.map((e) => e.field)).toContain('plan_id');
  });
});

describe('assertRoutesMatchContract: rotas da aplicacao x OpenAPI', () => {
  const health: DeclaredRoute = {
    method: 'GET',
    path: '/health',
    operationId: 'getHealth',
    handler: 'HealthController.getHealth',
  };

  it('aceita rota com metodo, caminho e operationId do contrato', () => {
    expect(() => {
      assertRoutesMatchContract([health], contract);
    }).not.toThrow();
  });

  it.each([
    ['rota fora do contrato', { ...health, path: '/healthz' }],
    ['metodo divergente', { ...health, method: 'POST' }],
    ['operationId divergente', { ...health, operationId: 'listPlans' }],
    ['sem operationId', { ...health, operationId: undefined }],
    ['parametro com nome divergente', { ...health, path: '/plans/:id', operationId: 'getPlan' }],
  ] as const)('reprova %s', (_nome, route) => {
    expect(() => {
      assertRoutesMatchContract([route], contract);
    }).toThrow(ContractMismatchError);
  });

  it('reprova a mesma operacao registrada duas vezes', () => {
    expect(() => {
      assertRoutesMatchContract([health, { ...health }], contract);
    }).toThrow(ContractMismatchError);
  });
});

describe('PROBLEM_CATALOG: catalogo fechado ERR-001..ERR-016', () => {
  const codes = asArray(
    dig(ctx.api, 'components', 'schemas', 'Problem', 'properties', 'code')['enum'],
    'Problem.code.enum',
  ).map((c) => asString(c, 'code'));
  const matrixErrors = asObject(ctx.matrix['errors'], 'errors');

  // Titulo de cada codigo nos exemplos de components.responses (problem+json).
  const titles = new Map<string, string>();
  for (const response of Object.values(
    asObject(dig(ctx.api, 'components')['responses'], 'responses'),
  )) {
    if (!isObject(response)) continue;
    const media = dig(asObject(response, 'response'), 'content', 'application/problem+json');
    // Exemplo unico (example) ou nomeado (examples.<nome>.value).
    const named = isObject(media['examples'])
      ? Object.values(media['examples']).map((item) => (isObject(item) ? item['value'] : undefined))
      : [];
    for (const example of [media['example'], ...named]) {
      if (isObject(example)) {
        titles.set(asString(example['code'], 'code'), asString(example['title'], 'title'));
      }
    }
  }

  it('cobre exatamente os codigos do enum Problem.code', () => {
    expect(Object.keys(PROBLEM_CATALOG).sort()).toEqual([...codes].sort());
  });

  it.each(Object.entries(matrixErrors))(
    '%s: status e mensagem ao usuario da matriz',
    (_id, raw) => {
      const entry = asObject(raw, 'erro');
      const code = asString(entry['code'], 'code') as ProblemCode;
      expect(PROBLEM_CATALOG[code]).toMatchObject({
        status: entry['http_status'],
        detail: asString(entry['user_message'], 'user_message'),
      });
    },
  );

  it.each(codes)('%s: titulo do exemplo da OpenAPI e type relativo', (code) => {
    const item = PROBLEM_CATALOG[code as ProblemCode];
    expect(item.title).toBe(titles.get(code));
    expect(item.title.length).toBeLessThanOrEqual(200);
    expect(item.detail.length).toBeLessThanOrEqual(500);
    expect(problemType(code as ProblemCode)).toBe(`/problems/${code.toLowerCase()}`);
  });
});

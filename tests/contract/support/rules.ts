// Regras do TS-040 (contrato). Cada regra e pura: recebe o contexto e devolve a lista de violacoes.
// Fontes: OpenAPI 02.33.3, matriz de rastreabilidade, AGENTS.md (secoes 13 e 14), Especificacao 02.33
// (secao 13) e ADR-001 v1.5. Excecoes explicitas ficam em ALLOWANCES e exigem GAP registrado na matriz.
import {
  asArray,
  asObject,
  asString,
  asStrings,
  isObject,
  type Json,
  type JsonObject,
} from './json.js';
import type { ContractContext } from './load.js';

export interface Rule {
  readonly id: string;
  readonly title: string;
  readonly check: (ctx: ContractContext, allowances?: readonly Allowance[]) => string[];
}

export interface Allowance {
  readonly rule: string;
  readonly key: string;
  readonly gap: string;
  readonly reason: string;
}

/**
 * Excecoes conhecidas, cada uma amarrada a uma lacuna registrada em known_gaps da matriz.
 * Vazio desde a OpenAPI 02.33.3 (GAP-008 e GAP-009 resolvidos em 04/10/2026).
 */
export const ALLOWANCES: readonly Allowance[] = [];

// Conjuntos normativos (AGENTS.md secoes 13 e 14; Especificacao 02.33 secoes 13.2 e 13.3).
const PUBLIC_OPERATIONS = [
  'confirmPasswordReset',
  'createAccount',
  'createSession',
  'getHealth',
  'requestPasswordReset',
  'resendVerification',
  'verifyAccount',
];
const IDEMPOTENT_OPERATIONS = [
  'createAccount',
  'createExport',
  'createPlan',
  'createResponse',
  'requestAccountDeletion',
  'revokeAllSessions',
  'updatePlan',
];
const CSRF_OPERATIONS = [
  'cancelExport',
  'createExport',
  'createPlan',
  'createResponse',
  'deleteCurrentSession',
  'deletePlan',
  'requestAccountDeletion',
  'revokeAllSessions',
  'updateAccessibilityPreferences',
  'updateCurrentAccount',
  'updatePlan',
];
const METHODS = ['get', 'post', 'put', 'delete'] as const;
const CATALOGS = [
  'requirements',
  'non_functional_requirements',
  'acceptance_criteria',
  'sentinel_tests',
  'business_rules',
  'entities',
  'flows',
  'screen_states',
  'user_stories',
  'decisions',
  'approved_questions',
];

interface Operation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly node: JsonObject;
}

function operations(api: JsonObject): Operation[] {
  const result: Operation[] = [];
  for (const [path, item] of Object.entries(asObject(api['paths'], 'paths'))) {
    for (const method of METHODS) {
      const node = asObject(item, path)[method];
      if (isObject(node)) {
        result.push({ id: asString(node['operationId'], `${path} ${method}`), method, path, node });
      }
    }
  }
  return result;
}

function pointer(root: JsonObject, ref: string): Json | undefined {
  let current: Json | undefined = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(current)) return undefined;
    current = current[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return current;
}

/** Segue um $ref interno (uma vez) e devolve o objeto resolvido. */
function resolve(api: JsonObject, node: Json | undefined): JsonObject {
  const object = asObject(node, 'no OpenAPI');
  const ref = object['$ref'];
  return typeof ref === 'string' ? asObject(pointer(api, ref), ref) : object;
}

function responsesOf(api: JsonObject, op: Operation): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  for (const [status, response] of Object.entries(
    asObject(op.node['responses'], `${op.id}.responses`),
  )) {
    map.set(status, resolve(api, response));
  }
  return map;
}

function parameterNames(op: Operation): string[] {
  return asArray(op.node['parameters'] ?? [], `${op.id}.parameters`).flatMap((p) => {
    const ref = isObject(p) ? p['$ref'] : undefined;
    return typeof ref === 'string' ? [ref.split('/').at(-1) ?? ''] : [];
  });
}

function isPublic(op: Operation): boolean {
  const security = op.node['security'];
  return Array.isArray(security) && security.length === 0;
}

function requires(op: Operation, scheme: string): boolean {
  const security = op.node['security'];
  if (!Array.isArray(security)) return scheme === 'sessionCookie';
  return security.some((requirement) => isObject(requirement) && scheme in requirement);
}

function matrixErrors(
  ctx: ContractContext,
): { id: string; code: string; http: string; ops: string[] }[] {
  return Object.entries(asObject(ctx.matrix['errors'], 'errors')).map(([id, value]) => {
    const e = asObject(value, id);
    return {
      id,
      code: asString(e['code'], `${id}.code`),
      http: statusText(e['http_status'], `${id}.http_status`),
      ops: asStrings(e['operationIds'], `${id}.operationIds`),
    };
  });
}

function statusText(value: Json | undefined, what: string): string {
  return typeof value === 'number' ? String(value) : asString(value, what);
}

function gapIds(ctx: ContractContext): string[] {
  return asArray(ctx.matrix['known_gaps'], 'known_gaps').map((g) =>
    asString(asObject(g, 'gap')['id'], 'gap.id'),
  );
}

function allowed(allowances: readonly Allowance[], rule: string, key: string): boolean {
  return allowances.some((a) => a.rule === rule && a.key === key);
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();
const diff = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x));

export const RULES: readonly Rule[] = [
  {
    id: 'R01',
    title: 'operationId unicos, completos e iguais aos da matriz',
    check: ({ api, matrix }) => {
      const out: string[] = [];
      const ops = operations(api);
      const ids = ops.map((o) => o.id);
      for (const id of new Set(ids))
        if (ids.filter((x) => x === id).length > 1) out.push(`operationId duplicado: ${id}`);
      const inMatrix = Object.keys(asObject(matrix['operations'], 'operations'));
      for (const id of diff(ids, inMatrix)) out.push(`operacao fora da matriz: ${id}`);
      for (const id of diff(inMatrix, ids))
        out.push(`operacao da matriz ausente na OpenAPI: ${id}`);
      for (const op of ops) {
        if (typeof op.node['summary'] !== 'string') out.push(`${op.id}: sem summary`);
        if (asArray(op.node['x-traceability'] ?? [], op.id).length === 0)
          out.push(`${op.id}: x-traceability vazio`);
        const m = asObject(asObject(matrix['operations'], 'operations')[op.id] ?? null, op.id);
        if (m['method'] !== op.method.toUpperCase() || m['path'] !== op.path)
          out.push(`${op.id}: metodo/rota diferem da matriz`);
      }
      return out;
    },
  },
  {
    id: 'R02',
    title: 'toda referencia $ref interna resolve',
    check: ({ api }) => {
      const out: string[] = [];
      const walk = (node: Json, where: string): void => {
        if (Array.isArray(node))
          node.forEach((item, i) => {
            walk(item, `${where}[${String(i)}]`);
          });
        else if (isObject(node)) {
          for (const [key, value] of Object.entries(node)) {
            if (
              key === '$ref' &&
              typeof value === 'string' &&
              value.startsWith('#/') &&
              pointer(api, value) === undefined
            ) {
              out.push(`${where}: referencia sem alvo ${value}`);
            }
            walk(value, `${where}.${key}`);
          }
        }
      };
      walk(api, '#');
      return out;
    },
  },
  {
    id: 'R03',
    title: 'Problem.code e a lista fechada de erros da matriz',
    check: (ctx) => {
      const problem = asObject(
        asObject(asObject(ctx.api['components'], 'components')['schemas'], 'schemas')['Problem'],
        'Problem',
      );
      const enumValues = asStrings(
        asObject(asObject(problem['properties'], 'Problem.properties')['code'], 'Problem.code')[
          'enum'
        ],
        'Problem.code.enum',
      );
      const codes = matrixErrors(ctx).map((e) => e.code);
      return [
        ...diff(enumValues, codes).map((c) => `codigo no contrato sem erro na matriz: ${c}`),
        ...diff(codes, enumValues).map((c) => `erro da matriz fora do enum do contrato: ${c}`),
      ];
    },
  },
  {
    id: 'R04',
    title: 'cada erro da matriz e declarado (mesmo status) pelas operacoes que lista',
    check: (ctx) => {
      const out: string[] = [];
      const ops = new Map(operations(ctx.api).map((o) => [o.id, o]));
      for (const e of matrixErrors(ctx)) {
        for (const id of e.ops) {
          const op = ops.get(id);
          if (!op) out.push(`${e.id}: operacao inexistente ${id}`);
          else if (!responsesOf(ctx.api, op).has(e.http))
            out.push(`${e.id}: ${id} nao declara ${e.http}`);
        }
      }
      return out;
    },
  },
  {
    id: 'R05',
    title: 'todo status 4xx/5xx declarado por uma operacao esta mapeado em algum erro da matriz',
    check: (ctx, allowances = ALLOWANCES) => {
      const out: string[] = [];
      const errors = matrixErrors(ctx);
      for (const op of operations(ctx.api)) {
        for (const status of responsesOf(ctx.api, op).keys()) {
          if (!/^[45]/.test(status)) continue;
          const mapped = errors.some((e) => e.http === status && e.ops.includes(op.id));
          if (!mapped && !allowed(allowances, 'R05', `${op.id}:${status}`))
            out.push(`${op.id}: ${status} sem erro mapeado na matriz`);
        }
      }
      return out;
    },
  },
  {
    id: 'R06',
    title: 'a matriz reflete exatamente os status declarados por operacao',
    check: (ctx) => {
      const out: string[] = [];
      for (const op of operations(ctx.api)) {
        const declared = sorted(responsesOf(ctx.api, op).keys());
        const m = asObject(asObject(ctx.matrix['operations'], 'operations')[op.id] ?? null, op.id);
        const inMatrix = sorted(asStrings(m['response_statuses'], `${op.id}.response_statuses`));
        if (declared.join() !== inMatrix.join())
          out.push(`${op.id}: contrato [${declared.join()}] x matriz [${inMatrix.join()}]`);
      }
      return out;
    },
  },
  {
    id: 'R07',
    title: '429 em todas as operacoes, exceto getHealth (RNF-006), e ERR-010 coerente',
    check: (ctx) => {
      const out: string[] = [];
      const with429: string[] = [];
      for (const op of operations(ctx.api)) {
        const has = responsesOf(ctx.api, op).has('429');
        if (has) with429.push(op.id);
        if (op.id === 'getHealth' && has) out.push('getHealth nao deve declarar 429');
        if (op.id !== 'getHealth' && !has) out.push(`${op.id}: sem 429`);
      }
      const err010 = matrixErrors(ctx).find((e) => e.code === 'RATE_LIMITED');
      if (!err010 || sorted(err010.ops).join() !== sorted(with429).join())
        out.push('ERR-010 nao coincide com as operacoes que declaram 429');
      return out;
    },
  },
  {
    id: 'R08',
    title: 'Idempotency-Key obrigatoria exatamente nas 7 mutacoes criticas, com 409 declarado',
    check: (ctx) => {
      const out: string[] = [];
      const withKey = operations(ctx.api)
        .filter((o) => parameterNames(o).includes('IdempotencyKey'))
        .map((o) => o.id);
      for (const id of diff(IDEMPOTENT_OPERATIONS, withKey)) out.push(`${id}: sem Idempotency-Key`);
      for (const id of diff(withKey, IDEMPOTENT_OPERATIONS))
        out.push(`${id}: Idempotency-Key fora da lista normativa`);
      const key = asObject(
        asObject(asObject(ctx.api['components'], 'components')['parameters'], 'parameters')[
          'IdempotencyKey'
        ],
        'IdempotencyKey',
      );
      if (key['required'] !== true || key['in'] !== 'header' || key['name'] !== 'Idempotency-Key')
        out.push('parametro IdempotencyKey deve ser cabecalho obrigatorio Idempotency-Key');
      for (const op of operations(ctx.api)) {
        if (IDEMPOTENT_OPERATIONS.includes(op.id) && !responsesOf(ctx.api, op).has('409'))
          out.push(`${op.id}: sem 409`);
      }
      return out;
    },
  },
  {
    id: 'R09',
    title:
      'CSRF exatamente nas 11 mutacoes autenticadas, com 403; leituras e rotas publicas sem CSRF',
    check: (ctx) => {
      const out: string[] = [];
      const withCsrf = operations(ctx.api)
        .filter((o) => requires(o, 'csrfToken'))
        .map((o) => o.id);
      for (const id of diff(CSRF_OPERATIONS, withCsrf)) out.push(`${id}: sem csrfToken`);
      for (const id of diff(withCsrf, CSRF_OPERATIONS))
        out.push(`${id}: csrfToken fora da lista normativa`);
      for (const op of operations(ctx.api)) {
        if (CSRF_OPERATIONS.includes(op.id)) {
          if (!requires(op, 'sessionCookie')) out.push(`${op.id}: CSRF sem sessionCookie`);
          if (!responsesOf(ctx.api, op).has('403')) out.push(`${op.id}: sem 403`);
        }
      }
      return out;
    },
  },
  {
    id: 'R10',
    title:
      'rotas publicas sao exatamente 7; privadas declaram 401; com identificador no caminho declaram 404',
    check: (ctx) => {
      const out: string[] = [];
      const publicIds = operations(ctx.api)
        .filter(isPublic)
        .map((o) => o.id);
      for (const id of diff(PUBLIC_OPERATIONS, publicIds)) out.push(`${id}: deveria ser publica`);
      for (const id of diff(publicIds, PUBLIC_OPERATIONS))
        out.push(`${id}: publica fora da lista normativa`);
      for (const op of operations(ctx.api)) {
        if (isPublic(op)) continue;
        const statuses = responsesOf(ctx.api, op);
        if (!statuses.has('401')) out.push(`${op.id}: privada sem 401`);
        if (op.path.includes('{') && !statuses.has('404'))
          out.push(`${op.id}: rota com identificador sem 404 (BOLA)`);
      }
      return out;
    },
  },
  {
    id: 'R11',
    title:
      'erros 4xx/5xx usam application/problem+json com X-Correlation-ID; 423 e 429 com Retry-After',
    check: (ctx) => {
      const out: string[] = [];
      for (const op of operations(ctx.api)) {
        for (const [status, response] of responsesOf(ctx.api, op)) {
          if (!/^[45]/.test(status) || (op.id === 'getHealth' && status === '503')) continue;
          const content = asObject(response['content'] ?? {}, `${op.id}.${status}.content`);
          if (!('application/problem+json' in content))
            out.push(`${op.id}: ${status} sem application/problem+json`);
          const headers = asObject(response['headers'] ?? {}, `${op.id}.${status}.headers`);
          if (!('X-Correlation-ID' in headers))
            out.push(`${op.id}: ${status} sem X-Correlation-ID`);
          if ((status === '423' || status === '429') && !('Retry-After' in headers))
            out.push(`${op.id}: ${status} sem Retry-After`);
        }
      }
      return out;
    },
  },
  {
    id: 'R12',
    title: 'toda resposta, de sucesso ou de erro, declara X-Correlation-ID',
    check: (ctx) => {
      const out: string[] = [];
      for (const op of operations(ctx.api)) {
        for (const [status, response] of responsesOf(ctx.api, op)) {
          const headers = asObject(response['headers'] ?? {}, `${op.id}.${status}.headers`);
          if (!('X-Correlation-ID' in headers))
            out.push(`${op.id}: ${status} sem X-Correlation-ID`);
        }
      }
      return out;
    },
  },
  {
    id: 'R13',
    title:
      'ETag em getPlan/updatePlan (200) e createPlan (201); If-Match obrigatorio so em updatePlan',
    check: (ctx) => {
      const out: string[] = [];
      const expectEtag: [string, string][] = [
        ['getPlan', '200'],
        ['updatePlan', '200'],
        ['createPlan', '201'],
      ];
      const ops = new Map(operations(ctx.api).map((o) => [o.id, o]));
      for (const [id, status] of expectEtag) {
        const op = ops.get(id);
        const response = op ? responsesOf(ctx.api, op).get(status) : undefined;
        if (!response || !('ETag' in asObject(response['headers'] ?? {}, `${id}.headers`)))
          out.push(`${id}: ${status} sem ETag`);
      }
      for (const op of ops.values()) {
        const hasIfMatch = parameterNames(op).includes('IfMatch');
        if (op.id === 'updatePlan' && !hasIfMatch) out.push('updatePlan: sem If-Match');
        if (op.id !== 'updatePlan' && hasIfMatch) out.push(`${op.id}: If-Match fora de updatePlan`);
      }
      const ifMatch = asObject(
        asObject(asObject(ctx.api['components'], 'components')['parameters'], 'parameters')[
          'IfMatch'
        ],
        'IfMatch',
      );
      if (ifMatch['required'] !== true || ifMatch['in'] !== 'header')
        out.push('parametro IfMatch deve ser cabecalho obrigatorio');
      return out;
    },
  },
  {
    id: 'R14',
    title:
      'cookies e CSRF estao documentados no contrato (mr_session, mr_csrf, atributos, Set-Cookie)',
    check: (ctx) => {
      const out: string[] = [];
      const schemes = asObject(
        asObject(ctx.api['components'], 'components')['securitySchemes'],
        'securitySchemes',
      );
      const session = asString(
        asObject(schemes['sessionCookie'] ?? null, 'sessionCookie')['description'],
        'sessionCookie.description',
      );
      for (const token of ['mr_session', 'HttpOnly', 'Secure', 'SameSite=Lax'])
        if (!session.includes(token)) out.push(`sessionCookie sem "${token}"`);
      const csrf = asObject(schemes['csrfToken'] ?? null, 'csrfToken');
      if (csrf['in'] !== 'header' || csrf['name'] !== 'X-CSRF-Token')
        out.push('csrfToken deve ser o cabecalho X-CSRF-Token');
      const csrfText = asString(csrf['description'], 'csrfToken.description');
      for (const token of ['mr_csrf', 'Origin', '403 CSRF_VALIDATION_FAILED'])
        if (!csrfText.includes(token)) out.push(`csrfToken sem "${token}"`);
      const ops = new Map(operations(ctx.api).map((o) => [o.id, o]));
      for (const [id, status] of [
        ['createSession', '201'],
        ['deleteCurrentSession', '204'],
      ] as const) {
        const op = ops.get(id);
        const response = op ? responsesOf(ctx.api, op).get(status) : undefined;
        if (!response || !('Set-Cookie' in asObject(response['headers'] ?? {}, `${id}.headers`)))
          out.push(`${id}: ${status} sem Set-Cookie`);
      }
      return out;
    },
  },
  {
    id: 'R15',
    title: 'x-traceability referencia somente IDs existentes e coincide com a matriz',
    check: (ctx) => {
      const out: string[] = [];
      const known = new Set(CATALOGS.flatMap((c) => Object.keys(asObject(ctx.matrix[c] ?? {}, c))));
      const matrixOps = asObject(ctx.matrix['operations'], 'operations');
      for (const op of operations(ctx.api)) {
        const refs = asStrings(op.node['x-traceability'] ?? [], `${op.id}.x-traceability`);
        for (const ref of refs)
          if (!known.has(ref)) out.push(`${op.id}: referencia inexistente ${ref}`);
        const m = asObject(matrixOps[op.id] ?? null, op.id);
        if (asStrings(m['traceability'], `${op.id}.traceability`).join() !== refs.join())
          out.push(`${op.id}: traceability da matriz difere do x-traceability`);
      }
      return out;
    },
  },
  {
    id: 'R16',
    title: 'integridade: nome e SHA-256 da OpenAPI conferem com a matriz',
    check: (ctx) => {
      const generated = asObject(ctx.matrix['generated_from'], 'generated_from');
      const artifact = asObject(
        asObject(
          asObject(generated['source_integrity'], 'source_integrity')['artifacts'],
          'artifacts',
        )['openapi'],
        'openapi',
      );
      const out: string[] = [];
      const file = asString(artifact['file'], 'openapi.file');
      if (file !== ctx.openapiFile)
        out.push(
          `arquivo da OpenAPI na matriz (${file}) difere do arquivo real (${ctx.openapiFile})`,
        );
      if (artifact['sha256'] !== ctx.openapiSha256)
        out.push('SHA-256 da OpenAPI difere do registrado na matriz');
      return out;
    },
  },
  {
    id: 'R18',
    title:
      'falha inesperada documentada em toda operacao: 500 INTERNAL_ERROR (ERR-016) e 503 (ERR-011; getHealth com Health)',
    check: (ctx) => {
      const out: string[] = [];
      const errors = matrixErrors(ctx);
      const err016 = errors.find((e) => e.code === 'INTERNAL_ERROR');
      if (err016?.http !== '500') out.push('ERR INTERNAL_ERROR (500) ausente da matriz');
      const err011 = errors.find((e) => e.code === 'DEPENDENCY_UNAVAILABLE');
      const all = operations(ctx.api).map((op) => op.id);
      for (const op of operations(ctx.api)) {
        const statuses = responsesOf(ctx.api, op);
        if (!statuses.has('500')) out.push(`${op.id}: sem 500`);
        if (!statuses.has('503')) out.push(`${op.id}: sem 503`);
      }
      if (err016 && sorted(err016.ops).join() !== sorted(all).join())
        out.push('ERR-016 nao lista todas as operacoes');
      if (err011 && sorted(err011.ops).join() !== sorted(all).join())
        out.push('ERR-011 nao lista todas as operacoes');
      return out;
    },
  },
  {
    id: 'R17',
    title: 'toda excecao do TS-040 tem lacuna registrada em known_gaps da matriz',
    check: (ctx, allowances = ALLOWANCES) => {
      const ids = gapIds(ctx);
      return allowances
        .filter((a) => !ids.includes(a.gap))
        .map((a) => `excecao ${a.rule} ${a.key} sem ${a.gap} na matriz`);
    },
  },
];

// Contrato HTTP carregado da OpenAPI normativa (ADR-001 v1.5 secoes 7, 12/S1 e 14.10).
// - o YAML da raiz do repositorio e a unica fonte: nada e copiado para dentro do pacote;
// - schemas validados com JSON Schema 2020-12 (jsonSchemaDialect da OpenAPI 3.1.1), via Ajv;
// - requisicao: parametros de caminho, consulta e cabecalho, e corpo JSON -> FieldError[];
// - resposta: status documentado, X-Correlation-ID, tipo de conteudo e corpo -> lista de erros.
import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import formatsModule from 'ajv-formats';
import { parse } from 'yaml';
import type { FieldError } from '../http/problem-catalog.js';

type JsonObject = Record<string, unknown>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const DOCUMENT_ID = 'openapi';
const CORRELATION_HEADER = 'x-correlation-id';
const OPENAPI_FILE = /^MeuRemedio_OpenAPI_.*_COMPLETO\.yaml$/;
const REPOSITORY_ROOT = new URL('../../../../../', import.meta.url);

interface ParameterSpec {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly schema: unknown;
}

interface ResponseSpec {
  readonly headers: ReadonlyMap<string, unknown>;
  readonly content: ReadonlyMap<string, unknown> | undefined;
}

export interface ContractOperation {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Caminho no formato da OpenAPI, ex.: /plans/{plan_id}. */
  readonly path: string;
  /** Operacao sem sessao (security: [] na OpenAPI). */
  readonly public: boolean;
}

interface OperationSpec extends ContractOperation {
  readonly parameters: readonly ParameterSpec[];
  readonly body: { readonly required: boolean; readonly schema: unknown } | undefined;
  readonly responses: ReadonlyMap<string, ResponseSpec>;
}

export interface HttpRequestParts {
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

export interface HttpResponseParts {
  readonly status: number;
  /** Cabecalhos com nomes em minusculas. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

/** Localiza a unica OpenAPI normativa na raiz do repositorio. */
export function locateNormativeOpenApi(root: URL = REPOSITORY_ROOT): URL {
  const files = readdirSync(root).filter((file) => OPENAPI_FILE.test(file));
  const [file] = files;
  if (files.length !== 1 || file === undefined) {
    throw new Error(
      `Esperada 1 OpenAPI normativa em ${root.href}; encontradas ${String(files.length)}`,
    );
  }
  return new URL(file, root);
}

/** /plans/{plan_id} -> /plans/:plan_id (formato de rota do Fastify e do NestJS). */
export const toRoutePath = (openApiPath: string): string =>
  openApiPath.replace(/\{([^}]+)\}/g, ':$1');

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objectAt = (value: unknown, what: string): JsonObject => {
  if (!isObject(value)) throw new Error(`OpenAPI: ${what} deveria ser um objeto`);
  return value;
};

/** Reescreve $ref locais (#/...) para o documento registrado no Ajv. */
function anchorRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anchorRefs);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === '$ref' && typeof item === 'string' && item.startsWith('#/')
        ? `${DOCUMENT_ID}${item}`
        : anchorRefs(item),
    ]),
  );
}

const fieldPath = (instancePath: string): string =>
  instancePath.replace(/^\//, '').replaceAll('/', '.');

function toFieldErrors(errors: readonly ErrorObject[], prefix: string): FieldError[] {
  return errors.map((error) => {
    const params = error.params as Record<string, unknown>;
    const child =
      error.keyword === 'required'
        ? String(params['missingProperty'])
        : error.keyword === 'additionalProperties'
          ? String(params['additionalProperty'])
          : '';
    const field = [prefix, fieldPath(error.instancePath), child].filter(Boolean).join('.');
    return {
      field: field === '' ? 'body' : field,
      code: error.keyword === 'required' ? 'REQUIRED' : error.keyword.toUpperCase(),
      message: error.keyword === 'required' ? 'Campo obrigatório.' : 'Valor inválido.',
    };
  });
}

export class OpenApiContract {
  private readonly specs: ReadonlyMap<string, OperationSpec>;
  private readonly byRoute: ReadonlyMap<string, OperationSpec>;
  private readonly compiled = new Map<string, ValidateFunction>();

  private constructor(
    private readonly document: JsonObject,
    private readonly ajv: Ajv2020,
    private readonly coercingAjv: Ajv2020,
  ) {
    this.specs = new Map(this.readOperations().map((spec) => [spec.operationId, spec]));
    this.byRoute = new Map(
      [...this.specs.values()].map((spec) => [`${spec.method} ${toRoutePath(spec.path)}`, spec]),
    );
  }

  static load(file: URL): OpenApiContract {
    const document = objectAt(parse(readFileSync(file, 'utf8')), 'documento');
    const build = (coerceTypes: boolean): Ajv2020 => {
      const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        validateSchema: false,
        coerceTypes,
      });
      formatsModule.default(ajv);
      ajv.addSchema(document, DOCUMENT_ID);
      return ajv;
    };
    return new OpenApiContract(document, build(false), build(true));
  }

  get operations(): readonly ContractOperation[] {
    return [...this.specs.values()];
  }

  operation(operationId: string): ContractOperation {
    return this.spec(operationId);
  }

  /** Operacao pelo metodo e pela rota no formato do Fastify (ex.: GET /plans/:plan_id). */
  operationForRoute(method: string, routePath: string | undefined): ContractOperation | undefined {
    return routePath === undefined ? undefined : this.byRoute.get(`${method} ${routePath}`);
  }

  validateRequest(operationId: string, request: HttpRequestParts): FieldError[] {
    const spec = this.spec(operationId);
    const errors: FieldError[] = [];
    for (const parameter of spec.parameters) {
      const source =
        parameter.in === 'path'
          ? request.params
          : parameter.in === 'query'
            ? request.query
            : parameter.in === 'header'
              ? request.headers
              : undefined;
      if (source === undefined) continue;
      const key = parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name;
      const value = source[key];
      if (value === undefined) {
        if (parameter.required) {
          errors.push({ field: parameter.name, code: 'REQUIRED', message: 'Campo obrigatório.' });
        }
        continue;
      }
      const validate = this.compile(
        `param:${operationId}:${parameter.in}:${parameter.name}`,
        { type: 'object', properties: { value: parameter.schema } },
        this.coercingAjv,
      );
      if (!validate({ value })) {
        errors.push({ field: parameter.name, code: 'INVALID', message: 'Valor inválido.' });
      }
    }
    if (spec.body !== undefined) {
      if (request.body === undefined || request.body === null) {
        if (spec.body.required) {
          errors.push({ field: 'body', code: 'REQUIRED', message: 'Campo obrigatório.' });
        }
      } else {
        const validate = this.compile(`body:${operationId}`, spec.body.schema, this.ajv);
        if (!validate(request.body)) errors.push(...toFieldErrors(validate.errors ?? [], ''));
      }
    }
    return errors;
  }

  validateResponse(operationId: string, response: HttpResponseParts): string[] {
    const spec = this.spec(operationId);
    const documented = spec.responses.get(String(response.status));
    if (documented === undefined) {
      return [`${operationId}: status ${String(response.status)} nao documentado`];
    }
    const errors: string[] = [];
    if (!response.headers[CORRELATION_HEADER]) {
      errors.push(`${operationId}: cabecalho X-Correlation-ID ausente`);
    }
    for (const [name, schema] of documented.headers) {
      const value = response.headers[name];
      if (value === undefined || name === 'set-cookie') continue;
      const validate = this.compile(
        `header:${operationId}:${String(response.status)}:${name}`,
        { type: 'object', properties: { value: schema } },
        this.coercingAjv,
      );
      if (!validate({ value })) errors.push(`${operationId}: cabecalho ${name} invalido`);
    }
    if (documented.content === undefined) {
      if (response.body !== undefined && response.body !== '') {
        errors.push(`${operationId}: resposta ${String(response.status)} nao tem corpo`);
      }
      return errors;
    }
    const mediaType = (response.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    const schema = documented.content.get(mediaType);
    if (schema === undefined) {
      errors.push(`${operationId}: tipo de conteudo "${mediaType}" nao documentado`);
      return errors;
    }
    const validate = this.compile(
      `response:${operationId}:${String(response.status)}:${mediaType}`,
      schema,
      this.ajv,
    );
    if (!validate(response.body)) {
      errors.push(
        ...(validate.errors ?? []).map(
          (e) => `${operationId}: corpo ${e.instancePath} ${e.message ?? ''}`,
        ),
      );
    }
    return errors;
  }

  /** Valida um Problem fora de operacao do contrato (ex.: rota inexistente). */
  validateProblem(body: unknown): string[] {
    const validate = this.compile('problem', { $ref: '#/components/schemas/Problem' }, this.ajv);
    return validate(body)
      ? []
      : (validate.errors ?? []).map((e) => `Problem ${e.instancePath} ${e.message ?? ''}`);
  }

  private spec(operationId: string): OperationSpec {
    const spec = this.specs.get(operationId);
    if (!spec) throw new Error(`Operacao fora do contrato: ${operationId}`);
    return spec;
  }

  private compile(key: string, schema: unknown, ajv: Ajv2020): ValidateFunction {
    const cacheKey = `${ajv === this.ajv ? 'strict' : 'coerce'}:${key}`;
    const cached = this.compiled.get(cacheKey);
    if (cached) return cached;
    const validate = ajv.compile(anchorRefs(schema) as JsonObject);
    this.compiled.set(cacheKey, validate);
    return validate;
  }

  /** Segue $ref local (#/...) em objetos que nao sao schema (parametros, respostas, cabecalhos). */
  private deref(value: unknown, what: string): JsonObject {
    let current = objectAt(value, what);
    while (typeof current['$ref'] === 'string') {
      const ref = current['$ref'];
      if (!ref.startsWith('#/')) throw new Error(`OpenAPI: $ref externo nao suportado: ${ref}`);
      current = objectAt(
        ref
          .slice(2)
          .split('/')
          .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
          .reduce<unknown>(
            (node, part) => (isObject(node) ? node[part] : undefined),
            this.document,
          ),
        ref,
      );
    }
    return current;
  }

  private readParameters(list: unknown, what: string): ParameterSpec[] {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error(`OpenAPI: ${what} deveria ser uma lista`);
    return list.map((item, index) => {
      const parameter = this.deref(item, `${what}[${String(index)}]`);
      return {
        name: String(parameter['name']),
        in: parameter['in'] as ParameterSpec['in'],
        required: parameter['required'] === true,
        schema: parameter['schema'],
      };
    });
  }

  private readOperations(): OperationSpec[] {
    const operations: OperationSpec[] = [];
    for (const [path, rawItem] of Object.entries(objectAt(this.document['paths'], 'paths'))) {
      const item = objectAt(rawItem, path);
      const shared = this.readParameters(item['parameters'], `${path}.parameters`);
      for (const method of METHODS) {
        const raw = item[method.toLowerCase()];
        if (raw === undefined) continue;
        const operation = objectAt(raw, `${method} ${path}`);
        const own = this.readParameters(operation['parameters'], `${method} ${path}.parameters`);
        const parameters = [
          ...shared.filter((p) => !own.some((o) => o.name === p.name && o.in === p.in)),
          ...own,
        ];
        operations.push({
          operationId: String(operation['operationId']),
          method,
          path,
          public: Array.isArray(operation['security']) && operation['security'].length === 0,
          parameters,
          body: this.readBody(operation['requestBody'], `${method} ${path}`),
          responses: this.readResponses(operation['responses'], `${method} ${path}`),
        });
      }
    }
    return operations;
  }

  private readBody(raw: unknown, what: string): OperationSpec['body'] {
    if (raw === undefined) return undefined;
    const body = this.deref(raw, `${what}.requestBody`);
    const content = objectAt(body['content'], `${what}.requestBody.content`);
    const json = objectAt(content['application/json'], `${what}.requestBody application/json`);
    return { required: body['required'] === true, schema: json['schema'] };
  }

  private readResponses(raw: unknown, what: string): Map<string, ResponseSpec> {
    const responses = new Map<string, ResponseSpec>();
    for (const [status, value] of Object.entries(objectAt(raw, `${what}.responses`))) {
      const response = this.deref(value, `${what} ${status}`);
      const headers = new Map<string, unknown>();
      if (isObject(response['headers'])) {
        for (const [name, header] of Object.entries(response['headers'])) {
          headers.set(
            name.toLowerCase(),
            this.deref(header, `${what} ${status} ${name}`)['schema'],
          );
        }
      }
      const content = isObject(response['content'])
        ? new Map(
            Object.entries(response['content']).map(([media, entry]) => [
              media,
              objectAt(entry, `${what} ${status} ${media}`)['schema'],
            ]),
          )
        : undefined;
      responses.set(status, { headers, content });
    }
    return responses;
  }
}

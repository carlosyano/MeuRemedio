// Aplicacao do contrato em tempo de execucao:
// - onRequest: atribui o X-Correlation-ID;
// - preParsing: operacao sem requestBody no contrato ignora corpo e Content-Type, que nem chegam ao
//   parser (Content-Type malformado ou corpo ilegivel nao viram erro fora do contrato, DC-047);
// - interceptor: valida parametros, cabecalhos e corpo contra a operacao -> 400 VALIDATION_FAILED;
// - onSend: valida status, cabecalhos e corpo da resposta; resposta fora do contrato nao sai e
//   vira 500 INTERNAL_ERROR (o desvio vai para o log).
import {
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import type { OpenApiContract } from '../contract/openapi-contract.js';
import {
  CORRELATION_HEADER,
  assignCorrelationId,
  correlationIdOf,
  instanceOf,
} from './correlation.js';
import { PROBLEM_CONTENT_TYPE } from './problem-filter.js';
import { ProblemError, buildProblem } from './problem-catalog.js';

const operationOf = (contract: OpenApiContract, request: FastifyRequest): string | undefined =>
  contract.operationForRoute(request.method, request.routeOptions.url)?.operationId;

export class ContractRequestInterceptor implements NestInterceptor {
  constructor(private readonly contract: OpenApiContract) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const operationId = operationOf(this.contract, request);
    if (operationId === undefined) throw new Error('Rota sem operacao do contrato');
    const errors = this.contract.validateRequest(operationId, {
      params: (request.params ?? {}) as Record<string, unknown>,
      query: (request.query ?? {}) as Record<string, unknown>,
      headers: request.headers,
      body: request.body,
    });
    if (errors.length > 0) {
      // Identificador de caminho fora do formato nao identifica recurso algum: 404, como o id
      // inexistente (DC-031). Varias operacoes por id nem declaram 400 no contrato.
      const pathNames = this.contract.pathParameterNames(operationId);
      if (errors.some((error) => pathNames.includes(error.field))) {
        throw new ProblemError('RESOURCE_NOT_FOUND');
      }
      throw new ProblemError('VALIDATION_FAILED', errors);
    }
    return next.handle();
  }
}

function parseBody(payload: unknown, contentType: string | undefined): unknown {
  if (payload === null || payload === undefined || payload === '') return undefined;
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  if (typeof text !== 'string') return payload;
  return contentType?.includes('json') ? (JSON.parse(text) as unknown) : text;
}

function headersOf(reply: FastifyReply): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(reply.getHeaders()).map(([name, value]) => [
      name.toLowerCase(),
      value === undefined ? undefined : String(value),
    ]),
  );
}

export function registerContractHooks(instance: FastifyInstance, contract: OpenApiContract): void {
  const logger = new Logger('Contract');

  instance.addHook('onRequest', async (request, reply) => {
    void reply.header(CORRELATION_HEADER, assignCorrelationId(request.raw));
  });

  instance.addHook('preParsing', async (request, _reply, payload) => {
    const operationId = operationOf(contract, request);
    if (operationId === undefined || contract.acceptsBody(operationId)) return payload;
    delete request.headers['content-type'];
    delete request.headers['content-length'];
    delete request.headers['transfer-encoding'];
    payload.resume();
    return Readable.from([]);
  });

  instance.addHook('onSend', async (request, reply, payload) => {
    const headers = headersOf(reply);
    let body: unknown;
    let errors: string[];
    try {
      body = parseBody(payload, headers['content-type']);
      const operationId = operationOf(contract, request);
      errors =
        operationId === undefined
          ? contract.validateProblem(body)
          : contract.validateResponse(operationId, { status: reply.statusCode, headers, body });
    } catch (error) {
      errors = [`resposta ilegivel: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (errors.length === 0) return payload;

    const correlationId = correlationIdOf(request.raw);
    logger.error({ correlation_id: correlationId, contract_violations: errors });
    void reply.status(500).header('content-type', PROBLEM_CONTENT_TYPE);
    return JSON.stringify(buildProblem('INTERNAL_ERROR', instanceOf(request.url), correlationId));
  });
}

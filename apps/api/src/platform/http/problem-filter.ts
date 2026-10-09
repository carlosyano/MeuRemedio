// Toda excecao vira Problem do catalogo fechado (application/problem+json). Falha inesperada:
// 500 INTERNAL_ERROR sem detalhe tecnico na resposta; o detalhe vai so para o log, com
// correlation_id (DEC-026).
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { correlationIdOf, instanceOf } from './correlation.js';
import {
  ProblemError,
  buildProblem,
  type FieldError,
  type ProblemCode,
} from './problem-catalog.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Status HTTP de erros do framework (Nest ou Fastify) -> codigo do catalogo. */
function codeForStatus(status: number): ProblemCode {
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  // JSON malformado, corpo grande demais ou tipo de conteudo nao suportado.
  if (status === 400 || status === 413 || status === 415) return 'VALIDATION_FAILED';
  return 'INTERNAL_ERROR';
}

function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (typeof exception === 'object' && exception !== null && 'statusCode' in exception) {
    const status = exception.statusCode;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const correlationId = correlationIdOf(request.raw);

    let code: ProblemCode;
    let fieldErrors: readonly FieldError[] = [];
    let headers: Readonly<Record<string, string>> = {};
    if (exception instanceof ProblemError) {
      code = exception.code;
      fieldErrors = exception.fieldErrors;
      headers = exception.headers;
    } else {
      const status = statusOf(exception);
      code = status === undefined ? 'INTERNAL_ERROR' : codeForStatus(status);
    }
    if (code === 'INTERNAL_ERROR') {
      this.logger.error(
        {
          correlation_id: correlationId,
          error: exception instanceof Error ? exception.name : typeof exception,
        },
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    const problem = buildProblem(code, instanceOf(request.url), correlationId, fieldErrors);
    void reply.headers(headers).status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE);
    void reply.send(problem);
  }
}

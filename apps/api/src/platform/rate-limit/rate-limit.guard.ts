// Aplica o rate limit (RNF-006) antes da validacao e do handler: operacoes publicas contam por IP
// (20/min); getHealth e isento. O limite por titular (100/min) entra com as sessoes.
// Excedente: 429 RATE_LIMITED com Retry-After.
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '../clock.js';
import type { OpenApiContract } from '../contract/openapi-contract.js';
import { ProblemError } from '../http/problem-catalog.js';
import type { PostgresRateLimiter } from './rate-limiter.js';

const EXEMPT = new Set(['getHealth']);

export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly contract: OpenApiContract,
    private readonly limiter: PostgresRateLimiter,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const operation = this.contract.operationForRoute(request.method, request.routeOptions.url);
    if (operation === undefined || EXEMPT.has(operation.operationId) || !operation.public) {
      return true;
    }
    const decision = await this.limiter.consume('public_ip', request.ip, this.clock.now());
    if (!decision.allowed) {
      throw new ProblemError('RATE_LIMITED', [], {
        'retry-after': String(decision.retryAfterSeconds),
      });
    }
    return true;
  }
}

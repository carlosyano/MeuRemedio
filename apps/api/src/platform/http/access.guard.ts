// Controle de acesso antes da validacao e do handler (ADR-001 v1.5 secao 7; OA-008; RNF-006):
//   - operacao publica: rate limit por IP (20/min); getHealth isento;
//   - operacao privada: sessao valida do cookie mr_session (401), rate limit por titular (100/min)
//     e, nas mutacoes, CSRF por double-submit vinculado a sessao + Origin (ou Sec-Fetch-Site)
//     contra as origens permitidas (403 CSRF_VALIDATION_FAILED).
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type {
  AuthenticatedSession,
  Sessions,
} from '../../modules/identity/application/sessions.js';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  parseCookies,
  sameText,
} from '../../modules/identity/infrastructure/session-cookies.js';
import type { Clock } from '../clock.js';
import type { OpenApiContract } from '../contract/openapi-contract.js';
import type { PostgresRateLimiter } from '../rate-limit/rate-limiter.js';
import { ProblemError } from './problem-catalog.js';

const RATE_LIMIT_EXEMPT = new Set(['getHealth']);
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const sessions = new WeakMap<IncomingMessage, AuthenticatedSession>();

/** Sessao autenticada da requisicao (so em operacoes privadas). */
export function sessionOf(request: FastifyRequest): AuthenticatedSession {
  const session = sessions.get(request.raw);
  if (session === undefined) throw new Error('Requisicao sem sessao autenticada');
  return session;
}

const headerOf = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export class AccessGuard implements CanActivate {
  private readonly origins: ReadonlySet<string>;

  constructor(
    private readonly contract: OpenApiContract,
    private readonly limiter: PostgresRateLimiter,
    private readonly sessionService: Sessions,
    private readonly clock: Clock,
    allowedOrigins: readonly string[],
  ) {
    this.origins = new Set(allowedOrigins);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const operation = this.contract.operationForRoute(request.method, request.routeOptions.url);
    if (operation === undefined) return true;

    if (operation.public) {
      if (!RATE_LIMIT_EXEMPT.has(operation.operationId)) {
        await this.limit('public_ip', request.ip);
      }
      return true;
    }

    const cookies = parseCookies(headerOf(request, 'cookie'));
    const session = await this.sessionService.authenticate(cookies[SESSION_COOKIE]);
    if (session === undefined) throw new ProblemError('AUTHENTICATION_REQUIRED');
    sessions.set(request.raw, session);
    await this.limit('user', session.userId);

    if (MUTATIONS.has(request.method) && !this.csrfValid(request, cookies, session)) {
      throw new ProblemError('CSRF_VALIDATION_FAILED');
    }
    return true;
  }

  private async limit(scope: 'public_ip' | 'user', key: string): Promise<void> {
    const decision = await this.limiter.consume(scope, key, this.clock.now());
    if (!decision.allowed) {
      throw new ProblemError('RATE_LIMITED', [], {
        'retry-after': String(decision.retryAfterSeconds),
      });
    }
  }

  private csrfValid(
    request: FastifyRequest,
    cookies: Record<string, string>,
    session: AuthenticatedSession,
  ): boolean {
    const header = headerOf(request, 'x-csrf-token');
    const cookie = cookies[CSRF_COOKIE];
    if (header === undefined || cookie === undefined || !sameText(header, cookie)) return false;
    // Durante a rotacao, o token pela chave anterior tambem vale (TS-031, DC-065).
    const accepted = this.sessionService.acceptedCsrfTokens(session.sessionId);
    if (!accepted.some((token) => sameText(cookie, token))) return false;
    const origin = headerOf(request, 'origin');
    if (origin !== undefined) return this.origins.has(origin);
    return headerOf(request, 'sec-fetch-site') === 'same-origin';
  }
}

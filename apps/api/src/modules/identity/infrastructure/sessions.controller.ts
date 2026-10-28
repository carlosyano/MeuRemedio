// Rotas de sessao (OpenAPI 02.33.9, tag Sessions).
import { Body, Controller, Delete, Headers, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import { RevokeAllSessions } from '../application/revoke-all-sessions.js';
import { Sessions } from '../application/sessions.js';
import { clearedSessionCookies, sessionCookies } from './session-cookies.js';

@Controller()
export class SessionsController {
  constructor(
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(RevokeAllSessions) private readonly revokeAllSessions: RevokeAllSessions,
  ) {}

  @Post('sessions')
  @OperationId('createSession')
  async create(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const created = await this.sessions.create(body.email, body.password);
    void reply.header('set-cookie', sessionCookies(created.token, created.csrf)).status(201);
    return created.body;
  }

  @Delete('sessions/current')
  @OperationId('deleteCurrentSession')
  async deleteCurrent(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revoke(sessionOf(request).sessionId);
    void reply.header('set-cookie', clearedSessionCookies()).status(204);
  }

  @Post('sessions/revocations')
  @OperationId('revokeAllSessions')
  async revokeAll(
    @Req() request: FastifyRequest,
    @Body() body: { password: string },
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const response = await this.revokeAllSessions.execute({
      userId: sessionOf(request).userId,
      idempotencyKey,
      password: body.password,
    });
    void reply.header('set-cookie', clearedSessionCookies()).status(response.status);
  }
}

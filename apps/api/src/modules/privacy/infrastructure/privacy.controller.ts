// Rotas de privacidade (OpenAPI 02.33.10, tag Privacy).
import { Body, Controller, Get, Headers, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearedSessionCookies } from '../../identity/infrastructure/session-cookies.js';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { correlationIdOf } from '../../../platform/http/correlation.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import { privacySummary, type PrivacySummary } from '../application/privacy-summary.js';
import { RequestAccountDeletion } from '../application/request-account-deletion.js';

/** Token do canal externo de direitos (GX-002); undefined quando a implantacao nao o configurou. */
export const RIGHTS_CHANNEL = Symbol('RIGHTS_CHANNEL');

@Controller()
export class PrivacyController {
  constructor(
    @Inject(RequestAccountDeletion) private readonly deletion: RequestAccountDeletion,
    @Inject(RIGHTS_CHANNEL) private readonly rightsChannel: string | undefined,
  ) {}

  @Get('privacy')
  @OperationId('getPrivacy')
  privacy(): PrivacySummary {
    // Sem canal configurado nao ha resposta valida: o contrato exige external_channel.
    if (this.rightsChannel === undefined) throw new ProblemError('DEPENDENCY_UNAVAILABLE');
    return privacySummary(this.rightsChannel);
  }

  @Post('account-deletions')
  @OperationId('requestAccountDeletion')
  async requestDeletion(
    @Req() request: FastifyRequest,
    @Body() body: { password: string },
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.deletion.execute({
      userId: sessionOf(request).userId,
      idempotencyKey,
      password: body.password,
      correlationId: correlationIdOf(request.raw),
    });
    void reply.header('set-cookie', clearedSessionCookies()).status(response.status);
    return response.body;
  }
}

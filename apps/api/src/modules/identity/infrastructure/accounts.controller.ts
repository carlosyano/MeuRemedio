// Rotas de conta (OpenAPI 02.33.4, tag Accounts).
import { Body, Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { OperationId } from '../../../platform/http/operation-id.js';
import { CreateAccount, type CreateAccountRequest } from '../application/create-account.js';
import { ResendVerification } from '../application/resend-verification.js';
import { VerifyAccount } from '../application/verify-account.js';

@Controller()
export class AccountsController {
  constructor(
    @Inject(CreateAccount) private readonly createAccount: CreateAccount,
    @Inject(VerifyAccount) private readonly verifyAccount: VerifyAccount,
    @Inject(ResendVerification) private readonly resendVerification: ResendVerification,
  ) {}

  @Post('accounts')
  @OperationId('createAccount')
  async create(
    @Body() body: CreateAccountRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.createAccount.execute(idempotencyKey, body);
    void reply.headers(response.headers).status(response.status);
    return response.body;
  }

  @Post('accounts/verify')
  @OperationId('verifyAccount')
  async verify(
    @Body() body: { token: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.verifyAccount.execute(body.token);
    void reply.status(204);
  }

  @Post('accounts/verification-resends')
  @OperationId('resendVerification')
  async resend(
    @Body() body: { email: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ message: string }> {
    const response = await this.resendVerification.execute(body.email);
    void reply.status(202);
    return response;
  }
}

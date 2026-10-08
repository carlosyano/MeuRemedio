// Rotas de conta (OpenAPI 02.33.4, tag Accounts).
import { Body, Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { OperationId } from '../../../platform/http/operation-id.js';
import { CreateAccount, type CreateAccountRequest } from '../application/create-account.js';

@Controller()
export class AccountsController {
  constructor(@Inject(CreateAccount) private readonly createAccount: CreateAccount) {}

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
}

// Rotas de conta (OpenAPI 02.33.4, tag Accounts).
import { Body, Controller, Get, Headers, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import { AccountSettings, type AccessibilityPreferences } from '../application/account-settings.js';
import { CreateAccount, type CreateAccountRequest } from '../application/create-account.js';
import { CurrentAccount } from '../application/current-account.js';
import { ResendVerification } from '../application/resend-verification.js';
import { VerifyAccount } from '../application/verify-account.js';

@Controller()
export class AccountsController {
  constructor(
    @Inject(CreateAccount) private readonly createAccount: CreateAccount,
    @Inject(VerifyAccount) private readonly verifyAccount: VerifyAccount,
    @Inject(ResendVerification) private readonly resendVerification: ResendVerification,
    @Inject(CurrentAccount) private readonly currentAccount: CurrentAccount,
    @Inject(AccountSettings) private readonly settings: AccountSettings,
  ) {}

  @Put('accounts/me')
  @OperationId('updateCurrentAccount')
  async update(@Req() request: FastifyRequest, @Body() body: { name: string }): Promise<unknown> {
    return this.settings.rename(sessionOf(request).userId, body.name);
  }

  @Get('preferences/accessibility')
  @OperationId('getAccessibilityPreferences')
  async preferences(@Req() request: FastifyRequest): Promise<AccessibilityPreferences> {
    return this.settings.preferences(sessionOf(request).userId);
  }

  @Put('preferences/accessibility')
  @OperationId('updateAccessibilityPreferences')
  async replacePreferences(
    @Req() request: FastifyRequest,
    @Body() body: AccessibilityPreferences,
  ): Promise<AccessibilityPreferences> {
    return this.settings.replacePreferences(sessionOf(request).userId, body);
  }

  @Get('accounts/me')
  @OperationId('getCurrentAccount')
  async me(@Req() request: FastifyRequest): Promise<unknown> {
    return this.currentAccount.profile(sessionOf(request).userId);
  }

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

// Rotas de planos (OpenAPI 02.33.10, tag Plans).
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { correlationIdOf } from '../../../platform/http/correlation.js';
import { DEFAULT_PAGE_LIMIT } from '../../../platform/http/keyset-cursor.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import {
  ChangePlanStatus,
  type ChangePlanStatusRequest,
} from '../application/change-plan-status.js';
import { CreatePlan, type CreatePlanRequest } from '../application/create-plan.js';
import { DeletePlan } from '../application/delete-plan.js';
import { ReadPlans, type PlanPage } from '../application/read-plans.js';
import type { PlanView } from '../application/plan-view.js';
import type { PlanWriteRequest } from '../application/plan-write.js';
import { UpdatePlan } from '../application/update-plan.js';

@Controller()
export class PlansController {
  constructor(
    @Inject(CreatePlan) private readonly createPlan: CreatePlan,
    @Inject(ReadPlans) private readonly readPlans: ReadPlans,
    @Inject(UpdatePlan) private readonly updatePlan: UpdatePlan,
    @Inject(DeletePlan) private readonly deletePlan: DeletePlan,
    @Inject(ChangePlanStatus) private readonly changePlanStatus: ChangePlanStatus,
  ) {}

  @Get('plans')
  @OperationId('listPlans')
  async list(
    @Req() request: FastifyRequest,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | number | undefined,
  ): Promise<PlanPage> {
    // O contrato ja validou limit (1..100); a query chega como texto.
    const size = limit === undefined ? DEFAULT_PAGE_LIMIT : Number(limit);
    return this.readPlans.list(sessionOf(request).userId, cursor, size);
  }

  @Post('plans')
  @OperationId('createPlan')
  async create(
    @Req() request: FastifyRequest,
    @Body() body: CreatePlanRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.createPlan.execute(sessionOf(request).userId, idempotencyKey, body);
    void reply.headers(response.headers).status(response.status);
    return response.body;
  }

  @Get('plans/:plan_id')
  @OperationId('getPlan')
  async get(
    @Req() request: FastifyRequest,
    @Param('plan_id') planId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlanView> {
    const { plan, etag } = await this.readPlans.get(
      sessionOf(request).userId,
      planId,
      correlationIdOf(request.raw),
    );
    void reply.header('etag', etag);
    return plan;
  }

  @Put('plans/:plan_id')
  @OperationId('updatePlan')
  async update(
    @Req() request: FastifyRequest,
    @Param('plan_id') planId: string,
    @Body() body: PlanWriteRequest,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.updatePlan.execute({
      userId: sessionOf(request).userId,
      planId,
      ifMatch,
      idempotencyKey,
      correlationId: correlationIdOf(request.raw),
      request: body,
    });
    void reply.headers(response.headers).status(response.status);
    return response.body;
  }

  @Delete('plans/:plan_id')
  @OperationId('deletePlan')
  async remove(
    @Req() request: FastifyRequest,
    @Param('plan_id') planId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.deletePlan.execute({
      userId: sessionOf(request).userId,
      planId,
      correlationId: correlationIdOf(request.raw),
    });
    void reply.status(204);
  }

  @Post('plans/:plan_id/status-changes')
  @OperationId('changePlanStatus')
  async changeStatus(
    @Req() request: FastifyRequest,
    @Param('plan_id') planId: string,
    @Body() body: ChangePlanStatusRequest,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.changePlanStatus.execute({
      userId: sessionOf(request).userId,
      planId,
      ifMatch,
      idempotencyKey,
      correlationId: correlationIdOf(request.raw),
      request: body,
    });
    void reply.headers(response.headers).status(response.status);
    return response.body;
  }
}

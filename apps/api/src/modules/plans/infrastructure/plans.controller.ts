// Rotas de planos (OpenAPI 02.33.4, tag Plans). updatePlan e deletePlan entram em seguida.
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { correlationIdOf } from '../../../platform/http/correlation.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import { CreatePlan, type CreatePlanRequest } from '../application/create-plan.js';
import { DEFAULT_PAGE_LIMIT, ReadPlans, type PlanPage } from '../application/read-plans.js';
import type { PlanView } from '../application/plan-view.js';

@Controller()
export class PlansController {
  constructor(
    @Inject(CreatePlan) private readonly createPlan: CreatePlan,
    @Inject(ReadPlans) private readonly readPlans: ReadPlans,
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
}

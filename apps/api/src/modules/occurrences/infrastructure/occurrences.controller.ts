// Rotas de ocorrencias e respostas (OpenAPI 02.33.9, tag Occurrences).
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
import { commaSeparatedList } from '../../../platform/contract/openapi-contract.js';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { correlationIdOf } from '../../../platform/http/correlation.js';
import { DEFAULT_PAGE_LIMIT } from '../../../platform/http/keyset-cursor.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import {
  CreateResponse,
  type CreateResponseRequest,
} from '../../responses/application/create-response.js';
import {
  ReadOccurrences,
  type OccurrencePage,
  type OccurrenceStatus,
} from '../application/read-occurrences.js';

@Controller()
export class OccurrencesController {
  constructor(
    @Inject(ReadOccurrences) private readonly readOccurrences: ReadOccurrences,
    @Inject(CreateResponse) private readonly createResponse: CreateResponse,
  ) {}

  @Get('occurrences')
  @OperationId('listOccurrences')
  async list(
    @Req() request: FastifyRequest,
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | number | undefined,
    @Query('local_date') localDate: string | undefined,
  ): Promise<OccurrencePage> {
    // O contrato ja validou status (enum, ate 5), cursor, limit (1..100) e local_date (data civil);
    // a query chega como texto.
    const statuses = commaSeparatedList(status) as OccurrenceStatus[] | undefined;
    return this.readOccurrences.list(
      sessionOf(request).userId,
      { statuses, cursor, localDate },
      limit === undefined ? DEFAULT_PAGE_LIMIT : Number(limit),
    );
  }

  @Post('occurrences/:occurrence_id/responses')
  @OperationId('createResponse')
  async respond(
    @Req() request: FastifyRequest,
    @Param('occurrence_id') occurrenceId: string,
    @Body() body: CreateResponseRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.createResponse.execute({
      userId: sessionOf(request).userId,
      occurrenceId,
      idempotencyKey,
      correlationId: correlationIdOf(request.raw),
      request: body,
    });
    void reply.headers(response.headers).status(response.status);
    return response.body;
  }
}

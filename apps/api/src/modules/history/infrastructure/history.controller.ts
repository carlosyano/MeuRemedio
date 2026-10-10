// Rota do historico (OpenAPI 02.33.4, tag History).
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { sessionOf } from '../../../platform/http/access.guard.js';
import { DEFAULT_PAGE_LIMIT } from '../../../platform/http/keyset-cursor.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import { ReadHistory, type HistoryPage } from '../application/read-history.js';

@Controller()
export class HistoryController {
  constructor(@Inject(ReadHistory) private readonly readHistory: ReadHistory) {}

  @Get('history')
  @OperationId('getHistory')
  async list(
    @Req() request: FastifyRequest,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | number | undefined,
  ): Promise<HistoryPage> {
    // O contrato ja validou start e end (datas obrigatorias), cursor e limit (1..100).
    return this.readHistory.list(
      sessionOf(request).userId,
      { start, end, cursor },
      limit === undefined ? DEFAULT_PAGE_LIMIT : Number(limit),
    );
  }
}

// Rotas de exportacao (OpenAPI 02.33.7, tag Exports).
import {
  Body,
  Controller,
  Delete,
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
import { DEFAULT_PAGE_LIMIT } from '../../../platform/http/keyset-cursor.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import {
  Exports,
  type CreateExportRequest,
  type ExportPage,
  type ExportView,
} from '../application/exports.js';

@Controller()
export class ExportsController {
  constructor(@Inject(Exports) private readonly exports: Exports) {}

  @Get('exports')
  @OperationId('listExports')
  async list(
    @Req() request: FastifyRequest,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | number | undefined,
  ): Promise<ExportPage> {
    // O contrato ja validou limit (1..100); a query chega como texto.
    const size = limit === undefined ? DEFAULT_PAGE_LIMIT : Number(limit);
    return this.exports.list(sessionOf(request).userId, cursor, size);
  }

  @Post('exports')
  @OperationId('createExport')
  async create(
    @Req() request: FastifyRequest,
    @Body() body: CreateExportRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const response = await this.exports.create(sessionOf(request).userId, idempotencyKey, body);
    void reply.headers(response.headers).status(response.status);
    return response.body;
  }

  @Get('exports/:export_id')
  @OperationId('getExport')
  async get(
    @Req() request: FastifyRequest,
    @Param('export_id') exportId: string,
  ): Promise<ExportView> {
    return this.exports.get(sessionOf(request).userId, exportId, correlationIdOf(request.raw));
  }

  @Delete('exports/:export_id')
  @OperationId('cancelExport')
  async cancel(
    @Req() request: FastifyRequest,
    @Param('export_id') exportId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.exports.cancel(sessionOf(request).userId, exportId, correlationIdOf(request.raw));
    void reply.status(204);
  }

  @Get('exports/:export_id/file')
  @OperationId('downloadExport')
  async download(
    @Req() request: FastifyRequest,
    @Param('export_id') exportId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.exports.download(
      sessionOf(request).userId,
      exportId,
      correlationIdOf(request.raw),
    );
    void reply.headers({
      'content-type': 'application/pdf',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${file.filename}"`,
    });
    return file.body;
  }
}

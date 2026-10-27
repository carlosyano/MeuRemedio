// getHealth (OpenAPI 02.33.9, RNF-015, DEC-028): sonda o PostgreSQL com tempo-limite e compara o
// Clock da API com o now() do banco.
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CLOCK, type Clock } from '../../../platform/clock.js';
import { DATABASE, type Queryable } from '../../../platform/database.js';
import { OperationId } from '../../../platform/http/operation-id.js';
import {
  HEALTH_SETTINGS,
  assessHealth,
  httpStatusFor,
  type HealthSettings,
  type HealthStatus,
} from '../application/health.js';

export interface Health {
  readonly status: HealthStatus;
  readonly time: string;
}

@Controller()
export class HealthController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DATABASE) private readonly database: Queryable,
    @Inject(HEALTH_SETTINGS) private readonly settings: HealthSettings,
  ) {}

  @Get('health')
  @OperationId('getHealth')
  async getHealth(@Res({ passthrough: true }) reply: FastifyReply): Promise<Health> {
    const databaseNowMs = await this.databaseNow();
    const time = this.clock.now();
    const status = assessHealth(Date.parse(time), databaseNowMs, this.settings.clockSkewMaxMs);
    void reply.status(httpStatusFor(status));
    return { status, time };
  }

  /** now() do PostgreSQL em ms, ou undefined se o banco falhar ou passar do tempo-limite. */
  private async databaseNow(): Promise<number | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, this.settings.probeTimeoutMs, undefined);
    });
    const probe = this.database
      .query('SELECT clock_timestamp() AS now')
      .then(({ rows }) => {
        const value = (rows[0] as { now?: unknown } | undefined)?.now;
        return value instanceof Date ? value.getTime() : undefined;
      })
      .catch(() => undefined);
    try {
      return await Promise.race([probe, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

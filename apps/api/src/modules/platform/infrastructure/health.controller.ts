// getHealth (OpenAPI 02.33.4, RNF-015). Nesta etapa responde UP com o instante do Clock.
// DEGRADED (desvio de relogio acima de CLOCK_SKEW_MAX_MS) e DOWN aguardam decisao: a
// Especificacao nao define a referencia do desvio, o status HTTP de DEGRADED nem o criterio de DOWN.
import { Controller, Get, Inject } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../platform/clock.js';
import { OperationId } from '../../../platform/http/operation-id.js';

export interface Health {
  readonly status: 'UP' | 'DEGRADED' | 'DOWN';
  readonly time: string;
}

@Controller()
export class HealthController {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  @Get('health')
  @OperationId('getHealth')
  getHealth(): Health {
    return { status: 'UP', time: this.clock.now() };
  }
}

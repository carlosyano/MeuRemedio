// Montagem da API HTTP (NestJS + Fastify, ADR-001 v1.5). Contract-first: as rotas declaradas
// pelos controllers sao conferidas contra a OpenAPI normativa antes de a aplicacao subir.
import 'reflect-metadata';
import { Module, RequestMethod, type DynamicModule, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEFAULT_CLOCK_SKEW_MAX_MS,
  DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
  HEALTH_SETTINGS,
  type HealthSettings,
} from './modules/platform/application/health.js';
import { HealthController } from './modules/platform/infrastructure/health.controller.js';
import { CLOCK, type Clock } from './platform/clock.js';
import { OpenApiContract, locateNormativeOpenApi } from './platform/contract/openapi-contract.js';
import { assertRoutesMatchContract, type DeclaredRoute } from './platform/contract/route-check.js';
import { DATABASE, type Queryable } from './platform/database.js';
import {
  ContractRequestInterceptor,
  registerContractHooks,
} from './platform/http/contract-enforcement.js';
import { OPERATION_ID } from './platform/http/operation-id.js';
import { ProblemFilter } from './platform/http/problem-filter.js';

const CONTROLLERS: Type[] = [HealthController];

export interface CreateAppOptions {
  readonly clock: Clock;
  /** PostgreSQL (pg.Pool). */
  readonly database: Queryable;
  /** CLOCK_SKEW_MAX_MS (RNF-015); padrao 5000. */
  readonly clockSkewMaxMs?: number;
  /** Tempo-limite da sondagem do banco em getHealth (DEC-028); padrao 2000. */
  readonly healthProbeTimeoutMs?: number;
  /** Contrato ja carregado; por padrao, a OpenAPI normativa da raiz do repositorio. */
  readonly contract?: OpenApiContract;
  /** false desliga os logs (testes). */
  readonly logger?: false;
}

@Module({})
class AppModule {
  static forRoot(options: CreateAppOptions): DynamicModule {
    const health: HealthSettings = {
      clockSkewMaxMs: options.clockSkewMaxMs ?? DEFAULT_CLOCK_SKEW_MAX_MS,
      probeTimeoutMs: options.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
    };
    return {
      module: AppModule,
      imports: [DiscoveryModule],
      controllers: CONTROLLERS,
      providers: [
        { provide: CLOCK, useValue: options.clock },
        { provide: DATABASE, useValue: options.database },
        { provide: HEALTH_SETTINGS, useValue: health },
      ],
    };
  }
}

const joinPath = (...parts: unknown[]): string =>
  `/${parts
    .flatMap((part) => (typeof part === 'string' ? [part] : []))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/')}`;

/** Rotas declaradas pelos controllers, com o operationId de cada handler. */
function declaredRoutes(app: NestFastifyApplication): DeclaredRoute[] {
  const scanner = new MetadataScanner();
  const routes: DeclaredRoute[] = [];
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const metatype: unknown = wrapper.metatype;
    const instance: unknown = wrapper.instance;
    if (typeof metatype !== 'function' || typeof instance !== 'object' || instance === null) {
      continue;
    }
    const prototype = Object.getPrototypeOf(instance) as object;
    const base: unknown = Reflect.getMetadata(PATH_METADATA, metatype);
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (path === undefined || typeof method !== 'number') continue;
      const operationId: unknown = Reflect.getMetadata(OPERATION_ID, handler);
      routes.push({
        method: RequestMethod[method] ?? String(method),
        path: joinPath(base, path),
        operationId: typeof operationId === 'string' ? operationId : undefined,
        handler: `${metatype.name}.${name}`,
      });
    }
  }
  return routes;
}

export async function createApp(options: CreateAppOptions): Promise<NestFastifyApplication> {
  const contract = options.contract ?? OpenApiContract.load(locateNormativeOpenApi());
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(options),
    // HEAD automatico criaria rotas fora do contrato.
    new FastifyAdapter({ exposeHeadRoutes: false }),
    options.logger === false ? { logger: false } : {},
  );
  assertRoutesMatchContract(declaredRoutes(app), contract);
  registerContractHooks(app.getHttpAdapter().getInstance(), contract);
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalInterceptors(new ContractRequestInterceptor(contract));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

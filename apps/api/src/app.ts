// Montagem da API HTTP (NestJS + Fastify, ADR-001 v1.5). Contract-first: as rotas declaradas
// pelos controllers sao conferidas contra a OpenAPI normativa antes de a aplicacao subir.
import 'reflect-metadata';
import { Module, RequestMethod, type DynamicModule, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Pool } from 'pg';
import { CreateAccount } from './modules/identity/application/create-account.js';
import { CurrentAccount } from './modules/identity/application/current-account.js';
import { LoginThrottle } from './modules/identity/application/login-throttle.js';
import { Sessions } from './modules/identity/application/sessions.js';
import { ResendVerification } from './modules/identity/application/resend-verification.js';
import { VerifyAccount } from './modules/identity/application/verify-account.js';
import { AccountsController } from './modules/identity/infrastructure/accounts.controller.js';
import { loadCompromisedPasswords } from './modules/identity/infrastructure/compromised-passwords.js';
import { argon2idPasswordHasher } from './modules/identity/infrastructure/password-hasher.js';
import { SessionsController } from './modules/identity/infrastructure/sessions.controller.js';
import {
  DEFAULT_CLOCK_SKEW_MAX_MS,
  DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
  HEALTH_SETTINGS,
  type HealthSettings,
} from './modules/platform/application/health.js';
import { HealthController } from './modules/platform/infrastructure/health.controller.js';
import { CreatePlan } from './modules/plans/application/create-plan.js';
import { DeletePlan } from './modules/plans/application/delete-plan.js';
import { ReadPlans } from './modules/plans/application/read-plans.js';
import { UpdatePlan } from './modules/plans/application/update-plan.js';
import { PlansController } from './modules/plans/infrastructure/plans.controller.js';
import { CLOCK, type Clock } from './platform/clock.js';
import { OpenApiContract, locateNormativeOpenApi } from './platform/contract/openapi-contract.js';
import { assertRoutesMatchContract, type DeclaredRoute } from './platform/contract/route-check.js';
import { DATABASE, type Queryable } from './platform/database.js';
import {
  ContractRequestInterceptor,
  registerContractHooks,
} from './platform/http/contract-enforcement.js';
import { AccessGuard } from './platform/http/access.guard.js';
import { OPERATION_ID } from './platform/http/operation-id.js';
import { ProblemFilter } from './platform/http/problem-filter.js';
import { createRequestHasher } from './platform/idempotency/idempotency.js';
import { PostgresRateLimiter } from './platform/rate-limit/rate-limiter.js';

const CONTROLLERS: Type[] = [
  HealthController,
  AccountsController,
  SessionsController,
  PlansController,
];

export interface CreateAppOptions {
  readonly clock: Clock;
  /** PostgreSQL. */
  readonly database: Pool;
  /** Banco sondado por getHealth; por padrao, `database` (os testes trocam por um que trava). */
  readonly healthProbeDatabase?: Queryable;
  /** Segredos do servidor (Secrets Manager em producao). */
  readonly secrets: {
    /** Chave do HMAC do hash de requisicao idempotente (DC-012), 32 bytes ou mais. */
    readonly requestHashKey: Buffer;
    /** Pepper do HMAC do e-mail normalizado (bloqueio de login, DEC-016; tombstone, RN-019). */
    readonly emailPepper: Buffer;
    /** Chave do HMAC do token CSRF vinculado a sessao (OA-008). */
    readonly csrfKey: Buffer;
  };
  /** Origens aceitas no cabecalho Origin das mutacoes autenticadas (OA-008). */
  readonly allowedOrigins: readonly string[];
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
  static forRoot(options: CreateAppOptions, sessions: Sessions): DynamicModule {
    const health: HealthSettings = {
      clockSkewMaxMs: options.clockSkewMaxMs ?? DEFAULT_CLOCK_SKEW_MAX_MS,
      probeTimeoutMs: options.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
    };
    const hashRequest = createRequestHasher(options.secrets.requestHashKey);
    return {
      module: AppModule,
      imports: [DiscoveryModule],
      controllers: CONTROLLERS,
      providers: [
        { provide: CLOCK, useValue: options.clock },
        { provide: DATABASE, useValue: options.healthProbeDatabase ?? options.database },
        { provide: HEALTH_SETTINGS, useValue: health },
        {
          provide: CreateAccount,
          useValue: new CreateAccount(
            options.database,
            options.clock,
            hashRequest,
            argon2idPasswordHasher,
            loadCompromisedPasswords(),
          ),
        },
        { provide: VerifyAccount, useValue: new VerifyAccount(options.database, options.clock) },
        { provide: CurrentAccount, useValue: new CurrentAccount(options.database) },
        { provide: Sessions, useValue: sessions },
        {
          provide: ResendVerification,
          useValue: new ResendVerification(options.database, options.clock),
        },
        {
          provide: CreatePlan,
          useValue: new CreatePlan(options.database, options.clock, hashRequest),
        },
        { provide: ReadPlans, useValue: new ReadPlans(options.database, options.clock) },
        {
          provide: UpdatePlan,
          useValue: new UpdatePlan(options.database, options.clock, hashRequest),
        },
        { provide: DeletePlan, useValue: new DeletePlan(options.database, options.clock) },
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
  const sessions = new Sessions(
    options.database,
    options.clock,
    argon2idPasswordHasher,
    new LoginThrottle(options.database, options.secrets.emailPepper),
    options.secrets.csrfKey,
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(options, sessions),
    // HEAD automatico criaria rotas fora do contrato.
    new FastifyAdapter({ exposeHeadRoutes: false }),
    options.logger === false ? { logger: false } : {},
  );
  assertRoutesMatchContract(declaredRoutes(app), contract);
  registerContractHooks(app.getHttpAdapter().getInstance(), contract);
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalGuards(
    new AccessGuard(
      contract,
      new PostgresRateLimiter(options.database),
      sessions,
      options.clock,
      options.allowedOrigins,
    ),
  );
  app.useGlobalInterceptors(new ContractRequestInterceptor(contract));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

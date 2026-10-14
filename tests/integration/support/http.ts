// Harness HTTP compartilhado: PostgreSQL 17 real, API montada com Clock ajustavel e segredos
// sinteticos, chamadas por inject do Fastify com a resposta conferida contra a OpenAPI.
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { expect } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import { argon2idPasswordHasher } from '../../../apps/api/src/modules/identity/infrastructure/password-hasher.js';
import type { Clock } from '../../../apps/api/src/platform/clock.js';
import {
  OpenApiContract,
  locateNormativeOpenApi,
} from '../../../apps/api/src/platform/contract/openapi-contract.js';
import { migrate } from '../../../apps/api/src/platform/migrate.js';
import { MemoryObjectStorage } from '../../../apps/api/src/platform/storage/object-storage.js';
import { startPostgres, type PostgresHandle } from '../../../packages/testkit/src/index.js';

export const ORIGIN = 'https://app.example.invalid';
export const PASSWORD = 'Senha-Sintetica-2026';
/** Canal externo de direitos (GX-002) sintetico, exposto por getPrivacy. */
export const RIGHTS_CHANNEL = 'https://privacidade.example.invalid/direitos';

export interface HttpResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  /** Cada Set-Cookie separado. */
  readonly cookies: string[];
  readonly body: unknown;
  /** Corpo bruto (ex.: o PDF de downloadExport). */
  readonly raw: Buffer;
}

export interface CallOptions {
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly remoteAddress?: string;
  /** Desliga a conferencia da resposta contra a OpenAPI (rotas fora do contrato). */
  readonly unchecked?: boolean;
}

export interface Harness {
  readonly pool: pg.Pool;
  /** Armazenamento privado de arquivos em memoria, compartilhado pela API e pelo worker. */
  readonly storage: MemoryObjectStorage;
  /** URL do banco isolado da suite (ex.: para o pg-boss do worker). */
  readonly url: string;
  readonly app: NestFastifyApplication;
  readonly contract: OpenApiContract;
  now: string;
  call(
    operationId: string,
    method: string,
    url: string,
    options?: CallOptions,
  ): Promise<HttpResult>;
  /** Conta ACTIVE com a senha PASSWORD; devolve o id. */
  activeUser(email: string): Promise<string>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

const contract = OpenApiContract.load(locateNormativeOpenApi());
let ipSequence = 0;

/** IP de documentacao diferente por chamada (o rate limit por IP nao vaza entre cenarios). */
export const nextIp = (): string => {
  ipSequence += 1;
  return `198.51.${String(Math.floor(ipSequence / 250) % 250)}.${String((ipSequence % 250) + 1)}`;
};

export async function startHarness(now = '2026-10-05T11:05:15Z'): Promise<Harness> {
  const db: PostgresHandle = await startPostgres();
  const pool = new pg.Pool({ connectionString: db.url, max: 8 });
  await migrate(pool);
  const state = { now };
  const clock: Clock = { now: () => state.now };
  const storage = new MemoryObjectStorage();
  const app = await createApp({
    clock,
    database: pool,
    storage,
    logger: false,
    allowedOrigins: [ORIGIN],
    externalRightsChannel: RIGHTS_CHANNEL,
    secrets: {
      requestHashKey: randomBytes(32),
      emailPepper: randomBytes(32),
      csrfKey: randomBytes(32),
    },
  });

  const harness: Harness = {
    pool,
    storage,
    url: db.url,
    app,
    contract,
    get now() {
      return state.now;
    },
    set now(value: string) {
      state.now = value;
    },
    async call(operationId, method, url, options = {}) {
      const headers: Record<string, string> = { ...options.headers };
      if (options.body !== undefined) headers['content-type'] ??= 'application/json';
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: method as 'GET',
          url,
          headers,
          remoteAddress: options.remoteAddress ?? nextIp(),
          ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
        });
      const raw = response.headers['set-cookie'];
      const result: HttpResult = {
        status: response.statusCode,
        headers: Object.fromEntries(
          Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
        ),
        cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
        body:
          response.body === ''
            ? undefined
            : String(response.headers['content-type']).includes('json')
              ? response.json<unknown>()
              : response.body,
        raw: response.rawPayload,
      };
      if (options.unchecked !== true) {
        expect(contract.validateResponse(operationId, result), JSON.stringify(result.body)).toEqual(
          [],
        );
      }
      return result;
    },
    async activeUser(email) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO users (name, email_normalized, password_hash, status, account_timezone,
           terms_version, privacy_notice_version, terms_accepted_at, privacy_acknowledged_at,
           verified_at)
         VALUES ('Ana Silva', $1, $2, 'ACTIVE', 'America/Sao_Paulo', '2026-10', '2026-10',
           '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z', '2026-10-01T10:05:00Z')
         RETURNING id`,
        [email, await argon2idPasswordHasher.hash(PASSWORD)],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('INSERT em users nao retornou id');
      return id;
    },
    async truncate() {
      await pool.query(
        `TRUNCATE users, idempotency_records, outbox_events, rate_limit_counters,
                  login_failure_counters CASCADE`,
      );
      storage.clear();
    },
    async close() {
      await app.close();
      await pool.end();
      await db.stop();
    },
  };
  return harness;
}

/** Valor de um cookie (nome=valor) entre os Set-Cookie da resposta. */
export function cookieValue(cookies: readonly string[], name: string): string | undefined {
  const line = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

/** Atributos de um Set-Cookie, em minusculas, sem o par nome=valor. */
export function cookieAttributes(cookies: readonly string[], name: string): string[] {
  const line = cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
  return line
    .split(';')
    .slice(1)
    .map((attribute) => attribute.trim().toLowerCase());
}

export interface LoggedIn {
  readonly sessionCookie: string;
  readonly csrf: string;
  readonly sessionId: string;
  /** Cabecalhos de uma mutacao autenticada valida (cookie, X-CSRF-Token e Origin). */
  readonly mutation: Record<string, string>;
  /** Cabecalhos de uma leitura autenticada. */
  readonly read: Record<string, string>;
}

export async function login(
  harness: Harness,
  email: string,
  password = PASSWORD,
): Promise<LoggedIn> {
  const response = await harness.call('createSession', 'POST', '/sessions', {
    body: { email, password },
  });
  expect(response.status).toBe(201);
  const session = cookieValue(response.cookies, 'mr_session');
  const csrf = cookieValue(response.cookies, 'mr_csrf');
  if (session === undefined || csrf === undefined) throw new Error('login sem cookies');
  const cookie = `mr_session=${session}; mr_csrf=${csrf}`;
  return {
    sessionCookie: session,
    csrf,
    sessionId: (response.body as { session_id: string }).session_id,
    read: { cookie },
    mutation: { cookie, 'x-csrf-token': csrf, origin: ORIGIN },
  };
}

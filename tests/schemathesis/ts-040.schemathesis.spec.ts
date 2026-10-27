// @trace TS-040 RNF-014 RNF-016 (Especificacao 02.33 secao 13; AGENTS.md secoes 13 e 14; QG-001)
// TS-040, verificacao 4: Schemathesis contra a API em execucao (PostgreSQL 17 real, HTTP de verdade)
// nas 29 operacoes da OpenAPI. Reprova se houver 5xx, status nao documentado, Content-Type, cabecalho
// ou corpo fora do contrato, dado invalido aceito ou rota privada sem autenticacao (DC-047).
//   - fase 1: todas as operacoes, exceto as tres que encerram a sessao, com uma sessao valida;
//   - fase 2: deleteCurrentSession com sessao propria (o primeiro sucesso a encerra e o restante
//     recebe 401, documentado); revokeAllSessions e requestAccountDeletion com a sessao da fase 1
//     (a senha gerada nunca e a do titular, entao elas nao revogam nada);
//   - limites de rate limit elevados so aqui, para o 429 nao encobrir as demais respostas.
// Requer o Schemathesis fixado em tools/schemathesis/requirements.txt (SCHEMATHESIS_BIN ou PATH).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { argon2idPasswordHasher } from '../../apps/api/src/modules/identity/infrastructure/password-hasher.js';
import { systemClock } from '../../apps/api/src/platform/clock.js';
import { locateNormativeOpenApi } from '../../apps/api/src/platform/contract/openapi-contract.js';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { MemoryObjectStorage } from '../../apps/api/src/platform/storage/object-storage.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';

const EMAIL = 'ana.silva@example.com';
const PASSWORD = 'Senha-Sintetica-2026';
const SESSION_ENDERS = ['deleteCurrentSession', 'revokeAllSessions', 'requestAccountDeletion'];
const CHECKS = [
  'not_a_server_error',
  'status_code_conformance',
  'content_type_conformance',
  'response_headers_conformance',
  'response_schema_conformance',
  'negative_data_rejection',
  'ignored_auth',
].join(',');

let db: PostgresHandle;
let pool: pg.Pool;
let app: NestFastifyApplication;
let baseUrl: string;
const reportDir = mkdtempSync(join(tmpdir(), 'schemathesis-'));
/** Sessoes abertas antes de qualquer chamada do Schemathesis: senhas aleatorias nas operacoes de
 * reautenticacao bloqueiam o login do titular por 15 min (RN-005). */
const sessions = new Map<string, string[]>();

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
  await migrate(pool);
  app = await createApp({
    clock: systemClock,
    database: pool,
    storage: new MemoryObjectStorage(),
    logger: false,
    // Origem da propria API: o Schemathesis envia Origin igual a ela nas mutacoes.
    allowedOrigins: ['http://127.0.0.1'],
    externalRightsChannel: 'https://privacidade.example.invalid/direitos',
    rateLimits: { public_ip: 100_000, user: 100_000 },
    secrets: {
      requestHashKey: randomBytes(32),
      emailPepper: randomBytes(32),
      csrfKey: randomBytes(32),
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.getHttpAdapter().getInstance().server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(port)}`;
  await pool.query(
    `INSERT INTO users (name, email_normalized, password_hash, status, account_timezone,
       terms_version, privacy_notice_version, terms_accepted_at, privacy_acknowledged_at,
       verified_at)
     VALUES ('Ana Silva', $1, $2, 'ACTIVE', 'America/Sao_Paulo', '2026-10', '2026-10',
       now(), now(), now())`,
    [EMAIL, await argon2idPasswordHasher.hash(PASSWORD)],
  );
  // Limite de 3 sessoes ativas por titular (RN-004): uma principal e uma para deleteCurrentSession.
  sessions.set('principal', await sessionHeaders());
  sessions.set('deleteCurrentSession', await sessionHeaders());
}, 180_000);

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.stop();
});

/** Cabecalhos de uma sessao nova do titular (cookie, CSRF e Origin). */
async function sessionHeaders(): Promise<string[]> {
  const response = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(response.status).toBe(201);
  const cookies = response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0] ?? '')
    .filter((pair) => pair.startsWith('mr_session=') || pair.startsWith('mr_csrf='));
  const csrf = cookies.find((pair) => pair.startsWith('mr_csrf='))?.slice('mr_csrf='.length);
  if (cookies.length !== 2 || csrf === undefined) throw new Error('login sem cookies');
  return [`Cookie: ${cookies.join('; ')}`, `X-CSRF-Token: ${csrf}`, 'Origin: http://127.0.0.1'];
}

async function schemathesis(name: string, filter: readonly string[]): Promise<void> {
  const headers = sessions.get(name.replace(/^fase-2-/, '')) ?? sessions.get('principal') ?? [];
  const bin = process.env['SCHEMATHESIS_BIN'] ?? 'schemathesis';
  const args = [
    'run',
    fileURLToPath(locateNormativeOpenApi()),
    '--url',
    baseUrl,
    '--checks',
    CHECKS,
    '--phases',
    'examples,coverage,fuzzing',
    '--max-examples',
    '25',
    '--seed',
    '20261014',
    '--generation-database',
    'none',
    // Cookie e X-CSRF-Token vem da sessao (-H); a falta deles e testada pelo check ignored_auth.
    '--generation-with-security-parameters',
    'false',
    '--workers',
    '1',
    '--no-color',
    '--report',
    'junit',
    '--report-junit-path',
    join(reportDir, `${name}.xml`),
    ...headers.flatMap((header) => ['-H', header]),
    ...filter,
  ];
  // Assincrono: a API roda neste mesmo processo e precisa do event loop livre para responder.
  const child = spawn(bin, args, {
    // Saida em UTF-8 tambem no console do Windows.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const status = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  expect(status, output).toBe(0);
}

describe('TS-040 Schemathesis nas 29 operacoes', () => {
  it('fase 1: todas as operacoes, exceto as que encerram a sessao', async () => {
    await schemathesis(
      'fase-1',
      SESSION_ENDERS.flatMap((id) => ['--exclude-operation-id', id]),
    );
  }, 1_800_000);

  it.each(SESSION_ENDERS)(
    'fase 2: %s com sessao propria',
    async (operationId) => {
      await schemathesis(`fase-2-${operationId}`, ['--include-operation-id', operationId]);
    },
    1_800_000,
  );
});

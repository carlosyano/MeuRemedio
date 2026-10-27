// @trace getHealth RNF-015 (imagens de container da API, do worker e da web, DC-070)
// Constroi as imagens do Dockerfile da raiz e as sobe contra um PostgreSQL 17 real numa rede
// Docker isolada: a migracao aplica e e idempotente, a API responde getHealth, o worker fica no
// ar, a web serve a entrada e encaminha /api/* a API, e nenhum processo roda como root.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const suffix = randomBytes(4).toString('hex');
const NETWORK = `mr-net-${suffix}`;
const DB = `mr-db-${suffix}`;
const API = `mr-api-${suffix}`;
const WORKER = `mr-worker-${suffix}`;
const WEB = `mr-web-${suffix}`;
const API_IMAGE = `meuremedio-api:test-${suffix}`;
const WEB_IMAGE = `meuremedio-web:test-${suffix}`;

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const secret = (): string => randomBytes(32).toString('base64');
const DATABASE_URL = `postgres://postgres:postgres@${DB}:5432/meuremedio`;
const apiEnv = [
  `DATABASE_URL=${DATABASE_URL}`,
  'ALLOWED_ORIGINS=http://localhost:3001',
  'RIGHTS_CHANNEL_URL=https://example.com/privacidade',
  `REQUEST_HASH_KEY=${secret()}`,
  `EMAIL_PEPPER=${secret()}`,
  `CSRF_KEY=${secret()}`,
].flatMap((pair) => ['-e', pair]);

const hostPort = (container: string, port: number): string =>
  docker('port', container, `${String(port)}/tcp`)
    .split('\n')[0]
    ?.split(':')
    .pop() ?? '';

const waitFor = async (url: string, timeoutMs: number): Promise<Response> => {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Sem resposta de ${url}: ${String(last)}`);
};

const running = (container: string): boolean =>
  docker('inspect', '-f', '{{.State.Running}}', container).trim() === 'true';

const uid = (container: string): string => docker('exec', container, 'id', '-u').trim();

describe('imagens de container', () => {
  beforeAll(() => {
    docker('build', '--target', 'api', '-t', API_IMAGE, '.');
    docker(
      'build',
      '--target',
      'web',
      '--build-arg',
      `MEUREMEDIO_API_URL=http://${API}:3000`,
      '-t',
      WEB_IMAGE,
      '.',
    );
    docker('network', 'create', NETWORK);
    docker(
      'run',
      '-d',
      '--name',
      DB,
      '--network',
      NETWORK,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-e',
      'POSTGRES_DB=meuremedio',
      'postgres:17',
    );
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        docker('exec', DB, 'pg_isready', '-U', 'postgres', '-d', 'meuremedio');
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        execFileSync('sleep', ['1']);
      }
    }
  });

  afterAll(() => {
    for (const container of [WEB, WORKER, API, DB]) {
      try {
        docker('rm', '-f', container);
      } catch {
        // ja removido
      }
    }
    for (const args of [
      ['network', 'rm', NETWORK],
      ['image', 'rm', '-f', API_IMAGE, WEB_IMAGE],
    ]) {
      try {
        docker(...args);
      } catch {
        // ja removido
      }
    }
  });

  it('a migracao aplica todas as migracoes e a segunda execucao nao aplica nada', () => {
    const run = () =>
      docker(
        'run',
        '--rm',
        '--network',
        NETWORK,
        '-e',
        `DATABASE_URL=${DATABASE_URL}`,
        API_IMAGE,
        'node',
        'apps/api/dist/migrate-main.js',
      );

    const first = JSON.parse(run()) as { applied: string[]; skipped: string[] };
    expect(first.applied.length).toBeGreaterThan(0);
    expect(first.applied[0]).toBe('0001_core.sql');

    const second = JSON.parse(run()) as { applied: string[]; skipped: string[] };
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
  });

  it('a API responde getHealth com X-Correlation-ID, sem rodar como root', async () => {
    docker('run', '-d', '--name', API, '--network', NETWORK, '-p', '3000', ...apiEnv, API_IMAGE);

    const response = await waitFor(`http://127.0.0.1:${hostPort(API, 3000)}/health`, 60_000);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(((await response.json()) as { status: string }).status).toBe('UP');
    expect(uid(API)).not.toBe('0');
  });

  it('o worker sobe da mesma imagem e continua no ar, sem rodar como root', async () => {
    docker(
      'run',
      '-d',
      '--name',
      WORKER,
      '--network',
      NETWORK,
      '-e',
      `DATABASE_URL=${DATABASE_URL}`,
      '-e',
      `EMAIL_PEPPER=${secret()}`,
      '-e',
      'WEB_BASE_URL=http://localhost:3001',
      API_IMAGE,
      'node',
      'apps/api/dist/worker-main.js',
    );

    await new Promise((resolve) => setTimeout(resolve, 5_000));

    expect(running(WORKER)).toBe(true);
    expect(uid(WORKER)).not.toBe('0');
  });

  it('a web serve a entrada com CSP e encaminha /api/* a API, sem rodar como root', async () => {
    docker(
      'run',
      '-d',
      '--name',
      WEB,
      '--network',
      NETWORK,
      '-p',
      '3001',
      '-e',
      `MEUREMEDIO_API_URL=http://${API}:3000`,
      WEB_IMAGE,
    );
    const origin = `http://127.0.0.1:${hostPort(WEB, 3001)}`;

    const page = await waitFor(`${origin}/entrar`, 60_000);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain('nonce-');

    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(uid(WEB)).not.toBe('0');
  });
});

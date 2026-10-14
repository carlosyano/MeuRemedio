// Ambiente dos testes E2E (QG-007/QG-008; DC-052): PostgreSQL 17 real (Testcontainers), a API
// compilada (apps/api/dist, com decorators ja transpilados) escutando em API_PORT e a aplicacao
// web em modo de producao (next build + next start) em WEB_PORT, com /api/* encaminhado a API.
// O rate limit fica elevado (a suite inteira sai do mesmo IP); os demais limites seguem os reais.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const WEB_PORT = 3100;
export const API_PORT = 3101;
export const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;

const root = fileURLToPath(new URL('../../../', import.meta.url));

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} falhou`);
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} nao respondeu em ${String(timeoutMs)} ms`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const node = process.execPath;
  run(node, ['node_modules/typescript/bin/tsc', '-b']);

  type Testkit = typeof import('../../../packages/testkit/src/index.js');
  type AppModule = typeof import('../../../apps/api/src/app.js');
  type MigrateModule = typeof import('../../../apps/api/src/platform/migrate.js');
  type ClockModule = typeof import('../../../apps/api/src/platform/clock.js');
  type StorageModule = typeof import('../../../apps/api/src/platform/storage/object-storage.js');
  const dist = (path: string) => new URL(`../../../${path}`, import.meta.url).href;
  const { startPostgres } = (await import(dist('packages/testkit/dist/index.js'))) as Testkit;
  const { createApp } = (await import(dist('apps/api/dist/app.js'))) as AppModule;
  const { migrate } = (await import(dist('apps/api/dist/platform/migrate.js'))) as MigrateModule;
  const { systemClock } = (await import(dist('apps/api/dist/platform/clock.js'))) as ClockModule;
  const { MemoryObjectStorage } = (await import(
    dist('apps/api/dist/platform/storage/object-storage.js')
  )) as StorageModule;

  const db = await startPostgres();
  const pool = new pg.Pool({ connectionString: db.url, max: 8 });
  await migrate(pool);
  const app = await createApp({
    clock: systemClock,
    database: pool,
    storage: new MemoryObjectStorage(),
    logger: false,
    allowedOrigins: [WEB_ORIGIN],
    externalRightsChannel: 'https://privacidade.example.invalid/direitos',
    rateLimits: { public_ip: 100_000, user: 100_000 },
    secrets: {
      requestHashKey: randomBytes(32),
      emailPepper: randomBytes(32),
      csrfKey: randomBytes(32),
    },
  });
  await app.listen({ port: API_PORT, host: '127.0.0.1' });
  process.env['E2E_DATABASE_URL'] = db.url;

  const webEnv = { ...process.env, MEUREMEDIO_API_URL: `http://127.0.0.1:${String(API_PORT)}` };
  const next = 'node_modules/next/dist/bin/next';
  run(node, [next, 'build', 'apps/web'], webEnv);
  const web: ChildProcess = spawn(
    node,
    [next, 'start', 'apps/web', '-p', String(WEB_PORT), '-H', 'localhost'],
    { cwd: root, env: webEnv, stdio: 'inherit' },
  );
  await waitFor(`${WEB_ORIGIN}/entrar`, 60_000);

  return async () => {
    web.kill();
    await app.close();
    await pool.end();
    await db.stop();
  };
}

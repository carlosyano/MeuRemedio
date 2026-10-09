// Ponto de entrada da API: sobe o servidor HTTP com o relogio do sistema e o PostgreSQL de
// DATABASE_URL.
import pg from 'pg';
import { createApp } from './app.js';
import { systemClock } from './platform/clock.js';

const optionalNumber = (name: string): number | undefined => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : Number(raw);
};

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') throw new Error('DATABASE_URL nao definida');

const clockSkewMaxMs = optionalNumber('CLOCK_SKEW_MAX_MS');
const healthProbeTimeoutMs = optionalNumber('HEALTH_PROBE_TIMEOUT_MS');
const app = await createApp({
  clock: systemClock,
  database: new pg.Pool({ connectionString: databaseUrl }),
  ...(clockSkewMaxMs === undefined ? {} : { clockSkewMaxMs }),
  ...(healthProbeTimeoutMs === undefined ? {} : { healthProbeTimeoutMs }),
});
await app.listen({ port: optionalNumber('PORT') ?? 3000, host: '0.0.0.0' });

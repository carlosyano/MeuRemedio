// Ponto de entrada da API: sobe o servidor HTTP com o relogio do sistema e o PostgreSQL de
// DATABASE_URL. Segredos em base64 (32+ bytes) vem do ambiente (Secrets Manager em producao), com
// as chaves anteriores da rotacao em *_PREVIOUS (TS-031, DC-065).
import pg from 'pg';
import { createApp } from './app.js';
import { systemClock } from './platform/clock.js';
import { secretsFromEnv } from './platform/secrets.js';
import { objectStorageFromEnv } from './platform/storage/s3-object-storage.js';

const optionalNumber = (name: string): number | undefined => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : Number(raw);
};

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') throw new Error('DATABASE_URL nao definida');

const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');
if (allowedOrigins.length === 0) throw new Error('ALLOWED_ORIGINS nao definida');

// RIGHTS_CHANNEL_URL: canal externo de direitos do titular (GX-002), exposto por getPrivacy.
const externalRightsChannel = process.env['RIGHTS_CHANNEL_URL'];
if (externalRightsChannel === undefined || externalRightsChannel === '') {
  throw new Error('RIGHTS_CHANNEL_URL nao definida');
}

const clockSkewMaxMs = optionalNumber('CLOCK_SKEW_MAX_MS');
const healthProbeTimeoutMs = optionalNumber('HEALTH_PROBE_TIMEOUT_MS');
const app = await createApp({
  clock: systemClock,
  database: new pg.Pool({ connectionString: databaseUrl }),
  secrets: secretsFromEnv(process.env),
  allowedOrigins,
  externalRightsChannel,
  // EXPORT_STORAGE_BUCKET (S3) ou EXPORT_STORAGE_DIR (diretorio local em desenvolvimento)
  storage: objectStorageFromEnv(process.env),
  ...(clockSkewMaxMs === undefined ? {} : { clockSkewMaxMs }),
  ...(healthProbeTimeoutMs === undefined ? {} : { healthProbeTimeoutMs }),
});
await app.listen({ port: optionalNumber('PORT') ?? 3000, host: '0.0.0.0' });

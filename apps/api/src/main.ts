// Ponto de entrada da API: sobe o servidor HTTP com o relogio do sistema e o PostgreSQL de
// DATABASE_URL. Segredos em base64 (32+ bytes) vem do ambiente (Secrets Manager em producao).
import pg from 'pg';
import { createApp } from './app.js';
import { systemClock } from './platform/clock.js';
import { FileSystemObjectStorage } from './platform/storage/object-storage.js';

const optionalNumber = (name: string): number | undefined => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : Number(raw);
};

const secret = (name: string): Buffer => {
  const value = Buffer.from(process.env[name] ?? '', 'base64');
  if (value.length < 32) throw new Error(`${name} (base64, 32+ bytes) nao definida`);
  return value;
};

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') throw new Error('DATABASE_URL nao definida');

const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');
if (allowedOrigins.length === 0) throw new Error('ALLOWED_ORIGINS nao definida');

const exportStorageDir = process.env['EXPORT_STORAGE_DIR'];
const clockSkewMaxMs = optionalNumber('CLOCK_SKEW_MAX_MS');
const healthProbeTimeoutMs = optionalNumber('HEALTH_PROBE_TIMEOUT_MS');
const app = await createApp({
  clock: systemClock,
  database: new pg.Pool({ connectionString: databaseUrl }),
  secrets: {
    requestHashKey: secret('REQUEST_HASH_KEY'),
    emailPepper: secret('EMAIL_PEPPER'),
    csrfKey: secret('CSRF_KEY'),
  },
  allowedOrigins,
  // EXPORT_STORAGE_DIR: diretorio local dos PDFs em desenvolvimento (o S3 entra com a infraestrutura).
  ...(exportStorageDir === undefined || exportStorageDir === ''
    ? {}
    : { storage: new FileSystemObjectStorage(exportStorageDir) }),
  ...(clockSkewMaxMs === undefined ? {} : { clockSkewMaxMs }),
  ...(healthProbeTimeoutMs === undefined ? {} : { healthProbeTimeoutMs }),
});
await app.listen({ port: optionalNumber('PORT') ?? 3000, host: '0.0.0.0' });

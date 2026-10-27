// Ponto de entrada do processo do worker (DC-022): PostgreSQL de DATABASE_URL, pg-boss no mesmo
// banco e link de verificacao a partir de WEB_BASE_URL. Sem provedor de e-mail configurado
// (EMAIL_PROVIDER), os jobs de e-mail falham e o pg-boss os refaz.
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { systemClock } from './platform/clock.js';
import { emailSenderFromEnv } from './platform/email/ses-email-sender.js';
import { objectStorageFromEnv } from './platform/storage/s3-object-storage.js';
import { startWorker } from './worker.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} nao definida`);
  return value;
};

// EMAIL_PEPPER: o mesmo segredo da API (base64, 32+ bytes); HMAC do e-mail no tombstone (RN-019).
const emailPepper = Buffer.from(required('EMAIL_PEPPER'), 'base64');
if (emailPepper.length < 32) throw new Error('EMAIL_PEPPER (base64, 32+ bytes) nao definida');

const databaseUrl = required('DATABASE_URL');
const boss = new PgBoss({ connectionString: databaseUrl });
const worker = await startWorker({
  pool: new pg.Pool({ connectionString: databaseUrl }),
  boss,
  clock: systemClock,
  // EMAIL_PROVIDER=ses com EMAIL_FROM; sem provedor, os jobs de e-mail falham
  email: emailSenderFromEnv(process.env),
  webBaseUrl: required('WEB_BASE_URL'),
  emailPepper,
  // EXPORT_STORAGE_BUCKET (S3) ou EXPORT_STORAGE_DIR (diretorio local em desenvolvimento)
  storage: objectStorageFromEnv(process.env),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().finally(() => process.exit(0));
  });
}

// Ponto de entrada do processo do worker (DC-022): PostgreSQL de DATABASE_URL, pg-boss no mesmo
// banco e link de verificacao a partir de WEB_BASE_URL. Sem provedor de e-mail configurado, os jobs
// de e-mail falham e o pg-boss os refaz (o adaptador SES entra com a infraestrutura, OA-004).
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { systemClock } from './platform/clock.js';
import { unconfiguredEmailSender } from './platform/email/email-sender.js';
import {
  FileSystemObjectStorage,
  unconfiguredObjectStorage,
} from './platform/storage/object-storage.js';
import { startWorker } from './worker.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} nao definida`);
  return value;
};

// EXPORT_STORAGE_DIR: diretorio local dos PDFs em desenvolvimento (o S3 entra com a infraestrutura).
const storageFromEnv = () => {
  const dir = process.env['EXPORT_STORAGE_DIR'];
  return dir === undefined || dir === ''
    ? unconfiguredObjectStorage
    : new FileSystemObjectStorage(dir);
};

const databaseUrl = required('DATABASE_URL');
const boss = new PgBoss({ connectionString: databaseUrl });
const worker = await startWorker({
  pool: new pg.Pool({ connectionString: databaseUrl }),
  boss,
  clock: systemClock,
  email: unconfiguredEmailSender,
  webBaseUrl: required('WEB_BASE_URL'),
  storage: storageFromEnv(),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().finally(() => process.exit(0));
  });
}

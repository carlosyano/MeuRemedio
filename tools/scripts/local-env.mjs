// Segredos do ambiente local (docker compose, DC-073): grava um .env na raiz com os tres segredos
// HMAC (32 bytes aleatorios em base64), proprios desta maquina. Nunca sobrescreve um .env
// existente, e o .env nunca entra no git (.gitignore). Uso: npm run local:env
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_SECRETS = ['REQUEST_HASH_KEY', 'EMAIL_PEPPER', 'CSRF_KEY'];

/** Devolve true se gravou o .env; false se ja existia (nada muda). */
export function writeLocalEnv(dir) {
  const file = join(dir, '.env');
  if (existsSync(file)) return false;
  const lines = [
    '# Segredos do ambiente local (npm run local:env). So para esta maquina; nao use fora dela.',
    ...LOCAL_SECRETS.map((name) => `${name}=${randomBytes(32).toString('base64')}`),
    '',
  ];
  // wx: falha se outro processo criou o arquivo no meio do caminho
  writeFileSync(file, lines.join('\n'), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  console.log(
    writeLocalEnv(root)
      ? 'local:env: .env criado com segredos novos.'
      : 'local:env: .env ja existe; nada foi alterado.',
  );
}

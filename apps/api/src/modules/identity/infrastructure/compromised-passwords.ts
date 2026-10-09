// Lista local de senhas comprometidas (RN-017, DEC-029): SecLists top 100.000, versionada em
// apps/api/assets/compromised-passwords (origem e SHA-256 em SOURCE.md). Sem consulta remota.
// A carga confere o SHA-256 e falha se o arquivo divergir; a comparacao e exata.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const LIST_FILE = new URL(
  '../../../../assets/compromised-passwords/10-million-password-list-top-100000.txt',
  import.meta.url,
);
export const COMPROMISED_LIST_SHA256 =
  'e30e15faecc8db2d3181c3126e3b2c0cd5c187af10a5e4e83babfa157edab188';

export interface CompromisedPasswords {
  has(password: string): boolean;
}

let cached: CompromisedPasswords | undefined;

export function loadCompromisedPasswords(): CompromisedPasswords {
  if (cached) return cached;
  const bytes = readFileSync(LIST_FILE);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== COMPROMISED_LIST_SHA256) {
    throw new Error(`Lista de senhas comprometidas com SHA-256 divergente: ${digest}`);
  }
  const entries = new Set(
    bytes
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== ''),
  );
  cached = { has: (password) => entries.has(password) };
  return cached;
}

// Leitura dos argumentos dos scripts operacionais. Mensagens de erro citam a opcao, nunca o valor
// recebido, que pode conter dado do titular (TS-030, TS-032).
import type { Pool } from 'pg';
import type { Clock } from '../platform/clock.js';

export interface OpsIo {
  readonly pool: Pool;
  readonly clock: Clock;
  /** Principal IAM de quem executa (OPS_OPERATOR). */
  readonly operator: string;
  readonly readStdin: () => Promise<string>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export type OpsCommand = (args: string[], io: OpsIo) => Promise<void>;

/** Uso invalido: codigo de saida 2. */
export class UsageError extends Error {}

// Instante com fuso explicito.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function instant(name: string, value: string | undefined): string {
  if (value === undefined || !RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
    throw new UsageError(`--${name} exige instante RFC 3339 com fuso`);
  }
  return new Date(value).toISOString();
}

export function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  values: readonly T[],
): T {
  if (value === undefined || !(values as readonly string[]).includes(value)) {
    throw new UsageError(`--${name} fora do catalogo (${values.join(', ')})`);
  }
  return value as T;
}

export function uuid(name: string, value: string | undefined): string {
  if (value === undefined || !UUID.test(value)) throw new UsageError(`--${name} exige UUID`);
  return value.toLowerCase();
}

// Padroes de dado pessoal recusados nos textos livres operacionais: e-mail e CPF.
const PERSONAL_DATA = [/[^\s@]+@[^\s@]+\.[^\s@]+/, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/];

/** Texto livre sem dado de titular, com tamanho entre 1 e max. */
export function freeText(name: string, value: string | undefined, max: number): string {
  const text = value?.trim() ?? '';
  if (text.length === 0 || text.length > max) {
    throw new UsageError(`--${name} exige 1 a ${String(max)} caracteres`);
  }
  if (PERSONAL_DATA.some((pattern) => pattern.test(text))) {
    throw new UsageError(`--${name} nao pode conter dado de titular (e-mail ou CPF)`);
  }
  return text;
}

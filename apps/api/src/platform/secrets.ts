// Segredos HMAC do servidor (Secrets Manager em producao; RNF-012). Cada um tem a chave atual e,
// durante a rotacao, as chaves anteriores ainda aceitas na verificacao (TS-031, DC-065). No
// ambiente: base64 com 32+ bytes em NOME e as anteriores em NOME_PREVIOUS, separadas por virgula.
import { keyringOf, type Keyring } from './crypto/keyring.js';

export interface AppSecrets {
  /** Chave do HMAC do hash de requisicao idempotente (DC-012), 32 bytes ou mais. */
  readonly requestHashKey: Buffer;
  /** Pepper do HMAC do e-mail normalizado (bloqueio de login, DEC-016; tombstone, RN-019). */
  readonly emailPepper: Buffer;
  /** Chave do HMAC do token CSRF vinculado a sessao (OA-008). */
  readonly csrfKey: Buffer;
  /** Chaves anteriores, aceitas so na verificacao enquanto a rotacao nao termina (DC-065). */
  readonly previous?: {
    readonly requestHashKey?: readonly Buffer[];
    readonly emailPepper?: readonly Buffer[];
    readonly csrfKey?: readonly Buffer[];
  };
}

export interface SecretKeyrings {
  readonly requestHashKey: Keyring;
  readonly emailPepper: Keyring;
  readonly csrfKey: Keyring;
}

export const secretKeyrings = (secrets: AppSecrets): SecretKeyrings => ({
  requestHashKey: keyringOf(secrets.requestHashKey, secrets.previous?.requestHashKey),
  emailPepper: keyringOf(secrets.emailPepper, secrets.previous?.emailPepper),
  csrfKey: keyringOf(secrets.csrfKey, secrets.previous?.csrfKey),
});

type Env = Readonly<Record<string, string | undefined>>;

function decode(name: string, value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length < 32) throw new Error(`${name} (base64, 32+ bytes) invalida`);
  return key;
}

function current(env: Env, name: string): Buffer {
  const value = env[name]?.trim();
  if (value === undefined || value === '')
    throw new Error(`${name} (base64, 32+ bytes) nao definida`);
  return decode(name, value);
}

function previous(env: Env, name: string): Buffer[] {
  const variable = `${name}_PREVIOUS`;
  return (env[variable] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => decode(variable, item));
}

export const secretsFromEnv = (env: Env): AppSecrets => ({
  requestHashKey: current(env, 'REQUEST_HASH_KEY'),
  emailPepper: current(env, 'EMAIL_PEPPER'),
  csrfKey: current(env, 'CSRF_KEY'),
  previous: {
    requestHashKey: previous(env, 'REQUEST_HASH_KEY'),
    emailPepper: previous(env, 'EMAIL_PEPPER'),
    csrfKey: previous(env, 'CSRF_KEY'),
  },
});

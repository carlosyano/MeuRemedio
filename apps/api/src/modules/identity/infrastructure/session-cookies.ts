// Cookies de sessao e CSRF (ADR-001 v1.5 OA-008; OpenAPI securitySchemes):
//   - mr_session: segredo opaco de 32 bytes (base64url); HttpOnly; Secure; SameSite=Lax; Path=/;
//     sem Domain; Max-Age igual a duracao absoluta (24 h) (DC-025);
//   - mr_csrf: HMAC-SHA-256 do id da sessao com segredo do servidor; legivel por JavaScript.
//     Durante a rotacao, o token pela chave anterior tambem vale (TS-031, DC-065).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { acceptedDigests, hmacDigest, type Keyring } from '../../../platform/crypto/keyring.js';

export const SESSION_COOKIE = 'mr_session';
export const CSRF_COOKIE = 'mr_csrf';
export const SESSION_MAX_AGE_SECONDS = 24 * 3_600;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newSessionToken = (): string => randomBytes(32).toString('base64url');

export const isSessionToken = (value: string | undefined): value is string =>
  value !== undefined && TOKEN_PATTERN.test(value);

export const hashSessionToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

/** Tokens CSRF aceitos para a sessao: o da chave atual (o que e emitido) primeiro. */
export const csrfTokensFor = (sessionId: string, ring: Keyring): string[] =>
  acceptedDigests(hmacDigest(ring, sessionId)).map((digest) => digest.toString('base64url'));

/** Comparacao em tempo constante de dois textos. */
export function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Cabecalho Cookie -> mapa nome/valor (primeira ocorrencia de cada nome). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

export function sessionCookies(token: string, csrf: string): string[] {
  const common = `Path=/; Max-Age=${String(SESSION_MAX_AGE_SECONDS)}; Secure; SameSite=Lax`;
  return [`${SESSION_COOKIE}=${token}; ${common}; HttpOnly`, `${CSRF_COOKIE}=${csrf}; ${common}`];
}

export function clearedSessionCookies(): string[] {
  const common = 'Path=/; Max-Age=0; Secure; SameSite=Lax';
  return [`${SESSION_COOKIE}=; ${common}; HttpOnly`, `${CSRF_COOKIE}=; ${common}`];
}

// @trace TS-031 RNF-012 (rotacao de chave, DC-065)
// Chaveiro dos segredos do servidor: a chave atual assina e as anteriores so verificam. Os
// segredos vem do ambiente em base64, e as chaves anteriores em *_PREVIOUS, separadas por virgula.
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  acceptedDigests,
  hmacDigest,
  keyringOf,
} from '../../apps/api/src/platform/crypto/keyring.js';
import { createRequestHasher } from '../../apps/api/src/platform/idempotency/idempotency.js';
import { secretsFromEnv } from '../../apps/api/src/platform/secrets.js';

const hmac = (key: Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

describe('keyringOf e hmacDigest', () => {
  const current = randomBytes(32);
  const old = randomBytes(32);

  it('o digest e o HMAC-SHA-256 pela chave atual', () => {
    const digest = hmacDigest(keyringOf(current, [old]), 'ana.silva@example.com');
    expect(digest.equals(hmac(current, 'ana.silva@example.com'))).toBe(true);
  });

  it('os digests aceitos sao o da chave atual seguido dos das anteriores', () => {
    const digest = hmacDigest(keyringOf(current, [old]), 'x');
    expect(acceptedDigests(digest)).toEqual([hmac(current, 'x'), hmac(old, 'x')]);
  });

  it('sem chaves anteriores, so o digest atual e aceito', () => {
    expect(acceptedDigests(hmacDigest(keyringOf(current), 'x'))).toEqual([hmac(current, 'x')]);
    expect(acceptedDigests(Buffer.from('abc'))).toEqual([Buffer.from('abc')]);
  });

  it('chave anterior igual a atual ou repetida e descartada', () => {
    expect(keyringOf(current, [current, old, Buffer.from(old)]).previous).toEqual([old]);
  });

  it('recusa chave com menos de 32 bytes', () => {
    expect(() => keyringOf(Buffer.alloc(31))).toThrow(/32 bytes/);
    expect(() => keyringOf(current, [Buffer.alloc(16)])).toThrow(/32 bytes/);
  });

  it('o hash de requisicao aceita o digest da chave anterior', () => {
    const before = createRequestHasher(old)({ body: { a: 1 } });
    const after = createRequestHasher(keyringOf(current, [old]))({ body: { a: 1 } });
    expect(after.equals(before)).toBe(false);
    expect(acceptedDigests(after).some((digest) => digest.equals(before))).toBe(true);
  });
});

describe('secretsFromEnv', () => {
  const b64 = (key: Buffer) => key.toString('base64');
  const keys = { hash: randomBytes(32), pepper: randomBytes(32), csrf: randomBytes(32) };
  const env = {
    REQUEST_HASH_KEY: b64(keys.hash),
    EMAIL_PEPPER: b64(keys.pepper),
    CSRF_KEY: b64(keys.csrf),
  };

  it('le os segredos atuais sem chaves anteriores', () => {
    const secrets = secretsFromEnv(env);
    expect(secrets.requestHashKey.equals(keys.hash)).toBe(true);
    expect(secrets.emailPepper.equals(keys.pepper)).toBe(true);
    expect(secrets.csrfKey.equals(keys.csrf)).toBe(true);
    expect(secrets.previous).toEqual({ requestHashKey: [], emailPepper: [], csrfKey: [] });
  });

  it('le as chaves anteriores separadas por virgula, ignorando espacos e itens vazios', () => {
    const old = [randomBytes(32), randomBytes(48)];
    const secrets = secretsFromEnv({
      ...env,
      CSRF_KEY_PREVIOUS: ` ${b64(old[0] ?? Buffer.alloc(0))} ,, ${b64(old[1] ?? Buffer.alloc(0))}`,
    });
    expect(secrets.previous?.csrfKey).toEqual(old);
  });

  it.each(['REQUEST_HASH_KEY', 'EMAIL_PEPPER', 'CSRF_KEY'])(
    'exige %s com 32 bytes ou mais',
    (name) => {
      expect(() => secretsFromEnv({ ...env, [name]: undefined })).toThrow(name);
      expect(() => secretsFromEnv({ ...env, [name]: b64(randomBytes(16)) })).toThrow(name);
    },
  );

  it('recusa chave anterior curta, com o nome da variavel', () => {
    expect(() => secretsFromEnv({ ...env, EMAIL_PEPPER_PREVIOUS: b64(randomBytes(8)) })).toThrow(
      'EMAIL_PEPPER_PREVIOUS',
    );
  });
});

// Chaveiro dos segredos HMAC do servidor (RNF-012, TS-031, DC-065): a chave atual assina e as
// anteriores so verificam, enquanto o que foi assinado com elas ainda pode chegar (CSRF de sessao
// aberta, snapshot idempotente, confirmacao de duplicidade, bloqueio de login).
// O digest pela chave atual carrega os digests pelas anteriores (KeyedDigest): quem grava usa o
// proprio Buffer, e quem compara usa acceptedDigests.
import { createHmac } from 'node:crypto';

const MIN_KEY_BYTES = 32;

export interface Keyring {
  readonly current: Buffer;
  /** Chaves aposentadas aceitas so na verificacao, da mais recente para a mais antiga. */
  readonly previous: readonly Buffer[];
}

/** HMAC pela chave atual, com os HMACs pelas chaves anteriores. */
export type KeyedDigest = Buffer & { readonly previous?: readonly Buffer[] };

/** Monta o chaveiro; chave anterior igual a atual ou repetida e descartada. */
export function keyringOf(current: Buffer, previous: readonly Buffer[] = []): Keyring {
  for (const key of [current, ...previous]) {
    if (key.length < MIN_KEY_BYTES) throw new Error('Segredo HMAC exige pelo menos 32 bytes');
  }
  const distinct: Buffer[] = [];
  for (const key of previous) {
    if (!key.equals(current) && !distinct.some((seen) => seen.equals(key))) distinct.push(key);
  }
  return { current, previous: distinct };
}

/** Aceita a chave unica de antes da rotacao (testes e chamadas antigas) ou o chaveiro. */
export const asKeyring = (secret: Buffer | Keyring): Keyring =>
  Buffer.isBuffer(secret) ? keyringOf(secret) : secret;

export function hmacDigest(ring: Keyring, data: string): KeyedDigest {
  const digest = (key: Buffer): Buffer => createHmac('sha256', key).update(data).digest();
  const current = digest(ring.current);
  return ring.previous.length === 0
    ? current
    : Object.assign(current, { previous: ring.previous.map(digest) });
}

/** Digests que valem na comparacao: o da chave atual primeiro. */
export const acceptedDigests = (digest: KeyedDigest): Buffer[] => [
  digest,
  ...(digest.previous ?? []),
];

// Hash de senha com Argon2id (RN-017; ADR-001 v1.5 OA-009): 19 MiB, 2 iteracoes, paralelismo 1,
// parametros iniciais a calibrar no spike S7 (p95 de verificacao ate 500 ms no ambiente-alvo).
import { hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

// O algoritmo padrao da biblioteca e Argon2id (o const enum Algorithm nao pode ser lido como valor
// com verbatimModuleSyntax); o teste confere o prefixo $argon2id$ do hash.
const PARAMETERS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const argon2idPasswordHasher: PasswordHasher = {
  hash: (password) => hash(password, PARAMETERS),
  verify: (passwordHash, password) => verify(passwordHash, password),
};

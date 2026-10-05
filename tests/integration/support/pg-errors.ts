import pg from 'pg';
import { expect } from 'vitest';

export interface ExpectedPgError {
  /** SQLSTATE, por exemplo 23505 (unique), 23514 (check), 23503 (foreign key), 23502 (not null). */
  readonly code: string;
  /** Nome da constraint/indice que deve ter disparado (quando aplicavel). */
  readonly constraint?: string;
  readonly message?: RegExp;
}

/** Exige que a operacao falhe com o erro de banco esperado (e nao com qualquer outro). */
export async function expectPgError(
  operation: Promise<unknown>,
  expected: ExpectedPgError,
): Promise<void> {
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, 'a operacao deveria falhar').toBeInstanceOf(pg.DatabaseError);
  if (!(error instanceof pg.DatabaseError)) return;
  expect(error.code, `SQLSTATE (${error.message})`).toBe(expected.code);
  if (expected.constraint !== undefined) expect(error.constraint).toBe(expected.constraint);
  if (expected.message !== undefined) expect(error.message).toMatch(expected.message);
}

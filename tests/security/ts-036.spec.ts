// @trace TS-036 RF-002 RN-017 DEC-029 confirmPasswordReset
// TS-036: senha comprometida na redefinicao. A nova senha presente na lista local (DEC-029) e
// rejeitada com 400 VALIDATION_FAILED (field_errors[].code=PASSWORD_COMPROMISED), sem consulta
// remota, sem persistir a senha em lugar algum e sem consumir o token.
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD, startHarness, type Harness } from '../integration/support/http.js';

const COMPROMISED = 'Password123';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.truncate();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Conta ACTIVE com um token de redefinicao em aberto; devolve o id e o token. */
async function openToken(): Promise<{ userId: string; token: string }> {
  const userId = await h.activeUser('ana.silva@example.com');
  const token = randomBytes(32).toString('base64url');
  await h.pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, issued_at, expires_at)
     VALUES ($1, $2, $3, $3::timestamptz + interval '60 minutes')`,
    [userId, createHash('sha256').update(token).digest(), h.now],
  );
  return { userId, token };
}

const confirmReset = (token: string, password: string) =>
  h.call('confirmPasswordReset', 'POST', '/password-resets', {
    body: { token, new_password: password },
  });

describe('TS-036 senha comprometida na redefinicao', () => {
  it('400 PASSWORD_COMPROMISED sem chamada remota, sem trocar a senha nem consumir o token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { userId, token } = await openToken();
    const before = (
      await h.pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId],
      )
    ).rows[0]?.password_hash;

    const response = await confirmReset(token, COMPROMISED);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      field_errors: [{ field: 'new_password', code: 'PASSWORD_COMPROMISED' }],
    });
    expect(JSON.stringify(response.body)).not.toContain(COMPROMISED);
    expect(fetchSpy).not.toHaveBeenCalled();

    const after = await h.pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    expect(after.rows[0]?.password_hash).toBe(before);
    const open = await h.pool.query(
      'SELECT 1 FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
    expect(open.rowCount).toBe(1);
  });

  it('a senha rejeitada nao aparece em nenhuma tabela', async () => {
    const { token } = await openToken();
    await confirmReset(token, COMPROMISED);
    const tables = await h.pool.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'",
    );
    for (const { name } of tables.rows) {
      const dump = await h.pool.query<{ dump: string | null }>(
        `SELECT string_agg(row_to_json(t)::text, '') AS dump FROM "${name}" t`,
      );
      expect(dump.rows[0]?.dump ?? '', name).not.toContain(COMPROMISED);
    }
  });

  it('o mesmo token aceita depois uma senha fora da lista', async () => {
    const { token } = await openToken();
    await confirmReset(token, COMPROMISED);
    expect((await confirmReset(token, `${PASSWORD}-Nova`)).status).toBe(204);
  });
});

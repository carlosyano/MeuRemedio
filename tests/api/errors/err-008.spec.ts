// @trace ERR-008 RF-001 RF-002 TS-009 (410 TOKEN_EXPIRED)
// ERR-008: token de verificacao depois de 24 h e de redefinicao depois de 60 min, token substituido
// por um mais novo e token desconhecido respondem o mesmo 410, sem distinguir os casos (DC-019) e
// sem efeito. (Token de verificacao ja usado e repeticao idempotente: 204, verification.spec.ts.)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../integration/support/http.js';
import { catalogEntry, expectProblem, persistedState } from './support/catalog.js';
import { issueToken } from './support/fixtures.js';

const NOW = '2026-10-05T11:05:15Z';
const entry = catalogEntry('ERR-008');
let h: Harness;
let anaId: string;

const OPERATIONS = {
  verifyAccount: { kind: 'verification', url: '/accounts/verify', validity: 24 * 3_600_000 },
  confirmPasswordReset: { kind: 'password_reset', url: '/password-resets', validity: 3_600_000 },
} as const;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  anaId = await h.activeUser('ana.silva@example.com');
});

describe('ERR-008 TOKEN_EXPIRED (410)', () => {
  it('a matriz liga ERR-008 a verifyAccount e confirmPasswordReset', () => {
    expect(entry).toMatchObject({ code: 'TOKEN_EXPIRED', http_status: 410 });
    expect([...entry.operationIds].sort()).toEqual(Object.keys(OPERATIONS).sort());
  });

  it.each(Object.entries(OPERATIONS))(
    '%s com token expirado, substituido e desconhecido',
    async (operationId, { kind, url, validity }) => {
      const issuedAt = new Date(Date.parse(NOW) - validity).toISOString();
      const expired = await issueToken(h, kind, anaId, issuedAt);
      const superseded = await issueToken(h, kind, anaId, NOW);
      await h.pool.query(
        `UPDATE ${kind === 'verification' ? 'verification_tokens' : 'password_reset_tokens'}
            SET superseded_at = $1 WHERE expires_at > $1`,
        [NOW],
      );
      const before = await persistedState(h.pool);
      for (const token of [expired, superseded, 'token-desconhecido-0000000000000000000000']) {
        const body =
          kind === 'verification' ? { token } : { token, new_password: 'Outra-Senha-Sintetica-77' };
        expectProblem(await h.call(operationId, 'POST', url, { body }), 'TOKEN_EXPIRED', [token]);
      }
      expect(await persistedState(h.pool)).toBe(before);
    },
  );
});

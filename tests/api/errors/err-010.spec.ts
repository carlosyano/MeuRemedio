// @trace ERR-010 RNF-006 DEC-019 (429 RATE_LIMITED com Retry-After)
// ERR-010: com a janela do minuto esgotada, toda operacao limitada responde 429 com Retry-After ate
// o fim da janela, sem efeito: as publicas pelo IP (20/min) e as privadas pelo titular (100/min).
// As operacoes vem da matriz e precisam ser todas as do contrato menos getHealth (isenta).
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../../../apps/api/src/platform/rate-limit/rate-limiter.js';
import {
  login,
  startHarness,
  type Harness,
  type LoggedIn,
} from '../../integration/support/http.js';
import { catalogEntry, expectProblem, genericUrl, persistedState } from './support/catalog.js';

const NOW = '2026-10-05T11:05:15Z';
const WINDOW = '2026-10-05T11:05:00Z';
const IP = '203.0.113.10';
const entry = catalogEntry('ERR-010');
let h: Harness;
let ana: LoggedIn;
let anaId: string;

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
  ana = await login(h, 'ana.silva@example.com');
});

/** Esgota a janela atual da chave no escopo, como fariam as requisicoes anteriores do minuto. */
async function exhaust(scope: keyof typeof RATE_LIMITS, key: string): Promise<void> {
  await h.pool.query(
    `INSERT INTO rate_limit_counters (scope, key_hash, window_start, count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET count = EXCLUDED.count`,
    [scope, createHash('sha256').update(key).digest(), WINDOW, RATE_LIMITS[scope]],
  );
}

describe('ERR-010 RATE_LIMITED (429)', () => {
  it('a matriz liga ERR-010 a toda operacao do contrato menos getHealth', () => {
    expect(entry).toMatchObject({ code: 'RATE_LIMITED', http_status: 429 });
    const limited = h.contract.operations
      .map((op) => op.operationId)
      .filter((id) => id !== 'getHealth');
    expect([...entry.operationIds].sort()).toEqual(limited.sort());
  });

  it.each(entry.operationIds)('%s', async (operationId) => {
    const operation = h.contract.operation(operationId);
    if (operation.public) await exhaust('public_ip', IP);
    else await exhaust('user', anaId);
    const before = await persistedState(h.pool);
    const response = await h.call(operationId, operation.method, genericUrl(operation), {
      remoteAddress: IP,
      headers: {
        ...(operation.public ? {} : operation.method === 'GET' ? ana.read : ana.mutation),
        'idempotency-key': 'err-010',
      },
    });
    expectProblem(response, 'RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('45');
    expect(await persistedState(h.pool)).toBe(before);
  });
});

// @trace RNF-009 TS-022 (ADR-001 v1.5 S6)
// Content-Security-Policy da aplicacao web (DC-059): nonce novo por requisicao, scripts so com o
// nonce ('strict-dynamic'), sem 'unsafe-inline' nem 'unsafe-eval' em producao, sem objetos,
// base-uri e frame-ancestors fechados; 'unsafe-eval' so no desenvolvimento.
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from '../../apps/web/src/lib/csp.js';

const directives = (policy: string): Map<string, string> =>
  new Map(
    policy.split(';').flatMap((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return name === undefined || name === '' ? [] : [[name, values.join(' ')]];
    }),
  );

describe('Content-Security-Policy', () => {
  it('producao: scripts e estilos so com o nonce, nada inline nem eval', () => {
    const policy = directives(contentSecurityPolicy('bm9uY2UtMTIz', { development: false }));
    expect(policy.get('default-src')).toBe("'self'");
    expect(policy.get('script-src')).toBe("'self' 'nonce-bm9uY2UtMTIz' 'strict-dynamic'");
    expect(policy.get('style-src')).toBe("'self' 'nonce-bm9uY2UtMTIz'");
    expect(policy.get('img-src')).toBe("'self' blob: data:");
    expect(policy.get('font-src')).toBe("'self'");
    expect(policy.get('connect-src')).toBe("'self'");
    expect(policy.get('object-src')).toBe("'none'");
    expect(policy.get('base-uri')).toBe("'none'");
    expect(policy.get('form-action')).toBe("'self'");
    expect(policy.get('frame-ancestors')).toBe("'none'");
    expect([...policy.values()].join(' ')).not.toMatch(/unsafe-(inline|eval)/);
  });

  it("desenvolvimento: 'unsafe-eval' nos scripts (exigido pelo React em dev)", () => {
    const policy = directives(contentSecurityPolicy('abc', { development: true }));
    expect(policy.get('script-src')).toBe("'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'");
  });

  it('nonce: base64 de 128 bits, diferente a cada chamada', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});

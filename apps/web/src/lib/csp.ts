// Content-Security-Policy da aplicacao web (DC-059; ADR-001 v1.5 S6): nonce novo por requisicao,
// gerado no proxy e aplicado pelo Next aos proprios scripts. Sem importar outros modulos locais:
// roda nos testes e no proxy.

/** 128 bits aleatorios em base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, options: { development: boolean }): string {
  // O React usa eval so no desenvolvimento, para reconstruir pilhas de erro.
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ''}`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

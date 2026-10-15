// Proxy do Next (DC-059): gera o nonce de cada requisicao de pagina e envia a Content-Security-Policy
// na requisicao (o Next le o nonce dali e o aplica aos scripts) e na resposta. /api, os arquivos
// estaticos e os prefetches de navegacao ficam de fora: nao sao documentos HTML.
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './lib/csp';

export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

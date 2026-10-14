// Aplicacao web (ADR-001 v1.5: Next.js no frontend; DC-052).
// - /api/* e encaminhado a API (MEUREMEDIO_API_URL, lido no build): o navegador fala so com a
//   origem da aplicacao, os cookies mr_session e mr_csrf ficam nessa origem e o Origin das
//   mutacoes e o da aplicacao (OA-008);
// - cabecalhos de seguranca em todas as respostas; sem cache de paginas com dados do titular.
import type { NextConfig } from 'next';

const apiUrl = process.env['MEUREMEDIO_API_URL'];
if (apiUrl === undefined || apiUrl === '') {
  throw new Error('MEUREMEDIO_API_URL nao definida (URL interna da API)');
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/:path*` }]),
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      // Paginas e respostas da API nao vao para cache; os arquivos estaticos versionados vao.
      { source: '/((?!_next/static).*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]),
};

export default config;

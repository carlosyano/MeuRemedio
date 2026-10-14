import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MeuRemedio', template: '%s · MeuRemedio' },
  description: 'Rotina de medicamentos declarada por você.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen text-base leading-relaxed">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2"
        >
          Ir para o conteúdo
        </a>
        <main id="conteudo" className="mx-auto max-w-xl p-4">
          {children}
        </main>
      </body>
    </html>
  );
}

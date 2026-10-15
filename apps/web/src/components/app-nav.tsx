'use client';
// Navegacao da area logada (DC-054). Estilo neutro ate o design system. Ao montar, aplica as
// preferencias de acessibilidade do titular (RF-009, DC-061); sem resposta, fica o padrao.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { applyPreferences, type AccessibilityPreferences } from '@/lib/accessibility';
import { api } from '@/lib/browser-api';

const LINKS = [
  ['/hoje', 'Hoje'],
  ['/planos', 'Planos'],
  ['/historico', 'Histórico'],
  ['/exportacao', 'Exportar'],
  ['/privacidade', 'Privacidade'],
  ['/conta', 'Conta'],
] as const;

export function AppNav() {
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    api
      .request<AccessibilityPreferences>({ method: 'GET', path: '/preferences/accessibility' })
      .then((response) => {
        if (active) applyPreferences(document.documentElement, response.body);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <nav
      aria-label="Principal"
      className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2"
    >
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
          className="aria-[current=page]:font-semibold"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

'use client';
// Navegacao da area logada (DC-054). Estilo neutro ate o design system.
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/hoje', 'Hoje'],
  ['/planos', 'Planos'],
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="mb-6 flex gap-4 border-b border-line pb-2">
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

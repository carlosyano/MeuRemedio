'use client';
// Exportacoes recentes do titular (listExports, DEC-034): as 10 mais recentes, em todos os estados,
// com link para acompanhar cada pedido. Falha ao carregar nao impede solicitar uma nova.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/browser-api';
import { formatInstant, isPending, statusLabel, type ExportRequest } from '@/lib/exports';
import { formatDate } from '@/lib/plan-form';

const LIMIT = 10;

interface ExportRequestPage {
  readonly items: readonly ExportRequest[];
  readonly page: { readonly next_cursor: string | null; readonly limit: number };
}

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly ExportRequest[] }
  | { readonly status: 'error' };

const linkLabel = (status: string): string => {
  if (isPending(status)) return 'Acompanhar exportação';
  if (status === 'COMPLETED') return 'Ver e baixar o PDF';
  return 'Ver detalhes';
};

export function RecentExports({ timeZone }: { readonly timeZone: string }) {
  const [state, setState] = useState<ListState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .request<ExportRequestPage>({ method: 'GET', path: `/exports?limit=${String(LIMIT)}` })
      .then((response) => {
        if (active) setState({ status: 'ready', items: response.body.items });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-labelledby="recentes-titulo" className="mt-8">
      <h2 id="recentes-titulo" className="mb-2 text-xl font-semibold">
        Exportações recentes
      </h2>
      {state.status === 'loading' && <p aria-live="polite">Carregando…</p>}
      {state.status === 'error' && <p>Não foi possível carregar as exportações recentes.</p>}
      {state.status === 'ready' && state.items.length === 0 && (
        <p>Nenhuma exportação solicitada.</p>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="divide-y divide-line">
          {state.items.map((item) => (
            <li key={item.export_id} className="py-3">
              <p className="font-medium">
                {formatDate(item.start_date)} a {formatDate(item.end_date)} ·{' '}
                {statusLabel(item.status)}
              </p>
              <p className="text-sm text-muted">
                Solicitada em {formatInstant(item.requested_at, timeZone)}
              </p>
              <Link href={`/exportacao?pedido=${item.export_id}`}>{linkLabel(item.status)}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

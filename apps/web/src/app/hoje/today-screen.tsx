'use client';
// Area logada inicial (DC-052): exige sessao (TS-019); a lista de ocorrencias do dia (TL-005)
// entra no PR das ocorrencias.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { useAccount } from '@/lib/use-account';

export function TodayScreen() {
  const router = useRouter();
  const state = useAccount('/hoje');
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function signOut(): Promise<void> {
    setLeaving(true);
    setError(undefined);
    try {
      await api.request({ method: 'DELETE', path: '/sessions/current' });
      router.replace('/entrar');
    } catch (caught) {
      setError(messageFor(caught));
      setLeaving(false);
    }
  }

  if (state.status === 'loading') return <p aria-live="polite">Carregando…</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="font-medium text-danger">
        {state.message}
      </p>
    );
  }
  return (
    <>
      <AppNav />
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Hoje</h1>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={leaving}
          className="rounded border border-line px-3 py-1"
        >
          Sair
        </button>
      </div>
      <p>Olá, {state.account.name}</p>
      {error !== undefined && (
        <p role="alert" className="mt-4 font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
}

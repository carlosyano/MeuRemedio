'use client';
// Conta do titular para as telas da area logada (DC-052). Sem sessao, leva a /entrar com o destino
// atual em ?proximo= (TS-019); indisponibilidade mostra a mensagem, sem dado falso.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiProblem, messageFor } from './api-client';
import { api } from './browser-api';

export interface Account {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
}

export type AccountState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly account: Account }
  | { readonly status: 'error'; readonly message: string };

export function useAccount(currentPath: string): AccountState {
  const router = useRouter();
  const [state, setState] = useState<AccountState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .request<Account>({ method: 'GET', path: '/accounts/me' })
      .then((response) => {
        if (active) setState({ status: 'ready', account: response.body });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiProblem && error.status === 401) {
          router.replace(`/entrar?proximo=${encodeURIComponent(currentPath)}`);
          return;
        }
        setState({ status: 'error', message: messageFor(error) });
      });
    return () => {
      active = false;
    };
  }, [currentPath, router]);

  return state;
}

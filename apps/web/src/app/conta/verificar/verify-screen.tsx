'use client';
// Confirmacao de e-mail (FL-001; DC-021, DC-053): o token vem no fragmento do link, sai da URL
// assim que e lido e vai a verifyAccount. Sucesso so com o 204.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { takeTokenFromFragment } from '@/lib/forms';

const LINK_UNUSABLE = 'Este link não pode mais ser usado. Solicite um novo.';
const NOT_PENDING = 'Esta conta não está aguardando confirmação.';

type State =
  | { readonly status: 'verifying' }
  | { readonly status: 'verified' }
  | { readonly status: 'error'; readonly message: string; readonly canResend: boolean };

export function VerifyScreen() {
  const [state, setState] = useState<State>({ status: 'verifying' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeTokenFromFragment();
    if (token === undefined) {
      setState({ status: 'error', message: LINK_UNUSABLE, canResend: true });
      return;
    }
    api
      .request({ method: 'POST', path: '/accounts/verify', body: { token } })
      .then(() => {
        setState({ status: 'verified' });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiProblem && error.code === 'STATE_CONFLICT') {
          setState({ status: 'error', message: NOT_PENDING, canResend: false });
          return;
        }
        const expired = error instanceof ApiProblem && error.code === 'TOKEN_EXPIRED';
        setState({ status: 'error', message: messageFor(error), canResend: expired });
      });
  }, []);

  if (state.status === 'error') {
    return (
      <>
        <p role="alert" className="mb-4 font-medium text-danger">
          {state.message}
        </p>
        {state.canResend && <Link href="/conta/reenviar-verificacao">Enviar novo link</Link>}
      </>
    );
  }
  return (
    <>
      <p role="status" className="mb-4">
        {state.status === 'verified'
          ? 'E-mail confirmado. Você já pode entrar.'
          : 'Confirmando seu e-mail…'}
      </p>
      {state.status === 'verified' && <Link href="/entrar">Entrar</Link>}
    </>
  );
}

'use client';
// TL-002 (DC-052): inicial; autenticando; bloqueado; credencial invalida; limite de sessoes;
// indisponivel. Nenhum sucesso e declarado sem a resposta 201 da API (TS-010).
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';

const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

function loginError(error: unknown): string {
  if (error instanceof ApiProblem && error.code === 'AUTHENTICATION_REQUIRED') {
    return INVALID_CREDENTIALS;
  }
  if (error instanceof ApiProblem && error.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
    const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
    return `${messageFor(error)} Aguarde ${String(minutes)} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
  }
  return messageFor(error);
}

export function LoginForm({ next }: { readonly next: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    setSubmitting(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: '/sessions',
        body: { email: field('email'), password: field('password') },
      });
      router.replace(next);
    } catch (caught) {
      setError(loginError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={submitting}>
      <div className="mb-4">
        <label htmlFor="email" className="mb-1 block font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded border border-line p-2"
        />
      </div>
      <div className="mb-4">
        <label htmlFor="password" className="mb-1 block font-medium">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded border border-line p-2"
        />
      </div>
      {error !== undefined && (
        <p role="alert" className="mb-4 font-medium text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-70"
      >
        {submitting ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

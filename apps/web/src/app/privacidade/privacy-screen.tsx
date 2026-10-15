'use client';
// TL-008 (DC-058): carregando; dados; confirmacao destrutiva; reautenticacao; exclusao agendada;
// erro.
//   - dados: direitos automatizados (com link para as telas), canal externo de direitos (RF-011) e
//     prazos de retencao do contrato;
//   - exclusao: avisos, confirmacao textual EXCLUIR MINHA CONTA e senha atual (reautenticacao);
//     senha errada retorna 401 sem excluir: a tela confere a sessao para separar senha errada de
//     sessao encerrada;
//   - 202: o acesso termina na hora (RN-012) e a tela mostra ate quando os dados serao removidos.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from 'react';
import { AppNav } from '@/components/app-nav';
import { FormAlert, TextField } from '@/components/fields';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { formatInstant } from '@/lib/exports';
import { createIdempotencyKeys, textOf, type FieldErrors } from '@/lib/forms';
import {
  DELETION_CONFIRMATION,
  retentionLines,
  rightLinks,
  type DeletionRequest,
  type PrivacySummary,
} from '@/lib/privacy';
import { loginPath, useAccount } from '@/lib/use-account';

const VALIDATION = 'Revise os campos destacados e tente novamente.';
const WRONG_PASSWORD =
  'Não foi possível confirmar a senha. Confira e tente de novo; depois de 5 tentativas erradas, aguarde 15 minutos.';
const ALREADY_REQUESTED = 'A exclusão desta conta já foi solicitada.';

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly summary: PrivacySummary }
  | { readonly status: 'error'; readonly message: string };

export function PrivacyScreen() {
  const router = useRouter();
  const account = useAccount('/privacidade');
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState<DeletionRequest | undefined>();
  const keyFor = useRef(createIdempotencyKeys());
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const loadSummary = useCallback(() => {
    setLoad({ status: 'loading' });
    api
      .request<PrivacySummary>({ method: 'GET', path: '/privacy' })
      .then((response) => {
        setLoad({ status: 'ready', summary: response.body });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiProblem && error.status === 401) {
          router.replace(loginPath('/privacidade'));
          return;
        }
        setLoad({ status: 'error', message: messageFor(error) });
      });
  }, [router]);

  const accountReady = account.status === 'ready';
  useEffect(() => {
    if (accountReady) loadSummary();
  }, [accountReady, loadSummary]);

  useEffect(() => {
    if (deleting) panelHeading.current?.focus();
  }, [deleting]);

  /** 401 da reautenticacao: senha errada (sessao valida) ou sessao encerrada. */
  async function sessionStillValid(): Promise<boolean> {
    try {
      await api.request({ method: 'GET', path: '/accounts/me' });
      return true;
    } catch {
      return false;
    }
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const confirmation = textOf(form, 'confirmation').trim();
    const password = textOf(form, 'password');
    const invalid: Record<string, string> = {};
    if (confirmation !== DELETION_CONFIRMATION) {
      invalid['confirmation'] = `Digite ${DELETION_CONFIRMATION} para confirmar.`;
    }
    if (password === '') invalid['password'] = 'Informe sua senha.';
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setAlert(VALIDATION);
      return;
    }
    const body = { password, confirmation: DELETION_CONFIRMATION };
    setBusy(true);
    setAlert(undefined);
    try {
      const response = await api.request<DeletionRequest>({
        method: 'POST',
        path: '/account-deletions',
        body,
        idempotencyKey: keyFor.current(body),
      });
      setScheduled(response.body);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 401) {
        if (!(await sessionStillValid())) {
          router.replace(loginPath('/privacidade'));
          return;
        }
        setErrors({ password: 'Senha incorreta.' });
        setAlert(WRONG_PASSWORD);
      } else if (error instanceof ApiProblem && error.code === 'STATE_CONFLICT') {
        setAlert(ALREADY_REQUESTED);
      } else {
        setAlert(messageFor(error));
      }
    } finally {
      setBusy(false);
    }
  }

  if (account.status === 'error') return <FormAlert message={account.message} />;
  if (account.status === 'loading') return <p aria-live="polite">Carregando…</p>;

  if (scheduled !== undefined) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Privacidade</h1>
        <div role="status" className="mb-4">
          <p className="font-medium">Exclusão agendada.</p>
          <p>
            Seu acesso foi encerrado em todos os dispositivos. Os dados serão removidos até{' '}
            {formatInstant(scheduled.purge_due_at, account.account.account_timezone)}.
          </p>
        </div>
        <p>
          <Link href="/entrar">Ir para a entrada</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <h1 className="mb-4 text-2xl font-semibold">Privacidade</h1>
      {load.status === 'loading' && <p aria-live="polite">Carregando…</p>}
      {load.status === 'error' && (
        <>
          <FormAlert message={load.message} />
          <button
            type="button"
            onClick={loadSummary}
            className="rounded border border-line px-3 py-1"
          >
            Tentar de novo
          </button>
        </>
      )}
      {load.status === 'ready' && (
        <>
          <h2 className="mb-2 text-xl font-semibold">Seus direitos</h2>
          <ul className="mb-4 list-disc pl-6">
            {rightLinks(load.summary.automated_rights).map(([href, label]) => (
              <li key={href}>
                <Link href={href}>{label}</Link>
              </li>
            ))}
          </ul>
          <p className="mb-6">
            Outros pedidos sobre seus dados são atendidos pelo{' '}
            <a href={load.summary.external_channel} rel="noopener noreferrer">
              Canal de direitos do titular
            </a>
            .
          </p>

          <h2 id="prazos" className="mb-2 text-xl font-semibold">
            Prazos de retenção
          </h2>
          <ul aria-labelledby="prazos" className="mb-6 list-disc pl-6">
            {retentionLines(load.summary.retention).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {load.summary.automated_rights.includes('DELETE_ACCOUNT') &&
            (deleting ? (
              <section aria-labelledby="exclusao-titulo" className="rounded border border-line p-4">
                <h2
                  id="exclusao-titulo"
                  ref={panelHeading}
                  tabIndex={-1}
                  className="mb-2 text-xl font-semibold"
                >
                  Excluir a conta
                </h2>
                <ul className="mb-4 list-disc pl-6">
                  <li>O acesso termina na hora, em todos os dispositivos.</li>
                  <li>
                    Planos, ocorrências, respostas e exportações são removidos em até{' '}
                    {load.summary.retention.account_purge_days} dias.
                  </li>
                  <li>Esta ação não pode ser desfeita.</li>
                </ul>
                <form onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
                  <TextField
                    id="confirmation"
                    label={`Para confirmar, digite ${DELETION_CONFIRMATION}`}
                    autoComplete="off"
                    error={errors['confirmation']}
                  />
                  <TextField
                    id="password"
                    label="Senha atual"
                    type="password"
                    autoComplete="current-password"
                    maxLength={72}
                    error={errors['password']}
                  />
                  <FormAlert message={alert} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-danger px-4 py-2 font-medium text-white disabled:opacity-70"
                    >
                      {busy ? 'Excluindo…' : 'Excluir conta definitivamente'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleting(false);
                        setErrors({});
                        setAlert(undefined);
                      }}
                      className="rounded border border-line px-4 py-2"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </section>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDeleting(true);
                }}
                className="rounded border border-danger px-4 py-2 text-danger"
              >
                Excluir minha conta
              </button>
            ))}
        </>
      )}
    </>
  );
}

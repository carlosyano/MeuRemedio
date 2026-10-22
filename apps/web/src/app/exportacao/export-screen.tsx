'use client';
// TL-007 (DC-057): solicitando; processando; concluida; falha; expirada; sem permissao.
//   - solicitar: periodo com a regra do historico (DC-041), Idempotency-Key estavel para o mesmo
//     periodo; o 202 leva a /exportacao?pedido=<id>, que guarda o pedido no endereco; abaixo do
//     formulario ficam as exportacoes recentes (listExports, DEC-034);
//   - acompanhar: consulta a cada 2 s enquanto REQUESTED ou PROCESSING, com cancelamento (CA-016);
//   - concluida: link de download do PDF ate expires_at (24 h, RN-011); expirada mostra o ERR-012
//     (CA-011); pedido inexistente ou de outro titular mostra o ERR-003, sem dado do pedido.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from 'react';
import { AppNav } from '@/components/app-nav';
import { FormAlert, SubmitButton, TextField } from '@/components/fields';
import { ApiProblem, catalogMessage, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { createIdempotencyKeys, textOf, type FieldErrors } from '@/lib/forms';
import { formatInstant, isPending, type ExportRequest } from '@/lib/exports';
import { defaultPeriod, validatePeriod } from '@/lib/history';
import { formatDate, todayIn } from '@/lib/plan-form';
import { loginPath, useAccount } from '@/lib/use-account';
import { RecentExports } from './recent-exports';

const POLL_MS = 2_000;
const VALIDATION = 'Revise os campos destacados e tente novamente.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILURES: Readonly<Record<string, string>> = {
  TECHNICAL_FAILURE: 'Não foi possível gerar o PDF. Solicite uma nova exportação.',
  ACCOUNT_NOT_ACTIVE: 'Não foi possível gerar o PDF porque a conta não está ativa.',
};
const ALREADY_FINISHED = 'Esta exportação já terminou e não pode mais ser cancelada.';

type Tracking =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly request: ExportRequest }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

function NewExportLink() {
  return (
    <p className="mt-4">
      <Link href="/exportacao">Nova exportação</Link>
    </p>
  );
}

export function ExportScreen() {
  const router = useRouter();
  const pedido = useSearchParams().get('pedido');
  const path = pedido === null ? '/exportacao' : `/exportacao?pedido=${pedido}`;
  const account = useAccount(path);
  const [tracking, setTracking] = useState<Tracking>({ status: 'loading' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const keyFor = useRef(createIdempotencyKeys());

  const handle401 = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ApiProblem && error.status === 401) {
        router.replace(loginPath(path));
        return true;
      }
      return false;
    },
    [path, router],
  );

  const fetchExport = useCallback(
    async (id: string): Promise<void> => {
      if (!UUID_PATTERN.test(id)) {
        setTracking({ status: 'not-found' });
        return;
      }
      try {
        const response = await api.request<ExportRequest>({
          method: 'GET',
          path: `/exports/${id}`,
        });
        setTracking({ status: 'ready', request: response.body });
      } catch (error) {
        if (handle401(error)) return;
        if (error instanceof ApiProblem && error.status === 404) {
          setTracking({ status: 'not-found' });
        } else {
          setTracking({ status: 'error', message: messageFor(error) });
        }
      }
    },
    [handle401],
  );

  const accountReady = account.status === 'ready';
  useEffect(() => {
    if (!accountReady || pedido === null) return;
    setAlert(undefined);
    void fetchExport(pedido);
  }, [accountReady, pedido, fetchExport]);

  // Consulta de novo enquanto o pedido esta em andamento.
  const pendingId =
    tracking.status === 'ready' && isPending(tracking.request.status)
      ? tracking.request.export_id
      : undefined;
  useEffect(() => {
    if (pendingId === undefined) return;
    const timer = setTimeout(() => void fetchExport(pendingId), POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pendingId, tracking, fetchExport]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = textOf(form, 'start');
    const end = textOf(form, 'end');
    const invalid = validatePeriod(start, end);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setAlert(VALIDATION);
      return;
    }
    const body = { start_date: start, end_date: end };
    setBusy(true);
    setAlert(undefined);
    try {
      const response = await api.request<ExportRequest>({
        method: 'POST',
        path: '/exports',
        body,
        idempotencyKey: keyFor.current(body),
      });
      setTracking({ status: 'ready', request: response.body });
      router.replace(`/exportacao?pedido=${response.body.export_id}`);
    } catch (error) {
      if (handle401(error)) return;
      // O 422 da regra de periodo vem em end_date (DC-042).
      const periodError =
        error instanceof ApiProblem
          ? error.fieldErrors.find((item) => item.field === 'end_date')
          : undefined;
      setErrors(periodError === undefined ? {} : { end: periodError.message });
      setAlert(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string): Promise<void> {
    setBusy(true);
    setAlert(undefined);
    try {
      await api.request({ method: 'DELETE', path: `/exports/${id}` });
    } catch (error) {
      if (handle401(error)) return;
      setAlert(
        error instanceof ApiProblem && error.code === 'STATE_CONFLICT'
          ? ALREADY_FINISHED
          : messageFor(error),
      );
    } finally {
      setBusy(false);
    }
    await fetchExport(id);
  }

  if (account.status === 'error') return <FormAlert message={account.message} />;
  if (account.status === 'loading') return <p aria-live="polite">Carregando…</p>;
  const timeZone = account.account.account_timezone;

  const header = (
    <>
      <AppNav />
      <h1 className="mb-4 text-2xl font-semibold">Exportar histórico</h1>
    </>
  );

  if (pedido === null) {
    const initial = defaultPeriod(todayIn(timeZone));
    return (
      <>
        {header}
        <p className="mb-4">
          Gera um PDF com as ocorrências e respostas do período. O arquivo fica disponível por 24
          horas e é um registro declaratório, não uma prescrição.
        </p>
        <form onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <TextField
              id="start"
              label="Data inicial"
              type="date"
              defaultValue={initial.start}
              error={errors['start']}
            />
            <TextField
              id="end"
              label="Data final"
              type="date"
              description="Período de até 12 meses."
              defaultValue={initial.end}
              error={errors['end']}
            />
          </div>
          <FormAlert message={alert} />
          <SubmitButton label="Solicitar PDF" busyLabel="Solicitando…" busy={busy} />
        </form>
        <RecentExports timeZone={timeZone} />
      </>
    );
  }

  if (tracking.status === 'loading') {
    return (
      <>
        {header}
        <p aria-live="polite">Carregando…</p>
      </>
    );
  }
  if (tracking.status === 'not-found' || tracking.status === 'error') {
    return (
      <>
        {header}
        <FormAlert
          message={
            tracking.status === 'error' ? tracking.message : catalogMessage('RESOURCE_NOT_FOUND')
          }
        />
        <NewExportLink />
      </>
    );
  }

  const request = tracking.request;
  const period = `Período: ${formatDate(request.start_date)} a ${formatDate(request.end_date)}`;
  return (
    <>
      {header}
      <p className="mb-4">{period}</p>
      <FormAlert message={alert} />
      {isPending(request.status) && (
        <>
          <p role="status" className="mb-4">
            Gerando o PDF… Esta página se atualiza sozinha.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancel(request.export_id)}
            className="rounded border border-line px-3 py-1 disabled:opacity-70"
          >
            Cancelar exportação
          </button>
        </>
      )}
      {request.status === 'COMPLETED' && (
        <>
          <div role="status" className="mb-4">
            <p className="font-medium">PDF pronto.</p>
            {request.expires_at !== null && (
              <p>Disponível até {formatInstant(request.expires_at, timeZone)}.</p>
            )}
          </div>
          <a
            href={`/api/exports/${request.export_id}/file`}
            download
            className="inline-block rounded bg-accent px-4 py-2 font-medium text-white"
          >
            Baixar PDF
          </a>
          <NewExportLink />
        </>
      )}
      {request.status === 'CANCELED' && (
        <>
          <p role="status" className="font-medium">
            Exportação cancelada.
          </p>
          <NewExportLink />
        </>
      )}
      {request.status === 'FAILED' && (
        <>
          <FormAlert
            message={FAILURES[request.failure_reason ?? ''] ?? FAILURES['TECHNICAL_FAILURE']}
          />
          <NewExportLink />
        </>
      )}
      {request.status === 'EXPIRED' && (
        <>
          <FormAlert message={catalogMessage('RESOURCE_EXPIRED')} />
          <NewExportLink />
        </>
      )}
    </>
  );
}

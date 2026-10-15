'use client';
// TL-006 (DC-056): filtros; carregando; vazio; resultados; periodo invalido; erro.
//   - periodo padrao: os ultimos 30 dias no fuso da conta; consulta ao abrir a tela;
//   - a tela confere a regra de periodo da API (DC-041) antes de consultar; a API confere de novo;
//   - ocorrencias ja alcancadas, sem as canceladas, da mais recente para a mais antiga, com a
//     resposta de cada uma; as de plano excluido continuam (TS-037);
//   - 20 por pagina, com "Carregar mais" pelo cursor; erro nao mostra resultado falso (TS-010).
import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { FormAlert, SubmitButton, TextField } from '@/components/fields';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { apiFieldErrors, textOf, type FieldErrors } from '@/lib/forms';
import { defaultPeriod, outcomeText, validatePeriod, type HistoryResponse } from '@/lib/history';
import type { Occurrence } from '@/lib/occurrences';
import { formatDate, todayIn } from '@/lib/plan-form';
import { loginPath, useAccount } from '@/lib/use-account';

const VALIDATION = 'Revise os campos destacados e tente novamente.';

interface HistoryItem {
  readonly occurrence: Occurrence;
  readonly response: (HistoryResponse & { readonly response_id: string }) | null;
}

interface HistoryPage {
  readonly items: readonly HistoryItem[];
  readonly page: { readonly next_cursor: string | null; readonly limit: number };
}

interface Period {
  readonly start: string;
  readonly end: string;
}

type ResultState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly items: readonly HistoryItem[];
      readonly next: string | null;
    }
  | { readonly status: 'error'; readonly message: string };

export function HistoryScreen() {
  const router = useRouter();
  const account = useAccount('/historico');
  const [initial, setInitial] = useState<Period | undefined>();
  const [query, setQuery] = useState<Period | undefined>();
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | undefined>();

  const fetchPage = useCallback(
    async (period: Period, cursor: string | null): Promise<HistoryPage | undefined> => {
      const params = new URLSearchParams({ start: period.start, end: period.end, limit: '20' });
      if (cursor !== null) params.set('cursor', cursor);
      try {
        return (await api.request<HistoryPage>({ method: 'GET', path: `/history?${params}` })).body;
      } catch (error) {
        if (error instanceof ApiProblem && error.status === 401) {
          router.replace(loginPath('/historico'));
          return undefined;
        }
        throw error;
      }
    },
    [router],
  );

  const consult = useCallback(
    (period: Period) => {
      setQuery(period);
      setResult({ status: 'loading' });
      setAlert(undefined);
      setMoreError(undefined);
      fetchPage(period, null)
        .then((page) => {
          if (page !== undefined) {
            setResult({ status: 'ready', items: page.items, next: page.page.next_cursor });
          }
        })
        .catch((error: unknown) => {
          const fieldErrors = apiFieldErrors(error, ['start', 'end']);
          setErrors(fieldErrors);
          if (Object.keys(fieldErrors).length > 0) {
            setAlert(messageFor(error));
            setResult({ status: 'idle' });
          } else {
            setResult({ status: 'error', message: messageFor(error) });
          }
        });
    },
    [fetchPage],
  );

  const timeZone = account.status === 'ready' ? account.account.account_timezone : undefined;
  useEffect(() => {
    if (timeZone === undefined) return;
    const period = defaultPeriod(todayIn(timeZone));
    setInitial(period);
    consult(period);
  }, [timeZone, consult]);

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const period = { start: textOf(form, 'start'), end: textOf(form, 'end') };
    const invalid = validatePeriod(period.start, period.end);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setAlert(VALIDATION);
      setResult({ status: 'idle' });
      return;
    }
    consult(period);
  }

  async function loadMore(): Promise<void> {
    if (result.status !== 'ready' || result.next === null || query === undefined) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await fetchPage(query, result.next);
      if (page !== undefined) {
        setResult({
          status: 'ready',
          items: [...result.items, ...page.items],
          next: page.page.next_cursor,
        });
      }
    } catch (error) {
      setMoreError(messageFor(error));
    } finally {
      setLoadingMore(false);
    }
  }

  if (account.status === 'error') return <FormAlert message={account.message} />;
  if (account.status === 'loading' || initial === undefined) {
    return <p aria-live="polite">Carregando…</p>;
  }

  return (
    <>
      <AppNav />
      <h1 className="mb-4 text-2xl font-semibold">Histórico</h1>
      <form onSubmit={onSubmit} noValidate aria-busy={result.status === 'loading'} className="mb-6">
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
        <SubmitButton
          label="Consultar"
          busyLabel="Consultando…"
          busy={result.status === 'loading'}
        />
      </form>

      {result.status === 'loading' && <p aria-live="polite">Carregando…</p>}
      {result.status === 'error' && (
        <>
          <FormAlert message={result.message} />
          <button
            type="button"
            onClick={() => {
              if (query !== undefined) consult(query);
            }}
            className="rounded border border-line px-3 py-1"
          >
            Tentar de novo
          </button>
        </>
      )}
      {result.status === 'ready' && result.items.length === 0 && <p>Nenhum registro no período.</p>}
      {result.status === 'ready' && result.items.length > 0 && (
        <>
          <ul className="divide-y divide-line">
            {result.items.map(({ occurrence, response }) => (
              <li key={occurrence.occurrence_id} className="py-3">
                <p className="font-semibold">
                  {formatDate(occurrence.local_scheduled_date)}, {occurrence.local_time}
                </p>
                <p>
                  {occurrence.medication_name_snapshot} · {occurrence.dose_text_snapshot}
                </p>
                <p>{outcomeText(occurrence, response)}</p>
              </li>
            ))}
          </ul>
          {result.next !== null && (
            <div className="mt-4">
              <FormAlert message={moreError} />
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded border border-line px-3 py-1"
              >
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

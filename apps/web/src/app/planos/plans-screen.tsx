'use client';
// TL-003 (DC-054): carregando; lista vazia; lista; erro; sem permissao; conflito de versao.
// 20 por pagina com cursor (RNF-010). Sem sessao leva a entrada (TS-019); o conflito de versao
// aparece no editor, que oferece recarregar o plano.
// Grupos pela situacao (DEC-036): em andamento, finalizados (ativo com termino antes de hoje no fuso
// da conta), interrompidos (com o motivo) e cancelados; grupo vazio nao aparece.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { FormAlert } from '@/components/fields';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { describeForm, formatPeriod, todayIn, type Plan } from '@/lib/plan-form';
import { PLAN_GROUPS, planGroup, statusReasonText } from '@/lib/plan-status';
import { loginPath, useAccount } from '@/lib/use-account';

interface PlanPage {
  readonly items: readonly Plan[];
  readonly page: { readonly next_cursor: string | null; readonly limit: number };
}

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly Plan[]; readonly next: string | null }
  | { readonly status: 'error'; readonly message: string };

/** Aviso que o editor deixa ao voltar para a lista. */
const NOTICES: Readonly<Record<string, string>> = {
  criado: 'Plano criado.',
  salvo: 'Plano salvo.',
  excluido: 'Plano excluído.',
};

export function PlansScreen() {
  const router = useRouter();
  const account = useAccount('/planos');
  const aviso = useSearchParams().get('aviso');
  const [notice] = useState(() => (aviso === null ? undefined : NOTICES[aviso]));
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | undefined>();

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<PlanPage | undefined> => {
      const query = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      try {
        return (await api.request<PlanPage>({ method: 'GET', path: `/plans?limit=20${query}` }))
          .body;
      } catch (error) {
        if (error instanceof ApiProblem && error.status === 401) {
          router.replace(loginPath('/planos'));
          return undefined;
        }
        throw error;
      }
    },
    [router],
  );

  const loadFirst = useCallback(() => {
    setState({ status: 'loading' });
    fetchPage(null)
      .then((page) => {
        if (page !== undefined) {
          setState({ status: 'ready', items: page.items, next: page.page.next_cursor });
        }
      })
      .catch((error: unknown) => {
        setState({ status: 'error', message: messageFor(error) });
      });
  }, [fetchPage]);

  useEffect(() => {
    // O aviso vale uma vez: some da URL para nao reaparecer ao recarregar.
    if (aviso !== null) window.history.replaceState(null, '', '/planos');
    loadFirst();
    // So na montagem: o aviso lido da URL nao deve recarregar a lista.
  }, []);

  async function loadMore(): Promise<void> {
    if (state.status !== 'ready' || state.next === null) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await fetchPage(state.next);
      if (page !== undefined) {
        setState({
          status: 'ready',
          items: [...state.items, ...page.items],
          next: page.page.next_cursor,
        });
      }
    } catch (error) {
      setMoreError(messageFor(error));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <AppNav />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Planos</h1>
        <Link href="/planos/novo" className="rounded bg-accent px-4 py-2 font-medium text-white">
          Novo plano
        </Link>
      </div>
      {notice !== undefined && (
        <p role="status" className="mb-4 font-medium">
          {notice}
        </p>
      )}
      {(state.status === 'loading' || account.status === 'loading') && (
        <p aria-live="polite">Carregando…</p>
      )}
      {account.status === 'error' && <FormAlert message={account.message} />}
      {state.status === 'error' && (
        <>
          <FormAlert message={state.message} />
          <button
            type="button"
            onClick={loadFirst}
            className="rounded border border-line px-3 py-1"
          >
            Tentar de novo
          </button>
        </>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p>Você ainda não cadastrou planos.</p>
      )}
      {state.status === 'ready' && state.items.length > 0 && account.status === 'ready' && (
        <>
          <PlanGroups items={state.items} today={todayIn(account.account.account_timezone)} />
          {state.next !== null && (
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

function PlanGroups(props: { readonly items: readonly Plan[]; readonly today: string }) {
  return (
    <>
      {PLAN_GROUPS.map(([group, title]) => {
        const plans = props.items.filter((plan) => planGroup(plan, props.today) === group);
        if (plans.length === 0) return null;
        const headingId = `grupo-${group.toLowerCase()}`;
        return (
          <section key={group} aria-labelledby={headingId} className="mb-6">
            <h2 id={headingId} className="mb-2 text-lg font-semibold">
              {title}
            </h2>
            <ul className="divide-y divide-line">
              {plans.map((plan) => (
                <li key={plan.plan_id} className="py-3">
                  <Link href={`/planos/${plan.plan_id}`} className="font-semibold">
                    {plan.medication_name}
                  </Link>
                  <p>
                    {plan.dose_text} ·{' '}
                    {describeForm(plan.medication_form, plan.administration_route)}
                  </p>
                  <p>Horários: {plan.schedule_times.join(', ')}</p>
                  <p className="text-sm text-muted">
                    {formatPeriod(plan.start_date, plan.end_date)}
                  </p>
                  {plan.status !== 'ACTIVE' && plan.status_reason !== null && (
                    <p className="text-sm">
                      Motivo: {statusReasonText(plan.status, plan.status_reason)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

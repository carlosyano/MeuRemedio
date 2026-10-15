'use client';
// TL-005 na tela Hoje (DC-055): carregando; vazio; acionavel; respondendo; sucesso; conflito;
// desconectado.
//   - acionaveis: PROGRAMMED e NO_RESPONSE ja alcancadas, da mais recente para a mais antiga
//     (DC-036); a lista e consultada de novo a cada 60 s enquanto a pagina esta aberta (RF-005);
//   - resposta TAKEN ou NOT_TAKEN (motivo opcional), uma unica vez (RN-008); resposta tardia e
//     permitida (RN-009); 409 STATE_CONFLICT (ERR-007) atualiza a lista;
//   - consulta que falha ou navegador sem rede: aviso de desconectado, mantendo a ultima lista;
//     nada e enfileirado e o sucesso so aparece com a resposta da API (RN-015, TS-010);
//   - tempo limite (30 s): repetir usa a mesma Idempotency-Key e nao registra duas vezes (CA-013).
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { FormAlert } from '@/components/fields';
import { ApiProblem, ApiTimeout, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { createIdempotencyKeys } from '@/lib/forms';
import {
  NOT_TAKEN_REASONS,
  responseBody,
  whenText,
  type NotTakenReason,
  type Occurrence,
  type ResponseType,
} from '@/lib/occurrences';
import { todayIn } from '@/lib/plan-form';
import { loginPath, useAccount } from '@/lib/use-account';

const POLL_MS = 60_000;
/** Maximo do contrato; as mais antigas ficam no historico (TL-006). */
const PAGE_LIMIT = 100;
const TIMEOUT =
  'A resposta demorou demais e não sabemos se foi registrada. Tente de novo: o envio repetido não registra duas vezes.';
const DISCONNECTED = 'Sem conexão com o serviço. A lista pode estar desatualizada.';

interface OccurrencePage {
  readonly items: readonly Occurrence[];
  readonly page: { readonly next_cursor: string | null; readonly limit: number };
}

interface Pending {
  readonly occurrenceId: string;
  readonly type: ResponseType;
}

export function TodayScreen() {
  const router = useRouter();
  const account = useAccount('/hoje');
  const [items, setItems] = useState<readonly Occurrence[] | undefined>();
  const [truncated, setTruncated] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending | undefined>();
  const [declining, setDeclining] = useState<string | undefined>();
  const [reason, setReason] = useState<NotTakenReason | ''>('');
  const [leaving, setLeaving] = useState(false);
  const keys = useRef(new Map<string, (payload: unknown) => string>());

  const accountReady = account.status === 'ready';

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await api.request<OccurrencePage>({
        method: 'GET',
        path: `/occurrences?status=PROGRAMMED,NO_RESPONSE&limit=${String(PAGE_LIMIT)}`,
      });
      setItems(response.body.items);
      setTruncated(response.body.page.next_cursor !== null);
      setDisconnected(false);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 401) {
        router.replace(loginPath('/hoje'));
        return;
      }
      setDisconnected(true);
    }
  }, [router]);

  useEffect(() => {
    if (!accountReady) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const offline = (): void => {
      setDisconnected(true);
    };
    const online = (): void => {
      void refresh();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      clearInterval(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [accountReady, refresh]);

  async function respond(
    occurrence: Occurrence,
    type: ResponseType,
    chosen: NotTakenReason | null,
  ): Promise<void> {
    const id = occurrence.occurrence_id;
    setPending({ occurrenceId: id, type });
    setAlert(undefined);
    setNotice(undefined);
    const body = responseBody(type, chosen);
    let keyFor = keys.current.get(id);
    if (keyFor === undefined) {
      keyFor = createIdempotencyKeys();
      keys.current.set(id, keyFor);
    }
    try {
      await api.request({
        method: 'POST',
        path: `/occurrences/${id}/responses`,
        body,
        idempotencyKey: keyFor(body),
      });
      const verb = type === 'TAKEN' ? 'tomei' : 'não tomei';
      setNotice(
        `Resposta registrada: ${verb} ${occurrence.medication_name_snapshot} (${occurrence.local_time}).`,
      );
      setItems((current) => current?.filter((item) => item.occurrence_id !== id));
      setDeclining(undefined);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 401) {
        router.replace(loginPath('/hoje'));
        return;
      }
      setAlert(error instanceof ApiTimeout ? TIMEOUT : messageFor(error));
      // Ja respondida, cancelada ou de plano excluido: a lista atual mostra o estado certo.
      if (error instanceof ApiProblem && (error.status === 409 || error.status === 404)) {
        setDeclining(undefined);
        void refresh();
      }
    } finally {
      setPending(undefined);
    }
  }

  async function signOut(): Promise<void> {
    setLeaving(true);
    setAlert(undefined);
    try {
      await api.request({ method: 'DELETE', path: '/sessions/current' });
      router.replace('/entrar');
    } catch (caught) {
      setAlert(messageFor(caught));
      setLeaving(false);
    }
  }

  if (account.status === 'loading') return <p aria-live="polite">Carregando…</p>;
  if (account.status === 'error') return <FormAlert message={account.message} />;

  const today = todayIn(account.account.account_timezone);
  return (
    <>
      <AppNav />
      <div className="mb-4 flex items-center justify-between gap-4">
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
      <p className="mb-4">Olá, {account.account.name}</p>

      <div aria-live="polite">
        {disconnected && (
          <div className="mb-4 rounded border border-line p-3">
            <p className="mb-2 font-medium">{DISCONNECTED}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded border border-line px-3 py-1"
            >
              Tentar agora
            </button>
          </div>
        )}
      </div>
      {notice !== undefined && (
        <p role="status" className="mb-4 font-medium">
          {notice}
        </p>
      )}
      <FormAlert message={alert} />

      <h2 className="mb-2 text-xl font-semibold">Para registrar</h2>
      {items === undefined && !disconnected && <p aria-live="polite">Carregando…</p>}
      {items?.length === 0 && <p>Nada para registrar agora.</p>}
      {items !== undefined && items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((occurrence) => {
            const id = occurrence.occurrence_id;
            const busy = pending !== undefined;
            const mine = pending?.occurrenceId === id;
            return (
              <li key={id} className="py-3">
                <p className="font-semibold">
                  {occurrence.medication_name_snapshot}{' '}
                  <span className="font-normal">· {occurrence.dose_text_snapshot}</span>
                </p>
                <p>{whenText(occurrence, today)}</p>
                {occurrence.status === 'NO_RESPONSE' && (
                  <p className="text-sm text-muted">Sem resposta no prazo de 60 minutos.</p>
                )}
                {declining === id ? (
                  <div className="mt-2">
                    <fieldset className="mb-2">
                      <legend className="mb-1 font-medium">Motivo (opcional)</legend>
                      {[['', 'Prefiro não informar'] as const, ...NOT_TAKEN_REASONS].map(
                        ([value, label]) => (
                          <div key={value} className="flex items-center gap-2">
                            <input
                              type="radio"
                              id={`motivo-${id}-${value || 'nenhum'}`}
                              name={`motivo-${id}`}
                              value={value}
                              checked={reason === value}
                              onChange={() => {
                                setReason(value);
                              }}
                              className="size-5"
                            />
                            <label htmlFor={`motivo-${id}-${value || 'nenhum'}`}>{label}</label>
                          </div>
                        ),
                      )}
                    </fieldset>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void respond(occurrence, 'NOT_TAKEN', reason === '' ? null : reason)
                        }
                        className="rounded bg-accent px-3 py-1 font-medium text-white disabled:opacity-70"
                      >
                        {mine ? 'Registrando…' : 'Confirmar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeclining(undefined);
                        }}
                        className="rounded border border-line px-3 py-1"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void respond(occurrence, 'TAKEN', null)}
                      className="rounded bg-accent px-3 py-1 font-medium text-white disabled:opacity-70"
                    >
                      {mine && pending.type === 'TAKEN' ? 'Registrando…' : 'Tomei'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setReason('');
                        setDeclining(id);
                      }}
                      className="rounded border border-line px-3 py-1 disabled:opacity-70"
                    >
                      Não tomei
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {truncated && (
        <p className="mt-4 text-sm text-muted">
          Mostrando as {PAGE_LIMIT} mais recentes. As anteriores ficam no histórico.
        </p>
      )}
    </>
  );
}

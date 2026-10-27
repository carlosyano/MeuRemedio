'use client';
// Situacao do plano na tela do plano (DEC-036): cancelar o que ainda nao comecou, interromper o que
// esta em andamento e retomar o interrompido, sempre com motivo e observacao opcional.
//   - so oferece as acoes que a API aceitaria hoje (allowedActions); a API confere de novo;
//   - envio com If-Match do ETag lido e Idempotency-Key ligada a versao, como na edicao;
//   - o resultado so aparece com a resposta da API (RN-015).
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { SubmitButton, TextAreaField } from '@/components/fields';
import { api } from '@/lib/browser-api';
import { createIdempotencyKeys, textOf } from '@/lib/forms';
import type { Plan } from '@/lib/plan-form';
import {
  RESUME_REASONS,
  STOP_REASONS,
  allowedActions,
  type PlanStatusAction,
} from '@/lib/plan-status';

const NOTE_MAX = 200;
const REASON_REQUIRED = 'Escolha o motivo.';

interface ActionText {
  readonly open: string;
  readonly title: string;
  readonly explanation: string;
  readonly confirm: string;
  readonly done: string;
}

const TEXTS: Readonly<Record<PlanStatusAction, ActionText>> = {
  CANCEL: {
    open: 'Cancelar plano',
    title: 'Cancelar este plano?',
    explanation:
      'O plano ainda não começou. Cancelado, ele não gera horários e não pode ser retomado.',
    confirm: 'Confirmar cancelamento',
    done: 'Plano cancelado.',
  },
  INTERRUPT: {
    open: 'Interromper plano',
    title: 'Interromper este plano?',
    explanation:
      'Os próximos horários deixam de aparecer. O que já foi registrado é mantido, e você pode retomar o plano depois.',
    confirm: 'Confirmar interrupção',
    done: 'Plano interrompido.',
  },
  RESUME: {
    open: 'Retomar plano',
    title: 'Retomar este plano?',
    explanation: 'Os horários voltam a partir de agora. O período interrompido não é recriado.',
    confirm: 'Confirmar retomada',
    done: 'Plano retomado.',
  },
};

export function PlanStatusPanel(props: {
  readonly plan: Plan;
  readonly etag: string;
  readonly today: string;
  readonly onChanged: (plan: Plan, etag: string, notice: string) => void;
  readonly onFailed: (error: unknown) => void;
}) {
  const [action, setAction] = useState<PlanStatusAction | undefined>();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const keyFor = useRef(createIdempotencyKeys());
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (action !== undefined) heading.current?.focus();
  }, [action]);

  const actions = allowedActions(props.plan, props.today);
  if (actions.length === 0) return null;

  function close(): void {
    setAction(undefined);
    setReason('');
    setReasonError(undefined);
  }

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (action === undefined) return;
    if (reason === '') {
      setReasonError(REASON_REQUIRED);
      return;
    }
    setReasonError(undefined);
    const note = textOf(new FormData(event.currentTarget), 'status_note').trim();
    const body = { action, reason, note: note === '' ? null : note };
    setBusy(true);
    try {
      const response = await api.request<Plan>({
        method: 'POST',
        path: `/plans/${props.plan.plan_id}/status-changes`,
        body,
        headers: { 'if-match': props.etag },
        // A chave considera a versao: depois de recarregar, o mesmo corpo e outro pedido.
        idempotencyKey: keyFor.current({ etag: props.etag, body }),
      });
      const done = TEXTS[action].done;
      close();
      props.onChanged(response.body, response.headers.get('etag') ?? '', done);
    } catch (error) {
      props.onFailed(error);
    } finally {
      setBusy(false);
    }
  }

  if (action === undefined) {
    return (
      <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-4">
        {actions.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setAction(item);
            }}
            className="rounded border border-line px-4 py-2"
          >
            {TEXTS[item].open}
          </button>
        ))}
      </div>
    );
  }

  const text = TEXTS[action];
  const reasons = action === 'RESUME' ? RESUME_REASONS : STOP_REASONS;
  const errorId = reasonError === undefined ? undefined : 'motivo-situacao-erro';
  return (
    <section aria-labelledby="situacao-titulo" className="mt-8 border-t border-line pt-4">
      <h2 id="situacao-titulo" ref={heading} tabIndex={-1} className="mb-2 text-lg font-semibold">
        {text.title}
      </h2>
      <p className="mb-4">{text.explanation}</p>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <fieldset className="mb-4" aria-describedby={errorId}>
          <legend className="mb-1 font-medium">Motivo</legend>
          {reasons.map(([value, label]) => (
            <div key={value} className="flex items-center gap-2">
              <input
                type="radio"
                id={`motivo-situacao-${value}`}
                name="status_reason"
                value={value}
                checked={reason === value}
                onChange={() => {
                  setReason(value);
                }}
                className="size-5"
              />
              <label htmlFor={`motivo-situacao-${value}`}>{label}</label>
            </div>
          ))}
          {reasonError !== undefined && (
            <p id={errorId} className="mt-1 text-sm font-medium text-danger">
              {reasonError}
            </p>
          )}
        </fieldset>
        <TextAreaField id="status_note" label="Observação (opcional)" maxLength={NOTE_MAX} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton label={text.confirm} busyLabel="Enviando…" busy={busy} />
          <button type="button" onClick={close} className="rounded border border-line px-4 py-2">
            Voltar
          </button>
        </div>
      </form>
    </section>
  );
}

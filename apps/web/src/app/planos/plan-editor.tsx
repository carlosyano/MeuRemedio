'use client';
// TL-004 (DC-054): novo; editando; validacao; confirmacao de possivel duplicidade; salvando;
// sucesso; conflito; timeout.
//   - a tela confere as regras do contrato antes de enviar; a API confere de novo;
//   - criacao com duplicidade (RN-016): mostra os candidatos; confirmar reenvia com o token e uma
//     nova Idempotency-Key (o corpo muda, entao a chave muda);
//   - edicao com If-Match do ETag lido; 409 VERSION_CONFLICT (ERR-005) oferece recarregar o plano;
//   - tempo limite (30 s): o efeito e desconhecido; repetir o mesmo envio usa a mesma chave e a API
//     devolve o resultado original (CA-013), sem plano em dobro;
//   - plano inexistente, excluido ou de outro titular: 404 (ERR-003), sem dado do plano.
// Sucesso so com a resposta da API (RN-015).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from '@/components/fields';
import {
  ApiProblem,
  ApiTimeout,
  catalogMessage,
  messageFor,
  type DuplicateConfirmation,
} from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { apiFieldErrors, createIdempotencyKeys, textOf, type FieldErrors } from '@/lib/forms';
import {
  ADMINISTRATION_ROUTES,
  MAX_SCHEDULE_TIMES,
  MEDICATION_FORMS,
  toFormInput,
  toPlanPayload,
  todayIn,
  validatePlanForm,
  type Plan,
  type PlanFormInput,
  type PlanPayload,
} from '@/lib/plan-form';
import { loginPath, useAccount } from '@/lib/use-account';

const VALIDATION = 'Revise os campos destacados e tente novamente.';
const TIMEOUT =
  'A resposta demorou demais e não sabemos se o plano foi salvo. Tente salvar de novo: o envio repetido não cria outro plano.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = [
  'medication_name',
  'dose_text',
  'medication_form',
  'administration_route',
  'instructions',
  'prescriber_name',
  'prescriber_crm',
  'start_date',
  'end_date',
  'schedule_times',
];

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly initial: PlanFormInput; readonly etag?: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

interface PendingDuplicate extends DuplicateConfirmation {
  readonly payload: PlanPayload;
}

const emptyPlan = (startDate: string): PlanFormInput => ({
  medication_name: '',
  dose_text: '',
  medication_form: '',
  administration_route: '',
  instructions: '',
  prescriber_name: '',
  prescriber_crm: '',
  start_date: startDate,
  end_date: '',
  schedule_times: [''],
});

export function PlanEditor({ planId }: { readonly planId?: string }) {
  const router = useRouter();
  const path = planId === undefined ? '/planos/novo' : `/planos/${planId}`;
  const account = useAccount(path);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // Muda a cada carga para remontar os campos com os valores novos.
  const [formKey, setFormKey] = useState(0);
  const [times, setTimes] = useState<readonly string[]>(['']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [duplicate, setDuplicate] = useState<PendingDuplicate | undefined>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const keyFor = useRef(createIdempotencyKeys());
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const ready = useCallback((initial: PlanFormInput, etag?: string) => {
    setLoad(etag === undefined ? { status: 'ready', initial } : { status: 'ready', initial, etag });
    setTimes(initial.schedule_times);
    setFormKey((key) => key + 1);
  }, []);

  const loadPlan = useCallback(() => {
    if (planId === undefined) return;
    if (!UUID_PATTERN.test(planId)) {
      setLoad({ status: 'not-found' });
      return;
    }
    setLoad({ status: 'loading' });
    api
      .request<Plan>({ method: 'GET', path: `/plans/${planId}` })
      .then((response) => {
        ready(toFormInput(response.body), response.headers.get('etag') ?? undefined);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiProblem && error.status === 401) {
          router.replace(loginPath(path));
        } else if (error instanceof ApiProblem && error.status === 404) {
          setLoad({ status: 'not-found' });
        } else {
          setLoad({ status: 'error', message: messageFor(error) });
        }
      });
  }, [planId, path, ready, router]);

  const accountReady = account.status === 'ready';
  const timeZone = accountReady ? account.account.account_timezone : undefined;
  useEffect(() => {
    if (timeZone === undefined) return;
    if (planId === undefined) ready(emptyPlan(todayIn(timeZone)));
    else loadPlan();
  }, [timeZone, planId, ready, loadPlan]);

  useEffect(() => {
    if (duplicate !== undefined || confirmingDelete) panelHeading.current?.focus();
  }, [duplicate, confirmingDelete]);

  function failed(error: unknown): void {
    if (error instanceof ApiProblem && error.status === 401) {
      router.replace(loginPath(path));
      return;
    }
    if (error instanceof ApiProblem && error.status === 404) {
      setLoad({ status: 'not-found' });
      return;
    }
    setConflict(error instanceof ApiProblem && error.code === 'VERSION_CONFLICT');
    setErrors(apiFieldErrors(error, FIELDS));
    setAlert(error instanceof ApiTimeout ? TIMEOUT : messageFor(error));
    setBusy(false);
  }

  async function send(payload: PlanPayload, confirmationToken?: string): Promise<void> {
    setBusy(true);
    setAlert(undefined);
    setConflict(false);
    setDuplicate(undefined);
    try {
      if (planId === undefined) {
        const body =
          confirmationToken === undefined
            ? payload
            : { ...payload, duplicate_confirmation_token: confirmationToken };
        await api.request({
          method: 'POST',
          path: '/plans',
          body,
          idempotencyKey: keyFor.current(body),
        });
        router.push('/planos?aviso=criado');
      } else {
        const etag = load.status === 'ready' ? (load.etag ?? '') : '';
        await api.request({
          method: 'PUT',
          path: `/plans/${planId}`,
          body: payload,
          headers: { 'if-match': etag },
          // A chave considera a versao: depois de recarregar, o mesmo corpo e outro pedido.
          idempotencyKey: keyFor.current({ etag, payload }),
        });
        router.push('/planos?aviso=salvo');
      }
    } catch (error) {
      if (
        error instanceof ApiProblem &&
        error.code === 'DUPLICATE_CONFIRMATION_REQUIRED' &&
        error.duplicateConfirmation !== undefined
      ) {
        setDuplicate({ ...error.duplicateConfirmation, payload });
        setBusy(false);
        return;
      }
      failed(error);
    }
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: PlanFormInput = {
      medication_name: textOf(form, 'medication_name'),
      dose_text: textOf(form, 'dose_text'),
      medication_form: textOf(form, 'medication_form'),
      administration_route: textOf(form, 'administration_route'),
      instructions: textOf(form, 'instructions'),
      prescriber_name: textOf(form, 'prescriber_name'),
      prescriber_crm: textOf(form, 'prescriber_crm'),
      start_date: textOf(form, 'start_date'),
      end_date: textOf(form, 'end_date'),
      // Um unico campo vazio e "nenhum horario".
      schedule_times: times.every((time) => time === '') ? [] : times,
    };
    const invalid = validatePlanForm(input);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setDuplicate(undefined);
      setConflict(false);
      setAlert(VALIDATION);
      return;
    }
    await send(toPlanPayload(input));
  }

  async function remove(): Promise<void> {
    if (planId === undefined) return;
    setBusy(true);
    setAlert(undefined);
    try {
      await api.request({ method: 'DELETE', path: `/plans/${planId}` });
      router.push('/planos?aviso=excluido');
    } catch (error) {
      setConfirmingDelete(false);
      failed(error);
    }
  }

  const title = planId === undefined ? 'Novo plano' : 'Editar plano';
  const header = (
    <>
      <p className="mb-4">
        <Link href="/planos">Voltar aos planos</Link>
      </p>
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
    </>
  );

  if (account.status === 'error') {
    return (
      <>
        {header}
        <FormAlert message={account.message} />
      </>
    );
  }
  if (load.status === 'not-found') {
    return (
      <>
        {header}
        <FormAlert message={catalogMessage('RESOURCE_NOT_FOUND')} />
      </>
    );
  }
  if (load.status === 'error') {
    return (
      <>
        {header}
        <FormAlert message={load.message} />
        <button type="button" onClick={loadPlan} className="rounded border border-line px-3 py-1">
          Tentar de novo
        </button>
      </>
    );
  }
  if (load.status === 'loading') {
    return (
      <>
        {header}
        <p aria-live="polite">Carregando…</p>
      </>
    );
  }

  const initial = load.initial;
  const timesError = errors['schedule_times'];
  return (
    <>
      {header}
      <form key={formKey} onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
        <TextField
          id="medication_name"
          label="Medicamento"
          maxLength={120}
          defaultValue={initial.medication_name}
          error={errors['medication_name']}
        />
        <TextField
          id="dose_text"
          label="Dose"
          description="Como você toma, por exemplo 1 comprimido ou 10 gotas."
          maxLength={80}
          defaultValue={initial.dose_text}
          error={errors['dose_text']}
        />
        <SelectField
          id="medication_form"
          label="Forma farmacêutica"
          options={MEDICATION_FORMS}
          defaultValue={initial.medication_form}
          error={errors['medication_form']}
        />
        <SelectField
          id="administration_route"
          label="Via de administração"
          options={ADMINISTRATION_ROUTES}
          defaultValue={initial.administration_route}
          error={errors['administration_route']}
        />
        <fieldset
          className="mb-4"
          aria-describedby={
            timesError === undefined ? 'horarios-descricao' : 'horarios-descricao horarios-erro'
          }
        >
          <legend className="mb-1 font-medium">Horários</legend>
          <p id="horarios-descricao" className="mb-2 text-sm text-muted">
            No fuso da sua conta. Até {MAX_SCHEDULE_TIMES} horários.
          </p>
          {times.map((time, index) => {
            const label = `Horário ${String(index + 1)}`;
            return (
              <div key={index} className="mb-2 flex items-center gap-2">
                <label htmlFor={`horario-${String(index)}`} className="w-24">
                  {label}
                </label>
                <input
                  id={`horario-${String(index)}`}
                  type="time"
                  value={time}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTimes((current) => current.map((item, i) => (i === index ? value : item)));
                  }}
                  aria-invalid={timesError === undefined ? undefined : true}
                  aria-describedby={timesError === undefined ? undefined : 'horarios-erro'}
                  className="rounded border border-line p-2 aria-invalid:border-danger"
                />
                {times.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remover ${label.toLowerCase()}`}
                    onClick={() => {
                      setTimes((current) => current.filter((_item, i) => i !== index));
                    }}
                    className="rounded border border-line px-2 py-1"
                  >
                    Remover
                  </button>
                )}
              </div>
            );
          })}
          {timesError !== undefined && (
            <p id="horarios-erro" className="mb-2 text-sm font-medium text-danger">
              {timesError}
            </p>
          )}
          <button
            type="button"
            disabled={times.length >= MAX_SCHEDULE_TIMES}
            onClick={() => {
              setTimes((current) => [...current, '']);
            }}
            className="rounded border border-line px-3 py-1 disabled:opacity-70"
          >
            Adicionar horário
          </button>
        </fieldset>
        <TextField
          id="start_date"
          label="Data de início"
          type="date"
          defaultValue={initial.start_date}
          error={errors['start_date']}
        />
        <TextField
          id="end_date"
          label="Data de término"
          type="date"
          description="Opcional. Deixe em branco para uso contínuo."
          defaultValue={initial.end_date}
          error={errors['end_date']}
        />
        <TextAreaField
          id="instructions"
          label="Instruções"
          description="Opcional. Por exemplo: após o café da manhã."
          maxLength={500}
          defaultValue={initial.instructions}
          error={errors['instructions']}
        />
        <TextField
          id="prescriber_name"
          label="Nome de quem prescreveu"
          description="Opcional."
          maxLength={120}
          defaultValue={initial.prescriber_name}
          error={errors['prescriber_name']}
        />
        <TextField
          id="prescriber_crm"
          label="CRM de quem prescreveu"
          description="Opcional. Formato UF-número, por exemplo SP-123456. Não é consultado em nenhum cadastro."
          maxLength={13}
          defaultValue={initial.prescriber_crm}
          error={errors['prescriber_crm']}
        />

        {duplicate !== undefined && (
          <section
            aria-labelledby="duplicidade-titulo"
            className="mb-4 rounded border border-line p-4"
          >
            <h2
              id="duplicidade-titulo"
              ref={panelHeading}
              tabIndex={-1}
              className="mb-2 text-lg font-semibold"
            >
              Já existe um plano parecido
            </h2>
            <p className="mb-2">{catalogMessage('DUPLICATE_CONFIRMATION_REQUIRED')}</p>
            <ul className="mb-4 list-disc pl-6">
              {duplicate.candidates.map((candidate) => (
                <li key={candidate.planId}>
                  {candidate.medicationName}, {candidate.doseText}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void send(duplicate.payload, duplicate.confirmationToken)}
                className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-70"
              >
                Criar mesmo assim
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicate(undefined);
                }}
                className="rounded border border-line px-4 py-2"
              >
                Revisar o plano
              </button>
            </div>
          </section>
        )}

        <FormAlert message={alert} />
        {conflict && (
          <button
            type="button"
            onClick={() => {
              setConflict(false);
              setAlert(undefined);
              setErrors({});
              loadPlan();
            }}
            className="mb-4 rounded border border-line px-3 py-1"
          >
            Recarregar plano
          </button>
        )}
        {duplicate === undefined && (
          <SubmitButton label="Salvar plano" busyLabel="Salvando…" busy={busy} />
        )}
      </form>

      {planId !== undefined && (
        <div className="mt-8 border-t border-line pt-4">
          {confirmingDelete ? (
            <section aria-labelledby="exclusao-titulo">
              <h2
                id="exclusao-titulo"
                ref={panelHeading}
                tabIndex={-1}
                className="mb-2 text-lg font-semibold"
              >
                Excluir este plano?
              </h2>
              <p className="mb-4">
                As ocorrências futuras deixam de aparecer. O histórico já registrado é mantido.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className="rounded bg-danger px-4 py-2 font-medium text-white disabled:opacity-70"
                >
                  Excluir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                  className="rounded border border-line px-4 py-2"
                >
                  Cancelar
                </button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(true);
              }}
              className="rounded border border-danger px-4 py-2 text-danger"
            >
              Excluir plano
            </button>
          )}
        </div>
      )}
    </>
  );
}

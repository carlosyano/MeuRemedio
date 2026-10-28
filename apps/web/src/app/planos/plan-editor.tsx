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
// Cadastro no formato da receita (DC-074): horarios de N em N horas a partir do primeiro horario,
// duracao em dias que preenche o termino, frase de conferencia e "Salvar e cadastrar outro item",
// que mantem prescritor e inicio. Nada e inferido: as ajudas so preenchem campos editaveis.
// Situacao do plano (DEC-036): cancelar, interromper e retomar com motivo (PlanStatusPanel); plano
// cancelado ou interrompido nao se edita, so mostra a situacao e pode ser retomado ou excluido.
// Periodicidade (DEC-037): todos os dias, dias da semana marcados ou a cada N dias (do inicio).
// Motivo do tratamento (DEC-038): opcional, com os motivos ja usados como sugestao do campo.
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
  INTERVAL_HOURS,
  MAX_SCHEDULE_TIMES,
  MEDICATION_FORMS,
  RECURRENCE_KINDS,
  WEEKDAY_OPTIONS,
  describeRoutine,
  durationDays,
  endDateForDays,
  formatDate,
  formatPeriod,
  parseDays,
  timesEvery,
  toFormInput,
  toPlanPayload,
  todayIn,
  validatePlanForm,
  type Plan,
  type PlanFormInput,
  type PlanPayload,
  type RecurrenceKind,
} from '@/lib/plan-form';
import { statusReasonText } from '@/lib/plan-status';
import { loginPath, useAccount } from '@/lib/use-account';
import { PlanStatusPanel } from './plan-status-panel';

const VALIDATION = 'Revise os campos destacados e tente novamente.';
const TIMEOUT =
  'A resposta demorou demais e não sabemos se o plano foi salvo. Tente salvar de novo: o envio repetido não cria outro plano.';
const DAYS_INVALID = 'Informe um número inteiro de dias, de 1 a 3650.';
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
  'recurrence',
  'treatment_reason',
];

type LoadState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly initial: PlanFormInput;
      readonly etag?: string;
      /** Plano lido da API (so na edicao). */
      readonly plan?: Plan;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

interface TreatmentReasonPage {
  readonly items: readonly { readonly name: string }[];
}

interface PendingDuplicate extends DuplicateConfirmation {
  readonly payload: PlanPayload;
}

/** Campos nao controlados que entram na frase de conferencia. */
type Draft = Pick<
  PlanFormInput,
  'medication_name' | 'dose_text' | 'medication_form' | 'administration_route'
>;

const draftOf = (input: PlanFormInput): Draft => ({
  medication_name: input.medication_name,
  dose_text: input.dose_text,
  medication_form: input.medication_form,
  administration_route: input.administration_route,
});

// Duracao mostrada para um periodo ja preenchido (edicao ou termino digitado).
const daysOf = (start: string, end: string): string =>
  start !== '' && end !== '' && end >= start ? String(durationDays(start, end)) : '';

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
  const [draft, setDraft] = useState<Draft>(draftOf(emptyPlan('')));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState('');
  const [intervalHours, setIntervalHours] = useState('');
  const [recurrenceKind, setRecurrenceKind] = useState<RecurrenceKind>('DAILY');
  const [weekdays, setWeekdays] = useState<readonly string[]>([]);
  const [intervalDays, setIntervalDays] = useState('');
  const [reasonSuggestions, setReasonSuggestions] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | undefined>();
  // Botao que enviou a criacao: "proximo" volta ao formulario para o proximo item da receita.
  const afterCreate = useRef<'list' | 'next'>('list');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [duplicate, setDuplicate] = useState<PendingDuplicate | undefined>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const keyFor = useRef(createIdempotencyKeys());
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const ready = useCallback((initial: PlanFormInput, etag?: string, plan?: Plan) => {
    setLoad({
      status: 'ready',
      initial,
      ...(etag === undefined ? {} : { etag }),
      ...(plan === undefined ? {} : { plan }),
    });
    setTimes(initial.schedule_times);
    setDraft(draftOf(initial));
    setStartDate(initial.start_date);
    setEndDate(initial.end_date);
    setDays(daysOf(initial.start_date, initial.end_date));
    setIntervalHours('');
    setRecurrenceKind(initial.recurrence_kind ?? 'DAILY');
    setWeekdays(initial.weekdays ?? []);
    setIntervalDays(initial.interval_days ?? '');
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
        ready(toFormInput(response.body), response.headers.get('etag') ?? undefined, response.body);
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

  // Sugestoes do campo de motivo; sem elas o campo continua livre, entao a falha e silenciosa.
  useEffect(() => {
    if (!accountReady) return;
    let active = true;
    api
      .request<TreatmentReasonPage>({ method: 'GET', path: '/treatment-reasons?limit=100' })
      .then((response) => {
        if (active) setReasonSuggestions(response.body.items.map((item) => item.name));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accountReady]);

  useEffect(() => {
    if (duplicate !== undefined || confirmingDelete) panelHeading.current?.focus();
  }, [duplicate, confirmingDelete]);

  // Depois de "Salvar e cadastrar outro item", o foco volta ao primeiro campo do formulario novo.
  useEffect(() => {
    if (notice !== undefined) document.getElementById('medication_name')?.focus();
  }, [notice, formKey]);

  function changeStart(value: string): void {
    setStartDate(value);
    const count = parseDays(days);
    if (count !== undefined && value !== '') setEndDate(endDateForDays(value, count));
  }

  function changeDays(value: string): void {
    setDays(value);
    const count = parseDays(value);
    if (value.trim() === '') setEndDate('');
    else if (count !== undefined && startDate !== '') setEndDate(endDateForDays(startDate, count));
  }

  function changeEnd(value: string): void {
    setEndDate(value);
    setDays(daysOf(startDate, value));
  }

  // Com intervalo escolhido, a lista sai do Horario 1; sem Horario 1 valido, fica como esta.
  function applyInterval(hours: string, first: string): void {
    const generated = hours === '' ? [] : timesEvery(Number(hours), first);
    setTimes((current) => (generated.length > 0 ? generated : [first, ...current.slice(1)]));
  }

  function changeTime(index: number, value: string): void {
    if (index === 0 && intervalHours !== '') {
      applyInterval(intervalHours, value);
      return;
    }
    // Editar outro horario quebra a regularidade: volta a "Sem intervalo fixo"
    if (index > 0) setIntervalHours('');
    setTimes((current) => current.map((item, i) => (i === index ? value : item)));
  }

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
        if (afterCreate.current === 'next') {
          // Chaves novas: o mesmo item repetido na receita e um pedido novo e passa pela
          // confirmacao de duplicidade (RN-016), em vez de devolver o plano ja criado.
          keyFor.current = createIdempotencyKeys();
          ready({
            ...emptyPlan(payload.start_date),
            prescriber_name: payload.prescriber_name ?? '',
            prescriber_crm: payload.prescriber_crm ?? '',
          });
          setErrors({});
          setNotice(
            `Plano criado: ${payload.medication_name}. Cadastre o próximo item da receita.`,
          );
          setBusy(false);
          return;
        }
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
    const submitter = event.nativeEvent.submitter;
    afterCreate.current = submitter?.getAttribute('name') === 'proximo' ? 'next' : 'list';
    setNotice(undefined);
    const form = new FormData(event.currentTarget);
    const input: PlanFormInput = {
      medication_name: textOf(form, 'medication_name'),
      dose_text: textOf(form, 'dose_text'),
      medication_form: textOf(form, 'medication_form'),
      administration_route: textOf(form, 'administration_route'),
      instructions: textOf(form, 'instructions'),
      treatment_reason: textOf(form, 'treatment_reason'),
      prescriber_name: textOf(form, 'prescriber_name'),
      prescriber_crm: textOf(form, 'prescriber_crm'),
      start_date: textOf(form, 'start_date'),
      end_date: textOf(form, 'end_date'),
      // Um unico campo vazio e "nenhum horario".
      schedule_times: times.every((time) => time === '') ? [] : times,
      recurrence_kind: recurrenceKind,
      weekdays,
      interval_days: intervalDays,
    };
    const invalid: Record<string, string> = { ...validatePlanForm(input) };
    if (days.trim() !== '' && parseDays(days) === undefined)
      invalid['duration_days'] = DAYS_INVALID;
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

  const plan = load.status === 'ready' ? load.plan : undefined;
  // Cancelado e interrompido nao aceitam updatePlan (DEC-036).
  const editable = plan === undefined || plan.status === 'ACTIVE';
  const title = planId === undefined ? 'Novo plano' : editable ? 'Editar plano' : 'Plano';
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
  const summaryInput: PlanFormInput = {
    ...draft,
    instructions: '',
    prescriber_name: '',
    prescriber_crm: '',
    start_date: startDate,
    end_date: endDate,
    schedule_times: times.every((time) => time === '') ? [] : times,
    recurrence_kind: recurrenceKind,
    weekdays,
    interval_days: intervalDays,
  };
  const summary =
    Object.keys(validatePlanForm(summaryInput)).length === 0
      ? describeRoutine(toPlanPayload(summaryInput))
      : undefined;
  return (
    <>
      {header}
      {notice !== undefined && (
        <p role="status" className="mb-4 font-medium">
          {notice}
        </p>
      )}
      {plan !== undefined && plan.status_reason !== null && timeZone !== undefined && (
        <StatusSummary plan={plan} reason={plan.status_reason} timeZone={timeZone} />
      )}
      {editable && (
        <form
          key={formKey}
          onSubmit={(event) => void onSubmit(event)}
          onChange={(event) => {
            const form = new FormData(event.currentTarget);
            setDraft({
              medication_name: textOf(form, 'medication_name'),
              dose_text: textOf(form, 'dose_text'),
              medication_form: textOf(form, 'medication_form'),
              administration_route: textOf(form, 'administration_route'),
            });
          }}
          noValidate
          aria-busy={busy}
        >
          <TextField
            id="medication_name"
            label="Medicamento"
            description="Nome e concentração, como na receita, por exemplo Levofloxacino 500 mg."
            maxLength={120}
            defaultValue={initial.medication_name}
            error={errors['medication_name']}
          />
          <TextField
            id="dose_text"
            label="Dose"
            description="Quanto tomar de cada vez, como na receita, por exemplo 1 comprimido, 3 ml ou 10 gotas."
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
          <TextField
            id="treatment_reason"
            label="Motivo do tratamento"
            description="Opcional. Por que você toma este remédio, por exemplo pressão alta ou dor de cabeça. O mesmo motivo pode valer para vários remédios."
            maxLength={80}
            list="motivos-sugeridos"
            defaultValue={initial.treatment_reason ?? ''}
            error={errors['treatment_reason']}
          />
          <datalist id="motivos-sugeridos">
            {reasonSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <fieldset
            className="mb-4"
            aria-describedby={
              timesError === undefined ? 'horarios-descricao' : 'horarios-descricao horarios-erro'
            }
          >
            <legend className="mb-1 font-medium">Horários</legend>
            <p id="horarios-descricao" className="mb-2 text-sm text-muted">
              No fuso da sua conta. Até {MAX_SCHEDULE_TIMES} horários. Para “1 vez ao dia” ou “à
              noite”, informe a hora em que você toma.
            </p>
            <div className="mb-3">
              <label htmlFor="intervalo" className="mb-1 block">
                Intervalo
              </label>
              <select
                id="intervalo"
                value={intervalHours}
                aria-describedby="intervalo-descricao"
                onChange={(event) => {
                  const hours = event.target.value;
                  setIntervalHours(hours);
                  applyInterval(hours, times[0] ?? '');
                }}
                className="rounded border border-line bg-surface p-2"
              >
                <option value="">Sem intervalo fixo</option>
                {INTERVAL_HOURS.map((hours) => (
                  <option key={hours} value={String(hours)}>
                    De {hours} em {hours} horas
                  </option>
                ))}
              </select>
              <p id="intervalo-descricao" className="mt-1 text-sm text-muted">
                {intervalHours !== '' && (times[0] ?? '') === ''
                  ? 'Informe o Horário 1: os demais são calculados a partir dele.'
                  : 'Para receita “de N em N horas”: os horários são calculados a partir do Horário 1 e continuam editáveis.'}
              </p>
            </div>
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
                      changeTime(index, event.target.value);
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
                        setIntervalHours('');
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
                setIntervalHours('');
                setTimes((current) => [...current, '']);
              }}
              className="rounded border border-line px-3 py-1 disabled:opacity-70"
            >
              Adicionar horário
            </button>
          </fieldset>
          <RecurrenceFields
            kind={recurrenceKind}
            weekdays={weekdays}
            intervalDays={intervalDays}
            error={errors['recurrence']}
            onKindChange={setRecurrenceKind}
            onWeekdaysChange={setWeekdays}
            onIntervalDaysChange={setIntervalDays}
          />
          <TextField
            id="start_date"
            label="Data de início"
            type="date"
            value={startDate}
            onValueChange={changeStart}
            error={errors['start_date']}
          />
          <TextField
            id="duration_days"
            label="Duração em dias"
            inputMode="numeric"
            description="Opcional. Para “por 7 dias”, informe 7: a data de término é calculada."
            maxLength={4}
            value={days}
            onValueChange={changeDays}
            error={errors['duration_days']}
          />
          <TextField
            id="end_date"
            label="Data de término"
            type="date"
            description="Opcional. Deixe em branco para uso contínuo."
            value={endDate}
            onValueChange={changeEnd}
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
          <section aria-labelledby="resumo-titulo" className="mb-4 rounded border border-line p-4">
            <h2 id="resumo-titulo" className="mb-2 text-lg font-semibold">
              Confira antes de salvar
            </h2>
            {summary === undefined ? (
              <p className="text-muted">
                Preencha medicamento, dose, forma, via, horários e data de início para ver o resumo.
              </p>
            ) : (
              <>
                <p className="font-medium">{draft.medication_name.trim()}</p>
                <p>{summary}</p>
              </>
            )}
          </section>
          {duplicate === undefined && (
            <div className="flex flex-wrap gap-2">
              <SubmitButton label="Salvar plano" busyLabel="Salvando…" busy={busy} />
              {planId === undefined && (
                <button
                  type="submit"
                  name="proximo"
                  disabled={busy}
                  className="rounded border border-accent px-4 py-2 font-medium text-accent disabled:opacity-70"
                >
                  Salvar e cadastrar outro item
                </button>
              )}
            </div>
          )}
        </form>
      )}
      {plan !== undefined && timeZone !== undefined && (
        <PlanStatusPanel
          plan={plan}
          etag={load.etag ?? ''}
          today={todayIn(timeZone)}
          onChanged={(changed, etag, message) => {
            setAlert(undefined);
            setConflict(false);
            setErrors({});
            ready(toFormInput(changed), etag, changed);
            setNotice(message);
          }}
          onFailed={failed}
        />
      )}
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

const SITUATION: Readonly<Record<Plan['status'], string>> = {
  ACTIVE: 'Retomado',
  CANCELED: 'Cancelado',
  INTERRUPTED: 'Interrompido',
  DELETED: 'Excluído',
};

/** Ultima mudanca de situacao: o que aconteceu, quando, o motivo e a observacao. */
function StatusSummary(props: {
  readonly plan: Plan;
  readonly reason: NonNullable<Plan['status_reason']>;
  readonly timeZone: string;
}) {
  const { plan } = props;
  const changedOn =
    plan.status_changed_at === null
      ? undefined
      : formatDate(todayIn(props.timeZone, new Date(plan.status_changed_at)));
  return (
    <section
      aria-labelledby="situacao-atual-titulo"
      className="mb-6 rounded border border-line p-4"
    >
      <h2 id="situacao-atual-titulo" className="mb-2 text-lg font-semibold">
        {SITUATION[plan.status]}
        {changedOn === undefined ? '' : ` em ${changedOn}`}
      </h2>
      {plan.status !== 'ACTIVE' && (
        <p className="mb-2 font-medium">
          {plan.medication_name}, {plan.dose_text} · {formatPeriod(plan.start_date, plan.end_date)}
        </p>
      )}
      <p>Motivo: {statusReasonText(plan.status, props.reason)}</p>
      {plan.status_note !== null && <p>Observação: {plan.status_note}</p>}
    </section>
  );
}

/** Grupo "Periodicidade" (DEC-037): todos os dias, dias da semana ou a cada N dias. */
function RecurrenceFields(props: {
  readonly kind: RecurrenceKind;
  readonly weekdays: readonly string[];
  readonly intervalDays: string;
  readonly error: string | undefined;
  readonly onKindChange: (kind: RecurrenceKind) => void;
  readonly onWeekdaysChange: (weekdays: readonly string[]) => void;
  readonly onIntervalDaysChange: (value: string) => void;
}) {
  const errorId = props.error === undefined ? undefined : 'periodicidade-erro';
  return (
    <fieldset
      className="mb-4"
      aria-describedby={
        errorId === undefined ? 'periodicidade-descricao' : `periodicidade-descricao ${errorId}`
      }
    >
      <legend className="mb-1 font-medium">Periodicidade</legend>
      <p id="periodicidade-descricao" className="mb-2 text-sm text-muted">
        Os horários valem em cada dia escolhido. “A cada N dias” conta a partir da data de início.
      </p>
      {RECURRENCE_KINDS.map(([value, label]) => (
        <div key={value} className="flex items-center gap-2">
          <input
            type="radio"
            id={`periodicidade-${value}`}
            name="recurrence_kind"
            value={value}
            checked={props.kind === value}
            onChange={() => {
              props.onKindChange(value as RecurrenceKind);
            }}
            className="size-5"
          />
          <label htmlFor={`periodicidade-${value}`}>{label}</label>
        </div>
      ))}
      {props.kind === 'WEEKDAYS' && (
        <fieldset className="mt-2 ml-7">
          <legend className="mb-1">Em quais dias</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {WEEKDAY_OPTIONS.map(([value, label]) => (
              <div key={value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`dia-${value}`}
                  checked={props.weekdays.includes(value)}
                  onChange={(event) => {
                    props.onWeekdaysChange(
                      event.target.checked
                        ? [...props.weekdays, value]
                        : props.weekdays.filter((day) => day !== value),
                    );
                  }}
                  className="size-5"
                />
                <label htmlFor={`dia-${value}`}>{label}</label>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      {props.kind === 'EVERY_N_DAYS' && (
        <div className="mt-2 ml-7">
          <label htmlFor="interval_days" className="mb-1 block">
            A cada quantos dias
          </label>
          <input
            id="interval_days"
            inputMode="numeric"
            maxLength={3}
            value={props.intervalDays}
            onChange={(event) => {
              props.onIntervalDaysChange(event.target.value);
            }}
            aria-invalid={props.error === undefined ? undefined : true}
            aria-describedby={errorId}
            className="w-24 rounded border border-line p-2 aria-invalid:border-danger"
          />
        </div>
      )}
      {props.error !== undefined && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {props.error}
        </p>
      )}
    </fieldset>
  );
}

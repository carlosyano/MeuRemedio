// Formulario de plano na web (TL-004; DC-054): regras espelhadas do contrato (PlanWrite) e da API
// (termino >= inicio, ERR-009), montagem do payload e rotulos em pt-BR. A API valida tudo de novo;
// o CRM so tem o formato conferido, sem consulta externa (RN-001, TS-012).

/** Mesmo formato de FieldErrors de forms.ts (sem importar: este modulo roda nos testes). */
export type FieldErrors = Readonly<Record<string, string>>;

export interface PlanFormInput {
  readonly medication_name: string;
  readonly dose_text: string;
  readonly medication_form: string;
  readonly administration_route: string;
  readonly instructions: string;
  readonly prescriber_name: string;
  readonly prescriber_crm: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly schedule_times: readonly string[];
}

/** Corpo de createPlan e updatePlan (sem o token de duplicidade). */
export interface PlanPayload {
  readonly medication_name: string;
  readonly dose_text: string;
  readonly medication_form: string;
  readonly administration_route: string;
  readonly instructions: string | null;
  readonly prescriber_name: string | null;
  readonly prescriber_crm: string | null;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly schedule_times: readonly string[];
}

/** Plano como a API devolve (schema Plan). */
export interface Plan extends PlanPayload {
  readonly plan_id: string;
  /** Situacao (DEC-036); os tipos ficam em plan-status.ts, repetidos aqui sem importar. */
  readonly status: 'ACTIVE' | 'CANCELED' | 'INTERRUPTED' | 'DELETED';
  /** Ultima mudanca de situacao; null se nunca houve. */
  readonly status_reason:
    | 'MEDICAL_ADVICE'
    | 'SIDE_EFFECT'
    | 'IMPROVED'
    | 'COST_OR_ACCESS'
    | 'OWN_DECISION'
    | 'OTHER'
    | null;
  readonly status_note: string | null;
  readonly status_changed_at: string | null;
  readonly row_version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export type Options = readonly (readonly [value: string, label: string])[];

/** Enum MedicationForm da OpenAPI, na mesma ordem. */
export const MEDICATION_FORMS: Options = [
  ['TABLET', 'Comprimido'],
  ['CAPSULE', 'Cápsula'],
  ['LIQUID', 'Líquido'],
  ['DROPS', 'Gotas'],
  ['INJECTION', 'Injeção'],
  ['CREAM', 'Creme'],
  ['OINTMENT', 'Pomada'],
  ['INHALER', 'Inalador'],
  ['PATCH', 'Adesivo'],
  ['OTHER', 'Outra'],
];

/** Enum AdministrationRoute da OpenAPI, na mesma ordem. */
export const ADMINISTRATION_ROUTES: Options = [
  ['ORAL', 'Oral'],
  ['TOPICAL', 'Tópica'],
  ['INHALED', 'Inalatória'],
  ['NASAL', 'Nasal'],
  ['OPHTHALMIC', 'Oftálmica'],
  ['OTIC', 'Otológica'],
  ['RECTAL', 'Retal'],
  ['VAGINAL', 'Vaginal'],
  ['SUBCUTANEOUS', 'Subcutânea'],
  ['INTRAMUSCULAR', 'Intramuscular'],
  ['OTHER', 'Outra'],
];

export const MAX_SCHEDULE_TIMES = 10;

export const labelOf = (options: Options, value: string): string =>
  options.find(([option]) => option === value)?.[1] ?? value;

/** "Comprimido, via oral" ou "Comprimido, outra via". */
export function describeForm(form: string, route: string): string {
  const via =
    route === 'OTHER' ? 'outra via' : `via ${labelOf(ADMINISTRATION_ROUTES, route).toLowerCase()}`;
  return `${labelOf(MEDICATION_FORMS, form)}, ${via}`;
}

const CRM_PATTERN = /^[A-Z]{2}-\d{4,10}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const tooLong = (max: number): string => `Use no máximo ${String(max)} caracteres.`;

export function validatePlanForm(input: PlanFormInput): FieldErrors {
  const errors: Record<string, string> = {};
  const name = input.medication_name.trim();
  if (name === '') errors['medication_name'] = 'Informe o medicamento.';
  else if (name.length > 120) errors['medication_name'] = tooLong(120);
  const dose = input.dose_text.trim();
  if (dose === '') errors['dose_text'] = 'Informe a dose.';
  else if (dose.length > 80) errors['dose_text'] = tooLong(80);
  if (input.medication_form === '') errors['medication_form'] = 'Escolha a forma farmacêutica.';
  if (input.administration_route === '') {
    errors['administration_route'] = 'Escolha a via de administração.';
  }
  if (input.instructions.trim().length > 500) errors['instructions'] = tooLong(500);
  if (input.prescriber_name.trim().length > 120) errors['prescriber_name'] = tooLong(120);
  const crm = input.prescriber_crm.trim().toUpperCase();
  if (crm !== '' && !CRM_PATTERN.test(crm)) {
    errors['prescriber_crm'] = 'Informe o CRM no formato UF-número, por exemplo SP-123456.';
  }
  if (!DATE_PATTERN.test(input.start_date)) errors['start_date'] = 'Informe a data de início.';
  else if (input.end_date !== '' && input.end_date < input.start_date) {
    errors['end_date'] = 'A data de término deve ser igual ou posterior à data de início.';
  }
  const times = input.schedule_times;
  if (times.length === 0) errors['schedule_times'] = 'Informe pelo menos um horário.';
  else if (times.some((time) => !TIME_PATTERN.test(time))) {
    errors['schedule_times'] = 'Preencha ou remova os horários vazios.';
  } else if (new Set(times).size !== times.length) {
    errors['schedule_times'] = 'Os horários não podem se repetir.';
  } else if (times.length > MAX_SCHEDULE_TIMES) {
    errors['schedule_times'] = `Informe no máximo ${String(MAX_SCHEDULE_TIMES)} horários.`;
  }
  return errors;
}

const optional = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export function toPlanPayload(input: PlanFormInput): PlanPayload {
  return {
    medication_name: input.medication_name.trim(),
    dose_text: input.dose_text.trim(),
    medication_form: input.medication_form,
    administration_route: input.administration_route,
    instructions: optional(input.instructions),
    prescriber_name: optional(input.prescriber_name),
    prescriber_crm: optional(input.prescriber_crm.toUpperCase()),
    start_date: input.start_date,
    end_date: optional(input.end_date),
    schedule_times: [...input.schedule_times].sort(),
  };
}

/** Plano carregado como valores iniciais do formulario. */
export function toFormInput(plan: PlanPayload): PlanFormInput {
  return {
    medication_name: plan.medication_name,
    dose_text: plan.dose_text,
    medication_form: plan.medication_form,
    administration_route: plan.administration_route,
    instructions: plan.instructions ?? '',
    prescriber_name: plan.prescriber_name ?? '',
    prescriber_crm: plan.prescriber_crm ?? '',
    start_date: plan.start_date,
    end_date: plan.end_date ?? '',
    schedule_times: plan.schedule_times,
  };
}

/** Data civil YYYY-MM-DD de agora no fuso da conta (independe do fuso do navegador). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** YYYY-MM-DD para DD/MM/AAAA, sem passar por Date (sem efeito de fuso). */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

export function formatPeriod(start: string, end: string | null): string {
  return end === null
    ? `A partir de ${formatDate(start)}`
    : `De ${formatDate(start)} a ${formatDate(end)}`;
}

// Ajudas para transcrever a receita (DC-074). So montam o que a pessoa digitou: nao sugerem dose,
// horario nem duracao, e o resultado aparece nos campos para ser conferido antes de salvar.

/** Intervalos "de N em N horas" que fecham o dia com no maximo 10 horarios. */
export const INTERVAL_HOURS: readonly number[] = [4, 6, 8, 12, 24];

/** Horarios a cada `hours` horas a partir de `first`, na ordem do dia de tomada. */
export function timesEvery(hours: number, first: string): readonly string[] {
  if (!INTERVAL_HOURS.includes(hours) || !TIME_PATTERN.test(first)) return [];
  const [hour = 0, minute = 0] = first.split(':').map(Number);
  return Array.from({ length: 24 / hours }, (_item, index) => {
    const next = (hour + index * hours) % 24;
    return `${String(next).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  });
}

const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;

// Data civil como dias desde a epoca, em UTC: sem efeito do fuso do navegador.
const toEpochDay = (date: string): number => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};

export function addDays(date: string, days: number): string {
  return new Date((toEpochDay(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** "Por N dias" a partir do inicio: o termino e o N-esimo dia, inclusive. */
export const endDateForDays = (start: string, days: number): string => addDays(start, days - 1);

/** Dias de tratamento entre inicio e termino, inclusive. */
export const durationDays = (start: string, end: string): number =>
  toEpochDay(end) - toEpochDay(start) + 1;

/** Duracao digitada: inteiro de 1 a 3650; qualquer outra coisa e "sem duracao". */
export function parseDays(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days >= 1 && days <= MAX_DAYS ? days : undefined;
}

const joinTimes = (times: readonly string[]): string =>
  times.length === 1
    ? (times[0] ?? '')
    : `${times.slice(0, -1).join(', ')} e ${times[times.length - 1] ?? ''}`;

/** Frase de conferencia no formato da receita, a partir do payload que sera enviado. */
export function describeRoutine(plan: PlanPayload): string {
  const route =
    plan.administration_route === 'OTHER'
      ? 'por outra via'
      : `via ${labelOf(ADMINISTRATION_ROUTES, plan.administration_route).toLowerCase()}`;
  const count = plan.schedule_times.length;
  const frequency = `${String(count)} ${count === 1 ? 'vez' : 'vezes'} ao dia`;
  let period: string;
  if (plan.end_date === null) {
    period = `uso contínuo a partir de ${formatDate(plan.start_date)}`;
  } else {
    const days = durationDays(plan.start_date, plan.end_date);
    period =
      days === 1
        ? `por 1 dia, em ${formatDate(plan.start_date)}`
        : `por ${String(days)} dias, de ${formatDate(plan.start_date)} a ${formatDate(plan.end_date)}`;
  }
  return `Tomar ${plan.dose_text}, ${route}, ${frequency} (${joinTimes(plan.schedule_times)}), ${period}.`;
}

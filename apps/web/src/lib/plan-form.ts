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
  readonly status: 'ACTIVE' | 'DELETED';
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

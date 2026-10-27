// Situacao do plano na web (DEC-036): grupos da lista, acoes permitidas e motivos em pt-BR.
// As regras de transicao repetem as da API (changePlanStatus) pela data de hoje no fuso da conta;
// a API continua sendo a autoridade (409 STATE_CONFLICT) e a tela so evita oferecer o que falharia.
// Sem importar: este modulo roda nos testes unitarios.

/** Pares [valor, rotulo], como Options de plan-form.ts. */
export type Options = readonly (readonly [value: string, label: string])[];

export type PlanStatus = 'ACTIVE' | 'CANCELED' | 'INTERRUPTED' | 'DELETED';

export type PlanStatusAction = 'CANCEL' | 'INTERRUPT' | 'RESUME';

export type PlanStatusReason =
  'MEDICAL_ADVICE' | 'SIDE_EFFECT' | 'IMPROVED' | 'COST_OR_ACCESS' | 'OWN_DECISION' | 'OTHER';

/** "Finalizado" nao e uma situacao da API: e o plano ativo cujo termino ja passou. */
export type PlanGroup = 'IN_PROGRESS' | 'FINISHED' | 'INTERRUPTED' | 'CANCELED';

interface PlanPeriod {
  readonly status: PlanStatus;
  readonly start_date: string;
  readonly end_date: string | null;
}

/** Grupos da lista de planos, na ordem em que aparecem. */
export const PLAN_GROUPS: readonly (readonly [group: PlanGroup, title: string])[] = [
  ['IN_PROGRESS', 'Em andamento'],
  ['FINISHED', 'Finalizados'],
  ['INTERRUPTED', 'Interrompidos'],
  ['CANCELED', 'Cancelados'],
];

export function planGroup(plan: PlanPeriod, today: string): PlanGroup {
  if (plan.status === 'INTERRUPTED') return 'INTERRUPTED';
  if (plan.status === 'CANCELED') return 'CANCELED';
  return plan.end_date !== null && plan.end_date < today ? 'FINISHED' : 'IN_PROGRESS';
}

/** Mesmas regras da API: cancelar antes do inicio, interromper em andamento, retomar o interrompido. */
export function allowedActions(plan: PlanPeriod, today: string): PlanStatusAction[] {
  const notFinished = plan.end_date === null || today <= plan.end_date;
  if (plan.status === 'INTERRUPTED') return notFinished ? ['RESUME'] : [];
  if (plan.status !== 'ACTIVE') return [];
  if (today < plan.start_date) return ['CANCEL'];
  return notFinished ? ['INTERRUPT'] : [];
}

/** Enum PlanStatusReason do contrato, na mesma ordem, com o rotulo de quem para o plano. */
export const PLAN_STATUS_REASONS: Options = [
  ['MEDICAL_ADVICE', 'Orientação médica'],
  ['SIDE_EFFECT', 'Efeito colateral'],
  ['IMPROVED', 'Melhorei'],
  ['COST_OR_ACCESS', 'Custo ou falta do medicamento'],
  ['OWN_DECISION', 'Decisão própria'],
  ['OTHER', 'Outro motivo'],
];

/** Motivos para cancelar e interromper. */
export const STOP_REASONS: Options = PLAN_STATUS_REASONS;

/** Motivos para retomar: os que fazem sentido ao voltar, com o texto de quem retoma. */
export const RESUME_REASONS: Options = [
  ['MEDICAL_ADVICE', 'Orientação médica'],
  ['COST_OR_ACCESS', 'Voltei a ter o medicamento'],
  ['OWN_DECISION', 'Decisão própria'],
  ['OTHER', 'Outro motivo'],
];

/** Texto do motivo da ultima mudanca: num plano ativo, a mudanca foi uma retomada. */
export function statusReasonText(status: PlanStatus, reason: PlanStatusReason): string {
  const options = status === 'ACTIVE' ? RESUME_REASONS : STOP_REASONS;
  const label = (list: Options): string | undefined =>
    list.find(([value]) => value === reason)?.[1];
  // A API aceita qualquer motivo na retomada; o que nao tem texto proprio usa o geral.
  return label(options) ?? label(PLAN_STATUS_REASONS) ?? reason;
}

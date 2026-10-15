// Historico na web (TL-006; DC-056): periodo padrao, regra de periodo igual a da API (RN-010,
// DC-041) e texto da situacao de cada ocorrencia. Sem importar outros modulos locais: este modulo
// roda nos testes e no Next.

export interface HistoryResponse {
  readonly type: 'TAKEN' | 'NOT_TAKEN';
  readonly reason: string | null;
  readonly is_late: boolean;
}

export type PeriodErrors = Readonly<Partial<Record<'start' | 'end', string>>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const REASONS: Readonly<Record<string, string>> = {
  FORGOT: 'Esqueci',
  UNAVAILABLE: 'Não tinha o medicamento',
  SIDE_EFFECT_CONCERN: 'Preocupação com efeito colateral',
  CHOSE_NOT_TO_TAKE: 'Decidi não tomar',
  OTHER: 'Outro motivo',
};

const toDay = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const fromDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Mesma data civil N meses depois, com o dia limitado ao ultimo dia do mes de chegada. */
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Os ultimos 30 dias ate hoje (data civil da conta), inclusive. */
export function defaultPeriod(today: string): { start: string; end: string } {
  return { start: fromDay(toDay(today) - 29), end: today };
}

export function validatePeriod(start: string, end: string): PeriodErrors {
  const errors: Partial<Record<'start' | 'end', string>> = {};
  if (!DATE_PATTERN.test(start)) errors.start = 'Informe a data inicial.';
  if (!DATE_PATTERN.test(end)) errors.end = 'Informe a data final.';
  if (errors.start !== undefined || errors.end !== undefined) return errors;
  if (end < start) return { end: 'A data final deve ser igual ou posterior à inicial.' };
  // "12 meses" inclusivos: no maximo ate a vespera de start + 12 meses (DC-041).
  if (toDay(end) > toDay(addMonths(start, 12)) - 1) {
    return { end: 'O período pode ter no máximo 12 meses.' };
  }
  return {};
}

export function outcomeText(
  occurrence: { readonly status: string },
  response: HistoryResponse | null,
): string {
  if (response !== null) {
    const parts = [response.type === 'TAKEN' ? 'Tomei' : 'Não tomei'];
    if (response.reason !== null) parts.push(REASONS[response.reason] ?? response.reason);
    if (response.is_late) parts.push('registrado com atraso');
    return parts.join(' · ');
  }
  return occurrence.status === 'NO_RESPONSE' ? 'Sem resposta' : 'Aguardando resposta';
}

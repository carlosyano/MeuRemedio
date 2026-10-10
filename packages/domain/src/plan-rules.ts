// Regras puras de duplicidade de plano (Especificacao 02.33 RN-016; OpenAPI DuplicateConfirmation):
// candidato e um plano ACTIVE do mesmo titular com medication_name e dose_text iguais apos a
// normalizacao e periodos [start_date, end_date | infinito) com intersecao. end_date e data civil
// inclusiva, entao periodos que se tocam no mesmo dia se sobrepoem (DC-029).

/** trim, colapso de espacos (inclusive NBSP e tab), remocao de diacriticos e caixa baixa. */
export function normalizePlanText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

export interface PlanPeriod {
  /** YYYY-MM-DD. */
  readonly startDate: string;
  /** YYYY-MM-DD inclusiva, ou null (sem fim). */
  readonly endDate: string | null;
}

/** Datas YYYY-MM-DD comparam corretamente como texto. */
export function planPeriodsOverlap(a: PlanPeriod, b: PlanPeriod): boolean {
  const aStartsBeforeBEnds = b.endDate === null || a.startDate <= b.endDate;
  const bStartsBeforeAEnds = a.endDate === null || b.startDate <= a.endDate;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

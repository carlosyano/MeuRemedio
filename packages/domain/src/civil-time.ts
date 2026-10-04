// ETAPA VERMELHA (Test-First): contrato publico definido, comportamento ainda nao implementado.
// Regras normativas: Especificacao 02.33 (RN-013, secao 13.5) e ADR-001 v1.5 (OA-003).

export type CivilResolution = 'EXACT' | 'GAP_ADVANCED' | 'AMBIGUOUS_FIRST';

export interface ResolvedCivilInstant {
  /** Instante em UTC, formato YYYY-MM-DDTHH:MM:SSZ. */
  readonly instantUtc: string;
  readonly resolution: CivilResolution;
}

export class InvalidCivilInputError extends Error {
  public override readonly name = 'InvalidCivilInputError';
}

export function resolveCivilInstant(
  localDate: string,
  localTime: string,
  timeZone: string,
): ResolvedCivilInstant {
  throw new Error(
    `Nao implementado (etapa vermelha do Test-First): ${localDate} ${localTime} ${timeZone}`,
  );
}

export function deadlineFor(scheduledAtUtc: string): string {
  throw new Error(`Nao implementado (etapa vermelha do Test-First): ${scheduledAtUtc}`);
}

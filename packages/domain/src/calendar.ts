// Aritmetica de datas civis (YYYY-MM-DD) sem fuso: uso interno do pacote, fora do index.
import { InvalidCivilInputError } from './civil-time.js';

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Data civil -> dias desde 1970-01-01; rejeita formato e datas inexistentes. */
export function dayNumber(date: string, field: string): number {
  const epochMs = DATE_PATTERN.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(epochMs) || new Date(epochMs).toISOString().slice(0, 10) !== date) {
    throw new InvalidCivilInputError(`${field} invalida: "${date}"`);
  }
  return epochMs / DAY_MS;
}

/** Dias desde 1970-01-01 -> data civil. */
export const civilDate = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

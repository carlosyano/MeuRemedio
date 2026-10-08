// Resolucao de tempo civil -> instante UTC.
// Regras normativas: Especificacao 02.33 (RN-013, secao 13.5) e ADR-001 v1.5 (OA-003):
//   - horario civil inexistente (lacuna de horario de verao) avanca para o primeiro instante valido;
//   - horario civil ambiguo (hora repetida) usa o primeiro instante cronologico;
//   - instantes sao sempre UTC; o resultado nao depende do fuso do servidor.
// Implementacao sem dependencias externas: usa apenas Intl (dados de fuso do runtime).

export type CivilResolution = 'EXACT' | 'GAP_ADVANCED' | 'AMBIGUOUS_FIRST';

export interface ResolvedCivilInstant {
  /** Instante em UTC, formato YYYY-MM-DDTHH:MM:SSZ. */
  readonly instantUtc: string;
  readonly resolution: CivilResolution;
}

export class InvalidCivilInputError extends Error {
  public override readonly name = 'InvalidCivilInputError';
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DEADLINE_MS = HOUR;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new InvalidCivilInputError(`Fuso horario invalido: "${timeZone}"`);
  }
  formatters.set(timeZone, created);
  return created;
}

/** Deslocamento (ms) do fuso em relacao ao UTC no instante informado. */
function offsetAt(timeZone: string, epochMs: number): number {
  const parts = formatterFor(timeZone).formatToParts(epochMs);
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return wallClockAsUtc - Math.floor(epochMs / SECOND) * SECOND;
}

function toInstantString(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

function parseNaiveWallClock(localDate: string, localTime: string): number {
  const dateMatch = DATE_PATTERN.exec(localDate);
  const timeMatch = TIME_PATTERN.exec(localTime);
  if (!dateMatch || !timeMatch) {
    throw new InvalidCivilInputError(`Data ou hora fora do formato: "${localDate}" "${localTime}"`);
  }
  const [year, month, day] = [dateMatch[1], dateMatch[2], dateMatch[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const [hour, minute] = [timeMatch[1], timeMatch[2]].map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Ida e volta em ISO: datas inexistentes (ex.: 2026-02-30) "rolam" para outro dia e nao coincidem.
  if (new Date(naive).toISOString().slice(0, 10) !== localDate) {
    throw new InvalidCivilInputError(`Data inexistente: "${localDate}"`);
  }
  return naive;
}

/** Primeiro segundo em que o deslocamento deixa de ser o de `lo` (transicao dentro de (lo, hi]). */
function transitionBetween(timeZone: string, lo: number, hi: number): number {
  const before = offsetAt(timeZone, lo);
  if (offsetAt(timeZone, hi) === before) {
    throw new Error('Invariante violada: nao ha transicao de deslocamento na janela');
  }
  let low = lo;
  let high = hi;
  while (high - low > SECOND) {
    const middle = low + Math.floor((high - low) / (2 * SECOND)) * SECOND;
    if (offsetAt(timeZone, middle) === before) low = middle;
    else high = middle;
  }
  return high;
}

export function resolveCivilInstant(
  localDate: string,
  localTime: string,
  timeZone: string,
): ResolvedCivilInstant {
  const naive = parseNaiveWallClock(localDate, localTime);
  formatterFor(timeZone);

  const offsets = new Set([offsetAt(timeZone, naive - DAY), offsetAt(timeZone, naive + DAY)]);
  const valid = [...offsets]
    .map((offset) => ({ offset, candidate: naive - offset }))
    .filter(({ offset, candidate }) => offsetAt(timeZone, candidate) === offset)
    .map(({ candidate }) => candidate)
    .sort((a, b) => a - b);

  const first = valid[0];
  if (first !== undefined) {
    return {
      instantUtc: toInstantString(first),
      resolution: valid.length > 1 ? 'AMBIGUOUS_FIRST' : 'EXACT',
    };
  }
  return {
    instantUtc: toInstantString(transitionBetween(timeZone, naive - DAY, naive + DAY)),
    resolution: 'GAP_ADVANCED',
  };
}

/** Instante UTC YYYY-MM-DDTHH:MM:SSZ -> epoch em ms; rejeita formato e datas inexistentes. */
export function parseInstant(instantUtc: string): number {
  const match = INSTANT_PATTERN.exec(instantUtc);
  if (!match) {
    throw new InvalidCivilInputError(`Instante UTC fora do formato: "${instantUtc}"`);
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (toInstantString(epochMs) !== instantUtc) {
    throw new InvalidCivilInputError(`Instante UTC inexistente: "${instantUtc}"`);
  }
  return epochMs;
}

/** Prazo de resposta: 60 minutos de tempo decorrido apos o instante programado (RN-009). */
export function deadlineFor(scheduledAtUtc: string): string {
  return toInstantString(parseInstant(scheduledAtUtc) + DEADLINE_MS);
}

/** Data civil (YYYY-MM-DD) do instante UTC no fuso informado. */
export function civilDateAt(instantUtc: string, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(parseInstant(instantUtc));
  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

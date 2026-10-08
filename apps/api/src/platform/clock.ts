// Clock injetavel (ADR-001 v1.5 secao 7, "Tempo"): toda regra temporal le o instante daqui.

export interface Clock {
  /** Instante atual em UTC, RFC 3339 com sufixo Z. */
  now(): string;
}

export const CLOCK = Symbol('Clock');

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

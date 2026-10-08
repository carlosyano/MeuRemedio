// @trace TS-024 RF-004 RN-013 RN-018 DEC-027 (Especificacao 02.33; ADR-001 v1.5 OA-003)
// Horizonte de geracao (DEC-027): da data civil atual no fuso da conta (ou de start_date, se
// posterior) ate a data atual + 30 dias, inclusive, limitado a end_date. Horarios ja vencidos na
// geracao nascem NO_RESPONSE, com no_response_reached_at igual ao instante da geracao.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidCivilInputError,
  civilDateAt,
  generationHorizon,
  initialOccurrenceState,
  type GenerationHorizonInput,
} from '../../packages/domain/src/index.js';

const DAY = 86_400_000;
// Relogio padrao dos cenarios (docs/specifications/P0_SENTINEL_TESTS.md).
const NOW = '2026-10-05T11:05:00Z';

const base = (over: Partial<GenerationHorizonInput> = {}): GenerationHorizonInput => ({
  now: NOW,
  timeZone: 'America/Sao_Paulo',
  planStartDate: '2026-10-01',
  planEndDate: null,
  ...over,
});

describe('DEC-027 civilDateAt: data civil atual no fuso da conta', () => {
  it.each([
    ['2026-10-05T02:59:00Z', 'America/Sao_Paulo', '2026-10-04'],
    ['2026-10-05T03:00:00Z', 'America/Sao_Paulo', '2026-10-05'],
    ['2026-10-04T13:00:00Z', 'Australia/Lord_Howe', '2026-10-05'],
    ['2026-10-04T12:59:00Z', 'Australia/Lord_Howe', '2026-10-04'],
    ['2026-03-08T04:59:00Z', 'America/New_York', '2026-03-07'],
    ['2026-03-08T05:00:00Z', 'America/New_York', '2026-03-08'],
    ['2026-10-25T00:30:00Z', 'Europe/Lisbon', '2026-10-25'],
  ])('%s em %s -> %s', (instant, zone, expected) => {
    expect(civilDateAt(instant, zone)).toBe(expected);
  });

  it.each([
    ['instante sem Z', '2026-10-05T11:05:00', 'America/Sao_Paulo'],
    ['instante invalido', '2026-13-05T11:05:00Z', 'America/Sao_Paulo'],
    ['fuso desconhecido', NOW, 'Mars/Olympus'],
  ])('rejeita %s', (_nome, instant, zone) => {
    expect(() => civilDateAt(instant, zone)).toThrow(InvalidCivilInputError);
  });
});

describe('DEC-027 generationHorizon: limites da janela', () => {
  it('vai da data atual ate a data atual + 30 dias, inclusive', () => {
    expect(generationHorizon(base())).toEqual({ fromDate: '2026-10-05', toDate: '2026-11-04' });
  });

  it('usa a data civil do fuso da conta, nao a data UTC', () => {
    // 01:30Z de 05/10 ainda e 04/10 em Sao Paulo (UTC-3).
    expect(generationHorizon(base({ now: '2026-10-05T01:30:00Z' }))).toEqual({
      fromDate: '2026-10-04',
      toDate: '2026-11-03',
    });
    // 13:30Z de 04/10 ja e 05/10 em Lord Howe (UTC+11 no horario de verao).
    expect(
      generationHorizon(base({ now: '2026-10-04T13:30:00Z', timeZone: 'Australia/Lord_Howe' })),
    ).toEqual({ fromDate: '2026-10-05', toDate: '2026-11-04' });
  });

  it('comeca em start_date quando ela e posterior a data atual', () => {
    expect(generationHorizon(base({ planStartDate: '2026-10-20' }))).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-11-04',
    });
  });

  it('start_date no ultimo dia do horizonte gera um unico dia', () => {
    expect(generationHorizon(base({ planStartDate: '2026-11-04' }))).toEqual({
      fromDate: '2026-11-04',
      toDate: '2026-11-04',
    });
  });

  it('termina em end_date quando ela e anterior ao fim do horizonte', () => {
    expect(generationHorizon(base({ planEndDate: '2026-10-10' }))).toEqual({
      fromDate: '2026-10-05',
      toDate: '2026-10-10',
    });
  });

  it('end_date igual a data atual gera somente o dia atual', () => {
    expect(generationHorizon(base({ planEndDate: '2026-10-05' }))).toEqual({
      fromDate: '2026-10-05',
      toDate: '2026-10-05',
    });
  });

  it('sem dias quando start_date passa do horizonte ou end_date ja passou', () => {
    expect(generationHorizon(base({ planStartDate: '2026-11-05' }))).toBeNull();
    expect(
      generationHorizon(base({ planStartDate: '2026-09-01', planEndDate: '2026-10-04' })),
    ).toBeNull();
  });

  it('atravessa a mudanca de horario sem perder nem repetir dias', () => {
    // Lisboa sai do horario de verao em 25/10/2026; a janela continua com 31 datas civis.
    expect(
      generationHorizon(base({ now: '2026-10-10T12:00:00Z', timeZone: 'Europe/Lisbon' })),
    ).toEqual({ fromDate: '2026-10-10', toDate: '2026-11-09' });
  });

  it.each([
    ['now invalido', base({ now: 'ontem' })],
    ['fuso invalido', base({ timeZone: 'America/Atlantida' })],
    ['start_date invalida', base({ planStartDate: '2026-02-30' })],
    ['end_date invalida', base({ planEndDate: '2026-10-32' })],
  ])('rejeita %s', (_nome, input) => {
    expect(() => generationHorizon(input)).toThrow(InvalidCivilInputError);
  });

  it('propriedade: a janela tem de 1 a 31 dias e respeita o plano', () => {
    const date = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 11, 31) }),
        fc.constantFrom('America/New_York', 'Europe/Lisbon', 'Australia/Lord_Howe'),
        fc.integer({ min: -60, max: 60 }),
        fc.option(fc.integer({ min: -60, max: 90 }), { nil: null }),
        (epochMs, zone, startOffset, endOffset) => {
          const now = new Date(epochMs - (epochMs % 60_000)).toISOString().replace('.000Z', 'Z');
          const today = Date.parse(`${civilDateAt(now, zone)}T00:00:00Z`) / DAY;
          const start = today + startOffset;
          const end = endOffset === null ? null : start + Math.abs(endOffset);
          const horizon = generationHorizon({
            now,
            timeZone: zone,
            planStartDate: date(start),
            planEndDate: end === null ? null : date(end),
          });
          const from = Math.max(today, start);
          const to = Math.min(today + 30, end ?? Number.POSITIVE_INFINITY);
          if (from > to) {
            expect(horizon).toBeNull();
          } else {
            expect(horizon).toEqual({ fromDate: date(from), toDate: date(to) });
          }
        },
      ),
    );
  });
});

describe('DEC-027 initialOccurrenceState: horarios ja passados na geracao', () => {
  it('prazo ja atingido: nasce NO_RESPONSE com no_response_reached_at = instante da geracao', () => {
    expect(initialOccurrenceState('2026-10-05T10:00:00Z', NOW)).toEqual({
      status: 'NO_RESPONSE',
      noResponseReachedAt: NOW,
    });
  });

  it('prazo exatamente no instante da geracao conta como atingido', () => {
    expect(initialOccurrenceState(NOW, NOW)).toEqual({
      status: 'NO_RESPONSE',
      noResponseReachedAt: NOW,
    });
  });

  it('horario ja passou, mas o prazo nao: nasce PROGRAMMED', () => {
    // 08:00 em Sao Paulo = 11:00Z; prazo 12:00Z; gerado as 11:05Z.
    expect(initialOccurrenceState('2026-10-05T12:00:00Z', NOW)).toEqual({
      status: 'PROGRAMMED',
      noResponseReachedAt: null,
    });
  });

  it('rejeita instantes invalidos', () => {
    expect(() => initialOccurrenceState('amanha', NOW)).toThrow(InvalidCivilInputError);
    expect(() => initialOccurrenceState(NOW, '2026-10-05')).toThrow(InvalidCivilInputError);
  });
});

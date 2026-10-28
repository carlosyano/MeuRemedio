// @trace DEC-037 RF-004 RN-007 TS-024 (periodicidade do plano no gerador puro)
// Periodicidade (DEC-037): todos os dias (padrao), dias da semana escolhidos ou a cada N dias
// contados a partir da data de inicio. Os dias valem no calendario civil da conta, sem efeito do
// fuso do processo.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidCivilInputError,
  occurrenceSlots,
  type OccurrenceSlotsInput,
  type Recurrence,
  type Weekday,
} from '../../packages/domain/src/index.js';

const DAY = 86_400_000;
const WEEKDAYS: readonly Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

const base = (over: Partial<OccurrenceSlotsInput> = {}): OccurrenceSlotsInput => ({
  timeZone: 'America/Sao_Paulo',
  planStartDate: '2026-10-01',
  planEndDate: null,
  times: [{ id: 't-0800', timeOfDay: '08:00' }],
  fromDate: '2026-10-05',
  toDate: '2026-10-18',
  ...over,
});

const datesOf = (input: OccurrenceSlotsInput): string[] => [
  ...new Set(occurrenceSlots(input).map((slot) => slot.localDate)),
];

/** Dia da semana de uma data civil, pelo calendario (sem fuso). */
const weekdayOf = (date: string): Weekday =>
  WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] as Weekday;

describe('DEC-037 todos os dias', () => {
  it('sem periodicidade e com DAILY: o mesmo resultado, um dia por data', () => {
    const omitted = occurrenceSlots(base());
    expect(occurrenceSlots(base({ recurrence: { kind: 'DAILY' } }))).toEqual(omitted);
    expect(datesOf(base())).toHaveLength(14);
  });
});

describe('DEC-037 dias da semana', () => {
  it('segunda e quinta: so essas datas, com todos os horarios do dia', () => {
    const input = base({
      recurrence: { kind: 'WEEKDAYS', weekdays: ['THURSDAY', 'MONDAY'] },
      times: [
        { id: 't-2000', timeOfDay: '20:00' },
        { id: 't-0800', timeOfDay: '08:00' },
      ],
    });
    // 2026-10-05 e uma segunda-feira.
    expect(datesOf(input)).toEqual(['2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15']);
    expect(occurrenceSlots(input).map((slot) => `${slot.localDate} ${slot.localTime}`)).toEqual([
      '2026-10-05 08:00',
      '2026-10-05 20:00',
      '2026-10-08 08:00',
      '2026-10-08 20:00',
      '2026-10-12 08:00',
      '2026-10-12 20:00',
      '2026-10-15 08:00',
      '2026-10-15 20:00',
    ]);
  });

  it('domingo e sabado tambem contam; os sete dias equivalem a todos os dias', () => {
    expect(
      datesOf(base({ recurrence: { kind: 'WEEKDAYS', weekdays: ['SUNDAY', 'SATURDAY'] } })),
    ).toEqual(['2026-10-10', '2026-10-11', '2026-10-17', '2026-10-18']);
    expect(occurrenceSlots(base({ recurrence: { kind: 'WEEKDAYS', weekdays: WEEKDAYS } }))).toEqual(
      occurrenceSlots(base()),
    );
  });

  it('respeita o inicio e o termino do plano', () => {
    const input = base({
      planStartDate: '2026-10-06',
      planEndDate: '2026-10-15',
      recurrence: { kind: 'WEEKDAYS', weekdays: ['MONDAY', 'THURSDAY'] },
    });
    expect(datesOf(input)).toEqual(['2026-10-08', '2026-10-12', '2026-10-15']);
  });
});

describe('DEC-037 a cada N dias', () => {
  it('conta a partir do inicio do plano, nao da janela', () => {
    // Inicio 2026-10-01, a cada 3 dias: 01, 04, 07, 10, 13, 16...
    const input = base({ recurrence: { kind: 'EVERY_N_DAYS', intervalDays: 3 } });
    expect(datesOf(input)).toEqual(['2026-10-07', '2026-10-10', '2026-10-13', '2026-10-16']);
  });

  it('janela que comeca antes do inicio: o primeiro dia e o inicio', () => {
    const input = base({
      planStartDate: '2026-10-06',
      fromDate: '2026-10-01',
      toDate: '2026-10-12',
      recurrence: { kind: 'EVERY_N_DAYS', intervalDays: 2 },
    });
    expect(datesOf(input)).toEqual(['2026-10-06', '2026-10-08', '2026-10-10', '2026-10-12']);
  });

  it('intervalo maior que a janela pode nao gerar nada; o termino corta', () => {
    expect(datesOf(base({ recurrence: { kind: 'EVERY_N_DAYS', intervalDays: 30 } }))).toEqual([]);
    expect(
      datesOf(
        base({
          planEndDate: '2026-10-09',
          recurrence: { kind: 'EVERY_N_DAYS', intervalDays: 2 },
        }),
      ),
    ).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
  });

  it('atravessa a mudanca de ano e o dia 29 de fevereiro', () => {
    const input = base({
      planStartDate: '2027-12-30',
      fromDate: '2027-12-30',
      toDate: '2028-03-05',
      recurrence: { kind: 'EVERY_N_DAYS', intervalDays: 31 },
    });
    expect(datesOf(input)).toEqual(['2027-12-30', '2028-01-30', '2028-03-01']);
  });
});

describe('DEC-037 entradas invalidas', () => {
  it.each([
    ['nenhum dia da semana', { kind: 'WEEKDAYS', weekdays: [] }],
    ['dia repetido', { kind: 'WEEKDAYS', weekdays: ['MONDAY', 'MONDAY'] }],
    ['dia fora da lista', { kind: 'WEEKDAYS', weekdays: ['FUNDAY'] }],
    ['intervalo 1', { kind: 'EVERY_N_DAYS', intervalDays: 1 }],
    ['intervalo 366', { kind: 'EVERY_N_DAYS', intervalDays: 366 }],
    ['intervalo fracionado', { kind: 'EVERY_N_DAYS', intervalDays: 2.5 }],
  ])('%s', (_nome, recurrence) => {
    expect(() => occurrenceSlots(base({ recurrence: recurrence as Recurrence }))).toThrow(
      InvalidCivilInputError,
    );
  });

  it('valida mesmo quando a janela nao produz slots', () => {
    expect(() =>
      occurrenceSlots(
        base({
          fromDate: '2026-10-10',
          toDate: '2026-10-01',
          recurrence: { kind: 'EVERY_N_DAYS', intervalDays: 0 },
        }),
      ),
    ).toThrow(InvalidCivilInputError);
  });

  it('aceita os limites 2 e 365', () => {
    for (const intervalDays of [2, 365]) {
      expect(() =>
        occurrenceSlots(base({ recurrence: { kind: 'EVERY_N_DAYS', intervalDays } })),
      ).not.toThrow();
    }
  });
});

describe('DEC-037 propriedades (fast-check)', () => {
  const date = fc
    .integer({ min: 0, max: 3650 })
    .map((offset) => new Date(Date.UTC(2026, 0, 1) + offset * DAY).toISOString().slice(0, 10));

  it('dias da semana: toda data gerada e um dos dias escolhidos, e nenhum outro falta', () => {
    fc.assert(
      fc.property(
        date,
        fc.integer({ min: 0, max: 40 }),
        fc.uniqueArray(fc.constantFrom(...WEEKDAYS), { minLength: 1, maxLength: 7 }),
        (start, span, weekdays) => {
          const toDate = new Date(Date.parse(start) + span * DAY).toISOString().slice(0, 10);
          const input = base({
            planStartDate: start,
            fromDate: start,
            toDate,
            recurrence: { kind: 'WEEKDAYS', weekdays },
          });
          const daily = datesOf({ ...input, recurrence: { kind: 'DAILY' } });
          expect(datesOf(input)).toEqual(daily.filter((d) => weekdays.includes(weekdayOf(d))));
        },
      ),
    );
  });

  it('a cada N dias: toda data gerada dista do inicio um multiplo de N', () => {
    fc.assert(
      fc.property(
        date,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 2, max: 365 }),
        (start, skip, span, intervalDays) => {
          const from = Date.parse(start) + skip * DAY;
          const input = base({
            planStartDate: start,
            fromDate: new Date(from).toISOString().slice(0, 10),
            toDate: new Date(from + span * DAY).toISOString().slice(0, 10),
            recurrence: { kind: 'EVERY_N_DAYS', intervalDays },
          });
          const daily = datesOf({ ...input, recurrence: { kind: 'DAILY' } });
          const expected = daily.filter(
            (d) => Math.round((Date.parse(d) - Date.parse(start)) / DAY) % intervalDays === 0,
          );
          expect(datesOf(input)).toEqual(expected);
        },
      ),
    );
  });
});

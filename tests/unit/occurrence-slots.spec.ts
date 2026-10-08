// @trace TS-024 RN-007 RN-009 RN-013 RF-004 (secao 13.5 da Especificacao 02.33; ADR-001 v1.5 OA-003)
// Parte pura do gerador de ocorrencias: (plano, horarios, fuso, janela de datas civis) -> slots.
// A janela e explicita: a politica do horizonte movel de 30 dias (inicio e limites) nao e decidida aqui.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidCivilInputError,
  occurrenceSlots,
  type OccurrenceSlotsInput,
} from '../../packages/domain/src/index.js';

const DAY = 86_400_000;
const PROPERTY_TIMEOUT_MS = 60_000;
const DST_ZONES = [
  'America/New_York',
  'Europe/Lisbon',
  'America/Santiago',
  'Australia/Lord_Howe',
  'America/Sao_Paulo',
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

const base = (over: Partial<OccurrenceSlotsInput> = {}): OccurrenceSlotsInput => ({
  timeZone: 'America/Sao_Paulo',
  planStartDate: '2026-10-01',
  planEndDate: null,
  times: [{ id: 't-0800', timeOfDay: '08:00' }],
  fromDate: '2026-10-05',
  toDate: '2026-10-05',
  ...over,
});

describe('TS-024 occurrenceSlots: dias de transicao', () => {
  it('hora inexistente avanca e preserva local_time; 02:30 e 03:00 viram slots distintos', () => {
    const slots = occurrenceSlots(
      base({
        timeZone: 'America/New_York',
        planStartDate: '2026-03-01',
        times: [
          { id: 't-0300', timeOfDay: '03:00' },
          { id: 't-0230', timeOfDay: '02:30' },
        ],
        fromDate: '2026-03-08',
        toDate: '2026-03-08',
      }),
    );
    expect(slots).toEqual([
      {
        scheduleTimeId: 't-0230',
        localDate: '2026-03-08',
        localTime: '02:30',
        scheduledAt: '2026-03-08T07:00:00Z',
        deadlineAt: '2026-03-08T08:00:00Z',
        resolution: 'GAP_ADVANCED',
      },
      {
        scheduleTimeId: 't-0300',
        localDate: '2026-03-08',
        localTime: '03:00',
        scheduledAt: '2026-03-08T07:00:00Z',
        deadlineAt: '2026-03-08T08:00:00Z',
        resolution: 'EXACT',
      },
    ]);
  });

  it('hora repetida gera exatamente 1 slot, no primeiro instante', () => {
    const slots = occurrenceSlots(
      base({
        timeZone: 'America/New_York',
        planStartDate: '2026-10-01',
        times: [{ id: 't-0130', timeOfDay: '01:30' }],
        fromDate: '2026-11-01',
        toDate: '2026-11-01',
      }),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      localTime: '01:30',
      scheduledAt: '2026-11-01T05:30:00Z',
      deadlineAt: '2026-11-01T06:30:00Z',
      resolution: 'AMBIGUOUS_FIRST',
    });
  });

  it('America/Sao_Paulo (sem DST): 08:00 vira 11:00Z em todos os dias', () => {
    const slots = occurrenceSlots(base({ fromDate: '2026-01-01', toDate: '2026-12-31' }));
    expect(slots.length).toBe(365 - 273); // 2026-10-01 .. 2026-12-31
    for (const slot of slots) expect(slot.scheduledAt).toBe(`${slot.localDate}T11:00:00Z`);
  });
});

describe('TS-024 occurrenceSlots: periodo do plano e janela', () => {
  it('recorta a janela pelo inicio e pelo fim do plano (inclusivos)', () => {
    const slots = occurrenceSlots(
      base({
        planStartDate: '2026-10-03',
        planEndDate: '2026-10-05',
        fromDate: '2026-10-01',
        toDate: '2026-10-10',
      }),
    );
    expect(slots.map((s) => s.localDate)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
  });

  it('sem data de termino, cobre a janela inteira', () => {
    const slots = occurrenceSlots(base({ fromDate: '2026-10-05', toDate: '2026-10-08' }));
    expect(slots.map((s) => s.localDate)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ]);
  });

  it('janela fora do periodo do plano ou invertida nao gera slots', () => {
    expect(occurrenceSlots(base({ fromDate: '2026-09-01', toDate: '2026-09-30' }))).toEqual([]);
    expect(
      occurrenceSlots(
        base({ planEndDate: '2026-10-02', fromDate: '2026-10-03', toDate: '2026-10-09' }),
      ),
    ).toEqual([]);
    expect(occurrenceSlots(base({ fromDate: '2026-10-06', toDate: '2026-10-05' }))).toEqual([]);
  });

  it('ordena por data civil e depois por horario civil', () => {
    const slots = occurrenceSlots(
      base({
        times: [
          { id: 't-2000', timeOfDay: '20:00' },
          { id: 't-0800', timeOfDay: '08:00' },
        ],
        fromDate: '2026-10-05',
        toDate: '2026-10-06',
      }),
    );
    expect(slots.map((s) => `${s.localDate} ${s.localTime}`)).toEqual([
      '2026-10-05 08:00',
      '2026-10-05 20:00',
      '2026-10-06 08:00',
      '2026-10-06 20:00',
    ]);
  });
});

describe('TS-024 occurrenceSlots: entradas invalidas', () => {
  it.each([
    ['data inicial invalida', { fromDate: '2026-02-30' }],
    ['data final fora do formato', { toDate: '05/10/2026' }],
    ['inicio do plano invalido', { planStartDate: '2026-13-01' }],
    ['fim do plano invalido', { planEndDate: '2026-1-1' }],
    ['horario fora do formato', { times: [{ id: 't', timeOfDay: '8:00' }] }],
    [
      'horario repetido (RN-006)',
      {
        times: [
          { id: 'a', timeOfDay: '08:00' },
          { id: 'b', timeOfDay: '08:00' },
        ],
      },
    ],
    ['fuso invalido', { timeZone: 'Mars/Olympus' }],
  ] as const)('rejeita %s', (_nome, over) => {
    expect(() => occurrenceSlots(base(over))).toThrow(InvalidCivilInputError);
  });
});

describe('TS-024 occurrenceSlots: propriedades (fast-check)', () => {
  const dayArb = fc
    .integer({ min: Date.UTC(2024, 0, 1) / DAY, max: Date.UTC(2030, 11, 31) / DAY })
    .map((days) => new Date(days * DAY).toISOString().slice(0, 10));
  const timesArb = fc
    .uniqueArray(
      fc
        .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
        .map(([h, m]) => `${pad(h)}:${pad(m)}`),
      { minLength: 1, maxLength: 10 },
    )
    .map((list) => list.map((timeOfDay, index) => ({ id: `t${String(index)}`, timeOfDay })));
  const inputArb = fc
    .record({
      timeZone: fc.constantFrom(...DST_ZONES),
      fromDate: dayArb,
      span: fc.integer({ min: 0, max: 30 }),
      times: timesArb,
    })
    .map(({ timeZone, fromDate, span, times }) => ({
      timeZone,
      planStartDate: '2024-01-01',
      planEndDate: null,
      times,
      fromDate,
      toDate: new Date(Date.parse(fromDate) + span * DAY).toISOString().slice(0, 10),
      span,
    }));

  it(
    'exatamente 1 slot por (data, horario); total = dias x horarios',
    () => {
      fc.assert(
        fc.property(inputArb, ({ span, ...input }) => {
          const slots = occurrenceSlots(input);
          const keys = new Set(slots.map((s) => `${s.localDate} ${s.localTime}`));
          expect(keys.size).toBe(slots.length);
          expect(slots.length).toBe((span + 1) * input.times.length);
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'scheduled_at monotonico no dia, deadline = scheduled_at + 60 min e local_time preservado',
    () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const slots = occurrenceSlots(input);
          const requested = new Set(input.times.map((t) => t.timeOfDay));
          for (let i = 0; i < slots.length; i += 1) {
            const slot = slots[i];
            if (!slot) throw new Error('slot ausente');
            expect(requested.has(slot.localTime)).toBe(true);
            expect(Date.parse(slot.deadlineAt) - Date.parse(slot.scheduledAt)).toBe(3_600_000);
            const previous = slots[i - 1];
            if (previous?.localDate === slot.localDate) {
              expect(Date.parse(slot.scheduledAt)).toBeGreaterThanOrEqual(
                Date.parse(previous.scheduledAt),
              );
            }
          }
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});

describe('TS-024 occurrenceSlots: independencia do fuso do servidor', () => {
  it('produz o mesmo resultado com TZ do processo diferentes', () => {
    const input = base({
      timeZone: 'Australia/Lord_Howe',
      planStartDate: '2026-04-01',
      times: [
        { id: 'a', timeOfDay: '01:45' },
        { id: 'b', timeOfDay: '02:15' },
      ],
      fromDate: '2026-04-04',
      toDate: '2026-10-05',
    });
    const original = process.env['TZ'];
    const results: unknown[] = [];
    try {
      for (const serverZone of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env['TZ'] = serverZone;
        results.push(occurrenceSlots(input));
      }
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});

// @trace TS-024 RN-013 RNF-010 RF-004 (secao 13.5 da Especificacao 02.33; ADR-001 v1.5 OA-003)
// Escopo desta etapa: resolucao de data, hora e fuso civis em instante UTC (parte pura do TS-024).
// O gerador de ocorrencias esta em tests/unit/occurrence-slots.spec.ts e
// tests/integration/ts-024.spec.ts (PostgreSQL).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidCivilInputError,
  deadlineFor,
  resolveCivilInstant,
  type CivilResolution,
} from '../../packages/domain/src/index.js';

interface Fixture {
  readonly zone: string;
  readonly date: string;
  readonly time: string;
  readonly instantUtc: string;
  readonly resolution: CivilResolution;
}

// Valores calculados com zoneinfo (Python) e registrados em docs/specifications/P0_SENTINEL_TESTS.md.
const FIXTURES: readonly Fixture[] = [
  {
    zone: 'America/New_York',
    date: '2026-03-08',
    time: '02:30',
    instantUtc: '2026-03-08T07:00:00Z',
    resolution: 'GAP_ADVANCED',
  },
  {
    zone: 'America/New_York',
    date: '2026-11-01',
    time: '01:30',
    instantUtc: '2026-11-01T05:30:00Z',
    resolution: 'AMBIGUOUS_FIRST',
  },
  {
    zone: 'Europe/Lisbon',
    date: '2026-03-29',
    time: '01:30',
    instantUtc: '2026-03-29T01:00:00Z',
    resolution: 'GAP_ADVANCED',
  },
  {
    zone: 'Europe/Lisbon',
    date: '2026-10-25',
    time: '01:30',
    instantUtc: '2026-10-25T00:30:00Z',
    resolution: 'AMBIGUOUS_FIRST',
  },
  {
    zone: 'America/Santiago',
    date: '2026-09-06',
    time: '00:30',
    instantUtc: '2026-09-06T04:00:00Z',
    resolution: 'GAP_ADVANCED',
  },
  {
    zone: 'America/Santiago',
    date: '2026-04-04',
    time: '23:30',
    instantUtc: '2026-04-05T02:30:00Z',
    resolution: 'AMBIGUOUS_FIRST',
  },
  {
    zone: 'Australia/Lord_Howe',
    date: '2026-10-04',
    time: '02:15',
    instantUtc: '2026-10-03T15:30:00Z',
    resolution: 'GAP_ADVANCED',
  },
  {
    zone: 'Australia/Lord_Howe',
    date: '2026-04-05',
    time: '01:45',
    instantUtc: '2026-04-04T14:45:00Z',
    resolution: 'AMBIGUOUS_FIRST',
  },
  {
    zone: 'America/New_York',
    date: '2026-07-01',
    time: '08:00',
    instantUtc: '2026-07-01T12:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'America/New_York',
    date: '2026-01-15',
    time: '08:00',
    instantUtc: '2026-01-15T13:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'Europe/Lisbon',
    date: '2026-07-01',
    time: '08:00',
    instantUtc: '2026-07-01T07:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'Europe/Lisbon',
    date: '2026-01-15',
    time: '08:00',
    instantUtc: '2026-01-15T08:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'America/Santiago',
    date: '2026-01-15',
    time: '08:00',
    instantUtc: '2026-01-15T11:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'America/Santiago',
    date: '2026-07-01',
    time: '08:00',
    instantUtc: '2026-07-01T12:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'Australia/Lord_Howe',
    date: '2026-01-15',
    time: '08:00',
    instantUtc: '2026-01-14T21:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'Australia/Lord_Howe',
    date: '2026-07-01',
    time: '08:00',
    instantUtc: '2026-06-30T21:30:00Z',
    resolution: 'EXACT',
  },
  // America/Sao_Paulo nao tem horario de verao desde 2019: offset fixo -03:00 o ano inteiro.
  {
    zone: 'America/Sao_Paulo',
    date: '2026-11-01',
    time: '08:00',
    instantUtc: '2026-11-01T11:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'America/Sao_Paulo',
    date: '2026-02-15',
    time: '08:00',
    instantUtc: '2026-02-15T11:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'America/Sao_Paulo',
    date: '2026-06-15',
    time: '00:00',
    instantUtc: '2026-06-15T03:00:00Z',
    resolution: 'EXACT',
  },
  {
    zone: 'America/Sao_Paulo',
    date: '2026-12-31',
    time: '23:59',
    instantUtc: '2027-01-01T02:59:00Z',
    resolution: 'EXACT',
  },
];

// Propriedades varrem ~3.000 minutos por exemplo; limite folgado para runners de CI mais lentos.
const PROPERTY_TIMEOUT_MS = 60_000;

const DST_ZONES = [
  'America/New_York',
  'Europe/Lisbon',
  'America/Santiago',
  'Australia/Lord_Howe',
  'America/Sao_Paulo',
] as const;

// ---------- oraculo independente: varredura minuto a minuto ----------
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

const oracleFormatters = new Map<string, Intl.DateTimeFormat>();

function localMinuteOf(zone: string, epochMs: number): number {
  let formatter = oracleFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    oracleFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(epochMs);
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) / MINUTE;
}

interface Oracle {
  readonly byLocalMinute: Map<number, number[]>;
  readonly gap: {
    readonly firstLocal: number;
    readonly lastLocal: number;
    readonly instant: number;
  } | null;
}

const oracleCache = new Map<string, Oracle>();

function oracleFor(zone: string, date: string): Oracle {
  const key = `${zone}|${date}`;
  const cached = oracleCache.get(key);
  if (cached) return cached;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, d) - 26 * 60 * MINUTE;
  const end = Date.UTC(y, m - 1, d) + DAY + 26 * 60 * MINUTE;
  const byLocalMinute = new Map<number, number[]>();
  let gap: Oracle['gap'] = null;
  let previousLocal: number | null = null;
  for (let t = start; t <= end; t += MINUTE) {
    const local = localMinuteOf(zone, t);
    const list = byLocalMinute.get(local) ?? [];
    list.push(t);
    byLocalMinute.set(local, list);
    if (previousLocal !== null && local - previousLocal > 1) {
      gap = { firstLocal: previousLocal + 1, lastLocal: local - 1, instant: t };
    }
    previousLocal = local;
  }
  const oracle: Oracle = { byLocalMinute, gap };
  oracleCache.set(key, oracle);
  return oracle;
}

function expectedByOracle(
  zone: string,
  date: string,
  time: string,
): { instantUtc: string; resolution: CivilResolution } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const requested = Date.UTC(y, m - 1, d, hh, mm) / MINUTE;
  const oracle = oracleFor(zone, date);
  const instants = oracle.byLocalMinute.get(requested);
  const toIso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');
  if (instants && instants.length > 0) {
    const first = Math.min(...instants);
    return {
      instantUtc: toIso(first),
      resolution: instants.length > 1 ? 'AMBIGUOUS_FIRST' : 'EXACT',
    };
  }
  if (oracle.gap && requested >= oracle.gap.firstLocal && requested <= oracle.gap.lastLocal) {
    return { instantUtc: toIso(oracle.gap.instant), resolution: 'GAP_ADVANCED' };
  }
  throw new Error(`oraculo sem resposta para ${zone} ${date} ${time}`);
}

describe('TS-024 resolveCivilInstant: fixtures normativas', () => {
  it.each(FIXTURES)('$zone $date $time -> $instantUtc ($resolution)', (f) => {
    expect(resolveCivilInstant(f.date, f.time, f.zone)).toEqual({
      instantUtc: f.instantUtc,
      resolution: f.resolution,
    });
  });
});

describe('TS-024 resolveCivilInstant: dias de transicao, todos os minutos do dia, contra o oraculo', () => {
  const transitions = FIXTURES.filter((f) => f.resolution !== 'EXACT');
  it.each(transitions)('$zone $date (dia inteiro)', (f) => {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
      expect(resolveCivilInstant(f.date, time, f.zone), `${f.zone} ${f.date} ${time}`).toEqual(
        expectedByOracle(f.zone, f.date, time),
      );
    }
  });
});

describe('TS-024 resolveCivilInstant: propriedades (fast-check)', () => {
  const dayArb = fc
    .integer({ min: Date.UTC(2024, 0, 1) / DAY, max: Date.UTC(2030, 11, 31) / DAY })
    .map((days) => new Date(days * DAY).toISOString().slice(0, 10));
  const timeArb = fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([h, m]) => `${pad(h)}:${pad(m)}`);
  const zoneArb = fc.constantFrom(...DST_ZONES);

  it(
    'coincide com o oraculo para qualquer fuso, data (2024-2030) e horario',
    () => {
      fc.assert(
        fc.property(zoneArb, dayArb, timeArb, (zone, date, time) => {
          expect(resolveCivilInstant(date, time, zone)).toEqual(expectedByOracle(zone, date, time));
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'nunca retorna instante anterior para horario civil posterior no mesmo dia (monotonico)',
    () => {
      fc.assert(
        fc.property(zoneArb, dayArb, timeArb, timeArb, (zone, date, a, b) => {
          const [early, late] = a <= b ? [a, b] : [b, a];
          const first = Date.parse(resolveCivilInstant(date, early, zone).instantUtc);
          const second = Date.parse(resolveCivilInstant(date, late, zone).instantUtc);
          expect(second).toBeGreaterThanOrEqual(first);
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});

describe('TS-024 resolveCivilInstant: independencia do fuso do servidor', () => {
  it('produz o mesmo resultado com TZ do processo diferentes', () => {
    const original = process.env['TZ'];
    const offsetsSeen = new Set<number>();
    const results: string[][] = [];
    try {
      for (const serverZone of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env['TZ'] = serverZone;
        offsetsSeen.add(new Date(2026, 0, 1, 12).getTimezoneOffset());
        results.push(FIXTURES.map((f) => resolveCivilInstant(f.date, f.time, f.zone).instantUtc));
      }
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
    // Pre-condicao: a troca de TZ realmente alterou o comportamento local do Date.
    expect(offsetsSeen.size).toBeGreaterThan(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});

describe('TS-024 deadlineFor: prazo de 60 minutos em tempo decorrido', () => {
  it('soma 60 minutos ao instante programado', () => {
    expect(deadlineFor('2026-10-05T11:00:00Z')).toBe('2026-10-05T12:00:00Z');
  });

  it('atravessa a virada de dia e de ano', () => {
    expect(deadlineFor('2026-12-31T23:30:00Z')).toBe('2027-01-01T00:30:00Z');
  });

  it('nao depende do relogio civil: no dia da lacuna de New York continua sendo +60 min', () => {
    const scheduled = resolveCivilInstant('2026-03-08', '02:30', 'America/New_York').instantUtc;
    expect(deadlineFor(scheduled)).toBe('2026-03-08T08:00:00Z');
  });
});

describe('TS-024 resolveCivilInstant: entradas invalidas', () => {
  it.each([
    ['data inexistente', '2026-02-30', '08:00', 'America/Sao_Paulo'],
    ['data fora do formato', '2026-2-3', '08:00', 'America/Sao_Paulo'],
    ['hora 24:00', '2026-02-03', '24:00', 'America/Sao_Paulo'],
    ['hora sem zero a esquerda', '2026-02-03', '8:00', 'America/Sao_Paulo'],
    ['minuto 60', '2026-02-03', '08:60', 'America/Sao_Paulo'],
    ['fuso inexistente', '2026-02-03', '08:00', 'Nowhere/City'],
    ['fuso vazio', '2026-02-03', '08:00', ''],
  ])('rejeita %s', (_nome, date, time, zone) => {
    expect(() => resolveCivilInstant(date, time, zone)).toThrow(InvalidCivilInputError);
  });
});

describe('TS-024 pendencias conhecidas (fora desta etapa)', () => {
  it.todo(
    'horizonte movel de 30 dias: disparo via Outbox (criar/editar plano) e job horario (requer o worker)',
  );
  it.todo(
    'account_timezone aceita somente identificador IANA canonico (validacao em createAccount)',
  );
});

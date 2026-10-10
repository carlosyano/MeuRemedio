// @trace RN-016 CA-017 TS-043 RF-003 createPlan
// Regras puras de duplicidade de plano: normalizacao de medication_name e dose_text (trim,
// colapso de espacos, remocao de diacriticos, case-insensitive) e intersecao de periodos
// [start_date, end_date | infinito), com end_date inclusiva (data civil).
import { describe, expect, it } from 'vitest';
import { normalizePlanText, planPeriodsOverlap } from '@meuremedio/domain';

describe('normalizePlanText', () => {
  it.each([
    ['Comprimido', 'comprimido'],
    ['  Comprimido  ', 'comprimido'],
    ['Ácido   Fólico', 'acido folico'],
    ['DIPIRONA\tSÓDICA', 'dipirona sodica'],
    ['1  comprimido', '1 comprimido'],
    ['Pão de mel', 'pao de mel'],
    ['Ç', 'c'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizePlanText(input)).toBe(expected);
  });

  it('acento composto e decomposto normalizam igual', () => {
    expect(normalizePlanText('Fólico')).toBe(normalizePlanText('Fólico'));
  });
});

describe('planPeriodsOverlap', () => {
  const p = (start: string, end: string | null) => ({ startDate: start, endDate: end });

  it.each([
    ['ambos sem fim', p('2026-10-01', null), p('2027-01-01', null), true],
    ['dias iguais', p('2026-10-01', '2026-10-01'), p('2026-10-01', '2026-10-01'), true],
    [
      'toque no ultimo dia (end inclusiva)',
      p('2026-10-01', '2026-10-10'),
      p('2026-10-10', null),
      true,
    ],
    ['contido', p('2026-10-01', '2026-12-31'), p('2026-11-01', '2026-11-02'), true],
    ['disjuntos', p('2026-10-01', '2026-10-09'), p('2026-10-10', null), false],
    ['disjuntos, ordem invertida', p('2026-10-10', null), p('2026-10-01', '2026-10-09'), false],
    [
      'fim antes do inicio do outro sem fim',
      p('2026-01-01', '2026-01-31'),
      p('2026-02-01', null),
      false,
    ],
  ])('%s', (_nome, a, b, expected) => {
    expect(planPeriodsOverlap(a, b)).toBe(expected);
    expect(planPeriodsOverlap(b, a)).toBe(expected);
  });
});

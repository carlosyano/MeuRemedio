// @trace DEC-037 RF-003 (mascara de bits dos dias da semana, migracao 0015)
// Os dias da semana da periodicidade sao gravados em mascara de bits: segunda = 1, ..., domingo =
// 64. A conversao e reversivel, ignora repeticao e devolve os dias de segunda a domingo.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  weekdayMask,
  weekdaysFromMask,
  weekdayOfDay,
} from '../../packages/domain/src/index.js';

describe('weekdayMask e weekdaysFromMask', () => {
  it('segunda = 1, quinta = 8, domingo = 64; todos = 127', () => {
    expect(weekdayMask(['MONDAY'])).toBe(1);
    expect(weekdayMask(['THURSDAY'])).toBe(8);
    expect(weekdayMask(['SUNDAY'])).toBe(64);
    expect(weekdayMask(['THURSDAY', 'MONDAY', 'THURSDAY'])).toBe(9);
    expect(weekdayMask(WEEKDAYS)).toBe(127);
    expect(weekdayMask([])).toBe(0);
  });

  it('volta de segunda a domingo', () => {
    expect(weekdaysFromMask(9)).toEqual(['MONDAY', 'THURSDAY']);
    expect(weekdaysFromMask(96)).toEqual(['SATURDAY', 'SUNDAY']);
    expect(weekdaysFromMask(127)).toEqual(WEEKDAYS);
    expect(weekdaysFromMask(0)).toEqual([]);
  });

  it('ida e volta preserva o conjunto (fast-check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 127 }), (mask) => {
        expect(weekdayMask(weekdaysFromMask(mask))).toBe(mask);
      }),
    );
  });
});

describe('weekdayOfDay', () => {
  it('1970-01-01 (dia 0) e quinta; dias antes de 1970 tambem', () => {
    expect(weekdayOfDay(0)).toBe('THURSDAY');
    expect(weekdayOfDay(4)).toBe('MONDAY');
    expect(weekdayOfDay(-1)).toBe('WEDNESDAY');
    expect(weekdayOfDay(-4)).toBe('SUNDAY');
    // 2026-10-05, segunda-feira.
    expect(weekdayOfDay(Date.UTC(2026, 9, 5) / 86_400_000)).toBe('MONDAY');
  });
});

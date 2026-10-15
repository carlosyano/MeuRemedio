// @trace TL-006 RF-007 RN-010 CA-009 ERR-001 getHistory
// Regras e textos do historico na web (TL-006; DC-056): periodo padrao dos ultimos 30 dias, mesma
// regra de periodo da API (DC-041: termino >= inicio e ate 12 meses inclusivos, com 29/02 indo ao
// ultimo dia do mes) e o texto da situacao de cada ocorrencia.
import { describe, expect, it } from 'vitest';
import { defaultPeriod, outcomeText, validatePeriod } from '../../apps/web/src/lib/history.js';

describe('periodo', () => {
  it('padrao: os ultimos 30 dias ate hoje, inclusive', () => {
    expect(defaultPeriod('2026-10-15')).toEqual({ start: '2026-09-16', end: '2026-10-15' });
    expect(defaultPeriod('2026-03-01')).toEqual({ start: '2026-01-31', end: '2026-03-01' });
  });

  it('datas obrigatorias', () => {
    expect(validatePeriod('', '')).toEqual({
      start: 'Informe a data inicial.',
      end: 'Informe a data final.',
    });
  });

  it('termino antes do inicio', () => {
    expect(validatePeriod('2026-03-10', '2026-03-09')).toEqual({
      end: 'A data final deve ser igual ou posterior à inicial.',
    });
    expect(validatePeriod('2026-03-10', '2026-03-10')).toEqual({});
  });

  it('ate 12 meses inclusivos (DC-041)', () => {
    expect(validatePeriod('2026-01-01', '2026-12-31')).toEqual({});
    expect(validatePeriod('2026-01-01', '2027-01-01')).toEqual({
      end: 'O período pode ter no máximo 12 meses.',
    });
    // 29/02/2028 + 12 meses = 28/02/2029 (ultimo dia do mes); a vespera e o limite.
    expect(validatePeriod('2028-02-29', '2029-02-27')).toEqual({});
    expect(validatePeriod('2028-02-29', '2029-02-28')).toEqual({
      end: 'O período pode ter no máximo 12 meses.',
    });
  });
});

describe('situacao', () => {
  const occurrence = (status: string) => ({ status });

  it('com resposta: tipo, motivo e atraso', () => {
    expect(outcomeText(occurrence('TAKEN'), { type: 'TAKEN', reason: null, is_late: false })).toBe(
      'Tomei',
    );
    expect(outcomeText(occurrence('TAKEN'), { type: 'TAKEN', reason: null, is_late: true })).toBe(
      'Tomei · registrado com atraso',
    );
    expect(
      outcomeText(occurrence('NOT_TAKEN'), { type: 'NOT_TAKEN', reason: 'FORGOT', is_late: false }),
    ).toBe('Não tomei · Esqueci');
    expect(
      outcomeText(occurrence('NOT_TAKEN'), { type: 'NOT_TAKEN', reason: null, is_late: false }),
    ).toBe('Não tomei');
  });

  it('sem resposta: no prazo ou vencida', () => {
    expect(outcomeText(occurrence('PROGRAMMED'), null)).toBe('Aguardando resposta');
    expect(outcomeText(occurrence('NO_RESPONSE'), null)).toBe('Sem resposta');
  });
});

// @trace TL-005 RF-005 RF-006 RN-009 createResponse
// Textos da tela de ocorrencias (TL-005; DC-055): quando (hoje ou data em pt-BR, com o horario
// local da ocorrencia, sem conversao de fuso), motivos do NOT_TAKEN em pt-BR na ordem do contrato
// e corpo da resposta (TAKEN sempre com reason null).
import { describe, expect, it } from 'vitest';
import { NOT_TAKEN_REASONS, responseBody, whenText } from '../../apps/web/src/lib/occurrences.js';

describe('whenText', () => {
  it('hoje mostra so o horario local; outro dia mostra a data', () => {
    expect(
      whenText({ local_scheduled_date: '2026-10-15', local_time: '08:00' }, '2026-10-15'),
    ).toBe('Hoje, 08:00');
    expect(
      whenText({ local_scheduled_date: '2026-10-14', local_time: '22:30' }, '2026-10-15'),
    ).toBe('14/10/2026, 22:30');
  });
});

describe('motivos e corpo da resposta', () => {
  it('todos os motivos do contrato, na mesma ordem, com rotulo', () => {
    expect(NOT_TAKEN_REASONS.map(([value]) => value)).toEqual([
      'FORGOT',
      'UNAVAILABLE',
      'SIDE_EFFECT_CONCERN',
      'CHOSE_NOT_TO_TAKE',
      'OTHER',
    ]);
    expect(NOT_TAKEN_REASONS.find(([value]) => value === 'FORGOT')?.[1]).toBe('Esqueci');
  });

  it('TAKEN leva reason null; NOT_TAKEN leva o motivo ou null', () => {
    expect(responseBody('TAKEN', 'FORGOT')).toEqual({ type: 'TAKEN', reason: null });
    expect(responseBody('NOT_TAKEN', 'FORGOT')).toEqual({ type: 'NOT_TAKEN', reason: 'FORGOT' });
    expect(responseBody('NOT_TAKEN', null)).toEqual({ type: 'NOT_TAKEN', reason: null });
  });
});

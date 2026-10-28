// @trace TL-005 RF-005 RF-006 RN-009 DEC-035 createResponse listOccurrences
// Textos da tela de ocorrencias (TL-005; DC-055): quando (hoje ou data em pt-BR, com o horario
// local da ocorrencia, sem conversao de fuso), motivos do NOT_TAKEN em pt-BR na ordem do contrato
// e corpo da resposta (TAKEN sempre com reason null).
import { describe, expect, it } from 'vitest';
import {
  NOT_TAKEN_REASONS,
  dayItems,
  dayStatusText,
  responseBody,
  whenText,
} from '../../apps/web/src/lib/occurrences.js';

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

describe('remedios do dia (DEC-035)', () => {
  const NOW = '2026-10-15T14:00:00Z';
  const at = (local_time: string, scheduled_at: string, status: string) => ({
    local_time,
    scheduled_at,
    status: status as 'PROGRAMMED' | 'NO_RESPONSE' | 'TAKEN' | 'NOT_TAKEN' | 'CANCELED',
  });

  it('ordena pelo horario local, do mais tarde para o mais cedo (o mais recente antes)', () => {
    const items = [
      at('20:00', '2026-10-15T23:00:00Z', 'PROGRAMMED'),
      at('08:00', '2026-10-15T11:00:00Z', 'TAKEN'),
      at('14:00', '2026-10-15T17:00:00Z', 'PROGRAMMED'),
    ];
    expect(dayItems(items).map((o) => o.local_time)).toEqual(['20:00', '14:00', '08:00']);
    // nao altera a lista recebida
    expect(items[0]?.local_time).toBe('20:00');
  });

  it('situacao em pt-BR; programada so vira "A registrar" quando o horario chega', () => {
    expect(dayStatusText(at('08:00', '2026-10-15T11:00:00Z', 'TAKEN'), NOW)).toBe('Tomado');
    expect(dayStatusText(at('08:00', '2026-10-15T11:00:00Z', 'NOT_TAKEN'), NOW)).toBe('Não tomado');
    expect(dayStatusText(at('08:00', '2026-10-15T11:00:00Z', 'NO_RESPONSE'), NOW)).toBe(
      'Sem resposta',
    );
    expect(dayStatusText(at('11:00', '2026-10-15T14:00:00Z', 'PROGRAMMED'), NOW)).toBe(
      'A registrar',
    );
    expect(dayStatusText(at('20:00', '2026-10-15T23:00:00Z', 'PROGRAMMED'), NOW)).toBe('Previsto');
  });
});

// @trace RF-007 RN-010 RN-013 CA-009
// Janela do historico (RN-010): periodo civil inclusivo de ate 12 meses, aplicado como intervalo
// semiaberto [inicio do dia start, inicio do dia seguinte a end) no fuso da conta (DC-041).
import { describe, expect, it } from 'vitest';
import { historyWindow } from '../../packages/domain/src/index.js';

describe('historyWindow', () => {
  it('CA-009: janeiro de 2026 em America/Sao_Paulo vira [01/01 03:00Z, 01/02 03:00Z)', () => {
    expect(
      historyWindow({ start: '2026-01-01', end: '2026-01-31', timeZone: 'America/Sao_Paulo' }),
    ).toEqual({ ok: true, fromInstant: '2026-01-01T03:00:00Z', toInstant: '2026-02-01T03:00:00Z' });
  });

  it('um unico dia e valido (start = end)', () => {
    expect(
      historyWindow({ start: '2026-10-05', end: '2026-10-05', timeZone: 'America/Sao_Paulo' }),
    ).toEqual({ ok: true, fromInstant: '2026-10-05T03:00:00Z', toInstant: '2026-10-06T03:00:00Z' });
  });

  it('DST: meia-noite inexistente avanca para o primeiro instante valido (America/Santiago)', () => {
    // Em 06/09/2026 o relogio de Santiago pula de 00:00 para 01:00 (-04 -> -03).
    const window = historyWindow({
      start: '2026-09-06',
      end: '2026-09-06',
      timeZone: 'America/Santiago',
    });
    expect(window).toEqual({
      ok: true,
      fromInstant: '2026-09-06T04:00:00Z',
      toInstant: '2026-09-07T03:00:00Z',
    });
  });

  it('12 meses inclusivos sao o limite: 01/01/2026 a 31/12/2026 passa; 01/01/2027 nao', () => {
    const tz = 'America/Sao_Paulo';
    expect(historyWindow({ start: '2026-01-01', end: '2026-12-31', timeZone: tz }).ok).toBe(true);
    expect(historyWindow({ start: '2026-01-01', end: '2027-01-01', timeZone: tz })).toEqual({
      ok: false,
      field: 'end',
      code: 'PERIOD_TOO_LONG',
    });
  });

  it('dia que nao existe no mes de chegada usa o ultimo dia do mes (29/02 + 12 meses)', () => {
    const tz = 'UTC';
    expect(historyWindow({ start: '2027-02-28', end: '2028-02-27', timeZone: tz }).ok).toBe(true);
    expect(historyWindow({ start: '2028-02-29', end: '2029-02-27', timeZone: tz }).ok).toBe(true);
    expect(historyWindow({ start: '2028-02-29', end: '2029-02-28', timeZone: tz }).ok).toBe(false);
  });

  it('end antes de start: invalido no campo end', () => {
    expect(
      historyWindow({ start: '2026-02-01', end: '2026-01-31', timeZone: 'America/Sao_Paulo' }),
    ).toEqual({ ok: false, field: 'end', code: 'BEFORE_START' });
  });
});

// @trace TL-007 RF-008 RN-011 FL-005 getExport
// Textos e estados da exportacao na web (TL-007; DC-057): o instante de expiracao no fuso da conta,
// em pt-BR, e quais estados ainda estao em andamento (a tela consulta de novo so nesses).
import { describe, expect, it } from 'vitest';
import { formatInstant, isPending } from '../../apps/web/src/lib/exports.js';

describe('exportacao', () => {
  it('instante no fuso da conta, nao no do processo', () => {
    expect(formatInstant('2026-10-16T01:30:00Z', 'America/Sao_Paulo')).toBe('15/10/2026 às 22:30');
    expect(formatInstant('2026-10-16T01:30:00Z', 'Asia/Tokyo')).toBe('16/10/2026 às 10:30');
  });

  it('em andamento so REQUESTED e PROCESSING (FL-005)', () => {
    expect(['REQUESTED', 'PROCESSING'].every(isPending)).toBe(true);
    expect(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELED'].some(isPending)).toBe(false);
  });
});

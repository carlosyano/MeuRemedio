// @trace TL-008 RF-010 RF-011 RN-012 getPrivacy requestAccountDeletion
// Textos da area de privacidade na web (TL-008; DC-058): direitos automatizados com o destino na
// aplicacao, prazos de retencao do contrato em pt-BR e a confirmacao textual exigida pela API.
import { describe, expect, it } from 'vitest';
import {
  DELETION_CONFIRMATION,
  retentionLines,
  rightLinks,
} from '../../apps/web/src/lib/privacy.js';

describe('privacidade', () => {
  it('direitos automatizados viram links para as telas, na ordem recebida', () => {
    expect(rightLinks(['EXPORT_PDF', 'ACCESS_HISTORY', 'DELETE_ACCOUNT'])).toEqual([
      ['/exportacao', 'Exportar o histórico em PDF'],
      ['/historico', 'Consultar o histórico'],
    ]);
  });

  it('prazos de retencao em pt-BR', () => {
    expect(
      retentionLines({
        pdf_hours: 24,
        idempotency_days: 7,
        technical_logs_days: 30,
        account_purge_days: 30,
        tombstone_days: 180,
      }),
    ).toEqual([
      'PDF exportado: 24 horas',
      'Registro de solicitações repetidas: 7 dias',
      'Registros técnicos: 30 dias',
      'Dados da conta após o pedido de exclusão: até 30 dias',
      'Registro mínimo de conta excluída: 180 dias',
    ]);
  });

  it('confirmacao textual igual a constante do contrato', () => {
    expect(DELETION_CONFIRMATION).toBe('EXCLUIR MINHA CONTA');
  });
});

// getPrivacy (RF-010, RF-011; DEC-022, DC-045): direitos atendidos pela propria aplicacao, canal
// externo dos demais direitos (GX-002, configurado na implantacao) e prazos de retencao vigentes
// (Q-001 aprovada; fixos no contrato).
export interface PrivacySummary {
  readonly automated_rights: readonly ('ACCESS_HISTORY' | 'EXPORT_PDF' | 'DELETE_ACCOUNT')[];
  readonly external_channel: string;
  readonly retention: {
    readonly pdf_hours: 24;
    readonly idempotency_days: 7;
    readonly technical_logs_days: 30;
    readonly account_purge_days: 30;
    readonly tombstone_days: 180;
  };
}

export function privacySummary(externalChannel: string): PrivacySummary {
  return {
    automated_rights: ['ACCESS_HISTORY', 'EXPORT_PDF', 'DELETE_ACCOUNT'],
    external_channel: externalChannel,
    retention: {
      pdf_hours: 24,
      idempotency_days: 7,
      technical_logs_days: 30,
      account_purge_days: 30,
      tombstone_days: 180,
    },
  };
}

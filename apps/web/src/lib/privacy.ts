// Area de privacidade na web (TL-008; DC-058): tipos do contrato, direitos com destino na aplicacao
// e prazos de retencao em pt-BR. Sem importar outros modulos locais: roda nos testes e no Next.

export interface Retention {
  readonly pdf_hours: number;
  readonly idempotency_days: number;
  readonly technical_logs_days: number;
  readonly account_purge_days: number;
  readonly tombstone_days: number;
}

/** Resumo como a API devolve (schema PrivacySummary). */
export interface PrivacySummary {
  readonly automated_rights: readonly string[];
  readonly external_channel: string;
  readonly retention: Retention;
}

/** Pedido agendado (schema DeletionRequest). */
export interface DeletionRequest {
  readonly deletion_request_id: string;
  readonly status: 'DELETION_SCHEDULED';
  readonly requested_at: string;
  readonly purge_due_at: string;
}

/** Constante exigida por DeleteAccountRequest.confirmation. */
export const DELETION_CONFIRMATION = 'EXCLUIR MINHA CONTA';

/** Direitos com tela propria; DELETE_ACCOUNT fica na propria area de privacidade. */
const RIGHT_LINKS: Readonly<Record<string, readonly [href: string, label: string]>> = {
  ACCESS_HISTORY: ['/historico', 'Consultar o histórico'],
  EXPORT_PDF: ['/exportacao', 'Exportar o histórico em PDF'],
};

export function rightLinks(rights: readonly string[]): (readonly [string, string])[] {
  return rights.flatMap((right) => {
    const link = RIGHT_LINKS[right];
    return link === undefined ? [] : [link];
  });
}

const plural = (value: number, one: string, many: string): string =>
  `${String(value)} ${value === 1 ? one : many}`;

export function retentionLines(retention: Retention): string[] {
  return [
    `PDF exportado: ${plural(retention.pdf_hours, 'hora', 'horas')}`,
    `Registro de solicitações repetidas: ${plural(retention.idempotency_days, 'dia', 'dias')}`,
    `Registros técnicos: ${plural(retention.technical_logs_days, 'dia', 'dias')}`,
    `Dados da conta após o pedido de exclusão: até ${plural(retention.account_purge_days, 'dia', 'dias')}`,
    `Registro mínimo de conta excluída: ${plural(retention.tombstone_days, 'dia', 'dias')}`,
  ];
}

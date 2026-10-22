// Exportacao na web (TL-007; DC-057): tipos do contrato, estados em andamento e instante no fuso
// da conta. Sem importar outros modulos locais: este modulo roda nos testes e no Next.

export type ExportStatus =
  'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELED';

/** Pedido como a API devolve (schema ExportRequest). */
export interface ExportRequest {
  readonly export_id: string;
  readonly status: ExportStatus;
  readonly start_date: string;
  readonly end_date: string;
  readonly requested_at: string;
  readonly completed_at: string | null;
  readonly expires_at: string | null;
  readonly failure_reason: 'TECHNICAL_FAILURE' | 'ACCOUNT_NOT_ACTIVE' | null;
}

/** Estados em andamento do FL-005: a tela consulta de novo e permite cancelar (CA-016). */
export const isPending = (status: string): boolean =>
  status === 'REQUESTED' || status === 'PROCESSING';

/** "15/10/2026 às 22:30" no fuso da conta. */
export function formatInstant(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} às ${part('hour')}:${part('minute')}`;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  REQUESTED: 'Em andamento',
  PROCESSING: 'Em andamento',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  EXPIRED: 'Expirada',
  CANCELED: 'Cancelada',
};

/** Rotulo do estado na lista de exportacoes recentes (listExports, DEC-034). */
export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

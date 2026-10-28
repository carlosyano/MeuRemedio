// Ocorrencias na web (TL-005; DC-055): tipos do contrato, textos em pt-BR e corpo da resposta.
// O horario mostrado e o local_time da propria ocorrencia, no fuso da conta, sem conversao.

export type OccurrenceStatus = 'PROGRAMMED' | 'NO_RESPONSE' | 'TAKEN' | 'NOT_TAKEN' | 'CANCELED';
export type ResponseType = 'TAKEN' | 'NOT_TAKEN';
export type NotTakenReason =
  'FORGOT' | 'UNAVAILABLE' | 'SIDE_EFFECT_CONCERN' | 'CHOSE_NOT_TO_TAKE' | 'OTHER';

/** Ocorrencia como a API devolve (schema Occurrence). */
export interface Occurrence {
  readonly occurrence_id: string;
  readonly plan_id: string;
  readonly local_scheduled_date: string;
  readonly local_time: string;
  readonly scheduled_at: string;
  readonly deadline_at: string;
  readonly status: OccurrenceStatus;
  readonly medication_name_snapshot: string;
  readonly dose_text_snapshot: string;
  /** Motivo do tratamento quando a ocorrencia foi gerada (DEC-038). */
  readonly treatment_reason_snapshot?: string | null;
  readonly is_late: boolean;
  readonly no_response_reached_at: string | null;
  readonly row_version: number;
}

/** Enum NotTakenReason da OpenAPI, na mesma ordem. */
export const NOT_TAKEN_REASONS: readonly (readonly [NotTakenReason, string])[] = [
  ['FORGOT', 'Esqueci'],
  ['UNAVAILABLE', 'Não tinha o medicamento'],
  ['SIDE_EFFECT_CONCERN', 'Preocupação com efeito colateral'],
  ['CHOSE_NOT_TO_TAKE', 'Decidi não tomar'],
  ['OTHER', 'Outro motivo'],
];

/** YYYY-MM-DD para DD/MM/AAAA (sem importar: este modulo roda nos testes e no Next). */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

/** "Hoje, 08:00" ou "14/10/2026, 22:30". */
export function whenText(
  occurrence: Pick<Occurrence, 'local_scheduled_date' | 'local_time'>,
  today: string,
): string {
  const day =
    occurrence.local_scheduled_date === today
      ? 'Hoje'
      : formatDate(occurrence.local_scheduled_date);
  return `${day}, ${occurrence.local_time}`;
}

/** Corpo de createResponse: TAKEN sempre com reason null (CreateResponseRequest). */
export function responseBody(
  type: ResponseType,
  reason: NotTakenReason | null,
): { readonly type: ResponseType; readonly reason: NotTakenReason | null } {
  return { type, reason: type === 'TAKEN' ? null : reason };
}

/**
 * Remedios do dia (DEC-035): do horario local mais tarde para o mais cedo, o mais recente antes
 * (pedido do mantenedor em 28/10/2026, DC-077), sem alterar a lista recebida.
 */
export function dayItems<T extends Pick<Occurrence, 'local_time'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.local_time.localeCompare(a.local_time));
}

/** Situacao de um horario do dia; PROGRAMMED so pede registro quando o horario ja chegou. */
export function dayStatusText(
  occurrence: Pick<Occurrence, 'status' | 'scheduled_at'>,
  now: string,
): string {
  switch (occurrence.status) {
    case 'TAKEN':
      return 'Tomado';
    case 'NOT_TAKEN':
      return 'Não tomado';
    case 'NO_RESPONSE':
      return 'Sem resposta';
    case 'CANCELED':
      return 'Cancelado';
    case 'PROGRAMMED':
      return Date.parse(occurrence.scheduled_at) <= Date.parse(now) ? 'A registrar' : 'Previsto';
  }
}

// Snapshot do historico e PDF da exportacao (RF-008, RN-011, TS-020; DC-042).
//   - o snapshot congela, no inicio do processamento, as ocorrencias do periodo ja alcancadas, sem
//     as CANCELED, com a resposta de cada uma (mesmo recorte de getHistory, DC-041);
//   - o PDF sai so do snapshot: edicao posterior do plano nao o altera (TS-020);
//   - texto em fonte padrao (Helvetica, WinAnsi): o PDF e pesquisavel (RN-011);
//   - sem nome nem e-mail do titular; com medicamento, dose, motivo do tratamento (DEC-038), horario e
//     resposta declarada.
import { historyWindow } from '@meuremedio/domain';
import type { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';

export const SNAPSHOT_VERSION = 1;

export interface SnapshotItem {
  readonly local_date: string;
  readonly local_time: string;
  readonly medication_name: string;
  readonly dose_text: string;
  /** Snapshot do motivo do tratamento; ausente nos snapshots anteriores a DEC-038. */
  readonly treatment_reason?: string | null;
  readonly status: 'PROGRAMMED' | 'NO_RESPONSE' | 'TAKEN' | 'NOT_TAKEN';
  readonly response: {
    readonly type: 'TAKEN' | 'NOT_TAKEN';
    readonly reason: string | null;
    readonly captured_at: string;
    readonly is_late: boolean;
  } | null;
}

export interface HistorySnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly time_zone: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly frozen_at: string;
  readonly items: readonly SnapshotItem[];
}

/** Congela o historico do periodo no instante `now`. */
export async function freezeHistory(
  client: PoolClient,
  input: { userId: string; timeZone: string; startDate: string; endDate: string; now: string },
): Promise<HistorySnapshot> {
  const window = historyWindow({
    start: input.startDate,
    end: input.endDate,
    timeZone: input.timeZone,
  });
  if (!window.ok) throw new Error('Periodo da exportacao invalido');
  const rows = (
    await client.query<{
      local_date: string;
      local_time: string;
      medication_name: string;
      dose_text: string;
      treatment_reason: string | null;
      status: SnapshotItem['status'];
      response_type: 'TAKEN' | 'NOT_TAKEN' | null;
      response_reason: string | null;
      response_captured_at: Date | null;
      response_is_late: boolean | null;
    }>(
      `SELECT to_char(o.local_scheduled_date, 'YYYY-MM-DD') AS local_date,
              to_char(o.local_time, 'HH24:MI') AS local_time,
              o.medication_name_snapshot AS medication_name, o.dose_text_snapshot AS dose_text,
              o.treatment_reason_snapshot AS treatment_reason,
              o.status, r.type AS response_type, r.reason AS response_reason,
              r.captured_at AS response_captured_at, r.is_late AS response_is_late
         FROM occurrences o
         LEFT JOIN responses r ON r.occurrence_id = o.id
        WHERE o.user_id = $1 AND o.status <> 'CANCELED'
          AND o.scheduled_at >= $2 AND o.scheduled_at < $3 AND o.scheduled_at <= $4
        ORDER BY o.scheduled_at DESC, o.id DESC`,
      [input.userId, window.fromInstant, window.toInstant, input.now],
    )
  ).rows;
  return {
    version: SNAPSHOT_VERSION,
    time_zone: input.timeZone,
    start_date: input.startDate,
    end_date: input.endDate,
    frozen_at: input.now,
    items: rows.map((row) => ({
      local_date: row.local_date,
      local_time: row.local_time,
      medication_name: row.medication_name,
      dose_text: row.dose_text,
      treatment_reason: row.treatment_reason,
      status: row.status,
      response:
        row.response_type === null ||
        row.response_captured_at === null ||
        row.response_is_late === null
          ? null
          : {
              type: row.response_type,
              reason: row.response_reason,
              captured_at: row.response_captured_at.toISOString(),
              is_late: row.response_is_late,
            },
    })),
  };
}

/** Snapshot lido do banco; undefined quando nao e da versao conhecida (falha tecnica). */
export function parseSnapshot(value: unknown): HistorySnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const snapshot = value as Partial<HistorySnapshot>;
  return snapshot.version === SNAPSHOT_VERSION &&
    typeof snapshot.time_zone === 'string' &&
    typeof snapshot.start_date === 'string' &&
    typeof snapshot.end_date === 'string' &&
    typeof snapshot.frozen_at === 'string' &&
    Array.isArray(snapshot.items)
    ? (snapshot as HistorySnapshot)
    : undefined;
}

const REASONS: Readonly<Record<string, string>> = {
  FORGOT: 'esqueci',
  UNAVAILABLE: 'medicamento indisponível',
  SIDE_EFFECT_CONCERN: 'preocupação com efeito colateral',
  CHOSE_NOT_TO_TAKE: 'optei por não tomar',
  OTHER: 'outro motivo',
};

const civilDate = (date: string): string => {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
};

function localDateTime(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return `${parts['day'] ?? ''}/${parts['month'] ?? ''}/${parts['year'] ?? ''} ${parts['hour'] ?? ''}:${parts['minute'] ?? ''}`;
}

function outcome(item: SnapshotItem, timeZone: string): string {
  const response = item.response;
  if (response === null) {
    return item.status === 'PROGRAMMED' ? 'Aguardando resposta' : 'Sem resposta';
  }
  const label =
    response.type === 'TAKEN'
      ? 'Tomado'
      : `Não tomado${response.reason === null ? '' : `: ${REASONS[response.reason] ?? 'outro motivo'}`}`;
  const late = response.is_late ? ', resposta tardia' : '';
  return `${label} (registrado em ${localDateTime(response.captured_at, timeZone)}${late})`;
}

/** PDF pesquisavel do snapshot. */
export function renderHistoryPdf(snapshot: HistorySnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: {
        Title: 'MeuRemedio - Histórico declaratório de medicamentos',
        Producer: 'MeuRemedio',
        Creator: 'MeuRemedio',
        CreationDate: new Date(snapshot.frozen_at),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text('MeuRemedio');
    doc.fontSize(13).text('Histórico declaratório de medicamentos');
    doc.moveDown(0.5);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `Período: ${civilDate(snapshot.start_date)} a ${civilDate(snapshot.end_date)} (fuso ${snapshot.time_zone})`,
      );
    doc.text(`Gerado em: ${localDateTime(snapshot.frozen_at, snapshot.time_zone)} (horário local)`);
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .text(
        'Registro declarado pelo próprio titular. Este documento não é prescrição e não substitui a orientação de um profissional de saúde.',
      );
    doc.moveDown();

    if (snapshot.items.length === 0) {
      doc.fontSize(10).text('Nenhum registro no período.');
    }
    for (const item of snapshot.items) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`${civilDate(item.local_date)} ${item.local_time}`, { continued: true })
        .font('Helvetica')
        .text(`  ${item.medication_name}, ${item.dose_text}`);
      if (item.treatment_reason != null) {
        doc.text(`Motivo do tratamento: ${item.treatment_reason}`);
      }
      doc.text(outcome(item, snapshot.time_zone));
      doc.moveDown(0.4);
    }
    doc.end();
  });
}

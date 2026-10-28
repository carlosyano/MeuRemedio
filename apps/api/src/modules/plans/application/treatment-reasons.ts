// Motivo do tratamento (DEC-038; ENT-018 treatment_reasons, migracao 0016).
//   - texto opcional do plano, aparado, de 1 a 80 caracteres (o contrato limita o tamanho; so
//     espacos -> 400 VALIDATION_FAILED);
//   - identificado pelo nome normalizado como na duplicidade (RN-016): o mesmo nome em outro plano
//     reaproveita o motivo existente, que mantem o nome da primeira gravacao;
//   - motivo sem plano nao excluido e apagado na mesma transacao (dado de saude sensivel: nao fica
//     guardado sem uso);
//   - listTreatmentReasons: motivos em uso, em ordem alfabetica (nome normalizado), com a
//     quantidade de planos. O cursor guarda so o id do ultimo motivo entregue, para o nome (dado de
//     saude) nao ir para a URL nem para os logs de acesso.
import { normalizePlanText } from '@meuremedio/domain';
import type { Pool, PoolClient } from 'pg';
import type { PageMeta } from '../../../platform/http/keyset-cursor.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';

export interface NormalizedTreatmentReason {
  readonly name: string;
  readonly nameNorm: string;
}

/** Motivo do corpo (string | null | omitido) aparado e normalizado; null = sem motivo. */
export function normalizeTreatmentReason(
  value: string | null | undefined,
): NormalizedTreatmentReason | null {
  if (value === undefined || value === null) return null;
  const name = value.trim();
  const nameNorm = normalizePlanText(name);
  if (nameNorm.length === 0) {
    throw new ProblemError('VALIDATION_FAILED', [
      {
        field: 'treatment_reason',
        code: 'REQUIRED',
        message: 'Informe o motivo ou deixe o campo em branco.',
      },
    ]);
  }
  return { name, nameNorm };
}

/** id do motivo do titular com esse nome normalizado, criado se ainda nao existir. */
export async function treatmentReasonId(
  client: PoolClient,
  userId: string,
  reason: NormalizedTreatmentReason | null,
): Promise<string | null> {
  if (reason === null) return null;
  // DO UPDATE sem mudanca efetiva: devolve o id tambem quando o motivo ja existe.
  const row = (
    await client.query<{ id: string }>(
      `INSERT INTO treatment_reasons (user_id, name, name_norm)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name_norm) DO UPDATE SET name_norm = EXCLUDED.name_norm
       RETURNING id`,
      [userId, reason.name, reason.nameNorm],
    )
  ).rows[0];
  if (row === undefined) throw new Error('Motivo do tratamento nao gravado');
  return row.id;
}

/** Apaga os motivos do titular que nenhum plano nao excluido usa mais. */
export async function removeUnusedTreatmentReasons(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM treatment_reasons r
      WHERE r.user_id = $1
        AND NOT EXISTS (SELECT 1 FROM medication_plans p
                         WHERE p.treatment_reason_id = r.id AND p.status <> 'DELETED')`,
    [userId],
  );
}

export interface TreatmentReasonItem {
  readonly treatment_reason_id: string;
  readonly name: string;
  readonly plan_count: number;
}

export interface TreatmentReasonPage {
  readonly items: TreatmentReasonItem[];
  readonly page: PageMeta;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const encodeReasonCursor = (id: string): string =>
  Buffer.from(JSON.stringify({ i: id })).toString('base64url');

function decodeReasonCursor(value: string): string {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'i' in parsed &&
      typeof parsed.i === 'string' &&
      UUID.test(parsed.i)
    ) {
      return parsed.i;
    }
  } catch {
    // cai no erro abaixo
  }
  throw new ProblemError('VALIDATION_FAILED', [
    { field: 'cursor', code: 'INVALID', message: 'Valor inválido.' },
  ]);
}

export class ReadTreatmentReasons {
  constructor(private readonly pool: Pool) {}

  async list(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TreatmentReasonPage> {
    const after = cursor === undefined ? null : decodeReasonCursor(cursor);
    // A posicao do cursor vem do proprio motivo do titular; se ele sumiu, a pagina vem vazia.
    const rows = (
      await this.pool.query<{ id: string; name: string; plan_count: string }>(
        `SELECT r.id, r.name, count(p.id)::text AS plan_count
           FROM treatment_reasons r
           JOIN medication_plans p ON p.treatment_reason_id = r.id AND p.status <> 'DELETED'
          WHERE r.user_id = $1
            AND ($2::uuid IS NULL OR (r.name_norm, r.id) > (
                  SELECT c.name_norm, c.id FROM treatment_reasons c
                   WHERE c.id = $2::uuid AND c.user_id = $1))
          GROUP BY r.id
          ORDER BY r.name_norm, r.id
          LIMIT $3`,
        [userId, after, limit + 1],
      )
    ).rows;
    const delivered = rows.slice(0, limit);
    const last = delivered[delivered.length - 1];
    return {
      items: delivered.map((row) => ({
        treatment_reason_id: row.id,
        name: row.name,
        plan_count: Number(row.plan_count),
      })),
      page: {
        next_cursor: rows.length > limit && last !== undefined ? encodeReasonCursor(last.id) : null,
        limit,
      },
    };
  }
}

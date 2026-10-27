// deletePlan (RF-003, FL-002; TS-005, TS-037): exclusao logica idempotente.
//   - plano ACTIVE, CANCELED ou INTERRUPTED do titular (DEC-036) -> DELETED com deleted_at;
//     ocorrencias PROGRAMMED futuras (scheduled_at > instante da acao) sao canceladas; iniciadas,
//     respondidas e snapshots ficam;
//   - plano ja DELETED do titular -> 204 sem alteracao (DC-034);
//   - inexistente ou de outro titular -> 404 identico; o de outro titular e auditado (DC-032).
//   Sem Idempotency-Key no contrato: repetir a chamada e seguro por si.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import { cancelFutureOccurrences, lockOwnPlan } from './plan-write.js';

export class DeletePlan {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: string; planId: string; correlationId: string }): Promise<void> {
    const now = this.clock.now();
    const found = await withTransaction(this.pool, async (client) => {
      const plan = await lockOwnPlan(client, { ...input, now });
      if (plan === undefined) return false;
      if (plan.status !== 'DELETED') {
        await client.query(
          `UPDATE medication_plans
              SET status = 'DELETED', deleted_at = $2, row_version = row_version + 1,
                  updated_at = $2
            WHERE id = $1`,
          [input.planId, now],
        );
        await cancelFutureOccurrences(client, input.planId, now);
      }
      return true;
    });
    // Fora da transacao: a auditoria do acesso negado ja foi confirmada.
    if (!found) throw new ProblemError('RESOURCE_NOT_FOUND');
  }
}

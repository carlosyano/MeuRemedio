// resendVerification (RF-001, TS-021; DC-020): resposta neutra (202), exista ou nao a conta.
// Conta PENDING_VERIFICATION: invalida os tokens abertos e grava novo evento
// identity.verification_requested no Outbox, na mesma transacao. Demais casos: nenhum efeito.
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';

export const RESEND_MESSAGE =
  'Se houver uma conta aguardando verificação para este e-mail, enviaremos um novo link.';

export class ResendVerification {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
  ) {}

  async execute(email: string): Promise<{ message: string }> {
    const now = this.clock.now();
    await withTransaction(this.pool, async (client) => {
      const user = (
        await client.query<{ id: string; status: string }>(
          'SELECT id, status FROM users WHERE email_normalized = $1 FOR UPDATE',
          [email.trim().toLowerCase()],
        )
      ).rows[0];
      if (user?.status !== 'PENDING_VERIFICATION') return;
      await client.query(
        `UPDATE verification_tokens SET superseded_at = $2
          WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
        [user.id, now],
      );
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, available_at,
                                    created_at)
         VALUES ('user', $1, 'identity.verification_requested', $2, $3, $3)`,
        [user.id, JSON.stringify({ user_id: user.id }), now],
      );
    });
    return { message: RESEND_MESSAGE };
  }
}

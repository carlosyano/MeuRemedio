// requestPasswordReset (RF-002, RN-017; DC-044): resposta neutra (202), exista ou nao a conta.
// Conta ACTIVE: invalida os tokens de redefinicao abertos e grava identity.password_reset_requested
// no Outbox, na mesma transacao. Demais casos (sem conta, PENDING_VERIFICATION, DELETION_SCHEDULED):
// nenhum efeito.
// Consumidor do evento (worker), no molde da verificacao (DC-020, DC-021):
//   - conta ainda ACTIVE: invalida os tokens abertos, emite um token novo de alta entropia (so o
//     SHA-256 e persistido; validade de 60 min) e, apos o COMMIT, envia o e-mail;
//   - conta em outro estado (ou removida): nada a fazer;
//   - falha no envio propaga o erro: o pg-boss refaz o job, e a nova execucao substitui o token.
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { hashToken, type VerificationDeps } from './issue-verification.js';

export const RESET_MESSAGE =
  'Se houver uma conta ativa para este e-mail, enviaremos um link para redefinir a senha.';

export const PASSWORD_RESET_REQUESTED = 'identity.password_reset_requested';

const TOKEN_TTL_MS = 60 * 60_000;

export class RequestPasswordReset {
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
      if (user?.status !== 'ACTIVE') return;
      await client.query(
        `UPDATE password_reset_tokens SET superseded_at = $2
          WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
        [user.id, now],
      );
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, available_at,
                                    created_at)
         VALUES ('user', $1, $2, $3, $4, $4)`,
        [user.id, PASSWORD_RESET_REQUESTED, JSON.stringify({ user_id: user.id }), now],
      );
    });
    return { message: RESET_MESSAGE };
  }
}

export interface PasswordResetRequested {
  readonly event_id: string;
  readonly user_id: string;
}

export async function handlePasswordResetRequested(
  deps: VerificationDeps,
  data: PasswordResetRequested,
): Promise<void> {
  const now = deps.clock.now();
  const issued = await withTransaction(deps.pool, async (client) => {
    const user = (
      await client.query<{ email_normalized: string; status: string }>(
        'SELECT email_normalized, status FROM users WHERE id = $1 FOR UPDATE',
        [data.user_id],
      )
    ).rows[0];
    if (user?.status !== 'ACTIVE') return undefined;
    await client.query(
      `UPDATE password_reset_tokens SET superseded_at = $2
        WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
      [data.user_id, now],
    );
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, issued_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $3)`,
      [data.user_id, hashToken(token), now, new Date(Date.parse(now) + TOKEN_TTL_MS).toISOString()],
    );
    return { to: user.email_normalized, token };
  });
  if (issued === undefined) return;

  const link = `${deps.webBaseUrl.replace(/\/+$/, '')}/conta/redefinir-senha#token=${issued.token}`;
  await deps.email.send({
    to: issued.to,
    subject: 'Redefinição de senha do MeuRemedio',
    text: [
      'Olá!',
      '',
      'Para criar uma nova senha no MeuRemedio, abra o link abaixo em até 60 minutos:',
      '',
      link,
      '',
      'Ao trocar a senha, todas as sessões abertas da conta serão encerradas.',
      'Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
    ].join('\n'),
  });
}

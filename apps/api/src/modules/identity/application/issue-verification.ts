// Consumidor de identity.verification_requested (DC-008, DC-020, DC-021; RN-017):
//   - conta ainda PENDING_VERIFICATION: invalida os tokens abertos, emite um token novo de alta
//     entropia (so o SHA-256 e persistido; validade de 24 h) e, apos o COMMIT, envia o e-mail;
//   - conta em outro estado (ou removida): nada a fazer;
//   - falha no envio propaga o erro: o pg-boss refaz o job, e a nova execucao substitui o token.
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import type { EmailSender } from '../../../platform/email/email-sender.js';

export interface VerificationDeps {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly email: EmailSender;
  /** URL da aplicacao web; o link leva o token no fragmento (DC-021). */
  readonly webBaseUrl: string;
}

export interface VerificationRequested {
  readonly event_id: string;
  readonly user_id: string;
}

const TOKEN_TTL_MS = 24 * 3_600_000;

export const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

export async function handleVerificationRequested(
  deps: VerificationDeps,
  data: VerificationRequested,
): Promise<void> {
  const now = deps.clock.now();
  const issued = await withTransaction(deps.pool, async (client) => {
    const user = (
      await client.query<{ email_normalized: string; status: string }>(
        'SELECT email_normalized, status FROM users WHERE id = $1 FOR UPDATE',
        [data.user_id],
      )
    ).rows[0];
    if (user?.status !== 'PENDING_VERIFICATION') return undefined;
    await client.query(
      `UPDATE verification_tokens SET superseded_at = $2
        WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
      [data.user_id, now],
    );
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO verification_tokens (user_id, token_hash, issued_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $3)`,
      [data.user_id, hashToken(token), now, new Date(Date.parse(now) + TOKEN_TTL_MS).toISOString()],
    );
    return { to: user.email_normalized, token };
  });
  if (issued === undefined) return;

  const link = `${deps.webBaseUrl.replace(/\/+$/, '')}/conta/verificar#token=${issued.token}`;
  await deps.email.send({
    to: issued.to,
    subject: 'Confirme seu e-mail no MeuRemedio',
    text: [
      'Olá!',
      '',
      'Para ativar sua conta no MeuRemedio, abra o link abaixo em até 24 horas:',
      '',
      link,
      '',
      'Se você não criou esta conta, ignore este e-mail.',
    ].join('\n'),
  });
}

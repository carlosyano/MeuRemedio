// getCurrentAccount (RF-001, CA-015): perfil do titular autenticado.
import type { Pool } from 'pg';
import { ProblemError } from '../../../platform/http/problem-catalog.js';

export interface AccountProfile {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly status: string;
  readonly account_timezone: string;
  readonly created_at: string;
}

export class CurrentAccount {
  constructor(private readonly pool: Pool) {}

  async profile(userId: string): Promise<AccountProfile> {
    const row = (
      await this.pool.query<{
        id: string;
        name: string;
        email_normalized: string;
        status: string;
        account_timezone: string;
        created_at: Date;
      }>(
        `SELECT id, name, email_normalized, status, account_timezone, created_at
           FROM users WHERE id = $1`,
        [userId],
      )
    ).rows[0];
    if (row === undefined) throw new ProblemError('AUTHENTICATION_REQUIRED');
    return {
      user_id: row.id,
      name: row.name,
      email: row.email_normalized,
      status: row.status,
      account_timezone: row.account_timezone,
      created_at: row.created_at.toISOString(),
    };
  }
}

// updateCurrentAccount (RF-001, CA-015) e preferencias de acessibilidade (RF-009, TS-022).
//   - so o nome muda (sem espacos nas pontas; vazio -> 400); o fuso e imutavel no MVP (RN-013) e o
//     contrato ja recusa campos extras;
//   - as preferencias sao substituidas por inteiro (text_scale e high_contrast).
import type { Pool } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import type { AccountProfile, CurrentAccount } from './current-account.js';

export interface AccessibilityPreferences {
  readonly text_scale: 100 | 125 | 150 | 175 | 200;
  readonly high_contrast: boolean;
}

export class AccountSettings {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly currentAccount: CurrentAccount,
  ) {}

  async rename(userId: string, name: string): Promise<AccountProfile> {
    const trimmed = name.trim();
    if (trimmed === '') {
      throw new ProblemError('VALIDATION_FAILED', [
        { field: 'name', code: 'REQUIRED', message: 'Informe o nome.' },
      ]);
    }
    await this.pool.query(
      `UPDATE users SET name = $2, updated_at = $3, row_version = row_version + 1 WHERE id = $1`,
      [userId, trimmed, this.clock.now()],
    );
    return this.currentAccount.profile(userId);
  }

  async preferences(userId: string): Promise<AccessibilityPreferences> {
    const row = (
      await this.pool.query<AccessibilityPreferences>(
        'SELECT text_scale, high_contrast FROM users WHERE id = $1',
        [userId],
      )
    ).rows[0];
    if (row === undefined) throw new ProblemError('AUTHENTICATION_REQUIRED');
    return { text_scale: row.text_scale, high_contrast: row.high_contrast };
  }

  async replacePreferences(
    userId: string,
    preferences: AccessibilityPreferences,
  ): Promise<AccessibilityPreferences> {
    await this.pool.query(
      `UPDATE users SET text_scale = $2, high_contrast = $3, updated_at = $4,
                        row_version = row_version + 1
        WHERE id = $1`,
      [userId, preferences.text_scale, preferences.high_contrast, this.clock.now()],
    );
    return this.preferences(userId);
  }
}

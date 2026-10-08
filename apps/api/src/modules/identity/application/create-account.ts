// createAccount (RF-001, CA-001; Especificacao 02.33 RN-017, DEC-009, DEC-023, DEC-029, DEC-030).
// O contrato ja validou formato e campos obrigatorios; aqui ficam as regras de negocio:
//   - nome aparado com 1..120 caracteres; e-mail normalizado (minusculo, sem espacos nas pontas);
//   - fuso reconhecido pelo Node/ICU (DC-015); senha fora da lista local (PASSWORD_COMPROMISED);
//   - e-mail ja cadastrado, em qualquer estado: 409 STATE_CONFLICT sem efeito (DEC-030);
//   - conta PENDING_VERIFICATION e evento identity.verification_requested no Outbox, na mesma
//     transacao e sob a Idempotency-Key com escopo public (DC-008).
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError, type FieldError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import type { CompromisedPasswords } from '../infrastructure/compromised-passwords.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';

export interface CreateAccountRequest {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly account_timezone: string;
  readonly terms_version: string;
  readonly privacy_notice_version: string;
  readonly terms_accepted: true;
  readonly privacy_notice_acknowledged: true;
}

const MAX_NAME = 120;
const SUPPORTED_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505' &&
  'constraint' in error &&
  error.constraint === constraint;

export class CreateAccount {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
    private readonly passwords: PasswordHasher,
    private readonly compromised: CompromisedPasswords,
  ) {}

  async execute(
    idempotencyKey: string,
    request: CreateAccountRequest,
  ): Promise<IdempotentResponse> {
    const name = request.name.trim();
    const errors: FieldError[] = [];
    if (name.length === 0 || name.length > MAX_NAME) {
      errors.push({ field: 'name', code: 'INVALID', message: 'Valor inválido.' });
    }
    if (!SUPPORTED_ZONES.has(request.account_timezone)) {
      errors.push({ field: 'account_timezone', code: 'INVALID', message: 'Valor inválido.' });
    }
    if (this.compromised.has(request.password)) {
      errors.push({
        field: 'password',
        code: 'PASSWORD_COMPROMISED',
        message: 'Esta senha aparece em listas de senhas vazadas. Escolha outra.',
      });
    }
    if (errors.length > 0) throw new ProblemError('VALIDATION_FAILED', errors);

    const email = request.email.trim().toLowerCase();
    const now = this.clock.now();
    const passwordHash = await this.passwords.hash(request.password);

    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'createAccount',
          scopeKey: 'public',
          key: idempotencyKey,
          requestHash: this.hashRequest({ body: request }),
          now,
        },
        () => this.insert(client, { name, email, passwordHash, now, request }),
      ),
    );
    return response;
  }

  private async insert(
    client: PoolClient,
    input: {
      name: string;
      email: string;
      passwordHash: string;
      now: string;
      request: CreateAccountRequest;
    },
  ): Promise<IdempotentResponse> {
    const existing = await client.query('SELECT 1 FROM users WHERE email_normalized = $1', [
      input.email,
    ]);
    if (existing.rowCount !== 0) throw new ProblemError('STATE_CONFLICT');

    let userId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (name, email_normalized, password_hash, account_timezone, terms_version,
                            privacy_notice_version, terms_accepted_at, privacy_acknowledged_at,
                            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $7)
         RETURNING id`,
        [
          input.name,
          input.email,
          input.passwordHash,
          input.request.account_timezone,
          input.request.terms_version,
          input.request.privacy_notice_version,
          input.now,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error('INSERT em users nao retornou id');
      userId = id;
    } catch (error) {
      // Cadastro simultaneo do mesmo e-mail com outra chave.
      if (isUniqueViolation(error, 'users_email_normalized_key')) {
        throw new ProblemError('STATE_CONFLICT');
      }
      throw error;
    }

    await client.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, available_at,
                                  created_at)
       VALUES ('user', $1, 'identity.verification_requested', $2, $3, $3)`,
      [userId, JSON.stringify({ user_id: userId }), input.now],
    );

    return {
      status: 201,
      headers: {},
      body: {
        user_id: userId,
        status: 'PENDING_VERIFICATION',
        account_timezone: input.request.account_timezone,
        created_at: input.now,
      },
    };
  }
}

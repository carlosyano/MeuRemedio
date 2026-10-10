// createPlan (RF-003, CA-005, CA-017; Especificacao 02.33 RN-006, RN-016, RN-018, DEC-009).
// O contrato ja validou formato, enums, 1..10 horarios unicos e campos obrigatorios; aqui ficam:
//   - medication_name e dose_text aparados, nao vazios (400) e normalizados para RN-016;
//   - end_date >= start_date (422 BUSINESS_RULE_VIOLATION);
//   - Idempotency-Key com escopo no titular; replay antes de qualquer regra (DEC-009);
//   - duplicidade (RN-016): plano ACTIVE do titular com nome e dose normalizados iguais e periodo
//     com intersecao exige confirmacao. Sem token valido: 409 DUPLICATE_CONFIRMATION_REQUIRED com
//     token novo de uso unico (10 min, vinculado ao titular e ao hash do payload sem o token), sem
//     snapshot de idempotencia. Token valido e consumido na transacao que cria o plano (DC-028);
//   - criacoes do mesmo titular serializam a verificacao de duplicidade (advisory lock);
//   - plano, horarios e evento plans.occurrences_requested no Outbox na mesma transacao (RN-018).
import { createHash, randomBytes } from 'node:crypto';
import { planPeriodsOverlap } from '@meuremedio/domain';
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../../../platform/clock.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { ProblemError } from '../../../platform/http/problem-catalog.js';
import {
  runIdempotent,
  type IdempotentResponse,
  type RequestHasher,
} from '../../../platform/idempotency/idempotency.js';
import { etagOf, findPlan, toPlanView } from './plan-view.js';
import {
  addScheduleTimes,
  requestOccurrences,
  validatePlanWrite,
  type NormalizedPlanText,
  type PlanWriteRequest,
} from './plan-write.js';

export interface CreatePlanRequest extends PlanWriteRequest {
  readonly duplicate_confirmation_token?: string;
}

/** TTL do token de confirmacao de duplicidade (RN-016). */
const CONFIRMATION_TTL_MS = 10 * 60_000;
/** Maximo de candidatos no 409 (DuplicateConfirmation.candidates.maxItems). */
const MAX_CANDIDATES = 20;

const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

interface Candidate {
  plan_id: string;
  medication_name: string;
  dose_text: string;
  start_date: string;
  end_date: string | null;
}

type Outcome =
  | { readonly kind: 'created'; readonly response: IdempotentResponse }
  | { readonly kind: 'duplicate'; readonly token: string; readonly candidates: Candidate[] };

export class CreatePlan {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    private readonly hashRequest: RequestHasher,
  ) {}

  async execute(
    userId: string,
    idempotencyKey: string,
    request: CreatePlanRequest,
  ): Promise<IdempotentResponse> {
    const normalized = validatePlanWrite(request);
    const now = this.clock.now();
    const { duplicate_confirmation_token: token, ...payload } = request;
    const payloadHash = this.hashRequest({ body: payload });

    let outcome: Outcome | undefined;
    const { response } = await withTransaction(this.pool, (client) =>
      runIdempotent(
        client,
        {
          operationId: 'createPlan',
          scopeKey: userId,
          key: idempotencyKey,
          requestHash: this.hashRequest({ body: request }),
          now,
        },
        async () => {
          outcome = await this.create(client, {
            userId,
            request,
            normalized,
            now,
            token,
            payloadHash,
          });
          // O 409 de duplicidade nao e snapshot (so 2xx viram); a transacao confirma o token.
          return outcome.kind === 'created'
            ? outcome.response
            : { status: 409, headers: {}, body: undefined };
        },
      ),
    );
    if (outcome?.kind === 'duplicate') {
      throw new ProblemError(
        'DUPLICATE_CONFIRMATION_REQUIRED',
        [],
        {},
        {
          duplicate_confirmation: {
            confirmation_token: outcome.token,
            candidates: outcome.candidates.map(({ plan_id, medication_name, dose_text }) => ({
              plan_id,
              medication_name,
              dose_text,
            })),
          },
        },
      );
    }
    return response;
  }

  private async create(
    client: PoolClient,
    input: {
      userId: string;
      request: CreatePlanRequest;
      normalized: NormalizedPlanText;
      now: string;
      token: string | undefined;
      payloadHash: Buffer;
    },
  ): Promise<Outcome> {
    const { userId, request, normalized, now } = input;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('createPlan:dup:' || $1, 0))",
      [userId],
    );
    const candidates = (
      await client.query<Candidate>(
        `SELECT id AS plan_id, medication_name, dose_text,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date
           FROM medication_plans
          WHERE user_id = $1 AND status = 'ACTIVE'
            AND medication_name_norm = $2 AND dose_text_norm = $3
          ORDER BY created_at, id`,
        [userId, normalized.medicationNameNorm, normalized.doseTextNorm],
      )
    ).rows.filter((candidate) =>
      planPeriodsOverlap(
        { startDate: candidate.start_date, endDate: candidate.end_date },
        { startDate: request.start_date, endDate: request.end_date ?? null },
      ),
    );

    if (candidates.length > 0) {
      const confirmed =
        input.token !== undefined &&
        (await this.consumeToken(client, userId, input.token, input.payloadHash, now));
      if (!confirmed) {
        return {
          kind: 'duplicate',
          token: await this.issueToken(client, userId, input.payloadHash, now),
          candidates: candidates.slice(0, MAX_CANDIDATES),
        };
      }
    }

    const planId = await this.insertPlan(client, userId, request, normalized, now);
    const plan = await findPlan(client, planId);
    if (plan === undefined) throw new Error('Plano recem-criado nao encontrado');
    return {
      kind: 'created',
      response: {
        status: 201,
        headers: { etag: etagOf(Number(plan.row_version)) },
        body: toPlanView(plan),
      },
    };
  }

  private async insertPlan(
    client: PoolClient,
    userId: string,
    request: CreatePlanRequest,
    normalized: NormalizedPlanText,
    now: string,
  ): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO medication_plans (user_id, medication_name, medication_name_norm, dose_text,
                                     dose_text_norm, medication_form, administration_route,
                                     instructions, prescriber_name, prescriber_crm, start_date,
                                     end_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING id`,
      [
        userId,
        normalized.medicationName,
        normalized.medicationNameNorm,
        normalized.doseText,
        normalized.doseTextNorm,
        request.medication_form,
        request.administration_route,
        request.instructions ?? null,
        request.prescriber_name ?? null,
        request.prescriber_crm ?? null,
        request.start_date,
        request.end_date ?? null,
        now,
      ],
    );
    const planId = inserted.rows[0]?.id;
    if (planId === undefined) throw new Error('INSERT em medication_plans nao retornou id');

    await addScheduleTimes(client, planId, request.schedule_times, now);
    await requestOccurrences(client, planId, now);
    return planId;
  }

  private async issueToken(
    client: PoolClient,
    userId: string,
    payloadHash: Buffer,
    now: string,
  ): Promise<string> {
    const token = `dup_${randomBytes(32).toString('base64url')}`;
    await client.query(
      `INSERT INTO plan_duplicate_confirmations (token_hash, user_id, request_hash, issued_at,
                                                 expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        hashToken(token),
        userId,
        payloadHash,
        now,
        new Date(Date.parse(now) + CONFIRMATION_TTL_MS).toISOString(),
      ],
    );
    return token;
  }

  /** Consome o token se for do titular, do mesmo payload, nao usado e dentro do prazo. */
  private async consumeToken(
    client: PoolClient,
    userId: string,
    token: string,
    payloadHash: Buffer,
    now: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE plan_duplicate_confirmations
          SET consumed_at = $5
        WHERE token_hash = $1 AND user_id = $2 AND request_hash = $3 AND consumed_at IS NULL
          AND expires_at > $4`,
      [hashToken(token), userId, payloadHash, now, now],
    );
    return result.rowCount === 1;
  }
}

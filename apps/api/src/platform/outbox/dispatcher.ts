// Despachante do Outbox transacional para o pg-boss (ADR-001 v1.5 OA-002; ENT-012; TS-016):
//   - reivindica um evento pendente por transacao (FOR UPDATE SKIP LOCKED): despachantes
//     concorrentes recebem eventos disjuntos;
//   - enfileira o job NA MESMA transacao que marca dispatched_at (opcao db do pg-boss), com o id do
//     job igual ao id do evento: sem perda nem duplicata;
//   - falha: a publicacao e desfeita, attempts++ e last_error_code (sem stack trace), e o evento
//     volta a ficar disponivel apos backoff exponencial de 2^attempts s, ate 300 s (DC-017).
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../clock.js';

/** Filas (event_type) conhecidas; o worker cria cada uma no pg-boss ao subir. */
export const OUTBOX_QUEUES = ['identity.verification_requested'] as const;

export interface TransactionalDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Subconjunto do PgBoss usado aqui (PgBoss.send o satisfaz). */
export interface JobPublisher {
  send(
    name: string,
    data: object,
    options: { id: string; db: TransactionalDb },
  ): Promise<string | null>;
}

const DEFAULT_BATCH = 50;
const MAX_BACKOFF_SECONDS = 300;

interface PendingEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

function errorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.name
        : 'UNKNOWN';
  return code.slice(0, 64);
}

export class OutboxDispatcher {
  constructor(
    private readonly pool: Pool,
    private readonly publisher: JobPublisher,
    private readonly clock: Clock,
    private readonly batchSize: number = DEFAULT_BATCH,
  ) {}

  /** Despacha ate batchSize eventos disponiveis; devolve quantos foram enfileirados. */
  async dispatchOnce(): Promise<number> {
    let dispatched = 0;
    for (let i = 0; i < this.batchSize; i += 1) {
      const outcome = await this.dispatchNext();
      if (outcome === 'none') break;
      if (outcome === 'dispatched') dispatched += 1;
    }
    return dispatched;
  }

  private async dispatchNext(): Promise<'none' | 'dispatched' | 'failed'> {
    const now = this.clock.now();
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const event = (
        await client.query<PendingEvent>(
          `SELECT id, event_type, payload, attempts FROM outbox_events
            WHERE dispatched_at IS NULL AND available_at <= $1
            ORDER BY available_at, created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [now],
        )
      ).rows[0];
      if (event === undefined) {
        await client.query('COMMIT');
        return 'none';
      }
      const outcome = await this.publish(client, event, now);
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  private async publish(
    client: PoolClient,
    event: PendingEvent,
    now: string,
  ): Promise<'dispatched' | 'failed'> {
    await client.query('SAVEPOINT publish');
    try {
      await this.publisher.send(
        event.event_type,
        { event_id: event.id, ...event.payload },
        { id: event.id, db: { executeSql: (text, values) => client.query(text, values) } },
      );
      await client.query(
        'UPDATE outbox_events SET dispatched_at = $2, attempts = attempts + 1 WHERE id = $1',
        [event.id, now],
      );
      await client.query('RELEASE SAVEPOINT publish');
      return 'dispatched';
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT publish');
      const attempts = event.attempts + 1;
      const backoffMs = Math.min(2 ** attempts, MAX_BACKOFF_SECONDS) * 1_000;
      await client.query(
        `UPDATE outbox_events SET attempts = $2, last_error_code = $3, available_at = $4
          WHERE id = $1`,
        [event.id, attempts, errorCode(error), new Date(Date.parse(now) + backoffMs).toISOString()],
      );
      return 'failed';
    }
  }
}

// @trace ENT-016 RF-011 TS-032 DEC-022 (docs/architecture/DATA_MODEL.md, DC-066)
// ENT-016 external_rights_requests no PostgreSQL 17 REAL: protocolo unico no formato
// DSR-AAAAMMDD-NNNN, tipos e estados fechados e datas coerentes. O conteudo da solicitacao fica no
// canal externo: a tabela nao tem coluna para ele. Cada regra e provada pela constraint nomeada.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../apps/api/src/platform/migrate.js';
import { startPostgres, type PostgresHandle } from '../../packages/testkit/src/index.js';
import { expectPgError } from './support/pg-errors.js';

let db: PostgresHandle;
let pool: pg.Pool;

beforeAll(async () => {
  db = await startPostgres();
  pool = new pg.Pool({ connectionString: db.url, max: 4 });
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE external_rights_requests');
});

const insertRequest = (row: {
  protocol?: string;
  channel?: string;
  right_type?: string;
  user_id?: string | null;
  status?: string;
  received_at?: string;
  due_at?: string;
  answered_at?: string | null;
}) =>
  pool.query(
    `INSERT INTO external_rights_requests
       (protocol, received_at, channel, right_type, user_id, status, due_at, answered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.protocol ?? 'DSR-20261023-0001',
      row.received_at ?? '2026-10-23T12:00:00Z',
      row.channel ?? 'email-privacidade',
      row.right_type ?? 'ACCESS',
      row.user_id === undefined ? randomUUID() : row.user_id,
      row.status ?? 'RECEIVED',
      row.due_at ?? '2026-11-07T12:00:00Z',
      row.answered_at ?? null,
    ],
  );

describe('ENT-016 external_rights_requests', () => {
  it('aceita o pedido com user_id sem FK, ou sem conta identificada', async () => {
    await insertRequest({});
    await insertRequest({ protocol: 'DSR-20261023-0002', user_id: null });
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM external_rights_requests ORDER BY protocol',
    );
    expect(rows.map((row) => row.status)).toEqual(['RECEIVED', 'RECEIVED']);
  });

  it('o status padrao e RECEIVED', async () => {
    await pool.query(
      `INSERT INTO external_rights_requests (protocol, received_at, channel, right_type, due_at)
       VALUES ('DSR-20261023-0001', '2026-10-23T12:00:00Z', 'email-privacidade', 'OTHER',
               '2026-11-07T12:00:00Z')`,
    );
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM external_rights_requests',
    );
    expect(rows[0]?.status).toBe('RECEIVED');
  });

  it('protocolo unico', async () => {
    await insertRequest({});
    await expectPgError(insertRequest({}), {
      code: '23505',
      constraint: 'external_rights_requests_protocol_key',
    });
  });

  it.each([
    [
      'protocolo fora do formato',
      { protocol: 'DSR-2026-1' },
      'external_rights_requests_protocol_chk',
    ],
    [
      'protocolo com e-mail',
      { protocol: 'ana.silva@example.com' },
      'external_rights_requests_protocol_chk',
    ],
    ['canal vazio', { channel: '' }, 'external_rights_requests_channel_chk'],
    [
      'canal com mais de 40 caracteres',
      { channel: 'c'.repeat(41) },
      'external_rights_requests_channel_chk',
    ],
    [
      'prazo antes do recebimento',
      { due_at: '2026-10-22T12:00:00Z' },
      'external_rights_requests_due_chk',
    ],
    [
      'resposta sem estado ANSWERED ou CLOSED',
      { answered_at: '2026-10-24T12:00:00Z' },
      'external_rights_requests_answered_chk',
    ],
    ['ANSWERED sem answered_at', { status: 'ANSWERED' }, 'external_rights_requests_answered_chk'],
    [
      'resposta antes do recebimento',
      { status: 'ANSWERED', answered_at: '2026-10-22T12:00:00Z' },
      'external_rights_requests_answered_chk',
    ],
  ])('recusa %s', async (_case, row, constraint) => {
    await expectPgError(insertRequest(row), { code: '23514', constraint });
  });

  it.each([
    ['tipo fora do catalogo', { right_type: 'DELETE_ALL' }],
    ['estado fora do catalogo', { status: 'DONE' }],
  ])('recusa %s', async (_case, row) => {
    await expectPgError(insertRequest(row), { code: '22P02' });
  });

  it('CLOSED so depois da resposta (procedimento: ANSWERED e depois CLOSED)', async () => {
    await insertRequest({ status: 'CLOSED', answered_at: '2026-10-24T12:00:00Z' });
    await expectPgError(insertRequest({ protocol: 'DSR-20261023-0002', status: 'CLOSED' }), {
      code: '23514',
      constraint: 'external_rights_requests_answered_chk',
    });
  });

  it('nao ha coluna para o conteudo da solicitacao nem para o e-mail', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'external_rights_requests' ORDER BY ordinal_position`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'id',
      'protocol',
      'received_at',
      'channel',
      'right_type',
      'user_id',
      'status',
      'due_at',
      'answered_at',
      'updated_at',
    ]);
  });
});

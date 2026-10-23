// @trace ENT-015 RF-012 TS-030 DEC-022 (docs/architecture/DATA_MODEL.md, DC-067)
// ENT-015 incident_records no PostgreSQL 17 REAL, no schema segregado security: severidade e
// estado fechados, textos com limite, encerramento so com a decisao registrada e closed_at
// exatamente em CLOSED. Cada regra e provada pela constraint nomeada.
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
  await pool.query('TRUNCATE security.incident_records');
});

const insertIncident = (row: {
  severity?: string;
  status?: string;
  summary?: string;
  evidence_ref?: string | null;
  decision_summary?: string | null;
  opened_at?: string;
  closed_at?: string | null;
}) =>
  pool.query(
    `INSERT INTO security.incident_records
       (severity, status, summary, evidence_ref, decision_summary, opened_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.severity ?? 'HIGH',
      row.status ?? 'OPEN',
      row.summary ?? 'Credencial de servico exposta em log de build',
      row.evidence_ref ?? null,
      row.decision_summary ?? null,
      row.opened_at ?? '2026-10-23T12:00:00Z',
      row.closed_at ?? null,
    ],
  );

describe('ENT-015 security.incident_records', () => {
  it('fica no schema security, fora do public', async () => {
    const { rows } = await pool.query<{ schemaname: string }>(
      `SELECT schemaname FROM pg_tables WHERE tablename = 'incident_records'`,
    );
    expect(rows).toEqual([{ schemaname: 'security' }]);
  });

  it('o estado padrao e OPEN', async () => {
    await pool.query(
      `INSERT INTO security.incident_records (severity, summary) VALUES ('LOW', 'Teste')`,
    );
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM security.incident_records',
    );
    expect(rows[0]?.status).toBe('OPEN');
  });

  it('encerra com a decisao registrada', async () => {
    await insertIncident({
      status: 'CLOSED',
      decision_summary: 'Sem dado de titular afetado; comunicacao dispensada',
      closed_at: '2026-10-24T12:00:00Z',
    });
    expect((await pool.query('SELECT 1 FROM security.incident_records')).rowCount).toBe(1);
  });

  it.each([
    ['resumo vazio', { summary: '' }, 'incident_records_summary_chk'],
    [
      'resumo com mais de 500 caracteres',
      { summary: 'r'.repeat(501) },
      'incident_records_summary_chk',
    ],
    [
      'referencia com mais de 512 caracteres',
      { evidence_ref: 'e'.repeat(513) },
      'incident_records_evidence_chk',
    ],
    [
      'decisao com mais de 1000 caracteres',
      { decision_summary: 'd'.repeat(1001) },
      'incident_records_decision_chk',
    ],
    [
      'CLOSED sem closed_at',
      { status: 'CLOSED', decision_summary: 'Decidido' },
      'incident_records_closed_chk',
    ],
    [
      'closed_at fora de CLOSED',
      { status: 'RESOLVED', closed_at: '2026-10-24T12:00:00Z' },
      'incident_records_closed_chk',
    ],
    [
      'encerramento antes da abertura',
      { status: 'CLOSED', decision_summary: 'Decidido', closed_at: '2026-10-22T12:00:00Z' },
      'incident_records_closed_chk',
    ],
    [
      'CLOSED sem decisao',
      { status: 'CLOSED', closed_at: '2026-10-24T12:00:00Z' },
      'incident_records_decision_chk',
    ],
  ])('recusa %s', async (_case, row, constraint) => {
    await expectPgError(insertIncident(row), { code: '23514', constraint });
  });

  it.each([
    ['severidade fora do catalogo', { severity: 'URGENT' }],
    ['estado fora do catalogo', { status: 'DONE' }],
  ])('recusa %s', async (_case, row) => {
    await expectPgError(insertIncident(row), { code: '22P02' });
  });
});

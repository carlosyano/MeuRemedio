// @trace TS-030 RF-012 ENT-015 ENT-013 DEC-022 (incidente de seguranca, DC-067)
// TS-030 contra PostgreSQL 17 real: incidente tratado pelos scripts operacionais
// (docs/operations/RIGHTS_AND_INCIDENTS.md §3) com registro, contencao, decisao e relatorio. O
// registro fica no schema segregado security, sem dado de titular; cada passo e auditado com o
// operador, e o relatorio pos-incidente reune o registro e a linha do tempo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runOps } from '../../apps/api/src/ops/ops-cli.js';
import { startHarness, type Harness } from '../integration/support/http.js';

let h: Harness;

const OPERATOR = 'arn:aws:iam::000000000000:role/meuremedio-ops-security';
const SUMMARY = 'Credencial de servico exposta em log de build';
const DECISION = 'Sem dado de titular afetado; comunicacao a ANPD e aos titulares dispensada';

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

async function ops(argv: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOps(argv, {
    pool: h.pool,
    clock: { now: () => h.now },
    operator: OPERATOR,
    readStdin: () => Promise.resolve(''),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

const parsed = (run: Run): Record<string, unknown> =>
  JSON.parse(run.out.join('\n')) as Record<string, unknown>;

async function open(extra: string[] = []): Promise<string> {
  const run = await ops(['incident:open', '--severity', 'HIGH', '--summary', SUMMARY, ...extra]);
  expect(run.code, run.err.join('\n')).toBe(0);
  return String(parsed(run)['incident_id']);
}

const step = (command: string, id: string, extra: string[] = []) =>
  ops([command, '--id', id, ...extra]);

beforeAll(async () => {
  h = await startHarness('2026-10-23T12:00:00Z');
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = '2026-10-23T12:00:00Z';
  await h.pool.query('TRUNCATE security.incident_records, audit_events');
});

describe('TS-030: registro, contencao, decisao e relatorio', () => {
  it('registra o incidente OPEN no schema security, com a referencia da evidencia', async () => {
    const run = await ops([
      'incident:open',
      '--severity',
      'CRITICAL',
      '--summary',
      SUMMARY,
      '--evidence-ref',
      'cofre://incidentes/2026-10-23/build-log',
    ]);
    expect(run.code).toBe(0);
    expect(parsed(run)).toMatchObject({ status: 'OPEN', severity: 'CRITICAL' });
    const { rows } = await h.pool.query<{
      id: string;
      severity: string;
      status: string;
      summary: string;
      evidence_ref: string;
      opened_at: Date;
    }>('SELECT * FROM security.incident_records');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: parsed(run)['incident_id'],
      severity: 'CRITICAL',
      status: 'OPEN',
      summary: SUMMARY,
      evidence_ref: 'cofre://incidentes/2026-10-23/build-log',
    });
    expect(rows[0]?.opened_at.toISOString()).toBe('2026-10-23T12:00:00.000Z');
  });

  it('percorre contencao, resolucao, decisao e encerramento e gera o relatorio', async () => {
    const id = await open();
    h.now = '2026-10-23T12:30:00Z';
    expect(parsed(await step('incident:contain', id, ['--evidence-ref', 'cofre://x/1']))).toEqual({
      incident_id: id,
      status: 'CONTAINED',
    });
    h.now = '2026-10-23T18:00:00Z';
    expect((await step('incident:resolve', id)).code).toBe(0);
    h.now = '2026-10-24T09:00:00Z';
    expect((await step('incident:decide', id, ['--decision', DECISION])).code).toBe(0);
    h.now = '2026-10-24T10:00:00Z';
    expect(parsed(await step('incident:close', id))).toEqual({ incident_id: id, status: 'CLOSED' });

    const report = parsed(await step('incident:report', id));
    expect(report).toEqual({
      incident_id: id,
      severity: 'HIGH',
      status: 'CLOSED',
      summary: SUMMARY,
      evidence_ref: 'cofre://x/1',
      decision_summary: DECISION,
      opened_at: '2026-10-23T12:00:00.000Z',
      closed_at: '2026-10-24T10:00:00.000Z',
      timeline: [
        { at: '2026-10-23T12:00:00.000Z', action: 'incident.opened', operator: OPERATOR },
        { at: '2026-10-23T12:30:00.000Z', action: 'incident.contained', operator: OPERATOR },
        { at: '2026-10-23T18:00:00.000Z', action: 'incident.resolved', operator: OPERATOR },
        { at: '2026-10-24T09:00:00.000Z', action: 'incident.decided', operator: OPERATOR },
        { at: '2026-10-24T10:00:00.000Z', action: 'incident.closed', operator: OPERATOR },
      ],
    });
  });

  it('a auditoria leva o operador e o estado, sem o resumo nem a decisao', async () => {
    const id = await open();
    await step('incident:decide', id, ['--decision', DECISION]);
    const { rows } = await h.pool.query<{
      action: string;
      resource_type: string;
      resource_id: string;
      actor_user_id: string | null;
      metadata: Record<string, string>;
    }>('SELECT action, resource_type, resource_id, actor_user_id, metadata FROM audit_events');
    expect(rows.map((row) => row.action)).toEqual(['incident.opened', 'incident.decided']);
    for (const row of rows) {
      expect(row).toMatchObject({
        resource_type: 'incident',
        resource_id: id,
        actor_user_id: null,
      });
      expect(row.metadata['operator']).toBe(OPERATOR);
    }
    const written = JSON.stringify(rows);
    expect(written).not.toContain(SUMMARY);
    expect(written).not.toContain(DECISION);
  });

  it('a decisao pode ser revista antes do encerramento', async () => {
    const id = await open();
    await step('incident:decide', id, ['--decision', 'Primeira avaliacao']);
    await step('incident:decide', id, ['--decision', DECISION]);
    const { rows } = await h.pool.query<{ decision_summary: string }>(
      'SELECT decision_summary FROM security.incident_records',
    );
    expect(rows[0]?.decision_summary).toBe(DECISION);
  });

  it('o relatorio de incidente em aberto sai sem closed_at e com a linha do tempo parcial', async () => {
    const id = await open();
    const report = parsed(await step('incident:report', id));
    expect(report).toMatchObject({ status: 'OPEN', closed_at: null, decision_summary: null });
    expect(report['timeline']).toHaveLength(1);
  });
});

describe('TS-030: recusas', () => {
  it('encerrar sem decisao: codigo 3, sem alterar', async () => {
    const id = await open();
    await step('incident:contain', id);
    await step('incident:resolve', id);
    const run = await step('incident:close', id);
    expect(run.code).toBe(3);
    const { rows } = await h.pool.query<{ status: string }>(
      'SELECT status FROM security.incident_records',
    );
    expect(rows[0]?.status).toBe('RESOLVED');
  });

  it.each([
    ['resolver sem conter', ['incident:resolve']],
    ['encerrar sem resolver', ['incident:decide', 'incident:close']],
    ['conter duas vezes', ['incident:contain', 'incident:contain']],
    [
      'decidir depois de encerrado',
      [
        'incident:contain',
        'incident:resolve',
        'incident:decide',
        'incident:close',
        'incident:decide',
      ],
    ],
  ])('%s: codigo 3', async (_case, commands) => {
    const id = await open();
    let last: Run | undefined;
    for (const command of commands) {
      last = await step(command, id, command === 'incident:decide' ? ['--decision', DECISION] : []);
    }
    expect(last?.code).toBe(3);
    expect(last?.out).toEqual([]);
  });

  it('incidente inexistente: codigo 3', async () => {
    const run = await step('incident:contain', '00000000-0000-4000-8000-000000000000');
    expect(run.code).toBe(3);
  });

  it.each([
    ['resumo com e-mail', ['--summary', 'Acesso indevido por ana.silva@example.com']],
    ['resumo com CPF', ['--summary', 'Titular 123.456.789-09 afetado']],
    ['resumo vazio', ['--summary', '']],
    ['severidade fora do catalogo', ['--severity', 'URGENT']],
  ])('abertura com %s: codigo 2, sem gravar e sem ecoar o valor', async (_case, override) => {
    const run = await ops([
      'incident:open',
      '--severity',
      'HIGH',
      '--summary',
      SUMMARY,
      ...override,
    ]);
    expect(run.code).toBe(2);
    const errors = run.err.join('\n');
    expect(errors).not.toContain('ana.silva@example.com');
    expect(errors).not.toContain('123.456.789-09');
    expect((await h.pool.query('SELECT 1 FROM security.incident_records')).rowCount).toBe(0);
  });

  it('decisao com dado pessoal: codigo 2, sem gravar', async () => {
    const id = await open();
    const run = await step('incident:decide', id, ['--decision', 'Avisar bruno.costa@example.com']);
    expect(run.code).toBe(2);
    expect(run.err.join('\n')).not.toContain('bruno.costa@example.com');
    const { rows } = await h.pool.query<{ decision_summary: string | null }>(
      'SELECT decision_summary FROM security.incident_records',
    );
    expect(rows[0]?.decision_summary).toBeNull();
  });

  it('id que nao e UUID: codigo 2', async () => {
    expect((await step('incident:contain', 'INC-1')).code).toBe(2);
  });
});

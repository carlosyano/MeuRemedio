// @trace TS-032 RF-011 ENT-016 ENT-013 RNF-008 DEC-022 (direito externo, DC-066)
// TS-032 contra PostgreSQL 17 real: a solicitacao externa de direito vira protocolo
// DSR-AAAAMMDD-NNNN pelo script operacional (docs/operations/RIGHTS_AND_INCIDENTS.md §2), sem
// expor dado do titular: o e-mail da conta entra so pela entrada padrao, serve para achar o
// user_id e nao aparece na saida, nos erros, na tabela nem na trilha de auditoria.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runOps } from '../../apps/api/src/ops/ops-cli.js';
import { startHarness, type Harness } from '../integration/support/http.js';

let h: Harness;

const ANA = 'ana.silva@example.com';
const OPERATOR = 'arn:aws:iam::000000000000:role/meuremedio-ops-privacy';

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

async function ops(argv: string[], stdin = ''): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOps(argv, {
    pool: h.pool,
    clock: { now: () => h.now },
    operator: OPERATOR,
    readStdin: () => Promise.resolve(stdin),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

const register = (extra: string[] = [], stdin = '') =>
  ops(
    [
      'rights:register',
      '--channel',
      'email-privacidade',
      '--type',
      'ACCESS',
      '--received-at',
      '2026-10-23T09:15:00-03:00',
      '--due-at',
      '2026-11-07T12:15:00Z',
      ...extra,
    ],
    stdin,
  );

const parsed = (run: Run): Record<string, unknown> =>
  JSON.parse(run.out.join('\n')) as Record<string, unknown>;

/** Tudo o que o script escreveu, mais a tabela e a trilha de auditoria. */
async function everythingWritten(runs: readonly Run[]): Promise<string> {
  const rights = await h.pool.query('SELECT * FROM external_rights_requests');
  const audit = await h.pool.query('SELECT * FROM audit_events');
  return JSON.stringify([runs, rights.rows, audit.rows]);
}

beforeAll(async () => {
  h = await startHarness('2026-10-23T12:20:00Z');
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = '2026-10-23T12:20:00Z';
  await h.truncate();
  await h.pool.query('TRUNCATE external_rights_requests, audit_events');
});

describe('TS-032: registro do protocolo', () => {
  it('cria o protocolo do dia UTC do recebimento, ligado a conta pelo e-mail da entrada padrao', async () => {
    const anaId = await h.activeUser(ANA);
    const run = await register(['--email-stdin'], `  ${ANA.toUpperCase()}\n`);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(parsed(run)).toEqual({
      protocol: 'DSR-20261023-0001',
      status: 'RECEIVED',
      account_linked: true,
    });

    const { rows } = await h.pool.query<{
      user_id: string;
      right_type: string;
      channel: string;
      received_at: Date;
      due_at: Date;
    }>('SELECT * FROM external_rights_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: anaId,
      right_type: 'ACCESS',
      channel: 'email-privacidade',
    });
    expect(rows[0]?.received_at.toISOString()).toBe('2026-10-23T12:15:00.000Z');
    expect(rows[0]?.due_at.toISOString()).toBe('2026-11-07T12:15:00.000Z');
  });

  it('numera em sequencia dentro do dia e recomeca no dia seguinte', async () => {
    expect(parsed(await register())['protocol']).toBe('DSR-20261023-0001');
    expect(parsed(await register())['protocol']).toBe('DSR-20261023-0002');
    const nextDay = await ops([
      'rights:register',
      '--channel',
      'email-privacidade',
      '--type',
      'DELETION',
      '--received-at',
      '2026-10-24T00:00:00Z',
      '--due-at',
      '2026-11-08T00:00:00Z',
    ]);
    expect(parsed(nextDay)['protocol']).toBe('DSR-20261024-0001');
  });

  it('registros simultaneos recebem protocolos distintos', async () => {
    const runs = await Promise.all(Array.from({ length: 5 }, () => register()));
    const protocols = runs.map((run) => parsed(run)['protocol']);
    expect(new Set(protocols).size).toBe(5);
  });

  it('sem conta identificada, registra sem user_id e sem revelar se o e-mail existe', async () => {
    const run = await register(['--email-stdin'], 'bruno.costa@example.com');
    expect(parsed(run)).toEqual({
      protocol: 'DSR-20261023-0001',
      status: 'RECEIVED',
      account_linked: false,
    });
    const { rows } = await h.pool.query<{ user_id: string | null }>(
      'SELECT user_id FROM external_rights_requests',
    );
    expect(rows[0]?.user_id).toBeNull();
  });

  it('audita o registro com o operador, sem dado do titular', async () => {
    await h.activeUser(ANA);
    await register(['--email-stdin'], ANA);
    const { rows } = await h.pool.query<{
      action: string;
      actor_user_id: string | null;
      resource_type: string;
      outcome: string;
      metadata: Record<string, unknown>;
    }>('SELECT action, actor_user_id, resource_type, outcome, metadata FROM audit_events');
    expect(rows).toEqual([
      {
        action: 'rights.request_registered',
        actor_user_id: null,
        resource_type: 'rights_request',
        outcome: 'SUCCESS',
        metadata: { operator: OPERATOR, protocol: 'DSR-20261023-0001', right_type: 'ACCESS' },
      },
    ]);
  });

  it('o e-mail nao aparece na saida, nos erros, na tabela nem na auditoria', async () => {
    await h.activeUser(ANA);
    const runs = [
      await register(['--email-stdin'], ANA),
      await register(['--email-stdin'], 'bruno.costa@example.com'),
      await register(['--email-stdin'], 'nao-e-email'),
      await register(['--email-stdin'], ''),
    ];
    const written = await everythingWritten(runs);
    for (const secret of [
      ANA,
      'ana.silva',
      'bruno.costa@example.com',
      'bruno.costa',
      'nao-e-email',
    ]) {
      expect(written).not.toContain(secret);
    }
  });

  it.each([
    ['tipo fora do catalogo', ['--type', 'TUDO']],
    ['recebimento sem fuso', ['--received-at', '2026-10-23T09:15:00']],
    ['prazo antes do recebimento', ['--due-at', '2026-10-01T00:00:00Z']],
    ['canal vazio', ['--channel', '']],
    ['opcao desconhecida', ['--email', ANA]],
  ])('recusa %s com codigo 2, sem gravar e sem ecoar o valor', async (_case, override) => {
    const run = await ops([
      'rights:register',
      '--channel',
      'email-privacidade',
      '--type',
      'ACCESS',
      '--received-at',
      '2026-10-23T09:15:00-03:00',
      '--due-at',
      '2026-11-07T12:15:00Z',
      ...override,
    ]);
    expect(run.code).toBe(2);
    expect(run.out).toEqual([]);
    expect(run.err.join('\n')).not.toContain(ANA);
    expect((await h.pool.query('SELECT 1 FROM external_rights_requests')).rowCount).toBe(0);
  });

  it('e-mail invalido na entrada padrao e recusado sem ecoar o valor', async () => {
    const run = await register(['--email-stdin'], 'ana.silva@');
    expect(run.code).toBe(2);
    expect(run.err.join('\n')).not.toContain('ana.silva');
    expect((await h.pool.query('SELECT 1 FROM external_rights_requests')).rowCount).toBe(0);
  });
});

describe('TS-032: andamento do protocolo', () => {
  const advance = (protocol: string, status: string) =>
    ops(['rights:advance', '--protocol', protocol, '--status', status]);

  it('avanca RECEIVED -> IN_PROGRESS -> ANSWERED -> CLOSED e audita cada passo', async () => {
    await register();
    h.now = '2026-10-24T10:00:00Z';
    expect(parsed(await advance('DSR-20261023-0001', 'IN_PROGRESS'))).toEqual({
      protocol: 'DSR-20261023-0001',
      status: 'IN_PROGRESS',
    });
    h.now = '2026-10-30T10:00:00Z';
    await advance('DSR-20261023-0001', 'ANSWERED');
    h.now = '2026-10-31T10:00:00Z';
    await advance('DSR-20261023-0001', 'CLOSED');

    const { rows } = await h.pool.query<{ status: string; answered_at: Date; updated_at: Date }>(
      'SELECT status, answered_at, updated_at FROM external_rights_requests',
    );
    expect(rows[0]?.status).toBe('CLOSED');
    expect(rows[0]?.answered_at.toISOString()).toBe('2026-10-30T10:00:00.000Z');
    expect(rows[0]?.updated_at.toISOString()).toBe('2026-10-31T10:00:00.000Z');
    const audit = await h.pool.query<{ action: string; metadata: Record<string, unknown> }>(
      'SELECT action, metadata FROM audit_events ORDER BY occurred_at',
    );
    expect(audit.rows.map((row) => [row.action, row.metadata['status']])).toEqual([
      ['rights.request_registered', undefined],
      ['rights.request_updated', 'IN_PROGRESS'],
      ['rights.request_updated', 'ANSWERED'],
      ['rights.request_updated', 'CLOSED'],
    ]);
  });

  it.each([
    ['volta de estado', ['IN_PROGRESS', 'RECEIVED']],
    ['repeticao do estado', ['IN_PROGRESS', 'IN_PROGRESS']],
    ['CLOSED sem ANSWERED', ['CLOSED']],
    ['depois de CLOSED', ['ANSWERED', 'CLOSED', 'IN_PROGRESS']],
  ])('recusa %s com codigo 3, sem alterar', async (_case, steps) => {
    await register();
    let last: Run | undefined;
    for (const status of steps) last = await advance('DSR-20261023-0001', status);
    expect(last?.code).toBe(3);
    expect(last?.out).toEqual([]);
  });

  it('protocolo inexistente: codigo 3', async () => {
    const run = await advance('DSR-20261023-0099', 'IN_PROGRESS');
    expect(run.code).toBe(3);
    expect(run.err.join('\n')).toContain('DSR-20261023-0099');
  });

  it('comando desconhecido: codigo 2', async () => {
    expect((await ops(['rights:delete'])).code).toBe(2);
    expect((await ops([])).code).toBe(2);
  });
});

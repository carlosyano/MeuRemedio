// @trace TS-029 RN-019 RN-012 ENT-014 FL-001
// TS-029 (Restore e tombstone) contra PostgreSQL 17 real (DC-046): depois de um restore de backup
// anterior ao expurgo, a conta expurgada volta ao banco; a passada de expurgo reconcilia com os
// tombstones e a remove de novo, com os dados dela, sem tocar em conta nova criada com o mesmo
// e-mail (o tombstone nao impede novo cadastro, RN-019).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlePurgeSweep } from '../../apps/api/src/modules/privacy/application/account-purge.js';
import { PASSWORD, login, startHarness, type Harness } from './support/http.js';

const NOW = '2026-10-05T11:05:15Z';
const DUE = '2026-11-04T11:05:15Z';
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  h.now = NOW;
  await h.truncate();
  await h.pool.query('TRUNCATE purge_tombstones');
});

const sweep = () =>
  handlePurgeSweep({
    pool: h.pool,
    clock: { now: () => h.now },
    storage: h.storage,
    emailPepper: h.emailPepper,
  });

interface Snapshot {
  users: Record<string, unknown>[];
  plans: Record<string, unknown>[];
}

/** Copia as linhas da conta e dos planos, como um backup logico anterior ao expurgo. */
async function backup(userId: string): Promise<Snapshot> {
  return {
    users: (await h.pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows,
    plans: (await h.pool.query('SELECT * FROM medication_plans WHERE user_id = $1', [userId])).rows,
  };
}

/** Reinsere as linhas do backup (restore). */
async function restore(snapshot: Snapshot): Promise<void> {
  for (const [table, rows] of [
    ['users', snapshot.users],
    ['medication_plans', snapshot.plans],
  ] as const) {
    for (const row of rows) {
      const columns = Object.keys(row);
      await h.pool.query(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
        columns.map((column) => row[column]),
      );
    }
  }
}

describe('TS-029 restore reconciliado com os tombstones', () => {
  it('conta expurgada restaurada de backup e removida de novo na passada seguinte', async () => {
    const anaId = await h.activeUser('ana.silva@example.com');
    const ana = await login(h, 'ana.silva@example.com');
    const plan = await h.call('createPlan', 'POST', '/plans', {
      body: {
        medication_name: 'Comprimido',
        dose_text: '1 comprimido',
        medication_form: 'TABLET',
        administration_route: 'ORAL',
        start_date: '2026-10-01',
        schedule_times: ['08:00'],
      },
      headers: { ...ana.mutation, 'idempotency-key': 'k-plano' },
    });
    expect(plan.status).toBe(201);
    const snapshot = await backup(anaId);
    const deletion = await h.call('requestAccountDeletion', 'POST', '/account-deletions', {
      body: { password: PASSWORD, confirmation: 'EXCLUIR MINHA CONTA' },
      headers: { ...ana.mutation, 'idempotency-key': 'k-exclusao' },
    });
    expect(deletion.status).toBe(202);
    h.now = DUE;
    expect(await sweep()).toMatchObject({ purged: 1 });

    // Restore do backup anterior ao pedido: a conta volta ACTIVE, com o plano.
    await restore(snapshot);
    expect((await h.pool.query('SELECT 1 FROM users WHERE id = $1', [anaId])).rowCount).toBe(1);

    expect(await sweep()).toMatchObject({ reconciled: 1 });
    expect((await h.pool.query('SELECT 1 FROM users WHERE id = $1', [anaId])).rowCount).toBe(0);
    const plans = await h.pool.query('SELECT 1 FROM medication_plans WHERE user_id = $1', [anaId]);
    expect(plans.rowCount).toBe(0);
    const stones = await h.pool.query('SELECT 1 FROM purge_tombstones WHERE user_id = $1', [anaId]);
    expect(stones.rowCount).toBe(1);
  });

  it('a conta restaurada nao consegue entrar depois da reconciliacao', async () => {
    const anaId = await h.activeUser('ana.silva@example.com');
    const snapshot = await backup(anaId);
    const ana = await login(h, 'ana.silva@example.com');
    await h.call('requestAccountDeletion', 'POST', '/account-deletions', {
      body: { password: PASSWORD, confirmation: 'EXCLUIR MINHA CONTA' },
      headers: { ...ana.mutation, 'idempotency-key': 'k-exclusao' },
    });
    h.now = DUE;
    await sweep();
    await restore(snapshot);
    await sweep();
    const attempt = await h.call('createSession', 'POST', '/sessions', {
      body: { email: 'ana.silva@example.com', password: PASSWORD },
    });
    expect(attempt.status).toBe(401);
  });

  it('conta nova com o mesmo e-mail (outro user_id) nao e afetada pela reconciliacao', async () => {
    const oldId = await h.activeUser('ana.silva@example.com');
    const ana = await login(h, 'ana.silva@example.com');
    await h.call('requestAccountDeletion', 'POST', '/account-deletions', {
      body: { password: PASSWORD, confirmation: 'EXCLUIR MINHA CONTA' },
      headers: { ...ana.mutation, 'idempotency-key': 'k-exclusao' },
    });
    h.now = DUE;
    await sweep();
    const newId = await h.activeUser('ana.silva@example.com');
    expect(newId).not.toBe(oldId);
    expect(await sweep()).toMatchObject({ purged: 0, reconciled: 0 });
    expect((await h.pool.query('SELECT 1 FROM users WHERE id = $1', [newId])).rowCount).toBe(1);
  });
});

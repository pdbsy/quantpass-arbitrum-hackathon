import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../apps/server/src/store.ts';
import { AutomataStore } from '../apps/server/src/automata-store.ts';
import { assertInvariant } from '../packages/domain/src/vault.ts';
import type { Parameters } from '../packages/automata/src/model.ts';

const parameters: Parameters = {
  weights: { 'rwa-a': 5000 },
  deviationBps: 100,
  intervalMs: 1000,
  feeBps: 0,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
};
function setup(path = ':memory:') {
  const local = new LocalStore(path);
  const bots = new AutomataStore(local);
  const v = local.obtainTestPasses('alice', 'core-flow-demo');
  if (!v.revision)
    local.command(
      'alice',
      v.id,
      { id: 'alice', role: 'owner' },
      { id: 'deposit', expectedRevision: 0, type: 'deposit', amount: '1500000000' },
    );
  return { local, bots, vaultId: v.id };
}
test('funding is owned, atomic and leaves unrelated idle money untouched', () => {
  const h = setup();
  try {
    const run = h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '1000000000',
      datasetId: 'trend',
      parameters,
    });
    assert.equal(run.state.cash, '1000000000');
    assert.equal(h.local.get(h.vaultId, 'alice').idle, '500000000');
    assert.throws(() => h.bots.get('bob', 'run1'), /NOT_FOUND/);
    assert.deepEqual(
      h.bots.create('alice', {
        id: 'run1',
        vaultId: h.vaultId,
        amount: '1000000000',
        datasetId: 'trend',
        parameters,
      }),
      run,
    );
    assert.throws(
      () =>
        h.bots.create('alice', {
          id: 'run1',
          vaultId: h.vaultId,
          amount: '500000000',
          datasetId: 'trend',
          parameters,
        }),
      /IDEMPOTENCY/,
    );
    assert.throws(
      () =>
        h.local.command(
          'alice',
          h.vaultId,
          { id: 'alice', role: 'owner' },
          { id: 'bypass', expectedRevision: 2, type: 'deallocate', amount: '1' },
        ),
      /BOT_OWNS_ALLOCATION/,
    );
    assertInvariant(h.local.get(h.vaultId, 'alice'));
  } finally {
    h.local.close();
  }
});
test('checkpoint, ownership, revision and idempotency survive closing SQLite', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'alphaforge-bot-')), 'ledger.sqlite');
  const h = setup(path);
  h.bots.create('alice', {
    id: 'run1',
    vaultId: h.vaultId,
    amount: '1000000000',
    datasetId: 'trend',
    parameters,
  });
  const command = { id: 'step1', expectedRevision: 0, type: 'step' as const };
  const a = h.bots.command('alice', 'run1', command);
  assert.equal(a.state.trades.length, 1);
  h.local.close();
  const next = setup(path);
  try {
    assert.deepEqual(next.bots.command('alice', 'run1', command), a);
    assert.throws(() => next.bots.command('alice', 'run1', { ...command, id: 'step2' }), /REVISION/);
    const stop = next.bots.command('alice', 'run1', {
      id: 'stop',
      expectedRevision: a.revision,
      type: 'stop',
    });
    assert.equal(stop.state.status, 'stopped');
    const vault = next.local.get(next.vaultId, 'alice');
    assert.equal(vault.status, 'stopped');
    assert.equal(vault.positionCost, '0');
    assert.equal(vault.idle, '500000000');
    assertInvariant(vault);
  } finally {
    next.local.close();
  }
});
test('failed persistence rolls back both run and Vault funding', () => {
  const h = setup();
  try {
    h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '500000000',
      datasetId: 'trend',
      parameters,
    });
    const before = h.local.get(h.vaultId, 'alice');
    h.local.db.exec(
      "CREATE TEMP TRIGGER fail_bot BEFORE UPDATE ON automata_runs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
    );
    assert.throws(() =>
      h.bots.command('alice', 'run1', {
        id: 'add',
        expectedRevision: 0,
        type: 'fund',
        direction: 'in',
        amount: '100000000',
      }),
    );
    assert.deepEqual(h.local.get(h.vaultId, 'alice'), before);
    assert.equal(h.bots.get('alice', 'run1').revision, 0);
    assert.equal(h.local.db.isTransaction, false);
  } finally {
    h.local.close();
  }
});
test('deposit and withdraw preserve unit NAV, cash-only refusal is atomic', () => {
  const h = setup();
  try {
    h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '500000000',
      datasetId: 'trend',
      parameters,
    });
    h.bots.command('alice', 'run1', { id: 'step', expectedRevision: 0, type: 'step' });
    const a = h.bots.command('alice', 'run1', {
      id: 'in',
      expectedRevision: 1,
      type: 'fund',
      direction: 'in',
      amount: '100000000',
    });
    assert.equal(a.returnBps, 0);
    const b = h.bots.command('alice', 'run1', {
      id: 'out',
      expectedRevision: 2,
      type: 'fund',
      direction: 'out',
      amount: '100000000',
    });
    assert.equal(b.returnBps, 0);
    assert.equal(h.local.get(h.vaultId, 'alice').idle, '1000000000');
    assert.throws(
      () =>
        h.bots.command('alice', 'run1', {
          id: 'too-much',
          expectedRevision: 3,
          type: 'fund',
          direction: 'out',
          amount: '400000000',
        }),
      /INSUFFICIENT_BOT_CASH/,
    );
    assert.equal(h.bots.get('alice', 'run1').revision, 3);
    assertInvariant(h.local.get(h.vaultId, 'alice'));
  } finally {
    h.local.close();
  }
});
test('paused runs are monitored by the scheduler and recover after reopening', () => {
  const h = setup();
  try {
    h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '500000000',
      datasetId: 'trend',
      parameters: { ...parameters, limits: { mode: 'price', assetId: 'rwa-a', upper: '101000000' } },
    });
    h.bots.tick();
    h.bots.command('alice', 'run1', { id: 'pause', expectedRevision: 1, type: 'pause' });
    for (let i = 0; i < 4; i++) h.bots.tick();
    const result = h.bots.get('alice', 'run1');
    assert.equal(result.state.status, 'stopped');
    assert.equal(result.state.trigger?.reason, 'upper');
  } finally {
    h.local.close();
  }
});
test('old stopped run cannot overwrite later Vault cash movements', () => {
  const h = setup();
  try {
    h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '500000000',
      datasetId: 'trend',
      parameters,
    });
    h.bots.command('alice', 'run1', { id: 'stop', expectedRevision: 0, type: 'stop' });
    const v = h.local.get(h.vaultId, 'alice');
    h.local.command(
      'alice',
      v.id,
      { id: 'alice', role: 'owner' },
      { id: 'release', type: 'deallocate', expectedRevision: v.revision, amount: '500000000' },
    );
    const before = h.local.get(h.vaultId, 'alice');
    h.bots.command('alice', 'run1', { id: 'stop-again', expectedRevision: 1, type: 'stop' });
    assert.deepEqual(h.local.get(h.vaultId, 'alice'), before);
    assert.throws(
      () => h.bots.command('alice', 'run1', { id: 'step', expectedRevision: 1, type: 'step' }),
      /INVALID_STATUS/,
    );
  } finally {
    h.local.close();
  }
});
test('stop tolerates an older revision after a replay tick, while funding remains revision guarded', () => {
  const h = setup();
  try {
    h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '500000000',
      datasetId: 'trend',
      parameters,
    });
    h.bots.tick();
    assert.throws(
      () =>
        h.bots.command('alice', 'run1', {
          id: 'stale-fund',
          expectedRevision: 0,
          type: 'fund',
          direction: 'out',
          amount: '1',
        }),
      /REVISION_CONFLICT/,
    );
    const stopped = h.bots.command('alice', 'run1', { id: 'stop', expectedRevision: 0, type: 'stop' });
    assert.equal(stopped.state.status, 'stopped');
    assert.equal(stopped.state.positions['rwa-a']?.quantity, '0');
  } finally {
    h.local.close();
  }
});
test('full settlement releases cash above Pass allowance to idle without changing unit return', () => {
  const h = setup();
  try {
    h.bots.create('alice', {
      id: 'run1',
      vaultId: h.vaultId,
      amount: '1000000000',
      datasetId: 'trend',
      parameters,
    });
    h.bots.tick();
    h.bots.command('alice', 'run1', { id: 'pause', expectedRevision: 1, type: 'pause' });
    for (let i = 0; i < 10; i++) h.bots.tick();
    const before = h.bots.get('alice', 'run1');
    const after = h.bots.command('alice', 'run1', {
      id: 'stop',
      expectedRevision: before.revision,
      type: 'stop',
    });
    assert.equal(after.state.cash, '1000000000');
    assert.equal(after.returnBps, before.returnBps);
    assert.equal(after.settlementReleased, '25000000');
    assert.equal(h.local.get(h.vaultId, 'alice').idle, '525000000');
    assertInvariant(h.local.get(h.vaultId, 'alice'));
  } finally {
    h.local.close();
  }
});

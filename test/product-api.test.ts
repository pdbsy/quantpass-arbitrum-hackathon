import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { productHarness } from './helpers/product-api.ts';

// Catches disconnected detail/catalog definitions and arbitrary strategy claims.
test('AF-BE01 versioned catalog supplies matching detail and only registered simulations', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  const catalog = await h.request(cookie, '/api/strategies');
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().length, 2);
  const detail = await h.request(cookie, '/api/strategies/core-flow-demo');
  assert.equal(detail.statusCode, 200);
  for (const key of ['id', 'name', 'description', 'scope', 'testPasses', 'catalogVersion'])
    assert.equal(detail.json()[key], catalog.json()[0][key]);
  assert.deepEqual(detail.json().asset, { assetId: 'TEST_ONLY_USDT_UNIT', decimals: 6 });
  assert.equal(detail.json().capabilities.execution, 'LOCAL_SIMULATION');
  assert.equal((await h.request(cookie, '/api/strategies/missing')).statusCode, 409);
  assert.equal((await h.request(cookie, '/api/vaults', { strategyId: 'missing' })).statusCode, 409);
  assert.equal((await h.request('', '/api/strategies/core-flow-demo')).statusCode, 401);
  const second = await h.claim(cookie, 'satellite-flow-demo');
  assert.equal(second.strategyId, 'satellite-flow-demo');
});

// Catches page-local totals, floating point rounding and cross-owner summary reads.
test('AF-BE01 account totals are exact and independent of vault pagination and other owners', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const alice = await h.login(),
    bob = await h.login('bob');
  const empty = await h.request(alice, '/api/account');
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().identity, { id: 'alice', mode: 'DEMO' });
  assert.equal(empty.json().status, null);
  assert.equal(empty.json().passes, '0');
  assert.deepEqual(empty.json().vaults, []);
  const a = await h.claim(alice),
    b = await h.claim(alice, 'satellite-flow-demo');
  for (const [id, amount] of [
    [a.id, '9007199254740993'],
    [b.id, '1'],
  ]) {
    const result = await h.request(alice, `/api/vaults/${id}/commands`, {
      id: 'same-id-independent-vault',
      type: 'deposit',
      expectedRevision: 0,
      amount,
    });
    assert.equal(result.statusCode, 200);
  }
  const account = (await h.request(alice, '/api/account?limit=1')).json();
  assert.equal(account.vaultCount, 2);
  assert.equal(account.passes, '2000');
  assert.equal(account.idle, '9007199254740994');
  assert.equal(account.vaults.length, 1);
  assert.ok(account.pagination.nextCursor);
  const next = (await h.request(alice, `/api/account?limit=1&after=${account.pagination.nextCursor}`)).json();
  assert.notEqual(account.vaults[0].id, next.vaults[0].id);
  assert.deepEqual(next.balances, account.balances);
  assert.equal(next.pagination.nextCursor, null);
  assert.equal((await h.request(bob, '/api/account')).json().vaultCount, 0);
  assert.equal((await h.request(bob, '/api/account')).json().idle, '0');
  assert.equal((await h.request('', '/api/account')).statusCode, 401);
});

// Catches using global vault identifiers without owner/strategy binding and claim resets.
test('AF-BE01 strategy-scoped vault lookup and duplicate claims preserve separate ledgers', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const alice = await h.login(),
    bob = await h.login('bob');
  const a = await h.claim(alice),
    b = await h.claim(alice, 'satellite-flow-demo');
  await h.request(alice, `/api/vaults/${a.id}/commands`, {
    id: 'd',
    type: 'deposit',
    expectedRevision: 0,
    amount: '100',
  });
  const scoped = await h.request(alice, '/api/strategies/core-flow-demo/vault');
  assert.equal(scoped.statusCode, 200);
  assert.equal(scoped.json().id, a.id);
  assert.equal(scoped.json().idle, '100');
  assert.equal((await h.request(alice, '/api/strategies/satellite-flow-demo/vault')).json().id, b.id);
  assert.equal((await h.request(bob, '/api/strategies/core-flow-demo/vault')).statusCode, 404);
  assert.equal((await h.request(bob, `/api/vaults/${a.id}`)).statusCode, 404);
  assert.equal((await h.request(bob, `/api/vaults/${a.id}/audit`)).statusCode, 404);
  assert.equal((await h.request(alice, `/api/vaults?strategyId=satellite-flow-demo`)).json()[0].idle, '0');
  const repeated = await h.claim(alice);
  assert.equal(repeated.id, a.id);
  assert.equal(repeated.revision, 1);
  assert.equal(repeated.idle, '100');
});

// Catches mislabelling pending or reserved cash as idle, and double-counting allocation.
test('AF-BE01 product balances and pending operations follow real ledger transitions', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  let vault = await h.claim(cookie);
  const steps = [
    { id: 'd', type: 'deposit', amount: '1500000000' },
    { id: 'a', type: 'allocate', amount: '1000000000' },
    { id: 's', type: 'start' },
    { id: 'o', type: 'reserveBuy', orderId: 'buy', amount: '200000000' },
    { id: 'w', type: 'requestWithdrawal', amount: '500000000' },
    { id: 'stop', type: 'stop' },
  ];
  for (const step of steps) {
    const result = await h.request(cookie, `/api/vaults/${vault.id}/commands`, {
      ...step,
      expectedRevision: vault.revision,
    });
    assert.equal(result.statusCode, 200, result.body);
    vault = result.json().vault;
  }
  const account = (await h.request(cookie, '/api/account')).json();
  assert.deepEqual(account.balances, {
    reserved: '200000000',
    pending: '500000000',
    unrealized: '0',
    activeGross: '1000000000',
    activeNet: '1000000000',
    equity: '1500000000',
    allowance: '1000000000',
  });
  assert.equal(account.status, 'stopping');
  assert.equal(
    vault.pendingOperations.find((op: { kind: string }) => op.kind === 'withdrawal').amount,
    '500000000',
  );
  assert.equal(
    vault.pendingOperations.find((op: { kind: string }) => op.kind === 'order').amount,
    '200000000',
  );
  assert.equal(vault.status, 'stopping');
  assert.equal(vault.pendingOperations.length, 2);
  assert.equal(vault.receipts, undefined);
  assert.equal(vault.executorId, undefined);
});

// Catches unbounded reads and cursor direction/off-by-one errors.
test('AF-BE01 list and audit pagination are bounded and reject malformed pagination', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  const strategyPage = await h.request(cookie, '/api/strategies?limit=1');
  assert.equal(strategyPage.json().length, 1);
  assert.equal(strategyPage.headers['x-next-cursor'], 'core-flow-demo');
  assert.equal(
    (await h.request(cookie, '/api/strategies?limit=1&after=core-flow-demo')).json()[0].id,
    'satellite-flow-demo',
  );
  for (let revision = 0; revision < 3; revision++)
    await h.request(cookie, `/api/vaults/${vault.id}/commands`, {
      id: `d${revision}`,
      type: 'deposit',
      amount: '1',
      expectedRevision: revision,
    });
  const page = await h.request(cookie, `/api/vaults/${vault.id}/audit?limit=2`);
  assert.deepEqual(
    page.json().map((e: { revision: number }) => e.revision),
    [3, 2],
  );
  assert.equal(page.headers['x-next-cursor'], '2');
  const last = await h.request(cookie, `/api/vaults/${vault.id}/audit?limit=2&beforeRevision=2`);
  assert.deepEqual(
    last.json().map((e: { revision: number }) => e.revision),
    [1],
  );
  assert.equal(last.headers['x-next-cursor'], undefined);
  for (const url of [
    '/api/account?limit=0',
    '/api/vaults?limit=101',
    '/api/strategies?limit=1.5',
    '/api/account?limit=01',
    '/api/vaults?unknown=1',
    `/api/vaults/${vault.id}/audit?beforeRevision=-1`,
  ])
    assert.equal((await h.request(cookie, url)).statusCode, 400, url);
});

// Catches raw errors, missing retry contracts, amount overflow misclassification and replay mutation.
test('AF-BE01 structured errors and exact input bounds preserve economic state', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  const url = `/api/vaults/${vault.id}/commands`;
  const command = { id: 'one', type: 'deposit', amount: '1', expectedRevision: 0 };
  for (const amount of [1, '1.5', '01', '-1', (1n << 256n).toString()]) {
    const result = await h.request(cookie, url, { ...command, amount });
    assert.equal(result.statusCode, 400);
    assert.deepEqual(result.json(), { error: 'INVALID_REQUEST' });
  }
  const first = await h.request(cookie, url, command);
  assert.equal(first.statusCode, 200);
  assert.equal((await h.request(cookie, url, command)).json().replayed, true);
  const stale = await h.request(cookie, url, { ...command, id: 'new' });
  assert.deepEqual(stale.json(), { error: 'REVISION_CONFLICT' });
  const conflict = await h.request(cookie, url, { ...command, amount: '2' });
  assert.equal(conflict.json().error, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.store.get(vault.id, 'alice').idle, '1');
  const tooLarge = await h.request(cookie, '/api/vaults', { strategyId: 'x'.repeat(17000) });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.json().error, 'INVALID_REQUEST');
  const missing = await h.request(cookie, '/api/no-such-route');
  assert.equal(missing.json().error, 'INVALID_REQUEST');
});

// Catches a read projection bypassing persisted-state validation.
test('AF-BE01 damaged account data returns a generic failure without partial totals', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  h.store.db.prepare('UPDATE vaults SET digest = ? WHERE id = ?').run('invalid', vault.id);
  for (const url of ['/api/account', '/api/strategies/core-flow-demo/vault']) {
    const result = await h.request(cookie, url);
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.json(), {
      error: 'LOCAL_OPERATION_FAILED',
    });
  }
});

// Catches account/detail reads changing schema-v1 data or losing persistent receipts on restore.
test('AF-BE01 account and strategy views survive restart and legacy SQLite backup', async () => {
  const first = await productHarness();
  const cookie = await first.login(),
    vault = await first.claim(cookie);
  const command = { id: 'persisted', type: 'deposit', amount: '123456789', expectedRevision: 0 };
  await first.request(cookie, `/api/vaults/${vault.id}/commands`, command);
  const backup = resolve(first.directory, 'backup.sqlite');
  await first.store.backupTo(backup);
  const path = first.path;
  await first.app.close();
  for (const dbPath of [path, backup]) {
    const h = await productHarness(dbPath);
    try {
      const nextCookie = await h.login();
      const account = await h.request(nextCookie, '/api/account');
      assert.equal(account.statusCode, 200);
      assert.equal(account.json().idle, '123456789');
      assert.equal(account.json().vaults[0].id, vault.id);
      assert.equal((await h.request(nextCookie, '/api/strategies/core-flow-demo/vault')).json().revision, 1);
      assert.equal(
        (await h.request(nextCookie, `/api/vaults/${vault.id}/commands`, command)).json().replayed,
        true,
      );
      assert.equal(h.store.db.prepare('PRAGMA user_version').get()?.user_version, 1);
    } finally {
      await h.app.close();
    }
  }
});

// Catches shipped UI fixtures drifting from the real public API contract.
test('AF-BE01 six UI fixtures match real API journeys and preserve pending/stop meaning', async () => {
  const { readFile } = await import('node:fs/promises');
  const { generateProductFixtures } = await import('./helpers/product-fixtures.ts');
  const actual = await generateProductFixtures();
  const fixture = JSON.parse(
    await readFile(new URL('../docs/api/fixtures/AF-BE01.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(actual, fixture);
  assert.deepEqual(Object.keys(fixture.scenarios), [
    'NORMAL',
    'EMPTY',
    'PENDING',
    'ERROR',
    'RUNNING',
    'STOPPED',
  ]);
  assert.equal(fixture.scenarios.EMPTY.accountSummary.vaultCount, 0);
  assert.equal(fixture.scenarios.NORMAL.accountSummary.idle, '1500000000');
  assert.equal(fixture.scenarios.PENDING.accountSummary.balances.pending, '500000000');
  assert.equal(fixture.scenarios.PENDING.vault.status, 'stopping');
  assert.equal(fixture.scenarios.RUNNING.vault.status, 'running');
  assert.equal(fixture.scenarios.STOPPED.vault.status, 'stopped');
  assert.equal(fixture.scenarios.ERROR.accountSummary, null);
  assert.deepEqual(fixture.scenarios.ERROR.error, { error: 'INVALID_REQUEST' });
});

// Catches the legacy core-only UI selecting a satellite ledger from states[0].
test('AF-BE01 legacy vault list stays core-bound with satellite-only and mixed accounts', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  const satellite = await h.claim(cookie, 'satellite-flow-demo');
  assert.deepEqual((await h.request(cookie, '/api/vaults')).json(), []);
  const core = await h.claim(cookie);
  const legacy = (await h.request(cookie, '/api/vaults')).json();
  assert.deepEqual(
    legacy.map((vault: { id: string }) => vault.id),
    [core.id],
  );
  assert.equal(
    (await h.request(cookie, '/api/vaults?strategyId=satellite-flow-demo')).json()[0].id,
    satellite.id,
  );
  assert.equal((await h.request(cookie, '/api/account')).json().vaultCount, 2);
});

// Catches boundary adapters diverging from the exact frozen Wave 1 resource shapes.
test('AF-BE01 frozen canonical resources bind absence, passes, balances and pending operations', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const alice = await h.login(),
    bob = await h.login('bob');
  const list = await h.request(alice, '/api/v1/strategies?limit=1');
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items[0].strategyId, 'core-flow-demo');
  assert.equal(list.json().items[0].schemaVersion, 1);
  const absent = (await h.request(alice, '/api/v1/strategies/core-flow-demo')).json();
  assert.deepEqual(absent.accountStrategy, {
    ownerId: 'alice',
    strategyId: 'core-flow-demo',
    vaultId: null,
    status: 'not_started',
  });
  const claimed = await h.request(alice, '/api/v1/vaults', { strategyId: 'core-flow-demo' });
  assert.equal(claimed.statusCode, 200);
  const vault = claimed.json();
  assert.equal(vault.vaultId, vault.id);
  assert.deepEqual(vault.passBalance, {
    strategyId: 'core-flow-demo',
    total: '1000',
    allowance: '1000000000',
  });
  assert.deepEqual(vault.balances.asset, { assetId: 'TEST_ONLY_USDT_UNIT', decimals: 6 });
  for (const key of [
    'idle',
    'activeCash',
    'positionCost',
    'positionValue',
    'feeLiability',
    'deposits',
    'withdrawalsPaid',
    'realizedPnl',
    'feesAccrued',
    'feesPaid',
    'reserved',
    'pending',
    'unrealized',
    'activeGross',
    'activeNet',
    'equity',
    'allowance',
  ])
    assert.equal(typeof vault.balances[key], 'string', key);
  const account = (await h.request(alice, '/api/v1/account')).json();
  assert.equal(account.schemaVersion, 1);
  assert.equal(account.ownerId, 'alice');
  assert.equal(
    account.strategies.find((s: { strategyId: string }) => s.strategyId === 'core-flow-demo').vaultId,
    vault.vaultId,
  );
  assert.equal(
    account.passBalances.find((s: { strategyId: string }) => s.strategyId === 'core-flow-demo').total,
    '1000',
  );
  assert.equal((await h.request(bob, `/api/v1/vaults/${vault.vaultId}`)).statusCode, 404);
  assert.equal(
    (await h.request(bob, '/api/v1/strategies/core-flow-demo')).json().accountStrategy.vaultId,
    null,
  );
  const url = `/api/v1/vaults/${vault.vaultId}/commands`;
  const command = { id: 'd', type: 'deposit', amount: '5', expectedRevision: 0 };
  assert.equal((await h.request(alice, url, command)).json().vault.balances.idle, '5');
  assert.equal((await h.request(alice, url, command)).json().replayed, true);
  await h.request(alice, url, { id: 'w', type: 'requestWithdrawal', amount: '2', expectedRevision: 1 });
  const live = (await h.request(alice, `/api/v1/vaults/${vault.vaultId}`)).json();
  assert.deepEqual(live.pendingOperations, [
    { operationId: 'w', kind: 'withdrawal', status: 'pending', amount: '2' },
  ]);
  const audit = (await h.request(alice, `/api/v1/vaults/${vault.vaultId}/audit?limit=1`)).json();
  assert.equal(audit.items[0].commandId, 'w');
  assert.equal(audit.items[0].commandType, 'requestWithdrawal');
  assert.equal(audit.items[0].actorId, 'alice');
  assert.match(audit.items[0].recordedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// Catches forged, cross-resource/owner and stale-process cursors being treated as offsets.
test('AF-BE01 canonical opaque cursors continue deterministic pages and reject invalid binding', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    bob = await h.login('bob');
  await h.claim(cookie);
  await h.claim(cookie, 'satellite-flow-demo');
  const first = (await h.request(cookie, '/api/v1/vaults?limit=1')).json();
  assert.equal(first.items.length, 1);
  assert.equal(typeof first.nextCursor, 'string');
  assert.notEqual(first.nextCursor, first.items[0].vaultId);
  const url = `/api/v1/vaults?limit=1&cursor=${first.nextCursor}`;
  const next = await h.request(cookie, url);
  assert.equal(next.statusCode, 200);
  assert.notEqual(next.json().items[0].vaultId, first.items[0].vaultId);
  assert.equal(next.json().nextCursor, null);
  assert.deepEqual((await h.request(cookie, url)).json(), next.json());
  for (const [identity, path] of [
    [bob, url],
    [cookie, '/api/v1/vaults?cursor=not-issued'],
    [cookie, `/api/v1/strategies?cursor=${first.nextCursor}`],
    [cookie, `/api/v1/vaults?strategyId=core-flow-demo&cursor=${first.nextCursor}`],
    [cookie, '/api/v1/vaults?limit=101'],
  ]) {
    const result = await h.request(identity!, path!);
    assert.equal(result.statusCode, 400, path);
    assert.equal(result.json().error, 'INVALID_REQUEST');
  }
  const restarted = await productHarness(h.path);
  try {
    const newCookie = await restarted.login();
    assert.equal((await restarted.request(newCookie, url)).statusCode, 400);
  } finally {
    await restarted.app.close();
  }
});

// Catches optional legacy error metadata leaking into the closed canonical envelope.
test('AF-BE01 canonical errors are exactly the frozen envelope at every boundary', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  for (const [identity, url, code, status] of [
    ['', '/api/v1/account', 'SESSION_REQUIRED', 401],
    [cookie, '/api/v1/vaults?limit=0', 'INVALID_REQUEST', 400],
    [cookie, '/api/v1/vaults/missing', 'VAULT_NOT_FOUND', 404],
    [cookie, '/api/v1/strategies/missing', 'UNKNOWN_STRATEGY', 409],
  ] as const) {
    const response = await h.request(identity, url);
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error: code });
  }
  const rejected = await h.app.inject({ url: '/api/v1/account', headers: { host: 'invalid.example' } });
  assert.deepEqual(rejected.json(), { error: 'HOST_REJECTED' });
  h.store.db.prepare('UPDATE vaults SET digest = ? WHERE id = ?').run('bad', vault.id);
  const failure = await h.request(cookie, '/api/v1/account');
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(failure.json(), { error: 'LOCAL_OPERATION_FAILED' });
});

// Catches persisted invariant failures being mislabeled as client state conflicts.
test('AF-BE01 invalid persisted state is internal even when its digest matches', async (t) => {
  const { createHash } = await import('node:crypto');
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  const state = { ...h.store.get(vault.id, 'alice'), status: 'invalid-status' };
  const json = JSON.stringify(state);
  h.store.db
    .prepare('UPDATE vaults SET state_json = ?, digest = ? WHERE id = ?')
    .run(json, createHash('sha256').update(json).digest('hex'), vault.id);
  const result = await h.request(cookie, '/api/v1/account');
  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.json(), { error: 'LOCAL_OPERATION_FAILED' });
});

// Catches canonical pending/audit projections retaining terminal operations or losing replay readback.
test('AF-BE01 canonical readback and terminal audit preserve completed and cancelled operations', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  let vault = await h.claim(cookie);
  const url = `/api/v1/vaults/${vault.id}`;
  const deposit = { id: 'deposit', type: 'deposit', amount: '10', expectedRevision: 0 };
  // Simulate a caller that did not retain the mutation response, then read before retrying.
  await h.request(cookie, `${url}/commands`, deposit);
  assert.equal((await h.request(cookie, url)).json().balances.idle, '10');
  assert.equal((await h.request(cookie, `${url}/audit`)).json().items[0].commandId, 'deposit');
  const replay = await h.request(cookie, `${url}/commands`, deposit);
  assert.equal(replay.json().replayed, true);
  vault = replay.json().vault;
  for (const step of [
    { id: 'allocate', type: 'allocate', amount: '5' },
    { id: 'start', type: 'start' },
    { id: 'order', type: 'reserveBuy', orderId: 'buy', amount: '3' },
    { id: 'withdrawal', type: 'requestWithdrawal', amount: '2' },
    { id: 'cancel', type: 'cancelOrder', orderId: 'buy' },
    { id: 'complete', type: 'confirmWithdrawal', withdrawalId: 'withdrawal' },
    { id: 'stop', type: 'stop' },
  ]) {
    const result = await h.request(cookie, `${url}/commands`, { ...step, expectedRevision: vault.revision });
    assert.equal(result.statusCode, 200, result.body);
    vault = result.json().vault;
  }
  assert.equal(vault.status, 'stopped');
  assert.deepEqual(vault.pendingOperations, []);
  assert.equal(vault.balances.withdrawalsPaid, '2');
  const first = (await h.request(cookie, `${url}/audit?limit=2`)).json();
  assert.deepEqual(
    first.items.map((item: { commandId: string }) => item.commandId),
    ['stop', 'complete'],
  );
  const next = (await h.request(cookie, `${url}/audit?limit=2&cursor=${first.nextCursor}`)).json();
  assert.deepEqual(
    next.items.map((item: { commandId: string }) => item.commandId),
    ['cancel', 'withdrawal'],
  );
});

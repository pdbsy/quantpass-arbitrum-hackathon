import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/server/src/app.ts';
import { ApiError } from '../apps/web/src/api.ts';
import { ProductAdapter } from '../apps/web/src/product-adapter.ts';
import { ProductClient, type ApiRequest, type ClientStorage } from '../apps/web/src/product-client.ts';

const pendingKey = 'quantpass.local.pending-command.v1';
class MemoryStorage implements ClientStorage {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('QUOTA_DENIED');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.fail) throw new Error('QUOTA_DENIED');
    this.values.delete(key);
  }
}
async function harness(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'ui-client-'));
  const { app, store } = await buildApp({
    dbPath: join(directory, 'ledger.sqlite'),
    env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
    origin: 'http://127.0.0.1:4180',
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  let cookie = '';
  const storage = new MemoryStorage();
  const controls: {
    after?: (path: string, body: unknown, data: unknown) => Promise<void>;
    before?: (path: string, body: unknown) => Promise<void>;
  } = {};
  const request: ApiRequest = async <T>(path: string, body?: unknown) => {
    await controls.before?.(path, body);
    const response = await app.inject({
      method: body === undefined ? 'GET' : 'POST',
      url: `/api${path}`,
      headers: {
        host: '127.0.0.1:4180',
        'x-quantpass-demo': '1',
        cookie,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const data = response.json();
    if (response.statusCode >= 400) throw new ApiError(data.error, response.statusCode);
    await controls.after?.(path, body, data);
    return data as T;
  };
  const client = new ProductClient({ request, storage });
  await client.selectIdentity('alice');
  await client.claim('core-flow-demo');
  return {
    client,
    request,
    store,
    storage,
    controls,
    logout: () => {
      cookie = '';
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('lost committed response survives reload and exact retry deposits once', async (t) => {
  const h = await harness(t);
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('RESPONSE_LOST');
  };
  await assert.rejects(h.client.command('deposit', { amount: '9007199254740993' }, h.client.prepare()));
  const durable = h.storage.getItem(pendingKey)!;
  const envelope = JSON.parse(durable);
  assert.equal(h.store.get(envelope.vaultId, 'alice').idle, '9007199254740993');
  assert.equal(h.client.snapshot.phase, 'DISCONNECTED');
  assert.equal(h.client.snapshot.notice, null);
  const restored = new ProductClient({ request: h.request, storage: h.storage });
  delete h.controls.after;
  await restored.refresh();
  assert.equal(h.storage.getItem(pendingKey), durable);
  await restored.retry();
  assert.equal(restored.snapshot.vaults[0]!.idle, '9007199254740993');
  assert.equal(h.store.audit('alice', envelope.vaultId).length, 1);
  assert.equal(h.storage.getItem(pendingKey), null);
});

test('review revision conflict is retained until refresh and explicit dismissal', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  await h.request(`/vaults/${review.vaultId}/commands`, {
    id: 'external',
    type: 'deposit',
    amount: '1',
    expectedRevision: 0,
  });
  await assert.rejects(h.client.command('deposit', { amount: '2' }, review), /REVISION_CONFLICT/);
  const pending = h.client.snapshot.pending!;
  assert.equal(pending.command.expectedRevision, 0);
  assert.equal(h.client.snapshot.phase, 'STALE');
  await assert.rejects(h.client.retry(), /REVIEW_REQUIRED/);
  await assert.rejects(h.client.dismissRejected(), /REFRESH_REQUIRED/);
  await h.client.refresh();
  await h.client.dismissRejected();
  assert.throws(() => h.client.prepare(), /REFRESH_REQUIRED/);
  await h.client.refresh();
  await h.client.command('deposit', { amount: '2' }, h.client.prepare());
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '3');
  assert.equal(h.store.audit('alice', review.vaultId).length, 2);
});

test('Bob never displays or replays Alice pending funds and switching back recovers', async (t) => {
  const h = await harness(t);
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('LOST');
  };
  await assert.rejects(h.client.command('deposit', { amount: '100' }, h.client.prepare()));
  const durable = h.storage.getItem(pendingKey);
  delete h.controls.after;
  await h.client.selectIdentity('bob');
  assert.equal(h.client.snapshot.user, 'bob');
  assert.equal(h.client.snapshot.vaults.length, 0);
  assert.deepEqual(h.client.snapshot.audit, []);
  assert.equal(h.client.snapshot.pending, null);
  await assert.rejects(h.client.retry(), /PENDING_OWNER_MISMATCH/);
  assert.equal(h.storage.getItem(pendingKey), durable);
  await h.client.selectIdentity('alice');
  await h.client.retry();
  assert.equal(h.client.snapshot.vaults[0]!.idle, '100');
});

test('storage failure prevents command submission and pending removal failure remains recoverable', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.storage.fail = true;
  await assert.rejects(h.client.command('deposit', { amount: '7' }, review), /QUOTA_DENIED/);
  assert.equal(h.store.get(review.vaultId, 'alice').revision, 0);
  assert.equal(h.client.snapshot.phase, 'ERROR');
  h.storage.fail = false;
  await h.client.refresh();
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) h.storage.fail = true;
  };
  await assert.rejects(h.client.command('deposit', { amount: '7' }, h.client.prepare()));
  assert.ok(h.client.snapshot.pending);
  assert.equal(h.client.snapshot.notice, null);
  h.storage.fail = false;
  delete h.controls.after;
  await h.client.retry();
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '7');
});

test('concurrent command attempts cannot create an additional deposit', async (t) => {
  const h = await harness(t),
    review = h.client.prepare(),
    gate = deferred(),
    entered = deferred();
  h.controls.before = async (path) => {
    if (path.endsWith('/commands')) {
      entered.resolve();
      await gate.promise;
    }
  };
  const first = h.client.command('deposit', { amount: '11' }, review);
  await entered.promise;
  await assert.rejects(h.client.command('deposit', { amount: '11' }, review), /BUSY/);
  await assert.rejects(h.client.selectIdentity('bob'), /BUSY/);
  gate.resolve();
  await first;
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '11');
});

test('successful write with failed readback stays pending until exact retry verifies it', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.controls.before = async (path) => {
    if (path.endsWith('/audit')) throw new Error('OFFLINE');
  };
  await assert.rejects(h.client.command('deposit', { amount: '19' }, review));
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '19');
  assert.ok(h.client.snapshot.pending);
  assert.equal(h.client.snapshot.notice, null);
  delete h.controls.before;
  await h.client.retry();
  assert.equal(h.client.snapshot.vaults[0]!.idle, '19');
  assert.equal(h.store.audit('alice', review.vaultId).length, 1);
});

test('401 clears every private view while preserving the durable pending request', async (t) => {
  const h = await harness(t);
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('LOST');
  };
  await assert.rejects(h.client.command('deposit', { amount: '23' }, h.client.prepare()));
  const durable = h.storage.getItem(pendingKey);
  h.logout();
  await assert.rejects(h.client.refresh(), /SESSION_REQUIRED/);
  assert.equal(h.client.snapshot.phase, 'DISCONNECTED');
  assert.equal(h.client.snapshot.user, null);
  assert.equal(h.client.snapshot.vaults.length, 0);
  assert.deepEqual(h.client.snapshot.strategies, []);
  assert.deepEqual(h.client.snapshot.audit, []);
  assert.equal(h.client.snapshot.selectedVaultId, null);
  assert.equal(h.client.snapshot.pending, null);
  assert.equal(h.storage.getItem(pendingKey), durable);
});

test('delayed Alice read cannot overwrite a completed Bob identity switch', async (t) => {
  const h = await harness(t),
    gate = deferred(),
    entered = deferred();
  let delayed = false;
  h.controls.after = async (path) => {
    if (path === '/vaults' && !delayed) {
      delayed = true;
      entered.resolve();
      await gate.promise;
    }
  };
  const oldRead = h.client.refresh();
  await entered.promise;
  await h.client.selectIdentity('bob');
  gate.resolve();
  await oldRead;
  assert.equal(h.client.snapshot.user, 'bob');
  assert.equal(h.client.snapshot.vaults.length, 0);
});

test('reviews cannot survive refresh or vault selection and foreign vault IDs are rejected', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  await h.client.refresh();
  await assert.rejects(h.client.command('deposit', { amount: '2' }, review), /REVIEW_REQUIRED/);
  await assert.rejects(h.client.selectVault('bob_vault'), /VAULT_NOT_FOUND/);
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '0');
  await h.client.selectVault(review.vaultId);
  assert.equal(h.client.snapshot.selectedVaultId, review.vaultId);
});

test('malformed legacy pending data is retained and blocks new writes', async (t) => {
  const h = await harness(t);
  h.storage.setItem(pendingKey, '{unresolved old request');
  const next = new ProductClient({ request: h.request, storage: h.storage });
  await assert.rejects(next.refresh(), /PENDING_STORAGE_INVALID/);
  assert.throws(() => next.prepare(), /PENDING_STORAGE_INVALID/);
  assert.equal(h.storage.getItem(pendingKey), '{unresolved old request');
});

test('all master command fields run a real local funding and simulation journey', async (t) => {
  const h = await harness(t),
    c = h.client;
  const states: string[] = [];
  const unsubscribe = c.subscribe((state) => states.push(state.phase));
  await c.command('deposit', { amount: '100000000' }, c.prepare());
  await c.command('allocate', { amount: '60000000' }, c.prepare());
  await c.command('start', {}, c.prepare());
  await c.command('reserveBuy', { orderId: 'cancel_me', amount: '10000000' }, c.prepare());
  await c.command('cancelOrder', { orderId: 'cancel_me' }, c.prepare());
  await c.command('reserveBuy', { orderId: 'fill_me', amount: '10000000' }, c.prepare());
  await c.command('fillBuy', { orderId: 'fill_me' }, c.prepare());
  await c.command('markPosition', { value: '11000000' }, c.prepare());
  await c.command('stop', {}, c.prepare());
  assert.equal(c.snapshot.vaults[0]!.status, 'stopping');
  assert.match(c.snapshot.notice!, /waiting/);
  assert.doesNotMatch(c.snapshot.notice!, /stopped/i);
  await c.command('settlePosition', { proceeds: '11000000' }, c.prepare());
  await c.command('deallocate', { amount: '61000000' }, c.prepare());
  await c.command('requestWithdrawal', { amount: '1000000' }, c.prepare());
  const cancelId = Object.keys(c.snapshot.vaults[0]!.pendingWithdrawals)[0]!;
  await c.command('cancelWithdrawal', { withdrawalId: cancelId }, c.prepare());
  await c.command('requestWithdrawal', { amount: '1000000' }, c.prepare());
  const payId = Object.keys(c.snapshot.vaults[0]!.pendingWithdrawals)[0]!;
  await c.command('confirmWithdrawal', { withdrawalId: payId }, c.prepare());
  assert.equal(c.snapshot.vaults[0]!.withdrawalsPaid, '1000000');
  assert.equal(c.snapshot.vaults[0]!.idle, '100000000');
  await assert.rejects(c.command('payFees', { amount: '1' }, c.prepare()));
  assert.equal(c.snapshot.phase, 'STALE');
  assert.ok(states.includes('PENDING'));
  unsubscribe();
});

test('5xx preserves exact pending payload for transport recovery', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.store.db.exec(
    "CREATE TEMP TRIGGER fail_client_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  await assert.rejects(h.client.command('deposit', { amount: '31' }, review), /LOCAL_OPERATION_FAILED/);
  const original = h.client.snapshot.pending!.command;
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '0');
  h.store.db.exec('DROP TRIGGER fail_client_audit');
  await h.client.retry();
  assert.equal(h.store.get(review.vaultId, 'alice').receipts[original.id]!.revision, 1);
  assert.equal(h.client.snapshot.vaults[0]!.idle, '31');
});

test('command response from another vault never becomes a visible success', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.controls.after = async (path, _body, data) => {
    if (path.endsWith('/commands')) (data as { vault: { ownerId: string } }).vault.ownerId = 'bob';
  };
  await assert.rejects(h.client.command('deposit', { amount: '37' }, review), /RESPONSE_CONTEXT_MISMATCH/);
  assert.ok(h.client.snapshot.pending);
  assert.equal(h.client.snapshot.notice, null);
  assert.ok(h.client.snapshot.vaults.every((vault) => vault.ownerId === 'alice'));
});

test('malformed amounts and fields cannot reach the ledger or durable request', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  await assert.rejects(h.client.command('deposit', { amount: '1.5' }, review), /NON_CANONICAL_AMOUNT/);
  await h.client.refresh();
  await assert.rejects(
    h.client.command('deposit', { amount: '1', id: 'override' } as never, h.client.prepare()),
    /INVALID_COMMAND_FIELDS/,
  );
  assert.equal(h.store.get(review.vaultId, 'alice').revision, 0);
  assert.equal(h.storage.getItem(pendingKey), null);
});

test('matching audit reconciles a lost committed command without sending another POST', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('LOST');
  };
  await assert.rejects(h.client.command('deposit', { amount: '41' }, review));
  delete h.controls.after;
  h.controls.before = async (path) => {
    if (path.endsWith('/commands')) throw new Error('MUST_RECONCILE_FIRST');
  };
  await h.client.retry();
  assert.equal(h.client.snapshot.pending, null);
  assert.equal(h.client.snapshot.vaults[0]!.idle, '41');
  assert.equal(h.store.audit('alice', review.vaultId).length, 1);
});

test('retry cannot write while required vault or audit reconciliation is unavailable', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.controls.before = async (path) => {
    if (path.endsWith('/commands')) throw new Error('OFFLINE_BEFORE_SEND');
  };
  await assert.rejects(h.client.command('deposit', { amount: '43' }, review));
  const original = h.storage.getItem(pendingKey);
  for (const unavailable of [`/vaults/${review.vaultId}`, `/vaults/${review.vaultId}/audit`]) {
    h.controls.before = async (path) => {
      if (path === unavailable) throw new Error('RECONCILIATION_OFFLINE');
    };
    await assert.rejects(h.client.retry(), /RECONCILIATION_OFFLINE/);
    assert.equal(h.store.get(review.vaultId, 'alice').revision, 0);
    assert.equal(h.storage.getItem(pendingKey), original);
  }
  delete h.controls.before;
  await h.client.retry();
  assert.equal(h.client.snapshot.vaults[0]!.idle, '43');
});

test('rate limiting retains a retryable exact envelope without rejection dismissal', async (t) => {
  const h = await harness(t),
    review = h.client.prepare();
  h.controls.before = async (path) => {
    if (path.endsWith('/commands')) throw new ApiError('RATE_LIMITED', 429);
  };
  await assert.rejects(h.client.command('deposit', { amount: '47' }, review), /RATE_LIMITED/);
  const pending = h.client.snapshot.pending!;
  assert.equal(pending.rejection, undefined);
  assert.equal(h.store.get(review.vaultId, 'alice').revision, 0);
  delete h.controls.before;
  await h.client.retry();
  assert.equal(h.store.get(review.vaultId, 'alice').receipts[pending.command.id]!.revision, 1);
});

test('pending request stays bound to its vault while selecting another owned vault', async (t) => {
  const h = await harness(t);
  // The production gateway selects v1's all-strategy collection when available;
  // the expanded backend intentionally keeps its legacy list core-only.
  const client = new ProductAdapter({ request: h.request, storage: h.storage }).client;
  await client.refresh();
  const review = client.prepare();
  const second = h.store.obtainTestPasses('alice', 'satellite-flow-demo');
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('LOST');
  };
  await assert.rejects(client.command('deposit', { amount: '53' }, review));
  const durable = h.storage.getItem(pendingKey);
  delete h.controls.after;
  await client.refresh();
  await client.selectVault(second.id);
  await assert.rejects(client.retry(), /PENDING_VAULT_MISMATCH/);
  assert.equal(client.snapshot.vaults.find((vault) => vault.id === second.id)!.idle, '0');
  assert.equal(client.snapshot.audit.length, 0);
  assert.equal(h.storage.getItem(pendingKey), durable);
  await client.selectVault(review.vaultId);
  await client.retry();
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '53');
  assert.equal(h.store.get(second.id, 'alice').idle, '0');
});

test('authenticated identity change during retry clears the previous private view', async (t) => {
  const h = await harness(t);
  await h.client.command('deposit', { amount: '59' }, h.client.prepare());
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('RESPONSE_LOST');
  };
  await assert.rejects(h.client.command('deposit', { amount: '61' }, h.client.prepare()));
  const durable = h.storage.getItem(pendingKey);
  assert.equal(h.client.snapshot.user, 'alice');
  assert.equal(h.client.snapshot.vaults[0]!.idle, '59');
  assert.equal(h.client.snapshot.audit.length, 1);
  assert.ok(h.client.snapshot.pending);
  delete h.controls.after;
  // A session change outside this controller, as in another tab, is authoritative.
  await h.request('/demo/session', { user: 'bob' });
  let commandPosts = 0;
  h.controls.before = async (path) => {
    if (path.endsWith('/commands')) commandPosts++;
  };
  await assert.rejects(h.client.retry(), /RESPONSE_CONTEXT_MISMATCH/);
  assert.equal(h.client.snapshot.user, null);
  assert.equal(h.client.snapshot.vaults.length, 0);
  assert.equal(h.client.snapshot.strategies.length, 0);
  assert.equal(h.client.snapshot.audit.length, 0);
  assert.equal(h.client.snapshot.selectedVaultId, null);
  assert.equal(h.client.snapshot.pending, null);
  assert.equal(h.client.snapshot.notice, null);
  assert.equal(h.storage.getItem(pendingKey), durable);
  assert.equal(commandPosts, 0);
});

test('executor receipts reconcile lost reserve responses after reload without another POST', async (t) => {
  const h = await harness(t);
  await h.client.command('deposit', { amount: '100000000' }, h.client.prepare());
  await h.client.command('allocate', { amount: '100000000' }, h.client.prepare());
  await h.client.command('start', {}, h.client.prepare());
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('RESPONSE_LOST');
  };
  await assert.rejects(
    h.client.command('reserveBuy', { amount: '10000000', orderId: 'lost-order' }, h.client.prepare()),
  );
  const durable = h.storage.getItem(pendingKey)!;
  const envelope = JSON.parse(durable);
  delete h.controls.after;
  h.controls.before = async (path) => {
    if (path.endsWith('/commands')) throw new Error('MUST_RECONCILE_FIRST');
  };
  const restored = new ProductClient({ request: h.request, storage: h.storage });
  await restored.refresh();
  await restored.retry();
  assert.equal(restored.snapshot.pending, null);
  assert.equal(h.storage.getItem(pendingKey), null);
  assert.equal(h.store.get(envelope.vaultId, 'alice').orders['lost-order'], '10000000');
  assert.equal(h.store.audit('alice', envelope.vaultId).length, 4);
});

test('owner commands reject a simulator audit actor and retain the pending request', async (t) => {
  const h = await harness(t);
  h.controls.after = async (path) => {
    if (path.endsWith('/commands')) throw new Error('RESPONSE_LOST');
  };
  await assert.rejects(h.client.command('deposit', { amount: '1' }, h.client.prepare()));
  const durable = h.storage.getItem(pendingKey);
  delete h.controls.after;
  const request: ApiRequest = async <T>(path: string, body?: unknown): Promise<T> => {
    const result = await h.request<T>(path, body);
    if (path.endsWith('/audit'))
      return (result as { actor_id: string }[]).map((row) => ({ ...row, actor_id: 'local-simulator' })) as T;
    return result;
  };
  const restored = new ProductClient({ request, storage: h.storage });
  await restored.refresh();
  await assert.rejects(restored.retry(), /RESPONSE_CONTEXT_MISMATCH/);
  assert.equal(h.storage.getItem(pendingKey), durable);
});

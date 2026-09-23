import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ProductAdapter, type CanonicalSnapshot } from '../apps/web/src/product-adapter.ts';
import { ApiError } from '../apps/web/src/api.ts';
import type { ApiRequest } from '../apps/web/src/product-client.ts';
import { productHarness } from './helpers/product-api.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function projection(snapshot: CanonicalSnapshot) {
  const { user, strategies, vaults, account, details, audit } = snapshot;
  return { user, strategies, vaults, account, details, audit };
}

test('an identity change from a loading subscriber cancels the superseded read before HTTP', async (t) => {
  const h = await setup(t);
  const aliceVault = structuredClone(h.store.get(h.a, 'alice'));
  const paths: string[] = [];
  h.hooks.after = async (path) => {
    paths.push(path);
  };
  let switched: Promise<void> | undefined;
  let armed = true;
  const unsubscribe = h.adapter.client.subscribe((snapshot) => {
    if (armed && snapshot.phase === 'LOADING') {
      armed = false;
      switched = h.adapter.client.selectIdentity('bob');
    }
  });
  t.after(unsubscribe);
  await h.adapter.client.refresh();
  assert.ok(switched);
  await switched;
  assert.equal(paths.filter((path) => path === '/session').length, 1);
  assert.equal(paths.filter((path) => path === '/v1/product-snapshot').length, 1);
  assert.equal(h.adapter.snapshot.user, 'bob');
  assert.equal(h.adapter.snapshot.account?.ownerId, 'bob');
  assert.equal(h.adapter.snapshot.phase, 'EMPTY');
  assert.deepEqual(h.adapter.snapshot.vaults, []);
  assert.throws(() => h.adapter.client.prepare(), /VAULT_REQUIRED/);
  assert.deepEqual(h.store.get(h.a, 'alice'), aliceVault);
});
async function setup(t: TestContext) {
  const h = await productHarness();
  t.after(() => h.app.close());
  let cookie = '';
  const values = new Map<string, string>();
  const hooks: {
    before?: (path: string, body?: unknown) => Promise<void>;
    after?: (path: string, value: Record<string, unknown>, body?: unknown) => Promise<void>;
  } = {};
  const request: ApiRequest = async <T>(path: string, body?: unknown) => {
    await hooks.before?.(path, body);
    const response = await h.request(cookie, `/api${path}`, body);
    if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const data = response.json();
    if (response.statusCode >= 400) throw new ApiError(data.error, response.statusCode);
    await hooks.after?.(path, data, body);
    return data as T;
  };
  const adapter = new ProductAdapter({
    request,
    storage: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        values.set(k, v);
      },
      removeItem: (k) => {
        values.delete(k);
      },
    },
  });
  await adapter.client.selectIdentity('alice');
  await adapter.client.claim('core-flow-demo');
  await adapter.client.claim('satellite-flow-demo');
  const a = adapter.snapshot.vaults.find((v) => v.strategyId === 'core-flow-demo')!.vaultId;
  const b = adapter.snapshot.vaults.find((v) => v.strategyId === 'satellite-flow-demo')!.vaultId;
  await adapter.client.selectVault(a);
  let sequence = 0;
  return {
    ...h,
    adapter,
    values,
    hooks,
    a,
    b,
    async deposit(vaultId: string, amount: string, id = `external-${++sequence}`) {
      const revision = h.store.get(vaultId, 'alice').revision;
      const result = await h.request(cookie, `/api/vaults/${vaultId}/commands`, {
        id,
        type: 'deposit',
        expectedRevision: revision,
        amount,
      });
      assert.equal(result.statusCode, 200, result.body);
    },
    hold(
      predicate: (path: string) => boolean,
      alter?: (value: Record<string, unknown>, path: string) => void,
    ) {
      const entered = deferred(),
        release = deferred();
      hooks.after = async (path, value) => {
        if (!predicate(path)) return;
        delete hooks.after;
        alter?.(value, path);
        entered.resolve();
        await release.promise;
      };
      t.after(() => release.resolve());
      return { entered: entered.promise, release: release.resolve };
    },
  };
}

for (const component of ['vault', 'account', 'details', 'audit', 'catalogue'] as const) {
  test(
    `PR11-P2/P9 delayed ${component} response cannot mutate the accepted adapter projection`,
    { timeout: 10000 },
    async (t) => {
      const h = await setup(t);
      await h.deposit(h.a, '1');
      await h.adapter.client.refresh();
      const match = (path: string) =>
        component === 'catalogue'
          ? path.startsWith('/v1/strategies?')
          : path === '/v1/product-snapshot' ||
            {
              vault: path === `/v1/vaults/${h.a}`,
              account: path === '/v1/account',
              details: path === '/v1/strategies/core-flow-demo',
              audit: path.startsWith(`/v1/vaults/${h.a}/audit`),
            }[component];
      const gate = h.hold(match, (data) => {
        if (component === 'catalogue') (data.items as { name: string }[])[0]!.name = 'Previous catalogue';
        if (component === 'details') {
          if (Array.isArray(data.details))
            (data.details as { description: string }[])[0]!.description = 'Previous details';
          else data.description = 'Previous details';
        }
        if (component === 'audit') {
          const rows = (data.audit ?? data.items) as { recordedAt: string }[];
          rows[0]!.recordedAt = '2000-01-01T00:00:00.000Z';
        }
      });
      const old = h.adapter.client.refresh();
      await gate.entered;
      await h.deposit(h.a, '8');
      await h.adapter.client.refresh();
      const accepted = projection(h.adapter.snapshot);
      gate.release();
      await old;
      assert.deepEqual(projection(h.adapter.snapshot), accepted);
      const selected = h.adapter.snapshot.vaults.find((v) => v.vaultId === h.a)!;
      assert.equal(h.adapter.client.prepare().expectedRevision, selected.revision);
    },
  );
}

test(
  'PR11-P2A delayed Alice session cannot detach or change accepted Bob projection',
  { timeout: 10000 },
  async (t) => {
    const h = await setup(t);
    const gate = h.hold((path) => path === '/session');
    const old = h.adapter.client.refresh();
    await gate.entered;
    await h.adapter.client.selectIdentity('bob');
    await h.adapter.client.claim('core-flow-demo');
    const bob = projection(h.adapter.snapshot);
    gate.release();
    await old;
    assert.deepEqual(projection(h.adapter.snapshot), bob);
    assert.equal(h.adapter.snapshot.account?.ownerId, 'bob');
  },
);

test(
  'PR11-P4/P9 delayed A audit cannot replace B event with the same command ID',
  { timeout: 10000 },
  async (t) => {
    const h = await setup(t);
    await h.deposit(h.a, '1', 'same');
    await h.deposit(h.b, '1', 'before');
    await h.deposit(h.b, '2', 'same');
    await h.adapter.client.refresh();
    const gate = h.hold(
      (path) => path === '/v1/product-snapshot' || path.startsWith(`/v1/vaults/${h.a}/audit`),
    );
    const old = h.adapter.client.refresh();
    await gate.entered;
    await h.adapter.client.selectVault(h.b);
    assert.equal(h.adapter.snapshot.audit.find((e) => e.commandId === 'same')?.revision, 2);
    gate.release();
    await old;
    assert.equal(h.adapter.snapshot.audit.find((e) => e.commandId === 'same')?.revision, 2);
    await h.adapter.client.selectVault(h.a);
    assert.equal(h.adapter.snapshot.audit.find((e) => e.commandId === 'same')?.revision, 1);
  },
);

test('PR11-P9 A to B to A ignores the first A response completing last', { timeout: 10000 }, async (t) => {
  const h = await setup(t);
  const gate = h.hold((path) => path === '/v1/product-snapshot' || path === `/v1/vaults/${h.a}`);
  const old = h.adapter.client.refresh();
  await gate.entered;
  await h.adapter.client.selectVault(h.b);
  await h.deposit(h.a, '10');
  await h.adapter.client.selectVault(h.a);
  const accepted = projection(h.adapter.snapshot);
  gate.release();
  await old;
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  assert.equal(
    h.adapter.client.prepare().expectedRevision,
    h.adapter.snapshot.vaults.find((v) => v.vaultId === h.a)!.revision,
  );
});

test('PR11-P7 equal revision identical state is idempotent; divergent state fails without pollution', async (t) => {
  const h = await setup(t);
  await h.adapter.client.refresh();
  const accepted = projection(h.adapter.snapshot);
  await h.adapter.client.refresh();
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  h.hooks.after = async (path, data) => {
    const value =
      path === '/v1/product-snapshot'
        ? (data.vaults as Record<string, unknown>[]).find((v) => v.vaultId === h.a)
        : path === `/v1/vaults/${h.a}`
          ? data
          : null;
    if (value) (value.balances as Record<string, unknown>).idle = '99';
  };
  await assert.rejects(h.adapter.client.refresh(), /RESPONSE_CONTEXT_MISMATCH/);
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  assert.throws(() => h.adapter.client.prepare(), /REFRESH_REQUIRED/);
});

test('PR11-P7 lower revision cannot replace newer accepted adapter state', async (t) => {
  const h = await setup(t);
  const old = structuredClone(h.adapter.snapshot.vaults.find((v) => v.vaultId === h.a)!);
  await h.deposit(h.a, '9');
  await h.adapter.client.refresh();
  const accepted = projection(h.adapter.snapshot);
  h.hooks.after = async (path, data) => {
    if (path === '/v1/product-snapshot') {
      const vaults = data.vaults as (typeof old)[];
      vaults[vaults.findIndex((v) => v.vaultId === h.a)] = old;
    } else if (path === `/v1/vaults/${h.a}`) Object.assign(data, old);
  };
  await assert.rejects(h.adapter.client.refresh(), /RESPONSE_CONTEXT_MISMATCH/);
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
});

test('PR11-P10 partial success followed by detail failure leaves the previous projection visibly stale', async (t) => {
  const h = await setup(t);
  const accepted = projection(h.adapter.snapshot);
  await h.deposit(h.b, '31');
  h.hooks.after = async (path, data) => {
    if (path === '/v1/product-snapshot')
      (data.details as { accountStrategy: { ownerId: string } }[])[0]!.accountStrategy.ownerId = 'bob';
    else if (path === '/v1/strategies/core-flow-demo') throw new ApiError('DETAIL_READ_FAILED', 500);
  };
  await assert.rejects(h.adapter.client.refresh());
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  assert.notEqual(h.adapter.snapshot.phase, 'READY');
  assert.throws(() => h.adapter.client.prepare(), /REFRESH_REQUIRED/);
});

test('PR11-P3/P9 concurrent external write never exposes mixed account and vault totals', async (t) => {
  const h = await setup(t);
  let wrote = false;
  h.hooks.after = async (path) => {
    if (!wrote && (path === '/v1/product-snapshot' || path.startsWith('/v1/vaults?'))) {
      wrote = true;
      await h.deposit(h.b, '29');
    }
  };
  await h.adapter.client.refresh();
  assert.equal(wrote, true);
  const value = h.adapter.snapshot;
  const total = value.vaults.reduce((sum, v) => sum + BigInt(String(v.balances.idle)), 0n).toString();
  assert.equal((value.account as unknown as { idle: string }).idle, total);
  await h.adapter.client.refresh();
  assert.equal((h.adapter.snapshot.account as unknown as { idle: string }).idle, '29');
});

for (const field of ['passes', 'equity', 'relation'] as const) {
  test(`PR11-P3 snapshot rejects divergent account ${field} before acceptance`, async (t) => {
    const h = await setup(t);
    const accepted = projection(h.adapter.snapshot);
    h.hooks.after = async (path, data) => {
      if (path !== '/v1/product-snapshot') return;
      const account = data.account as Record<string, unknown>;
      if (field === 'passes') account.passes = '999';
      if (field === 'equity') (account.balances as Record<string, unknown>).equity = '999';
      if (field === 'relation') (account.strategies as unknown[]).pop();
    };
    await assert.rejects(h.adapter.client.refresh(), /RESPONSE_CONTEXT_MISMATCH/);
    assert.deepEqual(projection(h.adapter.snapshot), accepted);
  });
}

test(
  'PR11-P2 discarded read cannot impose a late Retry-After on accepted Bob state',
  { timeout: 10000 },
  async (t) => {
    const h = await setup(t);
    const entered = deferred(),
      release = deferred();
    t.after(() => release.resolve());
    h.hooks.after = async (path) => {
      if (path !== '/session') return;
      delete h.hooks.after;
      entered.resolve();
      await release.promise;
      throw new ApiError('RATE_LIMITED', 429, '60');
    };
    const old = h.adapter.client.refresh();
    await entered.promise;
    await h.adapter.client.selectIdentity('bob');
    const bob = projection(h.adapter.snapshot);
    release.resolve();
    await old;
    assert.deepEqual(projection(h.adapter.snapshot), bob);
    assert.equal(h.adapter.retryAfterSeconds, 0);
  },
);

// Reject complete-looking but contradictory responses before committing any owner projection.
test('canonical snapshot corruption matrix preserves the last accepted account atomically', async (t) => {
  const h = await setup(t);
  await h.deposit(h.a, '10', 'boundary-deposit');
  await h.adapter.client.refresh();
  const accepted = projection(h.adapter.snapshot);
  const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [];
  const set = (path: string[], value: unknown) => (snapshot: Record<string, unknown>) => {
    let current = snapshot;
    for (const part of path.slice(0, -1)) current = current[part] as Record<string, unknown>;
    current[path.at(-1)!] = value;
  };
  for (const [path, value] of [
    [['vaults', '0', 'revision'], -1],
    [['vaults', '0', 'pendingOperations'], null],
    [
      ['vaults', '0', 'pendingOperations'],
      [{ operationId: 'p', kind: 'other', amount: '1', status: 'pending' }],
    ],
    [
      ['vaults', '0', 'pendingOperations'],
      [{ operationId: 'p', kind: 'order', amount: '1', status: 'done' }],
    ],
    [
      ['vaults', '0', 'pendingOperations'],
      [
        { operationId: 'p', kind: 'order', amount: '1', status: 'pending' },
        { operationId: 'p', kind: 'order', amount: '1', status: 'pending' },
      ],
    ],
    [['details'], []],
    [['details', '0', 'strategyId'], 'unregistered-strategy'],
    [['account', 'strategies', '0', 'status'], 'stopping'],
    [['account', 'passBalances', '0', 'total'], '999'],
    [['account', 'passBalances', '0', 'allowance'], '999'],
    [['account', 'status'], 'running'],
    [['account', 'identity', 'mode'], 'REAL'],
    [['account', 'passBalances'], null],
    [['account', 'vaults'], null],
  ] as Array<[string[], unknown]>)
    mutations.push([path.join('.'), set(path, value)]);
  mutations.push([
    'duplicate-vault',
    (value) => {
      const vaults = value.vaults as unknown[];
      vaults.push(structuredClone(vaults[0]));
    },
  ]);
  mutations.push([
    'duplicate-details',
    (value) => {
      const details = value.details as unknown[];
      details[1] = structuredClone(details[0]);
    },
  ]);
  mutations.push([
    'audit-rewrite',
    (value) => {
      const audit = value.audit as Record<string, unknown>[];
      assert.ok(audit.length > 0);
      audit[0]!.recordedAt = '2000-01-01T00:00:00.000Z';
    },
  ]);
  for (const [label, mutate] of mutations) {
    h.hooks.after = async (path, value) => {
      if (path === '/v1/product-snapshot') mutate(value);
    };
    await assert.rejects(h.adapter.client.refresh(), /RESPONSE|INVALID/, label);
    assert.deepEqual(projection(h.adapter.snapshot), accepted, label);
    delete h.hooks.after;
    await h.adapter.client.refresh();
    assert.equal(h.adapter.snapshot.phase, 'READY', label);
  }
});

test('catalogue malformed and duplicate entries never replace accepted strategies', async (t) => {
  const h = await setup(t);
  const accepted = projection(h.adapter.snapshot);
  for (const mutate of [
    (value: Record<string, unknown>) => {
      value.items = null;
    },
    (value: Record<string, unknown>) => {
      value.nextCursor = 42;
    },
    (value: Record<string, unknown>) => {
      value.items = [null];
    },
    (value: Record<string, unknown>) => {
      value.items = [{ strategyId: 42 }];
    },
    (value: Record<string, unknown>) => {
      (value.items as Record<string, unknown>[])[0]!.scope = 'MAINNET';
    },
    (value: Record<string, unknown>) => {
      const items = value.items as unknown[];
      items.push(structuredClone(items[0]));
    },
  ]) {
    h.hooks.after = async (path, value) => {
      if (path.startsWith('/v1/strategies?')) mutate(value);
    };
    await assert.rejects(h.adapter.client.refresh(), /RESPONSE|INVALID/);
    assert.deepEqual(projection(h.adapter.snapshot), accepted);
    delete h.hooks.after;
    await h.adapter.client.refresh();
  }
});

test('HTTP-date Retry-After survives reload, expires exactly, and ignores past or malformed dates', async () => {
  const start = Date.parse('2026-09-23T00:00:00Z');
  for (const header of [
    undefined,
    '',
    'not-a-date',
    new Date(start - 1000).toUTCString(),
    new Date(start + 2000).toUTCString(),
  ]) {
    let now = start;
    let calls = 0;
    const values = new Map<string, string>();
    const options = {
      now: () => now,
      request: async () => {
        calls++;
        throw new ApiError('RATE_LIMITED', 429, header);
      },
      storage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    };
    const adapter = new ProductAdapter(options);
    await assert.rejects(adapter.request('/session'), /RATE_LIMITED/);
    const future = header === new Date(start + 2000).toUTCString();
    assert.equal(adapter.retryAfterSeconds, future ? 2 : 0);
    const reloaded = new ProductAdapter(options);
    await assert.rejects(reloaded.request('/session'), /RATE_LIMITED/);
    assert.equal(calls, future ? 1 : 2, 'persisted future deadline prevents a second request');
    now += 2000;
    await assert.rejects(reloaded.request('/session'), /RATE_LIMITED/);
    assert.equal(calls, future ? 2 : 3, 'at expiry the original endpoint may be retried');
    assert.equal(reloaded.retryAfterSeconds, 0);
  }
});

test('malformed command receipt cannot claim success; exact original retry reconciles one real ledger mutation', async (t) => {
  const h = await setup(t);
  const before = projection(h.adapter.snapshot);
  const revision = h.store.get(h.a, 'alice').revision;
  h.hooks.after = async (path, value) => {
    if (path.endsWith('/commands')) value.replayed = 'false';
  };
  await assert.rejects(
    h.adapter.client.command('deposit', { amount: '7' }, h.adapter.client.prepare()),
    /INVALID/,
  );
  assert.deepEqual(projection(h.adapter.snapshot), before);
  assert.equal(h.store.get(h.a, 'alice').revision, revision + 1);
  assert.ok(h.adapter.snapshot.pending);
  const commandId = h.adapter.snapshot.pending.command.id;
  delete h.hooks.after;
  await h.adapter.client.retry();
  assert.equal(h.adapter.snapshot.phase, 'READY');
  assert.equal(h.adapter.snapshot.pending, null);
  assert.equal(h.store.get(h.a, 'alice').revision, revision + 1);
  assert.equal(h.adapter.snapshot.vaults.find((v) => v.vaultId === h.a)?.balances.idle, '7');
  assert.equal(h.adapter.snapshot.audit.filter((row) => row.commandId === commandId).length, 1);
});

test('invalid and mismatched identity selection clears private state without accepting another user', async (t) => {
  const h = await setup(t);
  const before = h.store.get(h.a, 'alice');
  await assert.rejects(h.adapter.client.selectIdentity('mallory' as never), /INVALID_IDENTITY/);
  assert.equal(h.adapter.client.snapshot.user, null);
  assert.equal(h.adapter.client.snapshot.vaults.length, 0);
  await h.adapter.client.selectIdentity('alice');
  h.hooks.after = async (path, data) => {
    if (path === '/demo/session') data.user = 'alice';
  };
  await assert.rejects(h.adapter.client.selectIdentity('bob'), /RESPONSE_CONTEXT_MISMATCH/);
  assert.equal(h.adapter.client.snapshot.user, null);
  assert.equal(h.adapter.client.snapshot.vaults.length, 0);
  assert.equal(h.adapter.snapshot.user, null);
  assert.deepEqual(h.store.get(h.a, 'alice'), before);
  delete h.hooks.after;
  await h.adapter.client.selectIdentity('bob');
  assert.equal(h.adapter.client.snapshot.user, 'bob');
  assert.equal(h.adapter.client.snapshot.vaults.length, 0);
});

for (const regression of ['lower-revision', 'same-revision-new-balances'] as const) {
  test(`a coherent ${regression} account cannot replace the last accepted projection`, async (t) => {
    const h = await setup(t);
    let previous: Record<string, unknown> | undefined;
    h.hooks.after = async (path, data) => {
      if (path === '/v1/product-snapshot') previous = structuredClone(data);
    };
    await h.adapter.client.refresh();
    delete h.hooks.after;
    assert.ok(previous);
    await h.deposit(h.a, '9');
    if (regression === 'lower-revision') await h.adapter.client.refresh();
    const accepted = projection(h.adapter.snapshot);
    h.hooks.after = async (path, data) => {
      if (path !== '/v1/product-snapshot') return;
      if (regression === 'lower-revision') {
        Object.assign(data, structuredClone(previous));
        return;
      }
      const revisions = previous!.revisions as Record<string, number>;
      const restoreRevision = (vaults: unknown) => {
        for (const value of vaults as { vaultId: string; revision: number }[])
          value.revision = revisions[value.vaultId]!;
      };
      restoreRevision(data.vaults);
      restoreRevision((data.account as { vaults: unknown }).vaults);
      data.revisions = structuredClone(revisions);
      data.audit = structuredClone(previous!.audit);
    };
    await assert.rejects(h.adapter.client.refresh(), /RESPONSE_CONTEXT_MISMATCH/);
    assert.deepEqual(projection(h.adapter.snapshot), accepted);
    assert.throws(() => h.adapter.client.prepare(), /REFRESH_REQUIRED/);
  });
}

test('public adapter refresh is session-first and read-only; unknown Vault selection cannot alter projection', async (t) => {
  const h = await setup(t);
  const calls: Array<{ path: string; body: unknown }> = [];
  h.hooks.after = async (path, _value, body) => {
    calls.push({ path, body });
  };
  await h.adapter.client.refresh();
  assert.equal(calls[0]?.path, '/session');
  assert.ok(calls.some(({ path }) => path === '/v1/product-snapshot'));
  assert.ok(calls.every(({ body }) => body === undefined));
  const accepted = projection(h.adapter.snapshot);
  calls.length = 0;
  await assert.rejects(h.adapter.client.selectVault('unregistered-vault'), /VAULT_NOT_FOUND/);
  assert.deepEqual(calls, []);
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  assert.equal(h.adapter.client.prepare().vaultId, h.a);
});

test('a late definitive rejection keeps Alice pending while an in-flight identity switch is refused', async (t) => {
  const h = await setup(t);
  const client = h.adapter.client;
  const pendingKey = 'quantpass.local.pending-command.v1';
  const review = client.prepare();
  await h.deposit(review.vaultId, '1', 'external-race');
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  let commandPosts = 0;
  h.hooks.before = async (path) => {
    if (!path.endsWith('/commands')) return;
    commandPosts++;
    entered.resolve();
    await release.promise;
  };
  const pending = client.command('deposit', { amount: '2' }, review);
  await entered.promise;
  await assert.rejects(client.selectIdentity('bob'), /BUSY/);
  await assert.rejects(client.refresh(), /BUSY/);
  await assert.rejects(client.selectVault(h.b), /BUSY/);
  assert.equal(client.snapshot.user, 'alice');
  assert.equal(client.snapshot.pending?.owner, 'alice');
  release.resolve();
  await assert.rejects(pending, /REVISION_CONFLICT/);
  assert.equal(commandPosts, 1);
  const durable = h.values.get(pendingKey);
  assert.ok(durable);
  assert.deepEqual(JSON.parse(durable).rejection, { code: 'REVISION_CONFLICT', status: 409 });
  assert.equal(client.snapshot.pending?.owner, 'alice');
  await client.selectIdentity('bob');
  assert.equal(client.snapshot.user, 'bob');
  assert.equal(client.snapshot.pending, null);
  assert.deepEqual(client.snapshot.vaults, []);
  assert.equal(h.values.get(pendingKey), durable);
  await assert.rejects(client.retry(), /PENDING_OWNER_MISMATCH/);
  await client.selectIdentity('alice');
  const restored = h.adapter.snapshot;
  assert.equal(restored.pending?.owner, 'alice');
  await assert.rejects(client.retry(), /REVIEW_REQUIRED/);
  await client.dismissRejected();
  assert.equal(h.values.has(pendingKey), false);
  assert.equal(h.store.get(review.vaultId, 'alice').idle, '1');
  assert.equal(h.store.audit('alice', review.vaultId).length, 1);
});

test('canonical Pass rows outside the catalogue cannot replace an accepted account projection', async (t) => {
  const h = await setup(t);
  const accepted = projection(h.adapter.snapshot);
  const beforeVault = structuredClone(h.store.get(h.a, 'alice'));
  h.hooks.after = async (path, value) => {
    if (path !== '/v1/product-snapshot') return;
    const account = value.account as { passBalances: Array<Record<string, unknown>> };
    account.passBalances[0] = {
      strategyId: 'unknown-strategy',
      total: '0',
      allowance: '0',
    };
  };
  await assert.rejects(h.adapter.client.refresh(), /RESPONSE_CONTEXT_MISMATCH/);
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  assert.deepEqual(h.store.get(h.a, 'alice'), beforeVault);
  assert.throws(() => h.adapter.client.prepare(), /REFRESH_REQUIRED/);
  delete h.hooks.after;
  await h.adapter.client.refresh();
  assert.deepEqual(projection(h.adapter.snapshot), accepted);
  assert.equal(h.adapter.client.prepare().vaultId, h.a);
});

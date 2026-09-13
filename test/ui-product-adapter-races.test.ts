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
async function setup(t: TestContext) {
  const h = await productHarness();
  t.after(() => h.app.close());
  let cookie = '';
  const values = new Map<string, string>();
  const hooks: { after?: (path: string, value: Record<string, unknown>) => Promise<void> } = {};
  const request: ApiRequest = async <T>(path: string, body?: unknown) => {
    const response = await h.request(cookie, `/api${path}`, body);
    if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const data = response.json();
    if (response.statusCode >= 400) throw new ApiError(data.error, response.statusCode);
    await hooks.after?.(path, data);
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

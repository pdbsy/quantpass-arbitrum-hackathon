import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductAdapter, fromCanonicalVault, fromLegacyVault } from '../apps/web/src/product-adapter.ts';
import { ApiError } from '../apps/web/src/api.ts';
import type { ApiRequest } from '../apps/web/src/product-client.ts';
// Actual public f66faa1 PENDING fixture; legacy aliases removed to verify canonical-only consumption.
const fixture = {
  strategySummary: {
    schemaVersion: 1,
    strategyId: 'core-flow-demo',
    name: '核心资金流程样例',
    description: '验证 SaaS 额度与独立余额，不运行真实量化交易。',
    scope: 'TEST_ONLY',
    testPasses: '1000',
    catalogVersion: '1',
    asset: {
      assetId: 'TEST_ONLY_USDT_UNIT',
      decimals: 6,
    },
  },
  strategyDetail: {
    schemaVersion: 1,
    strategyId: 'core-flow-demo',
    name: '核心资金流程样例',
    description: '验证 SaaS 额度与独立余额，不运行真实量化交易。',
    scope: 'TEST_ONLY',
    testPasses: '1000',
    catalogVersion: '1',
    asset: {
      assetId: 'TEST_ONLY_USDT_UNIT',
      decimals: 6,
    },
    capabilities: {
      execution: 'LOCAL_SIMULATION',
      claim: 'TEST_PASSES_ONLY',
      arbitraryStrategies: false,
      realFunds: false,
    },
    accountStrategy: {
      ownerId: 'alice',
      strategyId: 'core-flow-demo',
      vaultId: 'vault_alice_core_flow_demo',
      status: 'stopping',
    },
  },
  accountSummary: {
    schemaVersion: 1,
    ownerId: 'alice',
    strategies: [
      {
        ownerId: 'alice',
        strategyId: 'core-flow-demo',
        vaultId: 'vault_alice_core_flow_demo',
        status: 'stopping',
      },
      {
        ownerId: 'alice',
        strategyId: 'satellite-flow-demo',
        vaultId: null,
        status: 'not_started',
      },
    ],
    passBalances: [
      {
        strategyId: 'core-flow-demo',
        total: '1000',
        allowance: '1000000000',
      },
      {
        strategyId: 'satellite-flow-demo',
        total: '0',
        allowance: '0',
      },
    ],
    scope: 'TEST_ONLY',
    identity: {
      id: 'alice',
      mode: 'DEMO',
    },
    asset: {
      assetId: 'TEST_ONLY_USDT_UNIT',
      decimals: 6,
    },
    passes: '1000',
    vaultCount: 1,
    status: 'stopping',
    idle: '0',
    balances: {
      reserved: '200000000',
      pending: '500000000',
      unrealized: '0',
      activeGross: '1000000000',
      activeNet: '1000000000',
      equity: '1500000000',
      allowance: '1000000000',
    },
    vaults: [
      {
        schemaVersion: 1,
        scope: 'TEST_ONLY',
        vaultId: 'vault_alice_core_flow_demo',
        asset: {
          assetId: 'TEST_ONLY_USDT_UNIT',
          decimals: 6,
        },
        passBalance: {
          strategyId: 'core-flow-demo',
          total: '1000',
          allowance: '1000000000',
        },
        id: 'vault_alice_core_flow_demo',
        ownerId: 'alice',
        strategyId: 'core-flow-demo',
        passes: '1000',
        status: 'stopping',
        revision: 6,
        idle: '0',
        activeCash: '800000000',
        positionCost: '0',
        positionValue: '0',
        feeLiability: '0',
        withdrawalsPaid: '0',
        orders: {
          buy: '200000000',
        },
        pendingWithdrawals: {
          withdraw: '500000000',
        },
        pendingOperations: [
          {
            operationId: 'withdraw',
            kind: 'withdrawal',
            status: 'pending',
            amount: '500000000',
          },
          {
            operationId: 'buy',
            kind: 'order',
            status: 'pending',
            amount: '200000000',
          },
        ],
        balances: {
          asset: {
            assetId: 'TEST_ONLY_USDT_UNIT',
            decimals: 6,
          },
          idle: '0',
          activeCash: '800000000',
          positionCost: '0',
          positionValue: '0',
          feeLiability: '0',
          deposits: '1500000000',
          withdrawalsPaid: '0',
          realizedPnl: '0',
          feesAccrued: '0',
          feesPaid: '0',
          reserved: '200000000',
          pending: '500000000',
          unrealized: '0',
          activeGross: '1000000000',
          activeNet: '1000000000',
          equity: '1500000000',
          allowance: '1000000000',
        },
      },
    ],
    pagination: {
      limit: 50,
      nextCursor: null,
    },
  },
  vault: {
    schemaVersion: 1,
    scope: 'TEST_ONLY',
    vaultId: 'vault_alice_core_flow_demo',
    asset: {
      assetId: 'TEST_ONLY_USDT_UNIT',
      decimals: 6,
    },
    passBalance: {
      strategyId: 'core-flow-demo',
      total: '1000',
      allowance: '1000000000',
    },
    ownerId: 'alice',
    strategyId: 'core-flow-demo',
    status: 'stopping',
    revision: 6,
    pendingOperations: [
      {
        operationId: 'withdraw',
        kind: 'withdrawal',
        status: 'pending',
        amount: '500000000',
      },
      {
        operationId: 'buy',
        kind: 'order',
        status: 'pending',
        amount: '200000000',
      },
    ],
    balances: {
      asset: {
        assetId: 'TEST_ONLY_USDT_UNIT',
        decimals: 6,
      },
      idle: '0',
      activeCash: '800000000',
      positionCost: '0',
      positionValue: '0',
      feeLiability: '0',
      deposits: '1500000000',
      withdrawalsPaid: '0',
      realizedPnl: '0',
      feesAccrued: '0',
      feesPaid: '0',
      reserved: '200000000',
      pending: '500000000',
      unrealized: '0',
      activeGross: '1000000000',
      activeNet: '1000000000',
      equity: '1500000000',
      allowance: '1000000000',
    },
  },
  pendingOperation: {
    operationId: 'withdraw',
    kind: 'withdrawal',
    status: 'pending',
    amount: '500000000',
  },
  error: null,
} as const;
const storage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
};
test('canonical vault maps authentic fields and pending records without aliases', () => {
  const mapped = fromCanonicalVault(fixture.vault, 'alice');
  assert.equal(mapped.id, fixture.vault.vaultId);
  assert.equal(mapped.passes, '1000');
  assert.deepEqual(mapped.orders, { buy: '200000000' });
  assert.equal(mapped.idle, '0');
  assert.throws(() => fromCanonicalVault(fixture.vault, 'bob'), /CONTEXT/);
  assert.throws(
    () => fromCanonicalVault({ ...fixture.vault, balances: { ...fixture.vault.balances, idle: 1 } }, 'alice'),
    /RESPONSE/,
  );
});
test('legacy missing financial fields remain unavailable', () => {
  const old = fromCanonicalVault(fixture.vault, 'alice');
  const mapped = fromLegacyVault(old);
  assert.equal(mapped.balances.deposits, undefined);
  assert.equal(mapped.balances.idle, '0');
  assert.equal(mapped.vaultId, old.id);
});
test('gateway consumes opaque pages and account/detail without legacy aliases', async () => {
  const seen: string[] = [];
  const request: ApiRequest = async <T>(path: string) => {
    seen.push(path);
    let result: unknown;
    if (path === '/session') result = { user: 'alice' };
    else if (path === '/v1/strategies?limit=100')
      result = { items: [fixture.strategySummary], nextCursor: 'opaque +/?' };
    else if (path === '/v1/strategies?limit=100&cursor=opaque%20%2B%2F%3F')
      result = { items: [], nextCursor: null };
    else if (path === '/v1/account') result = fixture.accountSummary;
    else if (path === '/v1/strategies/core-flow-demo') result = fixture.strategyDetail;
    else if (path === '/v1/vaults?limit=100') result = { items: [fixture.vault], nextCursor: null };
    else if (path === '/v1/vaults/' + fixture.vault.vaultId) result = fixture.vault;
    else if (path.endsWith('/audit?limit=100')) result = { items: [], nextCursor: null };
    else throw Error(path);
    return result as T;
  };
  const adapter = new ProductAdapter({ request, storage: storage() });
  await adapter.client.refresh();
  assert.equal(adapter.mode, 'v1');
  assert.equal(adapter.snapshot.vaults[0]?.balances.deposits, '1500000000');
  assert.equal(adapter.snapshot.account?.ownerId, 'alice');
  assert.equal(adapter.snapshot.details[0]?.capabilities?.execution, 'LOCAL_SIMULATION');
  assert.ok(seen.includes('/v1/strategies?limit=100&cursor=opaque%20%2B%2F%3F'));
});
test('only initial 404 permits legacy fallback; malformed pages and server/auth errors do not', async () => {
  for (const error of [new ApiError('SESSION_REQUIRED', 401), new ApiError('FAILED', 500)]) {
    const seen: string[] = [];
    const adapter = new ProductAdapter({
      storage: storage(),
      request: async <T>(path: string) => {
        seen.push(path);
        if (path === '/session') return { user: 'alice' } as T;
        throw error;
      },
    });
    await assert.rejects(adapter.client.refresh());
    assert.ok(!seen.includes('/strategies'));
  }
  const vault = fromCanonicalVault(fixture.vault, 'alice');
  const adapter = new ProductAdapter({
    storage: storage(),
    request: async <T>(path: string) => {
      if (path === '/session') return { user: 'alice' } as T;
      if (path.startsWith('/v1/')) throw new ApiError('NOT_FOUND', 404);
      if (path === '/strategies')
        return [
          {
            id: 'core-flow-demo',
            name: 'Demo',
            description: 'Local',
            scope: 'TEST_ONLY',
            testPasses: '1000',
          },
        ] as T;
      if (path === '/vaults') return [vault] as T;
      if (path.endsWith('/audit')) return [] as T;
      return vault as T;
    },
  });
  await adapter.client.refresh();
  assert.equal(adapter.mode, 'legacy');
  assert.equal(adapter.snapshot.vaults[0]?.balances.deposits, undefined);
});
test('cursor cycles fail closed', async () => {
  const adapter = new ProductAdapter({
    storage: storage(),
    request: async <T>(path: string) => {
      if (path === '/session') return { user: 'alice' } as T;
      return { items: [], nextCursor: 'cycle' } as T;
    },
  });
  await assert.rejects(adapter.client.refresh(), /PAGINATION/);
});
test('Retry-After blocks manual command retry until injected clock allows unchanged envelope', async () => {
  let now = 1000;
  let posts = 0;
  const adapter = new ProductAdapter({
    storage: storage(),
    now: () => now,
    request: async () => {
      posts++;
      throw new ApiError('RATE_LIMITED', 429, '60');
    },
  });
  const envelope = { id: 'same', expectedRevision: 0, type: 'deposit', amount: '7' };
  await assert.rejects(adapter.request('/vaults/example/commands', envelope));
  await assert.rejects(adapter.request('/vaults/example/commands', envelope), /RATE_LIMITED/);
  assert.equal(posts, 1);
  now += 60000;
  await assert.rejects(adapter.request('/vaults/example/commands', envelope));
  assert.equal(posts, 2);
});
test('404 after the initial canonical page never downgrades to legacy', async () => {
  const seen: string[] = [];
  const adapter = new ProductAdapter({
    storage: storage(),
    request: async <T>(path: string) => {
      seen.push(path);
      if (path === '/session') return { user: 'alice' } as T;
      if (path === '/v1/strategies?limit=100') return { items: [], nextCursor: 'second' } as T;
      throw new ApiError('NOT_FOUND', 404);
    },
  });
  await assert.rejects(adapter.client.refresh());
  assert.ok(!seen.includes('/strategies'));
  assert.notEqual(adapter.mode, 'legacy');
});
test('Retry-After survives a new adapter without changing durable command data', async () => {
  let now = 1000;
  let calls = 0;
  const saved = storage();
  const pending = 'original reviewed envelope';
  saved.setItem('quantpass.local.pending-command.v1', pending);
  const transport: ApiRequest = async () => {
    calls++;
    throw new ApiError('RATE_LIMITED', 429, '60');
  };
  const a = new ProductAdapter({ storage: saved, request: transport, now: () => now });
  await assert.rejects(a.request('/session'));
  const b = new ProductAdapter({ storage: saved, request: transport, now: () => now });
  await assert.rejects(b.request('/session'));
  assert.equal(calls, 1);
  assert.equal(saved.getItem('quantpass.local.pending-command.v1'), pending);
  now += 60000;
  await assert.rejects(b.request('/session'));
  assert.equal(calls, 2);
});
test('canonical balances reject negative cash and noncanonical signed money', () => {
  assert.throws(
    () =>
      fromCanonicalVault({ ...fixture.vault, balances: { ...fixture.vault.balances, idle: '-1' } }, 'alice'),
    /RESPONSE/,
  );
  assert.throws(
    () =>
      fromCanonicalVault(
        { ...fixture.vault, balances: { ...fixture.vault.balances, realizedPnl: '-0' } },
        'alice',
      ),
    /RESPONSE/,
  );
});
test('owned audit accepts actual simulator actor only for executor commands', async () => {
  let actor = 'local-simulator';
  let type = 'reserveBuy';
  const adapter = new ProductAdapter({
    storage: storage(),
    request: async <T>(path: string) => {
      if (path === '/session') return { user: 'alice' } as T;
      if (path.startsWith('/v1/strategies?'))
        return { items: [fixture.strategySummary], nextCursor: null } as T;
      if (path === '/v1/account') return fixture.accountSummary as T;
      if (path === '/v1/strategies/core-flow-demo') return fixture.strategyDetail as T;
      if (path.startsWith('/v1/vaults?')) return { items: [fixture.vault], nextCursor: null } as T;
      if (path.endsWith('/audit?limit=100'))
        return {
          items: [
            {
              commandId: 'reserve1',
              commandType: type,
              actorId: actor,
              revision: 6,
              recordedAt: '2026-09-12T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        } as T;
      return fixture.vault as T;
    },
  });
  await adapter.client.refresh();
  assert.equal(adapter.snapshot.audit[0]?.actorId, 'local-simulator');
  actor = 'bob';
  await assert.rejects(adapter.client.refresh(), /CONTEXT/);
  actor = 'local-simulator';
  type = 'deposit';
  await assert.rejects(adapter.client.refresh(), /CONTEXT/);
});
for (const failure of ['unreadable', 'malformed'] as const) {
  test(`cooldown ${failure} startup publishes DISCONNECTED, preserves pending and recovers on refresh`, async () => {
    const saved = storage();
    const retryKey = 'quantpass.local.retry-after.v1';
    const pendingKey = 'quantpass.local.pending-command.v1';
    const pending = JSON.stringify({
      owner: 'alice',
      vaultId: fixture.vault.vaultId,
      command: { id: 'retained-deposit', expectedRevision: 6, type: 'deposit', amount: '7000000' },
    });
    saved.setItem(pendingKey, pending);
    if (failure === 'malformed') saved.setItem(retryKey, 'not-a-deadline');
    let unreadable = failure === 'unreadable';
    const guarded = {
      ...saved,
      getItem: (key: string) => {
        if (key === retryKey && unreadable) throw new Error('storage denied');
        return saved.getItem(key);
      },
    };
    const paths: string[] = [];
    const adapter = new ProductAdapter({
      storage: guarded,
      request: async <T>(path: string) => {
        paths.push(path);
        if (path === '/session') return { user: 'alice' } as T;
        if (path.startsWith('/v1/')) throw new ApiError('NOT_FOUND', 404);
        if (path === '/strategies')
          return [{ ...fixture.strategySummary, id: fixture.strategySummary.strategyId }] as T;
        if (path === '/vaults') return [fromCanonicalVault(fixture.vault, 'alice')] as T;
        if (path.endsWith('/audit')) return [] as T;
        return fromCanonicalVault(fixture.vault, 'alice') as T;
      },
    });
    const phases: string[] = [];
    adapter.client.subscribe((snapshot) => phases.push(snapshot.phase));
    await assert.rejects(adapter.client.refresh(), /RETRY_AFTER_STORAGE/);
    assert.equal(adapter.snapshot.phase, 'DISCONNECTED');
    assert.ok(phases.includes('DISCONNECTED'));
    assert.match(adapter.snapshot.error ?? '', /RETRY_AFTER_STORAGE/);
    assert.throws(() => adapter.client.prepare());
    await assert.rejects(
      adapter.request('/vaults/example/commands', { type: 'deposit' }),
      /RETRY_AFTER_STORAGE/,
    );
    assert.equal(paths.length, 0);
    assert.equal(saved.getItem(pendingKey), pending);
    unreadable = false;
    saved.setItem(retryKey, '0');
    await adapter.client.refresh();
    assert.equal(adapter.snapshot.phase, 'PENDING');
    assert.equal(adapter.snapshot.pending?.command.id, 'retained-deposit');
    assert.equal(saved.getItem(pendingKey), pending);
    assert.ok(!paths.some((path) => path.endsWith('/commands')));
  });
}

test('contract-minimum vault accepts balances.asset without a top-level alias', () => {
  const minimal = structuredClone(fixture.vault);
  Reflect.deleteProperty(minimal, 'asset');
  const mapped = fromCanonicalVault(minimal, 'alice');
  assert.equal(mapped.id, minimal.vaultId);
  assert.equal(mapped.idle, minimal.balances.idle);
  assert.throws(
    () =>
      fromCanonicalVault(
        {
          ...minimal,
          balances: { ...minimal.balances, asset: { assetId: 'TEST_ONLY_USDT_UNIT', decimals: 18 } },
        },
        'alice',
      ),
    /RESPONSE/,
  );
});

test('contract-minimum detail accepts a null relation and still rejects a foreign relation', async () => {
  let relation: unknown = null;
  const adapter = new ProductAdapter({
    storage: storage(),
    request: async <T>(path: string) => {
      if (path === '/session') return { user: 'alice' } as T;
      if (path.startsWith('/v1/strategies?'))
        return { items: [fixture.strategySummary], nextCursor: null } as T;
      if (path === '/v1/account') return { ownerId: 'alice', strategies: [], passBalances: [] } as T;
      if (path === '/v1/strategies/core-flow-demo')
        return { ...fixture.strategyDetail, accountStrategy: relation } as T;
      if (path.startsWith('/v1/vaults?')) return { items: [], nextCursor: null } as T;
      throw Error('UNEXPECTED_REQUEST');
    },
  });
  await adapter.client.refresh();
  assert.equal(adapter.snapshot.phase, 'EMPTY');
  assert.equal(adapter.snapshot.details[0]?.accountStrategy, null);
  relation = { ...fixture.strategyDetail.accountStrategy, ownerId: 'bob' };
  await assert.rejects(adapter.client.refresh(), /CONTEXT/);
});

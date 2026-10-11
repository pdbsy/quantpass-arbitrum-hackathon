import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLaunchMarketServer } from '../apps/server/src/launch-market/server.ts';
import { LaunchMarketService } from '../packages/launch-market/src/service.ts';
import { LaunchMarketStore } from '../packages/launch-market/src/store.ts';
import type { EthReference, EthReferenceProvider } from '../packages/launch-market/src/chain.ts';

function fixture(provider: EthReferenceProvider | null, signerConfigured = true) {
  const store = new LaunchMarketStore(':memory:', 'https://www.ikol.top'),
    clock = { now: 1000 },
    calls = { sign: 0, signerAddress: 0 };
  const signer = {
    async getAddress() {
      calls.signerAddress++;
      throw new Error('Public price read must not use a signer');
    },
    async signTypedData() {
      calls.sign++;
      throw new Error('Public price read must not sign');
    },
  };
  const service = new LaunchMarketService({
    manifest: null,
    chain: null,
    store,
    ethReference: provider,
    quoteSigner: signerConfigured ? signer : null,
    claimSigner: signerConfigured ? signer : null,
    now: () => clock.now,
  });
  const unchanged = () => {
    assert.deepEqual(calls, { sign: 0, signerAddress: 0 });
    for (const table of [
      'market_accounts',
      'market_quotes',
      'market_operations',
      'market_claim_vouchers',
      'market_wallet_challenges',
      'market_wallet_test_challenges',
      'market_wallet_test_sessions',
      'market_snapshots',
    ])
      assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count, 0, table);
    assert.equal(store.db.prepare('SELECT version FROM market_projection_version').get()!.version, 0);
  };
  return { service, clock, store, unchanged };
}

test('public ETH reference preserves the raw price and expires 30 seconds after its observation', async () => {
  const f = fixture({ read: async () => ({ ethUsdPriceRaw: '900719925474099312345', observedAt: 970 }) });
  try {
    assert.deepEqual(await f.service.ethReference(), {
      ethUsdPriceRaw: '900719925474099312345',
      observedAt: 970,
      validUntil: 1000,
    });
    f.clock.now = 1001;
    await assert.rejects(f.service.ethReference(), { code: 'ETH_REFERENCE_STALE', statusCode: 503 });
    f.unchanged();
  } finally {
    f.service.close();
  }
});

test('public ETH reference rejects future, stale and malformed provider values without writes', async () => {
  let value: unknown;
  const f = fixture({ read: async () => value as EthReference });
  try {
    for (const observedAt of [1001, 969]) {
      value = { ethUsdPriceRaw: '2000000000', observedAt };
      await assert.rejects(f.service.ethReference(), { code: 'ETH_REFERENCE_STALE', statusCode: 503 });
    }
    for (const ethUsdPriceRaw of [
      '0',
      '02000000000',
      '-1',
      '1.5',
      '0x1',
      String(2n ** 256n),
      2_000_000_000,
    ]) {
      value = { ethUsdPriceRaw, observedAt: 1000 };
      await assert.rejects(f.service.ethReference(), { code: 'ETH_REFERENCE_INVALID', statusCode: 503 });
    }
    for (const observedAt of [-1, 999.5, NaN, Infinity, '1000', 1000n, null, {}, Number.MAX_SAFE_INTEGER]) {
      value = { ethUsdPriceRaw: '2000000000', observedAt };
      await assert.rejects(f.service.ethReference(), { code: 'ETH_REFERENCE_INVALID', statusCode: 503 });
    }
    for (value of [null, {}, { observedAt: 1000 }])
      await assert.rejects(f.service.ethReference(), { code: 'ETH_REFERENCE_INVALID', statusCode: 503 });
    f.unchanged();
  } finally {
    f.service.close();
  }
});

test('public ETH reference freshness is measured after the provider resolves', async () => {
  let resolve!: (value: EthReference) => void;
  const f = fixture({
    read: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  try {
    const pending = f.service.ethReference();
    f.clock.now = 1031;
    resolve({ ethUsdPriceRaw: '2000000000', observedAt: 1000 });
    await assert.rejects(pending, { code: 'ETH_REFERENCE_STALE', statusCode: 503 });
    f.unchanged();
  } finally {
    f.service.close();
  }
});

test('anonymous ETH reference API remains read-only and quote POST still requires authentication', async () => {
  let value: unknown = { ethUsdPriceRaw: '2000000000', observedAt: 1000 },
    reads = 0,
    identityReads = 0;
  const f = fixture({
    async read() {
      reads++;
      if (value instanceof Error) throw value;
      return value as EthReference;
    },
  });
  const server = await buildLaunchMarketServer({
    service: f.service,
    origin: f.store.origin,
    trustedIdentity: () => {
      identityReads++;
      return null;
    },
  });
  const headers = { host: 'www.ikol.top' };
  try {
    const response = await server.app.inject({ url: '/api/launch-market/eth-reference', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { ethUsdPriceRaw: '2000000000', observedAt: 1000, validUntil: 1030 });
    assert.equal(identityReads, 0);
    for (const [next, code] of [
      [{ ethUsdPriceRaw: '2000000000', observedAt: 969 }, 'ETH_REFERENCE_STALE'],
      [{ ethUsdPriceRaw: '2000000000', observedAt: 1001 }, 'ETH_REFERENCE_STALE'],
      [{ ethUsdPriceRaw: '0', observedAt: 1000 }, 'ETH_REFERENCE_INVALID'],
      [new Error('isolated provider failure'), 'ETH_REFERENCE_UNAVAILABLE'],
    ] as const) {
      value = next;
      const unavailable = await server.app.inject({ url: '/api/launch-market/eth-reference', headers });
      assert.equal(unavailable.statusCode, 503);
      assert.equal(unavailable.json().error.code, code);
    }
    const wrongHost = await server.app.inject({
      url: '/api/launch-market/eth-reference',
      headers: { host: 'attacker.example' },
    });
    assert.equal(wrongHost.statusCode, 403);
    assert.equal(reads, 5);
    assert.equal(identityReads, 0);
    const unauthorized = await server.app.inject({
      method: 'POST',
      url: '/api/launch-market/quote',
      headers: { ...headers, origin: f.store.origin },
      payload: {
        owner: '0x1111111111111111111111111111111111111111',
        strategyId: 'TSLA',
        operation: 'MINT',
        asset: 'ETH',
        amountRaw: '50000000000000000000',
        slippageBps: 100,
      },
    });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, 'VERIFIED_EMAIL_REQUIRED');
    assert.equal(reads, 5);
    f.unchanged();
  } finally {
    await server.stop();
  }
});

test('unconfigured ETH reference returns unavailable even with no deployment or signer', async () => {
  const f = fixture(null, false),
    service = f.service;
  const server = await buildLaunchMarketServer({
    service,
    origin: f.store.origin,
    trustedIdentity: () => null,
  });
  try {
    await assert.rejects(service.ethReference(), { code: 'ETH_REFERENCE_NOT_CONFIGURED', statusCode: 503 });
    const response = await server.app.inject({
      url: '/api/launch-market/eth-reference',
      headers: { host: 'www.ikol.top' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'ETH_REFERENCE_NOT_CONFIGURED');
    f.unchanged();
  } finally {
    await server.stop();
  }
});

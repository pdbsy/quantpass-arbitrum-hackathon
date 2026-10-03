import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';
import { TradingChainRuntime } from '../apps/server/src/trading-chain-runtime.ts';
import { buildPublicTestnetApp } from '../apps/server/src/testnet-app.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
const origin = 'https://test.example',
  headers = { host: 'test.example', origin, 'x-forwarded-proto': 'https', 'x-alphaforge-client': '1' };
test('public routes isolate owners and cannot turn arbitrary calldata, funds, or executor requests into a wallet operation', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-routes-')),
    f = tradingRpcFixture(),
    auth = new WalletAuthStore(':memory:', origin, {
      challengeTtlMs: 60000,
      sessionTtlMs: 60000,
      maxRows: 10,
    });
  const runtime = new TradingChainRuntime({
    dbPath: join(folder, 'chain.sqlite'),
    evidencePath: join(folder, 'evidence.sqlite'),
    manifest: f.manifest,
    inventory: f.inventory,
    rpc: f.client,
  });
  const app = await buildPublicTestnetApp({ origin, auth, runtimes: [{ id: 'alice-vault', runtime }] });
  try {
    for (const user of [address(1), address(99)]) {
      const session = auth.createSession(user, Date.now()),
        authenticated = { ...headers, cookie: '__Host-af_testnet=' + session.token };
      const view = await app.inject({ url: '/api/testnet/vaults', headers: authenticated });
      assert.equal(view.statusCode, 200);
      assert.equal(view.json().owner, user);
      assert.equal(view.json().vaults.length, user === address(1) ? 1 : 0);
      const response = await app.inject({
        method: 'POST',
        url: '/api/testnet/vaults/alice-vault/prepare',
        headers: authenticated,
        payload: { action: { kind: 'DEPOSIT', amountUsdc: '1' } },
      });
      assert.equal(response.statusCode, user === address(1) ? 500 : 404);
      assert.doesNotMatch(response.body, /\.sqlite|fixture\.invalid|stack/);
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/testnet/vaults/alice-vault/observe',
            headers: authenticated,
            payload: { operationId: 'unowned', transactionHash: '0x' + 'ab'.repeat(32) },
          })
        ).statusCode,
        user === address(1) ? 500 : 404,
      );
    }
    assert.equal((await app.inject({ url: '/api/testnet/vaults', headers })).statusCode, 401);
    const session = auth.createSession(address(1), Date.now()),
      authenticated = { ...headers, cookie: '__Host-af_testnet=' + session.token };
    for (const payload of [
      { action: { kind: 'execute', data: '0x12345678' }, privateKey: 'not-a-key' },
      { action: { kind: 'DEPOSIT', amountUsdc: '1' }, owner: address(99) },
    ])
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/testnet/vaults/alice-vault/prepare',
            headers: authenticated,
            payload,
          })
        ).statusCode,
        400,
      );
    for (const url of ['/api/testnet/executor/start', '/api/testnet/sign', '/api/testnet/mock/deposit'])
      assert.equal(
        (await app.inject({ method: 'POST', url, headers: authenticated, payload: {} })).statusCode,
        404,
      );
    assert.equal(runtime.store.db.prepare('SELECT count(*) AS n FROM chain_transactions').get()!.n, 0);
  } finally {
    await app.close();
    await runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

function routeRpcFixture(owner: string) {
  const logs: Record<string, unknown>[] = [];
  const log = (name: string, args: unknown[], block: number) => {
    const encoded = tradingInterface.encodeEventLog(tradingInterface.getEvent(name)!, args);
    const index = logs.length;
    logs.push({
      address: address(50),
      blockNumber: '0x' + block.toString(16),
      blockHash: block === 16 ? '0x' + 'ab'.repeat(32) : '0x' + block.toString(16).padStart(64, '0'),
      transactionHash: '0x' + String(index + 1).padStart(64, '0'),
      transactionIndex: '0x' + index.toString(16),
      logIndex: '0x' + index.toString(16),
      data: encoded.data,
      topics: encoded.topics,
      removed: false,
    });
  };
  log('Deposited', [1000000000n, 1000000000n, 1000n * 10n ** 18n], 1);
  log('CapitalChanged', [true, 900000000n, 900n * 10n ** 18n, 1n], 2);
  for (let i = 0; i < 3; i++)
    log('SwapExecuted', [BigInt(i + 2), 1n, address(10 + i), true, 100000000n, 10n ** 18n], 16);
  return tradingRpcFixture('NONE', { owner, historical: true, logs });
}

for (const [name, owner, otherOwner] of [
  ['Alice', address(1), address(99)],
  ['Bob', address(99), address(1)],
]) {
  test(`${name} Vault responses atomically bind the cookie owner for populated, empty and null snapshots`, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'alphaforge-owner-envelope-'));
    const f = routeRpcFixture(owner!);
    let clock = 1000000;
    const auth = new WalletAuthStore(':memory:', origin, {
      challengeTtlMs: 60000,
      sessionTtlMs: 300000,
      maxRows: 10,
    });
    const runtime = new TradingChainRuntime({
      dbPath: join(folder, 'chain.sqlite'),
      evidencePath: join(folder, 'evidence.sqlite'),
      manifest: f.manifest,
      inventory: f.inventory,
      rpc: f.client,
      now: () => clock,
    });
    const app = await buildPublicTestnetApp({
      origin,
      auth,
      now: () => clock,
      runtimes: [{ id: 'owned-vault', runtime }],
    });
    try {
      const ownCookie = '__Host-af_testnet=' + auth.createSession(owner!, clock).token;
      const otherCookie = '__Host-af_testnet=' + auth.createSession(otherOwner!, clock).token;
      for (const state of ['NOT_RUN', 'HEALTHY', 'STALE']) {
        if (state === 'HEALTHY') await runtime.syncToHead();
        if (state === 'STALE') clock += 90001;
        // A preceding session read cannot determine the next request's shared cookie identity.
        const session = await app.inject({
          url: '/api/testnet/auth/session',
          headers: { ...headers, cookie: ownCookie },
        });
        assert.equal(session.json().owner, owner);
        for (const [cookie, authenticatedOwner, hint] of [
          [otherCookie, otherOwner, owner],
          [ownCookie, owner, otherOwner],
          [otherCookie, otherOwner, owner],
        ]) {
          const response = await app.inject({
            url: '/api/testnet/vaults?owner=' + hint,
            headers: { ...headers, cookie: cookie!, 'x-alphaforge-owner': hint! },
          });
          assert.equal(response.statusCode, 200);
          assert.equal(response.headers['cache-control'], 'no-store');
          const view = response.json();
          assert.equal(view.owner, authenticatedOwner);
          assert.equal(view.chainId, 46630);
          if (authenticatedOwner === otherOwner) {
            assert.deepEqual(view.vaults, []);
            assert.equal(response.body.includes('owned-vault'), false);
          } else {
            assert.equal(view.vaults.length, 1);
            assert.equal(view.vaults[0].id, 'owned-vault');
            assert.equal(view.vaults[0].status, state);
            if (state === 'HEALTHY') assert.equal(view.vaults[0].snapshot.owner, owner);
            else assert.equal(view.vaults[0].snapshot, null);
          }
        }
      }
      assert.equal(runtime.store.db.prepare('SELECT count(*) AS n FROM chain_transactions').get()!.n, 0);
    } finally {
      await app.close();
      await runtime.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

test('Vault owner envelopes cannot be supplied by hints, invalid cookies or rejected ingress', async () => {
  let clock = 1000000;
  const auth = new WalletAuthStore(':memory:', origin, {
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxRows: 10,
  });
  const app = await buildPublicTestnetApp({ origin, auth, now: () => clock });
  try {
    const cookie = '__Host-af_testnet=' + auth.createSession(address(1), clock).token;
    for (const [requestHeaders, status] of [
      [{ ...headers, 'x-alphaforge-owner': address(1) }, 401],
      [{ ...headers, cookie: '__Host-af_testnet=invalid', 'x-alphaforge-owner': address(1) }, 401],
      [{ ...headers, cookie, origin: 'https://other.example' }, 403],
      [{ ...headers, cookie, host: 'other.example' }, 403],
      [{ ...headers, cookie, 'sec-fetch-site': 'cross-site' }, 403],
    ] as const) {
      const response = await app.inject({
        url: '/api/testnet/vaults?owner=' + address(1),
        headers: requestHeaders,
      });
      assert.equal(response.statusCode, status);
      assert.equal(response.json().owner, undefined);
      assert.equal(response.json().vaults, undefined);
    }
    clock += 60001;
    const expired = await app.inject({
      url: '/api/testnet/vaults?owner=' + address(99),
      headers: { ...headers, cookie },
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.json().owner, undefined);
  } finally {
    await app.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

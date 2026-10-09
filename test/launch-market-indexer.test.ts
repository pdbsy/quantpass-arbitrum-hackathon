import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface, Wallet, ZeroAddress } from 'ethers';
import { MarketEventIndexer, marketEventInterface } from '../apps/server/src/launch-market/indexer.ts';
import { buildLaunchMarketServer } from '../apps/server/src/launch-market/server.ts';
import { LaunchMarketService } from '../packages/launch-market/src/service.ts';
import { LaunchMarketStore } from '../packages/launch-market/src/store.ts';
import type { MarketChain } from '../packages/launch-market/src/chain.ts';
import {
  LaunchMarketError,
  type LaunchMarketManifest,
  type MarketSnapshot,
} from '../packages/launch-market/src/types.ts';

const a = (n: number) => '0x' + n.toString(16).padStart(40, '0');
const h = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const qty = (n: number) => '0x' + n.toString(16);
const P = 10n ** 18n;
const manifest: LaunchMarketManifest = {
  schemaVersion: 1,
  chainId: 46630,
  deploymentBlock: '1',
  usdc: a(1),
  claim: a(2),
  conversionReserve: a(3),
  router: a(4),
  poolFactory: a(5),
  vaultFactory: a(10),
  strategies: {
    TSLA: { pass: a(6), launch: a(7), pool: null, lpRecipient: a(20) },
    AMZN: { pass: a(8), launch: null, pool: a(9), lpRecipient: a(21) },
  },
  runtimeCodeHashes: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [a(n), h(99)])),
};
function snapshot(height: number, blockHash: string, claims = 0): MarketSnapshot {
  const base = {
    state: 'LAUNCHED' as const,
    pass: a(8),
    totalSupplyRaw: (1_000_000n * P).toString(),
    publicSupplyRaw: '0',
    soldRaw: '0',
    remainingRaw: '0',
    mintPriceUsdcRaw: '500000',
    lpPassRaw: (500_000n * P).toString(),
    lpUsdcRaw: '250000000000',
    pool: a(9),
    reservePassRaw: (500_000n * P).toString(),
    reserveUsdcRaw: '250000000000',
    ammFeeBps: 30,
  };
  return {
    location: {
      chainId: 46630,
      blockNumber: String(height),
      blockHash,
      transactionHash: null,
      logIndex: null,
      version: '0',
      confirmations: 1,
    },
    markets: {
      TSLA: {
        ...base,
        pass: a(6),
        pool: a(11),
        publicSupplyRaw: (500_000n * P).toString(),
        soldRaw: (500_000n * P).toString(),
      },
      AMZN: base,
    },
    claim: {
      amountUsdcRaw: '1000000000',
      successfulClaims: claims,
      maxClaims: 100,
      remainingClaims: 100 - claims,
      funded: true,
    },
    conversion: {
      ethReserveRaw: '100000000000000000000',
      usdcReserveRaw: '1000000000000',
      ethBuyAvailable: true,
      ethSellAvailable: true,
      ethMintAvailable: true,
      feeBps: 0,
      epoch: '1',
    },
  };
}
/** A local unit fixture for raw Ethereum JSON-RPC; the runtime indexer has no invented chain source. */
class RpcFixture {
  height = 2;
  fork = 0;
  claims = 1;
  logs: Array<Record<string, unknown>> = [];
  calls = 0;
  injectForeign = false;
  hash(height: number) {
    return h(height + (height >= 2 ? this.fork * 1000 : 0));
  }
  log(emitter: string, name: string, args: unknown[], height: number, index: number) {
    const encoded = marketEventInterface.encodeEventLog(marketEventInterface.getEvent(name)!, args);
    const result = {
      address: emitter,
      blockNumber: qty(height),
      blockHash: this.hash(height),
      transactionHash: h(100 + height + index),
      transactionIndex: '0x0',
      logIndex: qty(index),
      topics: encoded.topics,
      data: encoded.data,
      removed: false,
    };
    this.logs.push(result);
    return result;
  }
  async send(method: string, params: unknown[]): Promise<unknown> {
    this.calls++;
    if (method === 'eth_chainId') return qty(46630);
    if (method === 'eth_getBlockByNumber') {
      const height = params[0] === 'latest' ? this.height : Number(BigInt(String(params[0])));
      if (height > this.height) return null;
      return {
        number: qty(height),
        hash: this.hash(height),
        parentHash: this.hash(height - 1),
        timestamp: qty(1000 + height * 12),
      };
    }
    if (method === 'eth_getLogs') {
      const filter = params[0] as { address: string[]; fromBlock: string; toBlock: string };
      const matched = this.logs.filter(
        (log) =>
          filter.address.includes(String(log.address)) &&
          Number(BigInt(String(log.blockNumber))) >= Number(BigInt(filter.fromBlock)) &&
          Number(BigInt(String(log.blockNumber))) <= Number(BigInt(filter.toBlock)) &&
          log.blockHash === this.hash(Number(BigInt(String(log.blockNumber)))),
      );
      if (this.injectForeign) return [...matched, { ...this.logs[0], address: a(90) }];
      return matched;
    }
    if (method === 'eth_call') {
      const request = params[0] as { data: string };
      const iface = new Interface([
        'function passLocker() view returns(address)',
        'function targetStock() view returns(address)',
      ]);
      const decoded = iface.parseTransaction(request)!;
      return iface.encodeFunctionResult(decoded.name, [decoded.name === 'passLocker' ? a(13) : a(14)]);
    }
    throw new Error('Unexpected RPC fixture method ' + method);
  }
}
function chain(rpc: RpcFixture): MarketChain {
  return {
    snapshot: async () => snapshot(rpc.height, rpc.hash(rpc.height), rpc.claims),
    wallet: async () => {
      throw new Error('Unused');
    },
    quoteAmm: async () => {
      throw new Error('Unused');
    },
    simulate: async () => {
      throw new Error('Unused');
    },
    transaction: async () => null,
    receipt: async () => null,
    canonicalBlockHash: async (n) => (Number(n) > rpc.height ? null : rpc.hash(Number(n))),
    signingPolicy: async () => {
      throw new Error('Unused');
    },
  };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'af-market-index-'));
  const rpc = new RpcFixture();
  const createService = () =>
    new LaunchMarketService({
      manifest,
      store: new LaunchMarketStore(join(dir, 'accounts.sqlite'), 'http://localhost'),
      chain: chain(rpc),
      ethReference: null,
      quoteSigner: null,
      claimSigner: null,
      now: () => 1000,
    });
  const service = createService();
  const indexer = new MarketEventIndexer({
    path: join(dir, 'events.sqlite'),
    manifest,
    provider: rpc,
    service,
  });
  return {
    dir,
    rpc,
    service,
    indexer,
    createService,
    cleanup: async () => {
      await indexer.close();
      service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('raw canonical logs discover pools and isolated vaults, and index real transfers and swaps across restart', async () => {
  const f = fixture();
  try {
    f.rpc.claims = 0;
    f.rpc.log(a(6), 'Transfer', [ZeroAddress, a(7), 1_000_000n * P], 1, 0);
    f.rpc.log(a(5), 'PoolCreated', [a(6), a(11), a(20), 100n], 2, 0);
    f.rpc.log(a(6), 'Transfer', [a(7), a(11), 500_000n * P], 2, 1);
    f.rpc.log(a(11), 'Swap', [a(30), a(30), true, 25_000_000n, 50n * P, 75_000n], 2, 2);
    f.rpc.log(a(6), 'Transfer', [a(11), a(30), 50n * P], 2, 3);
    f.rpc.log(a(10), 'VaultCreated', [a(30), 0, a(12), 0], 2, 4);
    f.rpc.log(a(12), 'Deposited', [a(30), 1_000_000n, P, 1_000_000n, 1_000_000n], 2, 5);
    const first = f.indexer.poll();
    assert.strictEqual(f.indexer.poll(), first);
    await first;
    assert.equal(f.indexer.status().state, 'HEALTHY');
    assert.equal(f.indexer.history('TSLA').find((event) => event.name === 'Deposited')?.emitter, a(12));
    assert.equal(
      f.indexer.holders('TSLA').find((holder) => holder.owner === a(30))?.balanceRaw,
      (50n * P).toString(),
    );
    assert.deepEqual(f.indexer.candles('TSLA'), [
      {
        timestamp: 1020,
        openRaw: '500000',
        highRaw: '500000',
        lowRaw: '500000',
        closeRaw: '500000',
        volumeUsdcRaw: '25000000',
      },
    ]);
    assert.equal(
      f.indexer.db
        .prepare(
          "SELECT count(*) AS n FROM event_index_watch WHERE kind IN('VAULT','LOCKER','STOCK') AND canonical=1",
        )
        .get()?.n,
      3,
    );
    await f.indexer.close();
    f.service.close();
    const service = f.createService(),
      indexer = new MarketEventIndexer({
        path: join(f.dir, 'events.sqlite'),
        manifest,
        provider: f.rpc,
        service,
      });
    try {
      const before = f.rpc.calls;
      await indexer.poll();
      assert.ok(f.rpc.calls - before < 10);
      assert.equal(indexer.history('TSLA').filter((event) => event.name === 'Swap').length, 1);
      assert.equal(indexer.status().blockHash, f.rpc.hash(2));
    } finally {
      await indexer.close();
      service.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('claim logs without a browser submission reconcile durable vouchers after three inclusive blocks and preserve eligibility on reorg', async () => {
  const f = fixture();
  try {
    const wallet = Wallet.createRandom(),
      account = f.service.account({
        email: 'person@example.test',
        subject: 'issuer-subject',
        emailVerified: true,
      });
    const challenge = f.service.options.store.bindingChallenge(account.id, wallet.address, 1000);
    f.service.options.store.bindWallet(
      account.id,
      challenge.nonce,
      await wallet.signMessage(challenge.message),
      1000,
    );
    const voucher = f.service.options.store.reserveClaim(account.id, wallet.address, 1000, 1060, 0);
    f.rpc.log(
      a(2),
      'Claim',
      [account.accountKey, wallet.address, BigInt(voucher.nonce), 1_000_000_000n, 1],
      2,
      0,
    );
    await f.indexer.poll();
    assert.equal(f.service.options.store.voucher(account.id)?.status, 'INCLUDED');
    f.rpc.height = 4;
    await f.indexer.poll();
    assert.equal(f.service.options.store.voucher(account.id)?.status, 'COMPLETED');
    const streamed: string[] = [];
    const unsubscribe = f.service.broker.subscribe((event) => streamed.push(event.type));
    f.rpc.fork = 1;
    f.rpc.claims = 0;
    await f.indexer.poll();
    unsubscribe();
    assert.equal(f.service.options.store.voucher(account.id)?.status, 'REORGED');
    assert.equal(f.service.options.store.voucher(account.id)?.nonce, voucher.nonce);
    assert.ok(streamed.includes('REORG'));
    assert.equal(
      f.service.options.store.db
        .prepare('SELECT count(*) AS n FROM market_claim_events WHERE canonical=1')
        .get()?.n,
      0,
    );
    assert.equal(
      f.indexer.db
        .prepare("SELECT count(*) AS n FROM event_index_events WHERE name='Claim' AND canonical=1")
        .get()?.n,
      0,
    );
    assert.throws(
      () => f.service.options.store.reserveClaim(account.id, wallet.address, 1001, 1061, 0),
      (error) => error instanceof LaunchMarketError && error.code === 'CLAIM_RECOVERY_REQUIRED',
    );
  } finally {
    await f.cleanup();
  }
});

test('foreign log emitters and wrong chains cannot advance the durable canonical cursor', async () => {
  const f = fixture();
  try {
    f.rpc.log(a(6), 'Transfer', [ZeroAddress, a(7), P], 1, 0);
    f.rpc.injectForeign = true;
    await assert.rejects(
      f.indexer.poll(),
      (error) => error instanceof LaunchMarketError && error.code === 'INDEX_UNWATCHED_LOG',
    );
    assert.equal(f.indexer.status().blockNumber, null);
    assert.equal(f.indexer.status().state, 'DEGRADED');
    const wrong = new MarketEventIndexer({
      path: join(f.dir, 'wrong.sqlite'),
      manifest,
      provider: { send: async () => qty(1) },
      service: f.service,
    });
    try {
      await assert.rejects(
        wrong.poll(),
        (error) => error instanceof LaunchMarketError && error.code === 'INDEX_WRONG_CHAIN',
      );
      assert.equal(wrong.status().blockNumber, null);
    } finally {
      await wrong.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('dedicated server reports NOT_DEPLOYED and enforces host, origin, strict input, and trusted authentication', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-market-server-'));
  const service = new LaunchMarketService({
    manifest: null,
    store: new LaunchMarketStore(join(dir, 'accounts.sqlite'), 'http://localhost'),
    chain: null,
    ethReference: null,
    quoteSigner: null,
    claimSigner: null,
  });
  let initialized = 0,
    disposed = 0;
  const runtime = await buildLaunchMarketServer({
    service,
    origin: 'http://localhost',
    trustedIdentity: () => null,
    initialize: async () => {
      initialized++;
    },
    dispose: async () => {
      disposed++;
    },
  });
  try {
    const config = await runtime.app.inject({ method: 'GET', url: '/api/launch-market/config' });
    assert.equal(config.json().deployment, 'NOT_DEPLOYED');
    assert.equal(initialized, 1);
    assert.equal(
      (await runtime.app.inject({ method: 'GET', url: '/api/launch-market/snapshot' })).statusCode,
      503,
    );
    assert.equal(
      (await runtime.app.inject({ method: 'GET', url: '/api/launch-market/account' })).statusCode,
      401,
    );
    assert.equal(
      (
        await runtime.app.inject({
          method: 'GET',
          url: '/api/launch-market/config',
          headers: { host: 'attacker.test' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/launch-market/wallet/challenge',
          headers: { origin: 'https://attacker.test' },
          payload: { owner: a(30) },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/launch-market/wallet/challenge',
          headers: { origin: 'http://localhost' },
          payload: { owner: a(30), emailVerified: true, email: 'forged@example.test' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/launch-market/wallet/challenge',
          headers: { origin: 'http://localhost' },
          payload: { owner: a(30) },
        })
      ).statusCode,
      401,
    );
    assert.equal((await runtime.app.inject({ method: 'GET', url: '/api/market' })).statusCode, 404);
    assert.equal(
      (await runtime.app.inject({ method: 'GET', url: '/health' })).json().mode,
      'ONCHAIN_TESTNET',
    );
  } finally {
    await runtime.stop();
    assert.equal(disposed, 1);
    rmSync(dir, { recursive: true, force: true });
  }
});

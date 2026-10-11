import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Interface, keccak256 } from 'ethers';
import {
  readStockExecutionSnapshot,
  reviewStockExecution,
  stockExecutionInterface,
  stockExecutionReceipt,
  validateStockExecutionHash,
  type StockExecutionPending,
} from '../apps/web/src/launch-market/stock-execution.ts';
import { executorFixture, FACTORY_CODE, VAULT } from './helpers/launch-market-executor-fixture.ts';
import { OWNER, OTHER, NOW, BLOCK, HASH } from './helpers/launch-market-ui-fixture.ts';
import type { Eip1193Request } from '../apps/web/src/chain-wallet.ts';
import { LaunchMarketClient, MarketApiError } from '../apps/web/src/launch-market/client.ts';
import { executorJournalKey } from '../apps/web/src/launch-market/executor.ts';

const STOCK = '0x4444444444444444444444444444444444444444';
const VENUE = '0x5555555555555555555555555555555555555555';
const FEED = '0x6666666666666666666666666666666666666666';
const DIGEST = `0x${'dd'.repeat(32)}`;
const ZERO = `0x${'00'.repeat(32)}`;
const factoryAbi = new Interface([
  'function strategy(uint8) view returns(tuple(address creator,address pass,address usdc,address targetStock,address otherStock,address stockReserve,address referenceFeed,bytes32 strategyRef,uint32 maxPriceAge))',
]);
const venueAbi = new Interface([
  'function usdc() view returns(address)',
  'function stock() view returns(address)',
  'function feed() view returns(address)',
  'function maxPriceAge() view returns(uint32)',
  'function paused() view returns(bool)',
]);
const feedAbi = new Interface([
  'function price() view returns(uint256,uint64,bytes32)',
  'function regularOpen() view returns(uint64)',
  'function regularClose() view returns(uint64)',
  'function calendarObservedAt() view returns(uint64)',
  'function calendarDigest() view returns(bytes32)',
  'function executionAllowed() view returns(bool)',
]);
const tokenAbi = new Interface(['function balanceOf(address) view returns(uint256)']);

function stockFixture() {
  const f = executorFixture();
  const cfg = f.state.config.manifest!;
  const manifest = {
    ...cfg,
    runtimeCodeHashes: {
      ...cfg.runtimeCodeHashes,
      ...Object.fromEntries(
        [cfg.usdc, cfg.strategies.AMZN.pass, STOCK, VENUE, FEED].map((address) => [
          address,
          keccak256(FACTORY_CODE),
        ]),
      ),
    },
  };
  const current = {
    price: 250_000_000n,
    observed: NOW,
    digest: DIGEST,
    calendarObserved: NOW,
    calendarDigest: DIGEST,
    opens: NOW - 3600,
    closes: NOW + 3600,
    allowed: true,
    paused: false,
    vaultStock: STOCK,
    venueFeed: FEED,
    cash: 10_000_000n,
    position: 10n ** 18n,
    reserveUsdc: 100_000_000_000n,
    reserveStock: 1_000_000n * 10n ** 18n,
    vaultUsdc: 10_000_000n,
    actualStock: 10n ** 18n,
    transactionData: '0x',
    transactionOwner: OWNER,
    transactionValue: '0x0',
    transactionHash: HASH,
    transactionBlock: '0x64',
    transactionBlockHash: BLOCK,
  };
  const previous = f.provider.request.bind(f.provider);
  f.provider.request = async (request: Eip1193Request): Promise<unknown> => {
    const [first, block] = request.params ?? [];
    if (request.method === 'eth_getTransactionByHash') {
      f.provider.calls.push(request);
      return {
        hash: current.transactionHash,
        from: current.transactionOwner,
        to: VAULT,
        input: current.transactionData,
        value: current.transactionValue,
        blockNumber: current.transactionBlock,
        blockHash: current.transactionBlockHash,
      };
    }
    if (
      request.method === 'eth_call' &&
      first &&
      typeof first === 'object' &&
      'to' in first &&
      'data' in first
    ) {
      const tx = first as { to: string; data: string };
      let abi: Interface | undefined;
      let values: Record<string, unknown[]> = {};
      if (
        tx.to === cfg.vaultFactory &&
        tx.data.slice(0, 10) === factoryAbi.getFunction('strategy')!.selector
      ) {
        abi = factoryAbi;
        values = {
          strategy: [[OWNER, cfg.strategies.AMZN.pass, cfg.usdc, STOCK, OTHER, VENUE, FEED, DIGEST, 60]],
        };
      } else if (tx.to === VAULT && stockExecutionInterface.parseTransaction({ data: tx.data })) {
        abi = stockExecutionInterface;
        values = {
          targetStock: [current.vaultStock],
          stockReserve: [VENUE],
          referenceFeed: [FEED],
          maxPriceAge: [60],
          trackedUsdcBalance: [current.cash],
          trackedPosition: [current.position],
          execute: [1],
        };
      } else if (tx.to === VENUE) {
        abi = venueAbi;
        values = {
          usdc: [cfg.usdc],
          stock: [STOCK],
          feed: [current.venueFeed],
          maxPriceAge: [60],
          paused: [current.paused],
        };
      } else if (tx.to === FEED) {
        abi = feedAbi;
        values = {
          price: [current.price, current.observed, current.digest],
          regularOpen: [current.opens],
          regularClose: [current.closes],
          calendarObservedAt: [current.calendarObserved],
          calendarDigest: [current.calendarDigest],
          executionAllowed: [current.allowed],
        };
      } else if (tx.to === cfg.usdc || tx.to === STOCK) {
        abi = tokenAbi;
        const decoded = tokenAbi.parseTransaction({ data: tx.data })!;
        values = {
          balanceOf: [
            tx.to === cfg.usdc
              ? decoded.args[0] === VAULT
                ? current.vaultUsdc
                : current.reserveUsdc
              : decoded.args[0] === VAULT
                ? current.actualStock
                : current.reserveStock,
          ],
        };
      }
      if (abi) {
        f.provider.calls.push(request);
        const decoded = abi.parseTransaction({ data: tx.data })!;
        assert.ok(block === '0x64' || (decoded.name === 'execute' && block === 'latest'));
        return abi.encodeFunctionResult(decoded.name, values[decoded.name]!);
      }
    }
    return previous(request);
  };
  return { ...f, manifest, stock: current };
}

const read = (f: ReturnType<typeof stockFixture>) =>
  readStockExecutionSnapshot(f.provider, f.manifest, OWNER, VAULT, 'AMZN');

test('stock execution reads actual tracked cash, stock price and reserve inventory at one canonical block', async () => {
  const f = stockFixture(),
    snapshot = await read(f);
  assert.equal(snapshot.status, 'READY');
  assert.equal(snapshot.stockPriceUsdcRaw, '250000000');
  assert.equal(snapshot.trackedCashRaw, '10000000');
  assert.equal(snapshot.trackedStockRaw, String(10n ** 18n));
  assert.equal(snapshot.executionCutoff, NOW + 60);
  const reads = f.provider.calls.filter((call) => call.method === 'eth_call');
  assert.ok(reads.every((call) => call.params![1] === '0x64'));
  assert.equal(
    f.provider.calls.some((call) => /send|sign/i.test(call.method)),
    false,
  );
});

test('wrong owner, chain, reference route, runtime code and missing tracked custody fail closed', async () => {
  const wrongOwner = stockFixture();
  await assert.rejects(
    readStockExecutionSnapshot(wrongOwner.provider, wrongOwner.manifest, OTHER, VAULT, 'AMZN'),
    /VAULT_IDENTITY_CHANGED/,
  );
  const wrongChain = stockFixture();
  wrongChain.provider.chainId = '0x1';
  await assert.rejects(read(wrongChain), /WALLET_WRONG_CHAIN/);
  const wrongStock = stockFixture();
  wrongStock.stock.vaultStock = OTHER;
  await assert.rejects(read(wrongStock), /STOCK_ROUTE_MISMATCH/);
  const wrongFeed = stockFixture();
  wrongFeed.stock.venueFeed = OTHER;
  await assert.rejects(read(wrongFeed), /STOCK_ROUTE_MISMATCH/);
  const wrongCode = stockFixture();
  wrongCode.manifest.runtimeCodeHashes[FEED] = BLOCK;
  await assert.rejects(read(wrongCode), /STOCK_ROUTE_CODE_MISMATCH/);
  const missingCash = stockFixture();
  missingCash.stock.vaultUsdc = 9_000_000n;
  await assert.rejects(read(missingCash), /VAULT_TRACKED_BALANCE_MISMATCH/);
  const reorg = stockFixture();
  reorg.current.pinnedHash = DIGEST;
  await assert.rejects(read(reorg), /CHAIN_REORGANIZED/);
});

test('uninitialized feed/calendar stays distinct from a closed market and stale prices/calendar', async () => {
  for (const [change, expected] of [
    [{ price: 0n }, 'UNINITIALIZED'],
    [{ digest: ZERO }, 'UNINITIALIZED'],
    [{ calendarDigest: ZERO }, 'UNINITIALIZED'],
    [{ observed: NOW - 61 }, 'STALE_REFERENCE'],
    [{ observed: NOW + 1 }, 'STALE_REFERENCE'],
    [{ calendarObserved: NOW - 61 }, 'STALE_CALENDAR'],
    [{ closes: NOW, allowed: false }, 'MARKET_CLOSED'],
    [{ paused: true }, 'PAUSED'],
  ] as const) {
    const f = stockFixture();
    Object.assign(f.stock, change);
    const snapshot = await read(f);
    assert.equal(snapshot.status, expected);
    assert.equal(snapshot.executionCutoff, null);
    await assert.rejects(
      reviewStockExecution(f.provider, snapshot, true, '1000000', 100, NOW),
      new RegExp(`STOCK_EXECUTION_${expected}`),
    );
  }
});

test('owner buy and sell calculate integer amounts and encode the actual execute ABI with freshness deadline', async () => {
  const f = stockFixture(),
    snapshot = await read(f);
  const buy = await reviewStockExecution(f.provider, snapshot, true, '10000000', 100, NOW);
  assert.equal(buy.estimatedOutRaw, '40000000000000000');
  assert.equal(buy.minOutRaw, '39600000000000000');
  assert.equal(buy.gasEstimateRaw, '100000');
  assert.equal(buy.deadline, NOW + 60);
  const decoded = stockExecutionInterface.parseTransaction({ data: buy.data })!;
  assert.equal(decoded.name, 'execute');
  assert.deepEqual(decoded.args.toArray().map(String), [
    'true',
    '10000000',
    '39600000000000000',
    String(NOW + 60),
    '0',
  ]);
  const sell = await reviewStockExecution(f.provider, snapshot, false, '40000000000000001', 0, NOW);
  assert.equal(sell.estimatedOutRaw, '10000000');
  assert.equal(sell.minOutRaw, '10000000');
  assert.ok(f.provider.calls.some((call) => call.method === 'eth_estimateGas'));
  assert.equal(
    f.provider.calls.some((call) => /send|sign/i.test(call.method)),
    false,
  );
});

test('stock review rejects insufficient tracked balances, reserve output, dust, excessive slippage and expired reference', async () => {
  const f = stockFixture(),
    snapshot = await read(f);
  await assert.rejects(
    reviewStockExecution(f.provider, snapshot, true, '10000001', 100, NOW),
    /INSUFFICIENT_VAULT_BALANCE/,
  );
  await assert.rejects(
    reviewStockExecution(f.provider, snapshot, true, '10000000', 501, NOW),
    /INVALID_STOCK_EXECUTION/,
  );
  await assert.rejects(
    reviewStockExecution(f.provider, snapshot, false, '1', 100, NOW),
    /STOCK_EXECUTION_DUST/,
  );
  await assert.rejects(
    reviewStockExecution(f.provider, snapshot, true, '1000000', 100, NOW + 61),
    /STOCK_EXECUTION_STALE_REFERENCE/,
  );
  await assert.rejects(
    reviewStockExecution(f.provider, snapshot, true, '1000000', 100, NOW + 60),
    /STOCK_EXECUTION_STALE_REFERENCE/,
  );
  f.stock.reserveStock = 1n;
  const lowReserve = await read(f);
  await assert.rejects(
    reviewStockExecution(f.provider, lowReserve, true, '1000000', 100, NOW),
    /INSUFFICIENT_TEST_STOCK_RESERVE/,
  );
  f.stock.reserveUsdc = 1n;
  const lowCash = await read(f);
  await assert.rejects(
    reviewStockExecution(f.provider, lowCash, false, '1000000000000000000', 100, NOW),
    /INSUFFICIENT_TEST_STOCK_RESERVE/,
  );
});

test('stock receipt verifies exact semantic calldata, owner, value, mined block and three inclusive confirmations', async () => {
  const f = stockFixture(),
    snapshot = await read(f);
  const review = await reviewStockExecution(f.provider, snapshot, true, '1000000', 100, NOW);
  const pending: StockExecutionPending = {
    owner: OWNER,
    vault: VAULT,
    strategyId: 'AMZN',
    data: review.data,
    hash: HASH,
  };
  f.stock.transactionData = review.data;
  assert.deepEqual(await stockExecutionReceipt(f.provider, pending), {
    state: 'SUBMITTED',
    confirmations: 0,
  });
  f.provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    to: VAULT,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  f.provider.tip = '0x65';
  assert.deepEqual(await stockExecutionReceipt(f.provider, pending), { state: 'INCLUDED', confirmations: 2 });
  f.provider.tip = '0x66';
  assert.deepEqual(await stockExecutionReceipt(f.provider, pending), {
    state: 'COMPLETED',
    confirmations: 3,
  });
  f.stock.transactionData = stockExecutionInterface.encodeFunctionData('execute', [false, 1, 1, NOW + 60, 0]);
  await assert.rejects(stockExecutionReceipt(f.provider, pending), /INVALID_STOCK_EXECUTION_RECEIPT/);
  f.stock.transactionData = review.data;
  f.stock.transactionOwner = OTHER;
  await assert.rejects(
    validateStockExecutionHash(f.provider, pending, HASH),
    /INVALID_STOCK_EXECUTION_RECEIPT/,
  );
  f.stock.transactionOwner = OWNER;
  f.stock.transactionValue = '0x1';
  await assert.rejects(stockExecutionReceipt(f.provider, pending), /INVALID_STOCK_EXECUTION_RECEIPT/);
  f.stock.transactionValue = '0x0';
  f.stock.transactionBlock = '0x63';
  await assert.rejects(stockExecutionReceipt(f.provider, pending), /INVALID_STOCK_EXECUTION_RECEIPT/);
  f.stock.transactionBlock = '0x64';
  f.current.pinnedHash = DIGEST;
  assert.deepEqual(await stockExecutionReceipt(f.provider, pending), { state: 'REORGED', confirmations: 0 });
  assert.equal(
    f.provider.calls.some((call) => /send|sign/i.test(call.method)),
    false,
  );
});

async function clientFixture(journal?: Storage) {
  const f = stockFixture();
  f.state.config = { ...f.state.config, manifest: f.manifest };
  const clock = { now: NOW };
  const client = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    now: () => clock.now,
    journal: journal ?? f.journal,
  });
  await client.initialize();
  await client.connect();
  return { ...f, client, clock };
}

test('client reviews direct owner execution without signing, then sends exactly the reviewed transaction', async () => {
  const f = await clientFixture();
  await f.client.reviewStock('AMZN', true, '1000000', 100);
  const review = f.client.state.stockReview!;
  assert.equal(f.client.state.executorReview, null);
  assert.equal(
    f.provider.calls.some((call) => /send|sign/i.test(call.method)),
    false,
  );
  f.stock.transactionData = review.data;
  await f.client.confirmExecutorPermission();
  const sent = f.provider.calls.filter((call) => call.method === 'eth_sendTransaction');
  assert.equal(sent.length, 1);
  const transaction = sent[0]!.params![0] as { from: string; to: string; value: string; data: string };
  assert.equal(transaction.from, OWNER);
  assert.equal(transaction.to, VAULT);
  assert.equal(transaction.value, '0x0');
  assert.equal(transaction.data, review.data);
  assert.equal(stockExecutionInterface.parseTransaction(transaction)!.name, 'execute');
  assert.equal(f.client.state.transaction.stock, true);
  assert.equal(f.client.state.transaction.state, 'SUBMITTED');
  assert.equal(JSON.parse(f.journal.getItem(executorJournalKey)!).kind, 'EXECUTE');
});

test('client changes to owner, account, network, reference, version or expiry prevent stock execution broadcast', async () => {
  for (const change of ['OWNER', 'ACCOUNT', 'CHAIN', 'PRICE', 'VERSION', 'EXPIRY'] as const) {
    const f = await clientFixture();
    await f.client.reviewStock('AMZN', true, '1000000', 100);
    if (change === 'OWNER') f.provider.owner = OTHER;
    if (change === 'ACCOUNT') f.client.setError(new MarketApiError('ACCOUNT_SESSION_INVALID', 401));
    if (change === 'CHAIN') f.provider.chainId = '0x1';
    if (change === 'PRICE') f.stock.price += 1n;
    if (change === 'VERSION') f.current.version++;
    if (change === 'EXPIRY') f.clock.now = NOW + 61;
    await assert.rejects(
      f.client.confirmExecutorPermission(),
      /WALLET_IDENTITY_CHANGED|WALLET_WRONG_CHAIN|EXECUTOR_REVIEW_REQUIRED|EXECUTOR_REVIEW_EXPIRED|STOCK_REVIEW_EXPIRED/,
    );
    assert.equal(
      f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
      false,
      change,
    );
  }
});

test('storage failure before wallet submission leaves no execution transaction or recoverable phantom hash', async () => {
  const entries = new Map<string, string>();
  const journal: Storage = {
    length: 0,
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: () => null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: () => {
      throw new Error('fixture quota exhausted');
    },
  };
  const f = await clientFixture(journal);
  await f.client.reviewStock('AMZN', true, '1000000', 100);
  await assert.rejects(f.client.confirmExecutorPermission(), /EXECUTOR_RECOVERY_STORAGE_REQUIRED/);
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
  assert.equal(f.client.state.transaction.hash, null);
  assert.equal(journal.getItem(executorJournalKey), null);
});

test('cancelling a delayed stock review prevents a completed RPC read from restoring its confirmation', async () => {
  const f = await clientFixture();
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const previous = f.provider.request.bind(f.provider);
  f.provider.request = async (request) => {
    const transaction = request.params?.[0] as { data?: string } | undefined;
    if (
      request.method === 'eth_call' &&
      request.params?.[1] === 'latest' &&
      transaction?.data?.slice(0, 10) === stockExecutionInterface.getFunction('execute')!.selector
    ) {
      started.resolve();
      await release.promise;
    }
    return previous(request);
  };
  const pending = f.client.reviewStock('AMZN', true, '1000000', 100);
  const rejected = assert.rejects(pending, /EXECUTOR_REVIEW_EXPIRED|STOCK_REVIEW_EXPIRED|REVIEW_CANCELLED/);
  await started.promise;
  f.client.clearQuote();
  release.resolve();
  await rejected;
  assert.equal(f.client.state.stockReview, null);
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

test('an RPC gas estimate that finishes after the stock deadline cannot publish a confirmable review', async () => {
  const f = await clientFixture();
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const previous = f.provider.request.bind(f.provider);
  f.provider.request = async (request) => {
    if (request.method === 'eth_estimateGas') {
      started.resolve();
      await release.promise;
    }
    return previous(request);
  };
  const pending = f.client.reviewStock('AMZN', true, '1000000', 100);
  const rejected = assert.rejects(pending, /EXECUTOR_REVIEW_EXPIRED|STOCK_REVIEW_EXPIRED/);
  await started.promise;
  f.clock.now += 61;
  release.resolve();
  await rejected;
  assert.equal(f.client.state.stockReview, null);
  assert.equal(f.client.state.busy, false);
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

test('a reorganization during an asynchronous stock review invalidates the completed review', async () => {
  const f = await clientFixture();
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const previous = f.provider.request.bind(f.provider);
  f.provider.request = async (request) => {
    if (request.method === 'eth_estimateGas') {
      started.resolve();
      await release.promise;
    }
    return previous(request);
  };
  const pending = f.client.reviewStock('AMZN', true, '1000000', 100);
  const rejected = assert.rejects(
    pending,
    /EXECUTOR_REVIEW_EXPIRED|STOCK_REVIEW_EXPIRED|ACCOUNT_LINKAGE_CHANGED/,
  );
  await started.promise;
  await f.client.stream({ type: 'REORG', location: f.state.snapshot.location });
  release.resolve();
  await rejected;
  assert.equal(f.client.state.stockReview, null);
  assert.equal(f.client.state.busy, false);
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

test('cancelling during the wallet execution preflight prevents the eventual send call', async () => {
  const f = await clientFixture();
  await f.client.reviewStock('AMZN', true, '1000000', 100);
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const previous = f.provider.request.bind(f.provider);
  let executeCalls = 0;
  f.provider.request = async (request) => {
    const transaction = request.params?.[0] as { data?: string } | undefined;
    if (
      request.method === 'eth_call' &&
      request.params?.[1] === 'latest' &&
      transaction?.data?.slice(0, 10) === stockExecutionInterface.getFunction('execute')!.selector &&
      ++executeCalls === 2
    ) {
      started.resolve();
      await release.promise;
    }
    return previous(request);
  };
  const pending = f.client.confirmExecutorPermission();
  const rejected = assert.rejects(pending, /EXECUTOR_REVIEW_EXPIRED|STOCK_REVIEW_EXPIRED|REVIEW_CANCELLED/);
  await started.promise;
  f.client.clearQuote();
  release.resolve();
  await rejected;
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
  assert.equal(f.journal.getItem(executorJournalKey), null);
});

test('a submitted stock execution survives reload, confirms exact chain evidence and never resends', async () => {
  const f = await clientFixture();
  await f.client.reviewStock('AMZN', true, '1000000', 100);
  const reviewed = f.client.state.stockReview!;
  f.stock.transactionData = reviewed.data;
  await f.client.confirmExecutorPermission();
  const recovered = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    journal: f.journal,
    now: () => NOW,
  });
  await recovered.initialize();
  await recovered.connect();
  assert.equal(recovered.state.transaction.stock, true);
  assert.equal(recovered.state.transaction.hash, HASH);
  f.provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    to: VAULT,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  f.current.version = 1;
  f.stock.cash -= 1_000_000n;
  f.stock.vaultUsdc = f.stock.cash;
  f.stock.position += BigInt(reviewed.estimatedOutRaw);
  f.stock.actualStock = f.stock.position;
  await recovered.refreshTransaction();
  assert.equal(recovered.state.transaction.state, 'COMPLETED');
  assert.equal(recovered.state.transaction.confirmations, 3);
  assert.equal(recovered.state.stockSnapshots!.AMZN!.trackedCashRaw, '9000000');
  assert.equal(f.journal.getItem(executorJournalKey), null);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

for (const detection of ['stream', 'rpc'] as const) {
  test(`a stock receipt read started before a ${detection} reorganization cannot clear the recovery journal`, async () => {
    const f = await clientFixture();
    await f.client.reviewStock('AMZN', true, '1000000', 100);
    f.stock.transactionData = f.client.state.stockReview!.data;
    await f.client.confirmExecutorPermission();
    f.provider.receipt = {
      transactionHash: HASH,
      from: OWNER,
      to: VAULT,
      blockNumber: '0x64',
      blockHash: BLOCK,
      status: '0x1',
    };
    const started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const previous = f.provider.request.bind(f.provider);
    let blocked = false;
    f.provider.request = async (request) => {
      if (request.method === 'eth_blockNumber' && !blocked) {
        blocked = true;
        const result = await previous(request);
        started.resolve();
        await release.promise;
        return result;
      }
      return previous(request);
    };
    const stalePoll = f.client.refreshTransaction();
    await started.promise;
    if (detection === 'stream') {
      f.provider.receipt = null;
      await f.client.stream({ type: 'REORG', location: f.state.snapshot.location });
    } else {
      f.current.pinnedHash = DIGEST;
      await f.client.refreshTransaction();
    }
    release.resolve();
    await stalePoll;
    assert.equal(f.client.state.transaction.state, 'REORGED');
    assert.ok(f.journal.getItem(executorJournalKey));
    assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
  });
}

test('concurrent stock receipt polls complete once without a second broadcast or a missing pending record', async () => {
  const f = await clientFixture();
  await f.client.reviewStock('AMZN', true, '1000000', 100);
  f.stock.transactionData = f.client.state.stockReview!.data;
  await f.client.confirmExecutorPermission();
  f.provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    to: VAULT,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  const bothStarted = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const previous = f.provider.request.bind(f.provider);
  let reads = 0;
  f.provider.request = async (request) => {
    if (request.method === 'eth_blockNumber' && reads < 2) {
      if (++reads === 2) bothStarted.resolve();
      await release.promise;
    }
    return previous(request);
  };
  const first = f.client.refreshTransaction();
  const second = f.client.refreshTransaction();
  await bothStarted.promise;
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(f.client.state.transaction.state, 'COMPLETED');
  assert.equal(f.journal.getItem(executorJournalKey), null);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('an uncertain stock wallet result is recovered by checking an actual hash, without another broadcast', async () => {
  const f = await clientFixture();
  await f.client.reviewStock('AMZN', false, '4000000000000000', 100);
  f.stock.transactionData = f.client.state.stockReview!.data;
  f.provider.sendResult = 'unknown';
  await f.client.confirmExecutorPermission();
  assert.equal(f.client.state.transaction.state, 'RECOVERY_REQUIRED');
  const recovered = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    journal: f.journal,
    now: () => NOW,
  });
  await recovered.initialize();
  await recovered.connect();
  await recovered.recoverExecutorTransaction(HASH);
  assert.equal(recovered.state.transaction.stock, true);
  assert.equal(recovered.state.transaction.hash, HASH);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

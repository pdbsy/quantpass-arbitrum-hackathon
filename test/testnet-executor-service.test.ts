import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatchJournal } from '../packages/market-data/src/batch-journal.ts';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';
import { TestnetExecutorService } from '../apps/server/src/testnet-executor-service.ts';
import { evidenceHash } from '../packages/testnet/src/executor-plan.ts';
import type { ExecutorConfig } from '../packages/testnet/src/execution-config.ts';
import { feedInterface, quoterInterface, tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import { asHexData, asBlockHash } from '../packages/chain-adapter/src/types.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
const assets = ['MSFT', 'NVDA', 'AAPL'].map((symbol, i) => ({
  id: '0x' + String(i + 1).repeat(64),
  tokenSymbol: symbol,
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: address(100 + i) }],
}));
const terms = assets.map((a) => ({
  identity: '4663:' + a.deployments[0]!.contractAddress,
  assetId: a.id,
  symbol: a.tokenSymbol,
  multiplier: '1',
}));
test('private loop persists official capture and prepares a typed feed update without signing; restart and storage/review pauses retain history', async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-executor-service-'))),
    orders = new OrderJournal(join(folder, 'orders.sqlite'), '0x' + 'ab'.repeat(32)),
    batches = new BatchJournal(join(folder, 'batches.sqlite')),
    f = tradingRpcFixture();
  const inventory = {
    ...f.inventory,
    stocks: f.inventory.stocks.map((s, i) => ({ ...s, referenceIdentity: evidenceHash(terms[i]) })),
  };
  const config: ExecutorConfig = {
    schemaVersion: 1,
    profile: 'RESTRICTED_TESTNET_EXECUTOR',
    chainId: 46630,
    dataDirectory: folder,
    maxStorageBytes: 8000000000,
    executor: address(40),
    keeper: address(40),
    minOrderUsdc: '1000000',
    deadlineSeconds: 10,
    gas: { gasLimit: '100000', maxFeePerGas: '1000', maxPriorityFeePerGas: '1', maxGasCostWei: '100000000' },
    maxTotalGasCostWei: '1000000000',
    referenceFile: 'references.json',
    referenceDigest: '0x' + 'ab'.repeat(32),
    vaults: [
      {
        id: 'owner1',
        manifestFile: 'vault.json',
        manifestDigest: f.manifest.manifestDigest,
        vaultAddress: f.manifest.contractAddress,
        inventoryFile: 'inventory.json',
        inventoryDigest: asBlockHash('0x' + 'ab'.repeat(32)),
      },
    ],
  };
  const published = inventory.stocks.map(() => ({
    priceUsdc: '100000000',
    observedAt: '995',
    sourceDigest: '0x' + 'ab'.repeat(32),
  }));
  const rpc = {
    chainId: f.client.chainId.bind(f.client),
    block: f.client.block.bind(f.client),
    code: f.client.code.bind(f.client),
    receipt: f.client.receipt.bind(f.client),
    logs: f.client.logs.bind(f.client),
    call: async (...args: Parameters<typeof f.client.call>) => {
      if (
        args[0].to === inventory.quoter &&
        args[0].data.startsWith(quoterInterface.getFunction('quoteExactInputSingle')!.selector)
      ) {
        return asHexData(
          quoterInterface.encodeFunctionResult('quoteExactInputSingle', [
            1994000000000000000n,
            1n,
            0n,
            100000n,
          ]),
        );
      }
      if (
        args[0].to === f.manifest.contractAddress &&
        tradingInterface.parseTransaction({ data: args[0].data })?.name === 'execute'
      ) {
        assert.equal(args[0].from, config.executor);
        return asHexData(tradingInterface.encodeFunctionResult('execute', [1994000000000000000n]));
      }
      const i = inventory.stocks.findIndex((s) => s.feed === args[0].to),
        action = i >= 0 ? feedInterface.parseTransaction({ data: args[0].data }) : null;
      if (action?.name === 'referenceIdentity')
        return asHexData(
          feedInterface.encodeFunctionResult('referenceIdentity', [inventory.stocks[i]!.referenceIdentity]),
        );
      if (action?.name === 'price')
        return asHexData(
          feedInterface.encodeFunctionResult('price', [
            published[i]!.priceUsdc,
            published[i]!.observedAt,
            published[i]!.sourceDigest,
          ]),
        );
      return f.client.call(...args);
    },
  };
  let writes = true,
    review = true,
    captures = 0;
  const options = {
    config,
    terms,
    rpc,
    deployments: [{ id: 'owner1', manifest: f.manifest, inventory }],
    orders,
    batches,
    canWrite: () => writes,
    reviewValid: () => review,
    reconcile: async () => {},
    now: () => 1000000,
    captureTransport: async (url: string) => {
      captures++;
      return new Response(
        JSON.stringify(
          url.endsWith('/assets')
            ? { assets }
            : {
                quotes: [
                  {
                    tokenSymbol: url.split('/').at(-1),
                    deployments: assets.find((a) => a.tokenSymbol === url.split('/').at(-1))!.deployments,
                    bid: '99',
                    ask: '101',
                    currency: 'USD',
                    isTradingHalt: false,
                    generatedAt: new Date(1000000).toISOString(),
                  },
                ],
              },
        ),
      );
    },
  };
  let service = new TestnetExecutorService(options);
  try {
    await service.tick();
    assert.equal(service.status, 'PREPARED_SIGNING_DISABLED');
    assert.equal(service.candidate!.purpose, 'FEED_UPDATE');
    assert.equal(service.candidate!.feed, inventory.stocks[0]!.feed);
    assert.equal(orders.attempts(), 0);
    assert.ok(batches.next(0));
    for (let i = 0; i < 3; i++) {
      const candidate = service.candidate!;
      const action = feedInterface.parseTransaction({ data: candidate.calldata })!;
      const index = inventory.stocks.findIndex((s) => s.feed === candidate.feed);
      published[index] = {
        priceUsdc: String(action.args[0]),
        observedAt: String(action.args[1]),
        sourceDigest: String(action.args[2]).toLowerCase(),
      };
      await service.tick();
      if (i < 2) assert.equal(service.candidate!.purpose, 'FEED_UPDATE');
    }
    assert.equal(service.status, 'WARMUP');
    assert.equal(service.candidate, null);
    assert.equal(new Set(published.map((q) => q.sourceDigest)).size, 1);
    // Strategy-output boundary: signal calculations are covered separately by raw-minute replay tests.
    service.engine = { ...service.engine, lastMinute: 940000, signals: ['BUY', 'WARMUP', 'WARMUP'] };
    await service.tick();
    assert.equal(service.status, 'PREPARED_SIGNING_DISABLED');
    assert.equal(service.candidate!.feed, undefined);
    assert.equal(tradingInterface.parseTransaction({ data: service.candidate!.calldata })!.name, 'execute');
    assert.equal(service.candidate!.sourceDigest, published[0]!.sourceDigest);
    // Restart deterministically restores the journal-derived state, not injected test signals.
    service.engine = new TestnetExecutorService(options).engine;
    const before = service.engine;
    await service.close();
    service = new TestnetExecutorService(options);
    assert.deepEqual(service.engine, before);
    const calls = captures;
    writes = false;
    await service.tick();
    assert.equal(service.status, 'PAUSED_STORAGE');
    assert.equal(captures, calls);
    writes = true;
    review = false;
    await service.tick();
    assert.equal(service.status, 'PAUSED_REFERENCE_REVIEW');
    assert.equal(captures, calls);
  } finally {
    await service.close();
    orders.close();
    batches.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

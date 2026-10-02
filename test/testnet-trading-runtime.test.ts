import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
import { TradingChainRuntime } from '../apps/server/src/trading-chain-runtime.ts';
import { tradingInterface } from '../packages/testnet/src/trading-abi.ts';
const hash = '0x' + 'ab'.repeat(32),
  txHash = '0x' + 'cd'.repeat(32);
function rpcOptions() {
  const logs: Record<string, unknown>[] = [];
  const log = (name: string, args: unknown[], block = 16) => {
    const encoded = tradingInterface.encodeEventLog(tradingInterface.getEvent(name)!, args),
      i = logs.length;
    logs.push({
      address: address(50),
      blockNumber: '0x' + block.toString(16),
      blockHash: block === 16 ? hash : '0x' + block.toString(16).padStart(64, '0'),
      transactionHash: '0x' + String(i + 1).padStart(64, '0'),
      transactionIndex: '0x' + i.toString(16),
      logIndex: '0x' + i.toString(16),
      data: encoded.data,
      topics: encoded.topics,
      removed: false,
    });
  };
  log('Deposited', [1000000000n, 1000000000n, 1000n * 10n ** 18n], 1);
  log('CapitalChanged', [true, 900000000n, 900n * 10n ** 18n, 1n], 2);
  for (let i = 0; i < 3; i++)
    log('SwapExecuted', [BigInt(i + 2), 1n, address(10 + i), true, 100000000n, 10n ** 18n]);
  return {
    historical: true,
    head: 16,
    logs,
    transaction: null as Record<string, unknown> | null,
    receipt: null as Record<string, unknown> | null,
    hashAt: (n: number) => (n === 16 ? hash : '0x' + n.toString(16).padStart(64, '0')),
  };
}
test('qualified runtime persists personal NAV and owner intents, refuses another owner and retains a submitted intent after restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-runtime-')),
    options = rpcOptions(),
    f = tradingRpcFixture('NONE', options),
    paths = { dbPath: join(folder, 'chain.sqlite'), evidencePath: join(folder, 'evidence.sqlite') };
  let runtime = new TradingChainRuntime({
    ...paths,
    manifest: f.manifest,
    inventory: f.inventory,
    rpc: f.client,
  });
  try {
    assert.equal(runtime.status(), 'NOT_RUN');
    assert.equal(runtime.ownedView(address(1)).snapshot, null);
    await runtime.syncToHead();
    const view = runtime.ownedView(address(1));
    assert.equal(view.performance!.pnlUsdc, '0');
    assert.equal(runtime.evidence.verify().records, 1);
    assert.throws(() => runtime.ownedView(address(99)), /TRADING_OWNER_REQUIRED/);
    const prepared = runtime.prepareOwnerAction(address(1), { kind: 'DEPOSIT', amountUsdc: '1' });
    assert.equal(prepared.requiresOwnerWallet, true);
    assert.equal(prepared.transaction.to, address(50));
    options.transaction = {
      hash: txHash,
      chainId: '0xb626',
      from: address(2),
      to: address(50),
      input: prepared.transaction.data,
      value: '0x0',
      nonce: '0x7',
      blockHash: null,
      blockNumber: null,
      transactionIndex: null,
    };
    await assert.rejects(
      runtime.observeOwnerSubmission(address(1), prepared.operationId!, txHash),
      /TRADING_TRANSACTION_MISMATCH/,
    );
    assert.equal(runtime.operationView(address(1), prepared.operationId!).state, 'AWAITING_SIGNATURE');
    options.transaction = null;
    await runtime.observeOwnerSubmission(address(1), prepared.operationId!, txHash);
    assert.equal(runtime.operationView(address(1), prepared.operationId!).productReady, false);
    await runtime.close();
    runtime = new TradingChainRuntime({
      ...paths,
      manifest: f.manifest,
      inventory: f.inventory,
      rpc: f.client,
    });
    assert.equal(runtime.operationView(address(1), prepared.operationId!).state, 'SUBMITTED');
    await runtime.syncToHead();
    assert.equal(runtime.evidence.verify().records, 1);
    await runtime.close();
    await runtime.close();
  } finally {
    await runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test('a canonical replacement preserves orphaned history and appends corrected NAV; mismatched current positions cannot publish returns', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-runtime-reorg-')),
    options = rpcOptions(),
    f = tradingRpcFixture('NONE', options),
    runtime = new TradingChainRuntime({
      dbPath: join(folder, 'chain.sqlite'),
      evidencePath: join(folder, 'evidence.sqlite'),
      manifest: f.manifest,
      inventory: f.inventory,
      rpc: f.client,
    });
  try {
    await runtime.syncToHead();
    const before = runtime.evidence.verify();
    const forkHash = '0x' + 'ef'.repeat(32);
    options.hashAt = (n) => (n === 16 ? forkHash : '0x' + n.toString(16).padStart(64, '0'));
    await assert.rejects(runtime.syncToHead(), /TRADING_SYNC_FAILED/);
    assert.equal(runtime.status(), 'DEGRADED');
    assert.equal(runtime.ownedView(address(1)).performance, null);
    assert.deepEqual(runtime.evidence.verify(), before);
    options.logs = options.logs.map((log) =>
      log.blockNumber === '0x10' ? { ...log, blockHash: forkHash } : log,
    );
    await runtime.syncToHead();
    assert.equal(runtime.status(), 'HEALTHY');
    assert.equal(runtime.evidence.verify().records, 2);
    assert.equal(
      runtime.store.db.prepare('SELECT count(*) AS n FROM chain_blocks WHERE canonical=0').get()!.n,
      1,
    );
    const records = runtime.evidence.db
      .prepare('SELECT payload FROM evidence_records ORDER BY sequence')
      .all()
      .map((row) => JSON.parse(String(row.payload)));
    assert.equal(records[0].events[2].blockHash, hash);
    assert.equal(records[1].events[2].blockHash, forkHash);
  } finally {
    await runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test('maintenance pauses owner writes and invalidates an observation that was awaiting a remote lookup', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-runtime-pause-')),
    options = rpcOptions(),
    f = tradingRpcFixture('NONE', options),
    runtime = new TradingChainRuntime({
      dbPath: join(folder, 'chain.sqlite'),
      evidencePath: join(folder, 'evidence.sqlite'),
      manifest: f.manifest,
      inventory: f.inventory,
      rpc: f.client,
    });
  try {
    await runtime.syncToHead();
    const prepared = runtime.prepareOwnerAction(address(1), { kind: 'DEPOSIT', amountUsdc: '1' }),
      release = runtime.pauseWrites();
    assert.throws(() => runtime.prepareOwnerAction(address(1), { kind: 'STOP' }), /TRADING_WRITES_PAUSED/);
    await assert.rejects(
      runtime.observeOwnerSubmission(address(1), prepared.operationId!, txHash),
      /TRADING_WRITES_PAUSED/,
    );
    release();
    await runtime.observeOwnerSubmission(address(1), prepared.operationId!, txHash);
    assert.equal(runtime.operationView(address(1), prepared.operationId!).state, 'SUBMITTED');
  } finally {
    await runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ChainStore } from '../apps/server/src/chain-store.ts';
import { ChainSynchronizer, type ChainSynchronizerOptions } from '../apps/server/src/chain-sync.ts';
import type {
  ContractIntegration,
  DecodedContractEvent,
  ProjectionCandidate,
  ReconciliationResult,
} from '../packages/chain-adapter/src/reconciliation.ts';
import type {
  ChainBlock,
  ChainLog,
  ChainLogFilter,
  ChainReceipt,
  ReadonlyRpc,
} from '../packages/chain-adapter/src/rpc.ts';
import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  type HexData,
  type TransactionHash,
} from '../packages/chain-adapter/src/types.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import {
  deploymentManifestDigest,
  validateDeploymentManifest,
} from '../packages/chain-adapter/src/manifest.ts';
import { m3ChainSyncPolicy } from '../packages/chain-adapter/src/policy.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../packages/chain-adapter/src/pass-abi.ts';

const CHAIN_ID = 46_630;
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const TX_A = asTransactionHash(`0x${'aa'.repeat(32)}`);
const TX_B = asTransactionHash(`0x${'bb'.repeat(32)}`);
const SIG = asHexData(`0x${'cc'.repeat(32)}`);
const UNKNOWN_SIG = asHexData(`0x${'dd'.repeat(32)}`);
const HASH_99 = asBlockHash(`0x${'09'.repeat(32)}`);
const HASH_100 = asBlockHash(`0x${'10'.repeat(32)}`);
const HASH_100_ALT = asBlockHash(`0x${'15'.repeat(32)}`);
const HASH_101 = asBlockHash(`0x${'11'.repeat(32)}`);
const HASH_101_ALT = asBlockHash(`0x${'12'.repeat(32)}`);
const HASH_102 = asBlockHash(`0x${'13'.repeat(32)}`);
const ABI_HASH = asBlockHash(`0x${'66'.repeat(32)}`);
const PASS = asAddress('0x8888888888888888888888888888888888888888');

const manifestBody = {
  schemaVersion: 1,
  environment: 'robinhood-chain-testnet',
  chainId: CHAIN_ID,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: CONTRACT,
  deploymentBlock: '100',
  abiVersion: 'm3-owner-v1',
  abiHash: ABI_HASH,
  runtimeBytecodeHash: asBlockHash(`0x${'77'.repeat(32)}`),
  strategyPassAddress: PASS,
  strategyPassDeploymentBlock: '90',
  strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: asBlockHash(`0x${'88'.repeat(32)}`),
} as const;
const manifestDigest = deploymentManifestDigest(manifestBody);
const manifest = validateDeploymentManifest(
  { ...manifestBody, manifestDigest },
  {
    environment: 'robinhood-chain-testnet',
    chainId: CHAIN_ID,
    manifestDigest,
    contractAddress: CONTRACT,
  },
);

function block(
  number: bigint,
  hash: ReturnType<typeof asBlockHash>,
  parentHash: ReturnType<typeof asBlockHash>,
): ChainBlock {
  return { number, hash, parentHash, timestamp: 1_000n + number };
}

function log(
  txHash: TransactionHash,
  blockNumber: bigint,
  blockHash: ReturnType<typeof asBlockHash>,
  topic: HexData = SIG,
): ChainLog {
  return {
    address: CONTRACT,
    blockNumber,
    blockHash,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 0,
    data: asHexData('0x1234'),
    topics: [topic],
    removed: false,
  };
}

function receipt(
  txHash: TransactionHash,
  blockNumber: bigint,
  blockHash: ReturnType<typeof asBlockHash>,
  status: 'SUCCESS' | 'REVERTED' = 'SUCCESS',
  logs: readonly ChainLog[] = [log(txHash, blockNumber, blockHash)],
): ChainReceipt {
  return {
    transactionHash: txHash,
    blockNumber,
    blockHash,
    transactionIndex: 0,
    from: OWNER,
    to: CONTRACT,
    status,
    logs,
  };
}

class FixtureRpc implements ReadonlyRpc {
  readonly blocks = new Map<bigint, ChainBlock>();
  readonly receipts = new Map<TransactionHash, ChainReceipt | null>();
  networkChainId = CHAIN_ID;
  head = 100n;

  async chainId() {
    return this.networkChainId;
  }
  async code() {
    return asHexData('0x6000');
  }
  async block(number: bigint | 'latest') {
    return this.blocks.get(number === 'latest' ? this.head : number) ?? null;
  }
  async receipt(hash: TransactionHash) {
    return this.receipts.get(hash) ?? null;
  }
  async logs(filter: ChainLogFilter) {
    const values: ChainLog[] = [];
    for (const item of this.receipts.values()) {
      if (!item) continue;
      for (const value of item.logs) {
        if (value.blockNumber >= filter.fromBlock && value.blockNumber <= filter.toBlock) values.push(value);
      }
    }
    return values;
  }
  async call() {
    return asHexData('0x');
  }
}

const integration: ContractIntegration = {
  decode(value): DecodedContractEvent | null {
    const signature = value.topics[0];
    if (!signature) return null;
    return {
      eventSignature: signature,
      eventName: signature === SIG ? 'OwnerActionObserved' : 'UnexpectedEvent',
      normalizedData: { owner: OWNER, amount: '1000000' },
    };
  },
  async rebuildProjections({ events, block }): Promise<readonly ProjectionCandidate[]> {
    return events.some((value) => value.eventName === 'OwnerActionObserved')
      ? [
          {
            owner: OWNER,
            projectionKey: 'trend-vault',
            blockNumber: block.number,
            blockHash: block.hash,
            state: { strategyId: 'trend', principal: '1000000' },
          },
        ]
      : [];
  },
  async reconcileOperation({ events }): Promise<ReconciliationResult> {
    return events.some((value) => value.eventName === 'OwnerActionObserved')
      ? { status: 'MATCH' }
      : { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
  },
};

async function databasePath() {
  await mkdir('.checks', { recursive: true });
  const directory = await mkdtemp(resolve('.checks/chain-sync-'));
  return resolve(directory, 'chain.sqlite');
}

function submitted(operationId: string, hash: TransactionHash) {
  return transitionOperation(
    createOperation({
      operationId,
      chainId: CHAIN_ID,
      owner: OWNER,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: hash, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
}

function createSynchronizer(
  options: Omit<ChainSynchronizerOptions, 'policy'> & {
    readonly softReadyDepth?: number;
    readonly reorgSearchLimit?: number;
  },
): ChainSynchronizer {
  const { softReadyDepth = 3, reorgSearchLimit = 8, ...input } = options;
  return new ChainSynchronizer({
    ...input,
    policy: m3ChainSyncPolicy({ softReadyDepth, reorgSearchLimit }),
  });
}

test('M3 policy defaults to three-block soft readiness and a 128-block reorg search', () => {
  assert.deepEqual(m3ChainSyncPolicy(), { softReadyDepth: 3, reorgSearchLimit: 128 });
  assert.throws(() => m3ChainSyncPolicy({ softReadyDepth: 0 }), /INVALID_CHAIN_SYNC_POLICY/);
  assert.throws(() => m3ChainSyncPolicy({ reorgSearchLimit: 10_001 }), /INVALID_CHAIN_SYNC_POLICY/);
});

test('indexer requires an explicit validated chain policy', async () => {
  const store = new ChainStore(await databasePath());
  const rpc = new FixtureRpc();
  assert.throws(
    () =>
      new ChainSynchronizer({
        rpc,
        store,
        manifest,
        integration,
      } as unknown as ChainSynchronizerOptions),
    /INVALID_CHAIN_SYNC_POLICY/,
  );
  store.close();
});

test('indexer rejects invalid ranges, unavailable heads and untrackable operation identities', async () => {
  const invalidPolicyStore = new ChainStore(await databasePath());
  assert.throws(
    () =>
      createSynchronizer({
        rpc: new FixtureRpc(),
        store: invalidPolicyStore,
        manifest,
        integration,
        maxBlocksPerSync: 0,
      }),
    /INVALID_CHAIN_SYNC_POLICY/,
  );
  invalidPolicyStore.close();

  const unavailableStore = new ChainStore(await databasePath());
  const unavailable = createSynchronizer({
    rpc: new FixtureRpc(),
    store: unavailableStore,
    manifest,
    integration,
  });
  await assert.rejects(() => unavailable.head(), { code: 'CHAIN_HEAD_UNAVAILABLE' });
  await assert.rejects(() => unavailable.syncTo(99n), { code: 'CHAIN_HEAD_BEFORE_DEPLOYMENT' });
  await assert.rejects(() => unavailable.syncTo(101n, 100n), { code: 'CHAIN_SYNC_TARGET_BEHIND' });
  await assert.rejects(() => unavailable.syncTo(100n), { code: 'CHAIN_HEAD_UNAVAILABLE' });
  await assert.rejects(() => unavailable.trackOperation('absent'), { code: 'OPERATION_NOT_FOUND' });
  unavailableStore.saveOperation(
    createOperation({
      operationId: 'unsigned',
      chainId: CHAIN_ID,
      owner: OWNER,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
  );
  await assert.rejects(() => unavailable.trackOperation('unsigned'), { code: 'OPERATION_NOT_TRACKABLE' });
  unavailableStore.saveOperation(submitted('receipt-pending', TX_A));
  await assert.rejects(() => unavailable.trackOperation('receipt-pending'), {
    code: 'CHAIN_HEAD_UNAVAILABLE',
  });
  assert.throws(() => unavailable.recordReplacement('absent', TX_B), { code: 'OPERATION_NOT_FOUND' });
  assert.throws(() => unavailable.recordDropped('absent'), { code: 'OPERATION_NOT_FOUND' });
  unavailableStore.close();

  const rangeRpc = new FixtureRpc();
  rangeRpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rangeRpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  const rangeStore = new ChainStore(await databasePath());
  const range = createSynchronizer({
    rpc: rangeRpc,
    store: rangeStore,
    manifest,
    integration,
    maxBlocksPerSync: 1,
  });
  await assert.rejects(() => range.syncTo(101n), { code: 'CHAIN_SYNC_RANGE_EXCEEDED' });
  rangeStore.close();

  const mismatchRpc = new FixtureRpc();
  mismatchRpc.blocks.set(100n, block(101n, HASH_100, HASH_99));
  const mismatchStore = new ChainStore(await databasePath());
  const mismatch = createSynchronizer({ rpc: mismatchRpc, store: mismatchStore, manifest, integration });
  await assert.rejects(() => mismatch.syncTo(100n), { code: 'CHAIN_BLOCK_MISMATCH' });
  mismatchStore.close();
});

test('indexer ignores unknown logs without granting a projection', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(
    TX_A,
    receipt(TX_A, 100n, HASH_100, 'SUCCESS', [{ ...log(TX_A, 100n, HASH_100), topics: [] }]),
  );
  const store = new ChainStore(await databasePath());
  const sync = createSynchronizer({ rpc, store, manifest, integration });
  assert.deepEqual(await sync.syncTo(100n), { scannedBlocks: 1, insertedEvents: 0, reorgedBlocks: 0 });
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 0);
  assert.equal(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), null);
  store.close();
});

test('indexer replay and restart keep one event and rebuildable wallet projection', async () => {
  const path = await databasePath();
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  let store = new ChainStore(path);
  let sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 3 });
  assert.deepEqual(await sync.syncTo(100n), { scannedBlocks: 1, insertedEvents: 1, reorgedBlocks: 0 });
  assert.deepEqual(await sync.syncTo(100n), { scannedBlocks: 0, insertedEvents: 0, reorgedBlocks: 0 });
  store.close();

  store = new ChainStore(path);
  sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 3 });
  assert.deepEqual(await sync.syncTo(100n), { scannedBlocks: 0, insertedEvents: 0, reorgedBlocks: 0 });
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 1);
  assert.deepEqual(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.state, {
    principal: '1000000',
    strategyId: 'trend',
  });

  store.rollbackFromBlock(CHAIN_ID, CONTRACT, 100n);
  assert.deepEqual(await sync.syncTo(100n), { scannedBlocks: 1, insertedEvents: 1, reorgedBlocks: 0 });
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 1);
  store.close();
});

test('receipt and tx hash remain confirming until canonical event reconciliation reaches injected depth', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.blocks.set(102n, block(102n, HASH_102, HASH_101));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  rpc.head = 101n;
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-confirm', TX_A));
  const sync = createSynchronizer({
    rpc,
    store,
    manifest,
    integration,
    softReadyDepth: 3,
    now: () => '2026-09-14T12:01:00.000Z',
  });

  const confirming = await sync.trackOperation('operation-confirm');
  assert.equal(confirming.state, 'CONFIRMING');
  assert.equal(confirming.confirmations, 2);
  assert.equal(confirming.reconciled, true);
  assert.equal(confirming.confirmedAt, null);

  rpc.head = 102n;
  const confirmed = await sync.trackOperation('operation-confirm');
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.transactionIndex, 0);
  assert.equal(confirmed.confirmations, 3);
  assert.equal(confirmed.reconciled, true);
  assert.equal(confirmed.confirmedAt, '2026-09-14T12:01:00.000Z');
  store.close();
});

test('delayed operation reconciliation cannot overwrite a newer synchronized projection', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  rpc.head = 100n;
  const reconcileStarted = Promise.withResolvers<void>();
  const allowReconciliation = Promise.withResolvers<void>();
  const delayedIntegration: ContractIntegration = {
    ...integration,
    async reconcileOperation(input): Promise<ReconciliationResult> {
      reconcileStarted.resolve();
      await allowReconciliation.promise;
      return integration.reconcileOperation(input);
    },
  };
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-delayed-reconciliation', TX_A));
  const sync = createSynchronizer({
    rpc,
    store,
    manifest,
    integration: delayedIntegration,
    softReadyDepth: 1,
  });

  const tracking = sync.trackOperation('operation-delayed-reconciliation');
  await reconcileStarted.promise;
  rpc.head = 101n;
  await sync.syncTo(101n);
  allowReconciliation.resolve();
  await assert.rejects(() => tracking, { code: 'CHAIN_SYNC_SUPERSEDED' });
  assert.equal(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.blockNumber, 101n);
  store.close();
});

test('same-block operation reconciliation cannot replace the rebuilt final projection', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  const sameBlockIntegration: ContractIntegration = {
    ...integration,
    async rebuildProjections({ block }) {
      return [
        {
          owner: OWNER,
          projectionKey: 'trend-vault',
          blockNumber: block.number,
          blockHash: block.hash,
          state: { version: 'final' },
        },
      ];
    },
    async reconcileOperation() {
      return { status: 'MATCH' };
    },
  };
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-same-block-reconciliation', TX_A));
  const sync = createSynchronizer({
    rpc,
    store,
    manifest,
    integration: sameBlockIntegration,
    softReadyDepth: 1,
  });

  assert.equal((await sync.trackOperation('operation-same-block-reconciliation')).state, 'CONFIRMED');
  assert.deepEqual(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.state, {
    version: 'final',
  });
  store.close();
});

test('unexpected event evidence fails closed after a successful receipt', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100, 'SUCCESS', [log(TX_A, 100n, HASH_100, UNKNOWN_SIG)]));
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-mismatch', TX_A));
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  const result = await sync.trackOperation('operation-mismatch');
  assert.equal(result.state, 'RECONCILIATION_FAILED');
  assert.equal(result.errorCode, 'EVENT_EVIDENCE_MISMATCH');
  assert.equal(result.confirmedAt, null);
  store.close();
});

test('reverted receipt never creates a confirmed projection', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100, 'REVERTED', []));
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-reverted', TX_A));
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  const result = await sync.trackOperation('operation-reverted');
  assert.equal(result.state, 'REVERTED');
  assert.equal(result.receiptStatus, 'REVERTED');
  assert.equal(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), null);
  store.close();
});

test('block-hash mismatch rewinds to a common ancestor and replays the canonical fork', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.receipts.set(TX_A, receipt(TX_A, 101n, HASH_101));
  rpc.head = 101n;
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-reorg', TX_A));
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  assert.equal((await sync.trackOperation('operation-reorg')).state, 'CONFIRMED');

  rpc.blocks.set(101n, block(101n, HASH_101_ALT, HASH_100));
  rpc.receipts.delete(TX_A);
  rpc.receipts.set(TX_B, receipt(TX_B, 101n, HASH_101_ALT));
  assert.deepEqual(await sync.syncTo(101n), { scannedBlocks: 1, insertedEvents: 1, reorgedBlocks: 1 });
  assert.equal(store.operation('operation-reorg')?.state, 'REORGED');
  assert.deepEqual(
    store.canonicalEvents(CHAIN_ID, CONTRACT).map((value) => value.transactionHash),
    [TX_B],
  );
  const dropped = sync.recordDropped('operation-reorg');
  assert.equal(dropped.state, 'DROPPED');
  assert.equal(store.operation('operation-reorg')?.state, 'DROPPED');
  assert.equal(store.operation('operation-reorg')?.blockNumber, 101n);
  assert.equal(store.operation('operation-reorg')?.transactionIndex, 0);
  assert.equal(store.operation('operation-reorg')?.receiptStatus, 'SUCCESS');
  assert.equal(store.operation('operation-reorg')?.canonical, false);
  const droppedEvidence = store.operationEvidence('operation-reorg', 'trend-vault');
  assert.equal(droppedEvidence?.receipt, 'SUCCESS');
  assert.equal(droppedEvidence?.receiptCanonical, false);
  assert.equal(droppedEvidence?.chainStatus, 'FAILED');
  assert.equal(droppedEvidence?.productReady, false);
  store.close();
});

test('replacement and dropped outcomes require explicit backend evidence', async () => {
  const rpc = new FixtureRpc();
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-replaced', TX_A));
  store.saveOperation(submitted('operation-dropped', TX_B));
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  assert.equal(sync.recordReplacement('operation-replaced', TX_B).state, 'REPLACED');
  assert.equal(sync.recordDropped('operation-dropped').state, 'DROPPED');
  store.close();
});

test('wrong-chain RPC fails before any checkpoint or projection is persisted', async () => {
  const rpc = new FixtureRpc();
  rpc.networkChainId = 1;
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  const store = new ChainStore(await databasePath());
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  await assert.rejects(() => sync.syncTo(100n), { code: 'CHAIN_ID_MISMATCH' });
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  store.close();
});

test('provider logs outside the trusted contract and block fail closed', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  const foreignLog = {
    ...log(TX_A, 100n, HASH_100),
    address: asAddress('0x3333333333333333333333333333333333333333'),
  };
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100, 'SUCCESS', [foreignLog]));
  const store = new ChainStore(await databasePath());
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  await assert.rejects(() => sync.syncTo(100n), { code: 'CHAIN_LOG_MISMATCH' });
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  store.close();
});

test('projection rebuild failure removes the partially indexed canonical block', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  const store = new ChainStore(await databasePath());
  const failingIntegration: ContractIntegration = {
    ...integration,
    async rebuildProjections() {
      throw new Error('fixture failure');
    },
  };
  const sync = createSynchronizer({
    rpc,
    store,
    manifest,
    integration: failingIntegration,
    softReadyDepth: 1,
  });
  await assert.rejects(() => sync.syncTo(100n), { code: 'PROJECTION_REBUILD_FAILED' });
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 0);
  store.close();
});

test('cross-fork parent mismatch keeps an incomplete prefix unreadable until recovery reaches the head', async () => {
  const path = await databasePath();
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100_ALT, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100_ALT));
  let store = new ChainStore(path);
  let sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });

  await assert.rejects(() => sync.syncTo(101n), { code: 'CHAIN_BLOCK_MISMATCH' });
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: HASH_100_ALT,
  });
  assert.deepEqual(store.projectionCheckpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: HASH_100_ALT,
  });
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  store.close();

  store = new ChainStore(path);
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  await assert.rejects(() => sync.syncTo(100n), { code: 'CHAIN_SYNC_TARGET_BEHIND' });
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100_ALT));
  assert.deepEqual(await sync.syncTo(101n), {
    scannedBlocks: 1,
    insertedEvents: 0,
    reorgedBlocks: 0,
  });
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  assert.equal(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.blockNumber, 101n);
  store.close();
});

test('concurrent sync requests are serialized before they inspect mutable RPC context', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  let activeChainChecks = 0;
  let maximumConcurrentChainChecks = 0;
  rpc.chainId = async () => {
    activeChainChecks++;
    maximumConcurrentChainChecks = Math.max(maximumConcurrentChainChecks, activeChainChecks);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeChainChecks--;
    return CHAIN_ID;
  };
  const store = new ChainStore(await databasePath());
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  await Promise.all([sync.syncTo(100n), sync.syncTo(101n)]);
  assert.equal(maximumConcurrentChainChecks, 1);
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 101n,
    blockHash: HASH_101,
  });
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  store.close();
});

test('separate synchronizers cannot clear a higher incomplete target through a lower-head completion', async () => {
  const lowRpc = new FixtureRpc();
  lowRpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  const highRpc = new FixtureRpc();
  highRpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  highRpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  highRpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  const lowHeadStarted = Promise.withResolvers<void>();
  const allowLowHead = Promise.withResolvers<void>();
  const highSecondBlockStarted = Promise.withResolvers<void>();
  const allowHighFailure = Promise.withResolvers<void>();
  const originalLowBlock = lowRpc.block.bind(lowRpc);
  let firstLowHead = true;
  lowRpc.block = async (number) => {
    if (number === 100n && firstLowHead) {
      firstLowHead = false;
      lowHeadStarted.resolve();
      await allowLowHead.promise;
    }
    return originalLowBlock(number);
  };
  const originalHighBlock = highRpc.block.bind(highRpc);
  let high101Reads = 0;
  highRpc.block = async (number) => {
    if (number === 101n && ++high101Reads === 2) {
      highSecondBlockStarted.resolve();
      await allowHighFailure.promise;
      return null;
    }
    return originalHighBlock(number);
  };

  const store = new ChainStore(await databasePath());
  const lowSync = createSynchronizer({
    rpc: lowRpc,
    store,
    manifest,
    integration,
    softReadyDepth: 1,
  });
  const highSync = createSynchronizer({
    rpc: highRpc,
    store,
    manifest,
    integration,
    softReadyDepth: 1,
  });
  const lowAttempt = lowSync.syncTo(100n);
  await lowHeadStarted.promise;
  const highAttempt = highSync.syncTo(101n);
  await highSecondBlockStarted.promise;
  allowLowHead.resolve();
  await assert.rejects(() => lowAttempt, { code: 'CHAIN_SYNC_TARGET_BEHIND' });
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  allowHighFailure.resolve();
  await assert.rejects(() => highAttempt, { code: 'CHAIN_BLOCK_UNAVAILABLE' });
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);

  const recovery = createSynchronizer({
    rpc: highRpc,
    store,
    manifest,
    integration,
    softReadyDepth: 1,
  });
  highRpc.block = originalHighBlock;
  await recovery.syncTo(101n);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  assert.equal(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.blockNumber, 101n);
  store.close();
});

test('a stale lower-head synchronizer cannot roll back a completed higher-head sync', async () => {
  const path = await databasePath();
  const lowRpc = new FixtureRpc();
  lowRpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  const highRpc = new FixtureRpc();
  highRpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  highRpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  highRpc.receipts.set(TX_A, receipt(TX_A, 101n, HASH_101));
  const lowHeadStarted = Promise.withResolvers<void>();
  const allowLowHead = Promise.withResolvers<void>();
  const originalLowLogs = lowRpc.logs.bind(lowRpc);
  lowRpc.logs = async (filter) => {
    lowHeadStarted.resolve();
    await allowLowHead.promise;
    return originalLowLogs(filter);
  };

  const lowStore = new ChainStore(path);
  const highStore = new ChainStore(path);
  const lowSync = createSynchronizer({
    rpc: lowRpc,
    store: lowStore,
    manifest,
    integration,
    softReadyDepth: 1,
  });
  const highSync = createSynchronizer({
    rpc: highRpc,
    store: highStore,
    manifest,
    integration,
    softReadyDepth: 1,
  });

  const lowAttempt = lowSync.syncTo(100n);
  await lowHeadStarted.promise;
  assert.deepEqual(await highSync.syncTo(101n), {
    scannedBlocks: 2,
    insertedEvents: 1,
    reorgedBlocks: 0,
  });
  allowLowHead.resolve();
  await assert.rejects(() => lowAttempt, { code: 'CHAIN_SYNC_SUPERSEDED' });
  assert.deepEqual(highStore.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 101n,
    blockHash: HASH_101,
  });
  assert.deepEqual(highStore.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  assert.equal(highStore.canonicalEvents(CHAIN_ID, CONTRACT).length, 1);
  assert.equal(highStore.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.blockNumber, 101n);
  lowStore.close();
  highStore.close();
});

test('restart rebuilds a projection when a block checkpoint committed before projection commit', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  const store = new ChainStore(await databasePath());
  const raw = log(TX_A, 100n, HASH_100);
  const decoded = integration.decode(raw)!;
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, rpc.blocks.get(100n)!, [
    { ...raw, chainId: CHAIN_ID, ...decoded },
  ]);
  assert.equal(store.projectionCheckpoint(CHAIN_ID, CONTRACT), null);
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_PROJECTION_PENDING/);
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  assert.deepEqual(await sync.syncTo(100n), { scannedBlocks: 0, insertedEvents: 0, reorgedBlocks: 0 });
  assert.deepEqual(store.projectionCheckpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: HASH_100,
  });
  assert.deepEqual(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.state, {
    principal: '1000000',
    strategyId: 'trend',
  });
  store.close();
});

test('temporarily unavailable checkpoint block blocks reads without destructive reorg rollback', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  const store = new ChainStore(await databasePath());
  const sync = createSynchronizer({ rpc, store, manifest, integration, softReadyDepth: 1 });
  await sync.syncTo(100n);
  rpc.blocks.delete(100n);
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.head = 101n;
  await assert.rejects(() => sync.syncTo(101n), { code: 'CHAIN_BLOCK_UNAVAILABLE' });
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: HASH_100,
  });
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  await sync.syncTo(101n);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  assert.equal(store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault')?.blockNumber, 101n);
  store.close();
});

test('reorg beyond the configured search bound marks projections unhealthy', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.blocks.set(102n, block(102n, HASH_102, HASH_101));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  rpc.head = 102n;
  const store = new ChainStore(await databasePath());
  store.saveOperation(submitted('operation-degraded', TX_A));
  const sync = createSynchronizer({
    rpc,
    store,
    manifest,
    integration,
    softReadyDepth: 1,
    reorgSearchLimit: 1,
  });
  await sync.syncTo(102n);
  rpc.blocks.set(101n, block(101n, HASH_101_ALT, HASH_100));
  rpc.blocks.set(102n, block(102n, asBlockHash(`0x${'14'.repeat(32)}`), HASH_101_ALT));
  await assert.rejects(() => sync.syncTo(102n), { code: 'CHAIN_REORG_DEPTH_EXCEEDED' });
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_REORG_DEPTH_EXCEEDED',
  });
  assert.deepEqual(store.operationEvidence('operation-degraded', 'trend-vault'), {
    lifecycle: 'SUBMITTED',
    receipt: 'PENDING',
    receiptCanonical: false,
    confirmations: 0,
    reconciliation: 'PENDING',
    projection: 'STALE',
    chainStatus: 'PENDING',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'DEGRADED',
    degradedReason: 'CHAIN_REORG_DEPTH_EXCEEDED',
    productReady: false,
  });
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  store.close();
});

test('reorg without a verified common ancestor degrades without erasing indexed history', async () => {
  const rpc = new FixtureRpc();
  rpc.blocks.set(100n, block(100n, HASH_100, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101, HASH_100));
  rpc.blocks.set(102n, block(102n, HASH_102, HASH_101));
  rpc.receipts.set(TX_A, receipt(TX_A, 100n, HASH_100));
  rpc.head = 102n;
  const store = new ChainStore(await databasePath());
  const sync = createSynchronizer({ rpc, store, manifest, integration });
  await sync.syncTo(102n);

  const hash102Alt = asBlockHash(`0x${'14'.repeat(32)}`);
  rpc.blocks.set(100n, block(100n, HASH_100_ALT, HASH_99));
  rpc.blocks.set(101n, block(101n, HASH_101_ALT, HASH_100_ALT));
  rpc.blocks.set(102n, block(102n, hash102Alt, HASH_101_ALT));
  await assert.rejects(() => sync.syncTo(102n), { code: 'CHAIN_REORG_NO_COMMON_ANCESTOR' });

  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_REORG_NO_COMMON_ANCESTOR',
  });
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 102n,
    blockHash: HASH_102,
  });
  assert.equal(store.canonicalBlock(CHAIN_ID, CONTRACT, 100n)?.hash, HASH_100);
  assert.equal(store.canonicalBlock(CHAIN_ID, CONTRACT, 102n)?.hash, HASH_102);
  assert.throws(() => store.projection(CHAIN_ID, OWNER, CONTRACT, 'trend-vault'), /CHAIN_SYNC_UNHEALTHY/);
  store.close();
});

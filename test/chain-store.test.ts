import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { ChainStore, type IndexedChainEvent } from '../apps/server/src/chain-store.ts';
import { ChainSynchronizer } from '../apps/server/src/chain-sync.ts';
import type { DeploymentManifest } from '../packages/chain-adapter/src/manifest.ts';
import type { ReadonlyRpc } from '../packages/chain-adapter/src/rpc.ts';
import { asAddress, asBlockHash, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import type { ChainOperation } from '../packages/chain-adapter/src/lifecycle.ts';

const CHAIN_ID = 46_630;
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const OWNER_A = asAddress('0x1111111111111111111111111111111111111111');
const OWNER_B = asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const BLOCK_99 = asBlockHash(`0x${'09'.repeat(32)}`);
const BLOCK_100 = asBlockHash(`0x${'10'.repeat(32)}`);
const BLOCK_101 = asBlockHash(`0x${'11'.repeat(32)}`);
const BLOCK_101_ALT = asBlockHash(`0x${'12'.repeat(32)}`);
const TX_A = asTransactionHash(`0x${'aa'.repeat(32)}`);
const TX_B = asTransactionHash(`0x${'bb'.repeat(32)}`);
const SIGNATURE = asHexData(`0x${'cc'.repeat(32)}`);

async function databasePath() {
  await mkdir('.checks', { recursive: true });
  const directory = await mkdtemp(resolve('.checks/chain-store-'));
  return resolve(directory, 'chain.sqlite');
}

function event(overrides: Partial<IndexedChainEvent> = {}): IndexedChainEvent {
  return {
    chainId: CHAIN_ID,
    address: CONTRACT,
    blockNumber: 100n,
    blockHash: BLOCK_100,
    transactionHash: TX_A,
    transactionIndex: 1,
    logIndex: 0,
    data: asHexData('0x1234'),
    topics: [SIGNATURE],
    removed: false,
    eventSignature: SIGNATURE,
    eventName: 'OwnerActionObserved',
    normalizedData: { owner: OWNER_A, amount: '1000000' },
    ...overrides,
  };
}

test('transaction identity conflicts use a fixed store error', async () => {
  const store = new ChainStore(await databasePath());
  const submitted = transitionOperation(
    createOperation({
      operationId: 'transaction-owner',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-20T00:00:00.000Z' },
  );
  store.saveOperation(submitted);
  assert.throws(
    () => store.saveOperation({ ...submitted, operationId: 'transaction-collision' }),
    /OPERATION_IDENTITY_CONFLICT/,
  );
  assert.equal(store.operationByTransaction(CHAIN_ID, TX_A)?.operationId, 'transaction-owner');
  store.close();
});

test('an existing operation id cannot be rebound to another owner', async () => {
  const store = new ChainStore(await databasePath());
  const awaiting = createOperation({
    operationId: 'fixed-operation-identity',
    chainId: CHAIN_ID,
    owner: OWNER_A,
    target: CONTRACT,
    state: 'AWAITING_SIGNATURE',
  });
  store.saveOperation(awaiting);
  assert.throws(() => store.saveOperation({ ...awaiting, owner: OWNER_B }), /OPERATION_IDENTITY_CONFLICT/);
  assert.equal(store.operation('fixed-operation-identity')?.owner, OWNER_A);
  store.close();
});

test('duplicate chain event observation is idempotent across restart', async () => {
  const path = await databasePath();
  let store = new ChainStore(path);
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  assert.deepEqual(store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]), {
    insertedEvents: 1,
    checkpoint: { blockNumber: 100n, blockHash: BLOCK_100 },
  });
  assert.deepEqual(store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]), {
    insertedEvents: 0,
    checkpoint: { blockNumber: 100n, blockHash: BLOCK_100 },
  });
  store.close();
  store = new ChainStore(path);
  assert.deepEqual(store.canonicalEvents(CHAIN_ID, CONTRACT), [event()]);
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: BLOCK_100,
  });
  store.close();
});

test('canonical events are read in block, transaction and log order', async () => {
  const store = new ChainStore(await databasePath());
  const laterTransaction = event({ transactionHash: TX_B, transactionIndex: 2, logIndex: 0 });
  const laterLog = event({ transactionHash: TX_A, transactionIndex: 1, logIndex: 2 });
  const firstLog = event({ transactionHash: TX_A, transactionIndex: 1, logIndex: 0 });
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [laterTransaction, laterLog, firstLog],
  );
  assert.deepEqual(
    store.canonicalEvents(CHAIN_ID, CONTRACT).map((value) => [value.transactionHash, value.logIndex]),
    [
      [TX_A, 0],
      [TX_A, 2],
      [TX_B, 0],
    ],
  );
  store.close();
});

test('one canonical block cannot contain duplicate transaction-log identities', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  assert.throws(
    () =>
      store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event(), event({ data: asHexData('0xffff') })]),
    /CHAIN_EVENT_CONFLICT/,
  );
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 0);
  store.close();
});

test('canonical block commit fails closed if its checkpoint disappears before target update', async () => {
  const store = new ChainStore(await databasePath());
  store.db.exec(`
    CREATE TRIGGER delete_new_checkpoint
    AFTER INSERT ON chain_checkpoints
    BEGIN
      DELETE FROM chain_checkpoints
      WHERE chain_id = NEW.chain_id AND contract_address = NEW.contract_address;
    END;
  `);
  assert.throws(
    () =>
      store.recordCanonicalBlock(
        CHAIN_ID,
        CONTRACT,
        { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
        [],
        101n,
      ),
    /CHAIN_CHECKPOINT_NOT_FOUND/,
  );
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  assert.equal(store.canonicalBlock(CHAIN_ID, CONTRACT, 100n), null);
  store.close();
});

test('conflicting duplicate identity fails without changing canonical evidence', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
  assert.throws(
    () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event({ data: asHexData('0xffff') })]),
    /CHAIN_EVENT_CONFLICT/,
  );
  assert.deepEqual(store.canonicalEvents(CHAIN_ID, CONTRACT), [event()]);
  store.close();
});

test('same block and event count cannot replay a different canonical event set', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
  assert.throws(
    () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event({ transactionHash: TX_B })]),
    /CHAIN_BLOCK_CONFLICT/,
  );
  assert.deepEqual(store.canonicalEvents(CHAIN_ID, CONTRACT), [event()]);
  store.close();
});

test('rollback marks displaced evidence and operations reorged and removes newer projections', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
  );
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [event({ blockNumber: 101n, blockHash: BLOCK_101 })],
  );
  const submitted = transitionOperation(
    createOperation({
      operationId: 'operation-reorg',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 101n,
    blockHash: BLOCK_101,
    receiptStatus: 'SUCCESS',
  });
  store.saveOperation(transitionOperation(mined, { state: 'CONFIRMING', confirmations: 1 }));
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [
      {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'vault-a',
        blockNumber: 101n,
        blockHash: BLOCK_101,
        state: { principal: '1000000' },
      },
    ],
  );

  assert.deepEqual(store.rollbackFromBlock(CHAIN_ID, CONTRACT, 101n), {
    blocks: 1,
    events: 1,
    operations: 1,
    projections: 1,
  });
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: BLOCK_100,
  });
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 0);
  assert.equal(store.operation('operation-reorg')?.state, 'REORGED');
  assert.equal(store.operation('operation-reorg')?.canonical, false);
  assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'vault-a'), /CHAIN_PROJECTION_PENDING/);
  store.close();
});

test('a reorged event may reappear under a new canonical block without duplicating its identity', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
  );
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [event({ blockNumber: 101n, blockHash: BLOCK_101 })],
  );
  store.rollbackFromBlock(CHAIN_ID, CONTRACT, 101n);
  const replacement = event({ blockNumber: 101n, blockHash: BLOCK_101_ALT });
  assert.deepEqual(
    store.recordCanonicalBlock(
      CHAIN_ID,
      CONTRACT,
      { number: 101n, hash: BLOCK_101_ALT, parentHash: BLOCK_100, timestamp: 1_011n },
      [replacement],
    ),
    { insertedEvents: 1, checkpoint: { blockNumber: 101n, blockHash: BLOCK_101_ALT } },
  );
  assert.deepEqual(store.canonicalEvents(CHAIN_ID, CONTRACT), [replacement]);
  store.close();
});

test('cyclic normalized event data fails with a bounded store error', async () => {
  const store = new ChainStore(await databasePath());
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(
    () =>
      store.recordCanonicalBlock(
        CHAIN_ID,
        CONTRACT,
        { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
        [event({ normalizedData: cyclic })],
      ),
    /INVALID_CHAIN_JSON/,
  );
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  store.close();
});

test('cyclic arrays in normalized event data fail without recursion exhaustion', async () => {
  const store = new ChainStore(await databasePath());
  const list: unknown[] = [];
  list.push(list);
  assert.throws(
    () =>
      store.recordCanonicalBlock(
        CHAIN_ID,
        CONTRACT,
        { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
        [event({ normalizedData: { list } })],
      ),
    /INVALID_CHAIN_JSON/,
  );
  store.close();
});

test('wallet projections remain independent and do not imply product-account ownership', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
  );
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [
      [OWNER_A, '1000000'],
      [OWNER_B, '2500000'],
    ].map(([owner, principal]) => ({
      chainId: CHAIN_ID,
      owner: asAddress(owner!),
      contract: CONTRACT,
      projectionKey: 'vault-shared-key',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      state: { principal },
    })),
  );
  assert.deepEqual(store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'vault-shared-key')?.state, {
    principal: '1000000',
  });
  assert.deepEqual(store.projection(CHAIN_ID, OWNER_B, CONTRACT, 'vault-shared-key')?.state, {
    principal: '2500000',
  });
  store.close();
});

test('product readiness is computed under one canonical database snapshot', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
  );
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [],
  );
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [
      {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'vault-a',
        blockNumber: 101n,
        blockHash: BLOCK_101,
        state: { principal: '1000000' },
      },
    ],
  );
  const submitted = transitionOperation(
    createOperation({
      operationId: 'operation-snapshot',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 100n,
    blockHash: BLOCK_100,
    receiptStatus: 'SUCCESS',
  });
  const confirming = transitionOperation(mined, {
    state: 'CONFIRMING',
    confirmations: 2,
    reconciled: true,
  });
  store.saveOperation(confirming);
  assert.deepEqual(store.operationEvidence('operation-snapshot', 'missing-projection'), {
    lifecycle: 'CONFIRMING',
    receipt: 'SUCCESS',
    receiptCanonical: true,
    confirmations: 2,
    reconciliation: 'MATCHED',
    projection: 'PENDING',
    chainStatus: 'INCLUDED',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'HEALTHY',
    degradedReason: null,
    productReady: false,
  });
  store.saveOperation(
    transitionOperation(confirming, {
      state: 'CONFIRMED',
      confirmations: 3,
      reconciled: true,
      confirmedAt: '2026-09-14T12:01:00.000Z',
    }),
  );

  assert.deepEqual(store.operationEvidence('operation-snapshot', 'vault-a'), {
    lifecycle: 'CONFIRMED',
    receipt: 'SUCCESS',
    receiptCanonical: true,
    confirmations: 3,
    reconciliation: 'MATCHED',
    projection: 'READY',
    chainStatus: 'SOFT_READY',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'HEALTHY',
    degradedReason: null,
    productReady: true,
  });
  store.close();
});

test('operation evidence maps every terminal and in-flight lifecycle without inventing readiness', async () => {
  const store = new ChainStore(await databasePath());
  const unsigned = (operationId: string) =>
    createOperation({
      operationId,
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    });
  const submit = (operationId: string, byte: string) =>
    transitionOperation(unsigned(operationId), {
      state: 'SUBMITTED',
      txHash: asTransactionHash(`0x${byte.repeat(64)}`),
      submittedAt: '2026-09-20T00:00:00.000Z',
    });
  const mine = (operationId: string, byte: string) =>
    transitionOperation(submit(operationId, byte), {
      state: 'MINED',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      receiptStatus: 'SUCCESS',
    });
  const cases = [
    {
      operation: unsigned('evidence-awaiting'),
      chainStatus: 'PENDING',
      reconciliation: 'PENDING',
      receipt: 'PENDING',
      receiptCanonical: false,
    },
    {
      operation: mine('evidence-mined', '1'),
      chainStatus: 'INCLUDED',
      reconciliation: 'PENDING',
      receipt: 'SUCCESS',
      receiptCanonical: true,
    },
    {
      operation: transitionOperation(unsigned('evidence-rejected'), {
        state: 'REJECTED',
        errorCode: 'WALLET_REJECTED',
      }),
      chainStatus: 'FAILED',
      reconciliation: 'PENDING',
      receipt: 'PENDING',
      receiptCanonical: false,
    },
    {
      operation: transitionOperation(submit('evidence-reverted', '2'), {
        state: 'REVERTED',
        blockNumber: 100n,
        blockHash: BLOCK_100,
        receiptStatus: 'REVERTED',
        errorCode: 'TRANSACTION_REVERTED',
      }),
      chainStatus: 'FAILED',
      reconciliation: 'PENDING',
      receipt: 'REVERTED',
      receiptCanonical: true,
    },
    {
      operation: transitionOperation(submit('evidence-replaced', '3'), {
        state: 'REPLACED',
        replacementTxHash: asTransactionHash(`0x${'4'.repeat(64)}`),
        errorCode: 'TRANSACTION_REPLACED',
      }),
      chainStatus: 'FAILED',
      reconciliation: 'PENDING',
      receipt: 'PENDING',
      receiptCanonical: false,
    },
    {
      operation: transitionOperation(mine('evidence-reorged', '5'), {
        state: 'REORGED',
        errorCode: 'CHAIN_REORG',
      }),
      chainStatus: 'REORGED',
      reconciliation: 'PENDING',
      receipt: 'SUCCESS',
      receiptCanonical: false,
    },
    {
      operation: transitionOperation(mine('evidence-reconciliation-failed', '6'), {
        state: 'RECONCILIATION_FAILED',
        errorCode: 'EVENT_EVIDENCE_MISMATCH',
      }),
      chainStatus: 'FAILED',
      reconciliation: 'FAILED',
      receipt: 'SUCCESS',
      receiptCanonical: true,
    },
  ] as const;

  for (const value of cases) {
    store.saveOperation(value.operation);
    const evidence = store.operationEvidence(value.operation.operationId, 'vault-a');
    assert.equal(evidence?.lifecycle, value.operation.state);
    assert.equal(evidence?.chainStatus, value.chainStatus);
    assert.equal(evidence?.reconciliation, value.reconciliation);
    assert.equal(evidence?.receipt, value.receipt);
    assert.equal(evidence?.receiptCanonical, value.receiptCanonical);
    assert.equal(evidence?.indexerStatus, 'SYNCING');
    assert.equal(evidence?.projection, value.operation.state === 'REORGED' ? 'STALE' : 'PENDING');
    assert.equal(evidence?.productReady, false);
  }
  store.close();
});

test('an incomplete checkpoint remains syncing and exposes no degraded reason', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
    101n,
  );
  const operation = transitionOperation(
    createOperation({
      operationId: 'evidence-incomplete-sync',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-20T00:00:00.000Z' },
  );
  store.saveOperation(operation);
  const evidence = store.operationEvidence(operation.operationId, 'vault-a');
  assert.equal(evidence?.indexerStatus, 'SYNCING');
  assert.equal(evidence?.degradedReason, null);
  assert.equal(evidence?.productReady, false);
  store.close();
});

test('projection commits fail closed when canonical evidence changes inside the commit boundary', async () => {
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  const projection = {
    chainId: CHAIN_ID,
    owner: OWNER_A,
    contract: CONTRACT,
    projectionKey: 'vault-a',
    blockNumber: 100n,
    blockHash: BLOCK_100,
    state: { principal: '1000000' },
  } as const;

  const checkpointRace = new ChainStore(await databasePath());
  checkpointRace.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  const originalCheckpointCanonical = checkpointRace.canonicalBlock.bind(checkpointRace);
  let checkpointReads = 0;
  Object.defineProperty(checkpointRace, 'canonicalBlock', {
    configurable: true,
    value: (...args: Parameters<ChainStore['canonicalBlock']>) =>
      ++checkpointReads === 2 ? null : originalCheckpointCanonical(...args),
  });
  assert.throws(
    () => checkpointRace.commitProjections(CHAIN_ID, CONTRACT, block, []),
    /PROJECTION_BLOCK_NOT_CANONICAL/,
  );
  assert.equal(checkpointRace.projectionCheckpoint(CHAIN_ID, CONTRACT), null);
  checkpointRace.close();

  const projectionRace = new ChainStore(await databasePath());
  projectionRace.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  const originalProjectionCanonical = projectionRace.canonicalBlock.bind(projectionRace);
  let projectionReads = 0;
  Object.defineProperty(projectionRace, 'canonicalBlock', {
    configurable: true,
    value: (...args: Parameters<ChainStore['canonicalBlock']>) =>
      ++projectionReads === 4 ? null : originalProjectionCanonical(...args),
  });
  assert.throws(
    () => projectionRace.commitProjections(CHAIN_ID, CONTRACT, block, [projection]),
    /PROJECTION_BLOCK_NOT_CANONICAL/,
  );
  assert.equal(projectionRace.projectionCheckpoint(CHAIN_ID, CONTRACT), null);
  projectionRace.close();

  const updateRace = new ChainStore(await databasePath());
  updateRace.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  updateRace.db.exec(`
    CREATE TRIGGER ignore_projection_checkpoint_update
    BEFORE UPDATE OF projected_block_number ON chain_checkpoints
    BEGIN
      SELECT RAISE(IGNORE);
    END;
  `);
  assert.throws(
    () => updateRace.commitProjections(CHAIN_ID, CONTRACT, block, []),
    /CHAIN_CHECKPOINT_CHANGED/,
  );
  assert.equal(updateRace.projectionCheckpoint(CHAIN_ID, CONTRACT), null);
  updateRace.close();
});

test('server readiness rejects a projection hash from a competing fork', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
  );
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [
      {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'vault-a',
        blockNumber: 100n,
        blockHash: BLOCK_100,
        state: { principal: '1000000' },
      },
    ],
  );
  const submitted = transitionOperation(
    createOperation({
      operationId: 'operation-corrupt-snapshot',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 100n,
    blockHash: BLOCK_100,
    receiptStatus: 'SUCCESS',
  });
  store.saveOperation(transitionOperation(mined, { state: 'CONFIRMING', confirmations: 1 }));
  store.db
    .prepare(
      'UPDATE product_projections SET block_hash = ? WHERE chain_id = ? AND contract_address = ? AND projection_key = ?',
    )
    .run(BLOCK_101_ALT.toLowerCase(), CHAIN_ID, CONTRACT.toLowerCase(), 'vault-a');

  assert.deepEqual(store.operationEvidence('operation-corrupt-snapshot', 'vault-a'), {
    lifecycle: 'CONFIRMING',
    receipt: 'SUCCESS',
    receiptCanonical: true,
    confirmations: 1,
    reconciliation: 'PENDING',
    projection: 'STALE',
    chainStatus: 'INCLUDED',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'HEALTHY',
    degradedReason: null,
    productReady: false,
  });
  store.close();
});

test('server readiness rejects internally consistent blocks from different ancestry', async () => {
  const store = new ChainStore(await databasePath());
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n },
    [],
  );
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [],
  );
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1_010n },
    [
      {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'vault-a',
        blockNumber: 101n,
        blockHash: BLOCK_101,
        state: { principal: '1000000' },
      },
    ],
  );
  const submitted = transitionOperation(
    createOperation({
      operationId: 'operation-competing-ancestry',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 100n,
    blockHash: BLOCK_100,
    receiptStatus: 'SUCCESS',
  });
  store.saveOperation(
    transitionOperation(
      transitionOperation(mined, { state: 'CONFIRMING', confirmations: 2, reconciled: true }),
      {
        state: 'CONFIRMED',
        confirmations: 3,
        reconciled: true,
        confirmedAt: '2026-09-14T12:01:00.000Z',
      },
    ),
  );

  // Simulate two individually self-consistent cache/fork witnesses: operation
  // 100/A100 and projection/checkpoint 101/B101, where B101 does not descend
  // from A100. The server must verify the parent chain, not just endpoints.
  store.db
    .prepare(
      'UPDATE chain_blocks SET parent_hash = ? WHERE chain_id = ? AND contract_address = ? AND block_number = 101 AND canonical = 1',
    )
    .run(BLOCK_101_ALT.toLowerCase(), CHAIN_ID, CONTRACT.toLowerCase());

  const evidence = store.operationEvidence('operation-competing-ancestry', 'vault-a');
  assert.equal(evidence?.projection, 'STALE');
  assert.equal(evidence?.productReady, false);
  store.close();
});

test('server readiness bounds ancestry work and fails closed beyond the engineering limit', async () => {
  const store = new ChainStore(await databasePath());
  const hashAt = (height: number) => asBlockHash(`0x${height.toString(16).padStart(64, '0')}`);
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: hashAt(100), parentHash: hashAt(99), timestamp: 100n },
    [],
  );
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const insert = store.db.prepare(
      `INSERT INTO chain_blocks
       (chain_id, contract_address, block_number, block_hash, parent_hash, block_timestamp, log_count, canonical)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    );
    for (let height = 101; height <= 2_099; height++) {
      insert.run(
        CHAIN_ID,
        CONTRACT.toLowerCase(),
        height,
        hashAt(height).toLowerCase(),
        hashAt(height - 1).toLowerCase(),
        String(height),
      );
    }
    store.db
      .prepare(
        'UPDATE chain_checkpoints SET block_number = 2099, block_hash = ? WHERE chain_id = ? AND contract_address = ?',
      )
      .run(hashAt(2_099).toLowerCase(), CHAIN_ID, CONTRACT.toLowerCase());
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    { number: 2_099n, hash: hashAt(2_099), parentHash: hashAt(2_098), timestamp: 2_099n },
    [
      {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'vault-a',
        blockNumber: 2_099n,
        blockHash: hashAt(2_099),
        state: { principal: '1000000' },
      },
    ],
  );
  const submitted = transitionOperation(
    createOperation({
      operationId: 'operation-bounded-ancestry',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 100n,
    blockHash: hashAt(100),
    receiptStatus: 'SUCCESS',
  });
  store.saveOperation(
    transitionOperation(
      transitionOperation(mined, { state: 'CONFIRMING', confirmations: 2, reconciled: true }),
      {
        state: 'CONFIRMED',
        confirmations: 3,
        reconciled: true,
        confirmedAt: '2026-09-14T12:01:00.000Z',
      },
    ),
  );

  const atLimit = store.operationEvidence('operation-bounded-ancestry', 'vault-a');
  assert.equal(atLimit?.projection, 'READY');
  assert.equal(atLimit?.productReady, true);

  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    {
      number: 2_100n,
      hash: hashAt(2_100),
      parentHash: hashAt(2_099),
      timestamp: 2_100n,
    },
    [],
  );
  store.commitProjections(
    CHAIN_ID,
    CONTRACT,
    {
      number: 2_100n,
      hash: hashAt(2_100),
      parentHash: hashAt(2_099),
      timestamp: 2_100n,
    },
    [
      {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'vault-a',
        blockNumber: 2_100n,
        blockHash: hashAt(2_100),
        state: { principal: '1000000' },
      },
    ],
  );

  const beyondLimit = store.operationEvidence('operation-bounded-ancestry', 'vault-a');
  assert.equal(beyondLimit?.projection, 'STALE');
  assert.equal(beyondLimit?.productReady, false);
  store.close();
});

test('chain store refuses an unrelated database instead of mutating it', async () => {
  const path = await databasePath();
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE unrelated (value TEXT);');
  db.close();
  assert.throws(() => new ChainStore(path), /REFUSING_UNKNOWN_CHAIN_DATABASE/);
  const reopened = new DatabaseSync(path);
  assert.deepEqual(
    (reopened.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map(
      (row) => row.name,
    ),
    ['unrelated'],
  );
  reopened.close();
});

test('chain store migrates to sync leases and rejects forged confirmed operations', async () => {
  const store = new ChainStore(await databasePath());
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 6);
  const submitted = transitionOperation(
    createOperation({
      operationId: 'forged-confirmed',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-14T12:00:00.000Z' },
  );
  const forged = {
    ...submitted,
    state: 'CONFIRMED',
    blockNumber: 100n,
    blockHash: BLOCK_100,
    receiptStatus: null,
    confirmations: 3,
    canonical: true,
    reconciled: true,
    confirmedAt: '2026-09-14T12:01:00.000Z',
  } as ChainOperation;
  assert.throws(() => store.saveOperation(forged), /INVALID_OPERATION_EVIDENCE/);
  assert.equal(store.operation('forged-confirmed'), null);
  store.close();
});

test('existing version-one chain database migrates without losing indexed evidence', async () => {
  const path = await databasePath();
  const legacy = new DatabaseSync(path);
  legacy.exec(
    readFileSync(
      new URL('../apps/server/chain-migrations/001-chain-projection.sql', import.meta.url),
      'utf8',
    ),
  );
  legacy
    .prepare(
      'INSERT INTO chain_blocks (chain_id, contract_address, block_number, block_hash, parent_hash, block_timestamp, log_count, canonical) VALUES (?, ?, ?, ?, ?, ?, 0, 1)',
    )
    .run(CHAIN_ID, CONTRACT.toLowerCase(), 100, BLOCK_100.toLowerCase(), BLOCK_99.toLowerCase(), '1000');
  legacy
    .prepare(
      'INSERT INTO chain_checkpoints (chain_id, contract_address, block_number, block_hash) VALUES (?, ?, ?, ?)',
    )
    .run(CHAIN_ID, CONTRACT.toLowerCase(), 100, BLOCK_100.toLowerCase());
  legacy.close();

  const store = new ChainStore(path);
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 6);
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: BLOCK_100,
  });
  assert.equal(store.projectionCheckpoint(CHAIN_ID, CONTRACT), null);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), null);
  store.close();
});

test('version-three incomplete targets remain authoritative after sync-lease migration', async () => {
  const path = await databasePath();
  const legacy = new DatabaseSync(path);
  for (const migration of [
    '001-chain-projection.sql',
    '002-projection-checkpoint.sql',
    '003-sync-target.sql',
  ])
    legacy.exec(
      readFileSync(new URL(`../apps/server/chain-migrations/${migration}`, import.meta.url), 'utf8'),
    );
  legacy
    .prepare(
      'INSERT INTO chain_blocks (chain_id, contract_address, block_number, block_hash, parent_hash, block_timestamp, log_count, canonical) VALUES (?, ?, ?, ?, ?, ?, 0, 1)',
    )
    .run(CHAIN_ID, CONTRACT.toLowerCase(), 100, BLOCK_100.toLowerCase(), BLOCK_99.toLowerCase(), '1000');
  legacy
    .prepare(
      `INSERT INTO chain_checkpoints
        (chain_id, contract_address, block_number, block_hash, sync_healthy, sync_error, sync_target_block_number)
       VALUES (?, ?, ?, ?, 0, 'CHAIN_SYNC_INCOMPLETE', 101)`,
    )
    .run(CHAIN_ID, CONTRACT.toLowerCase(), 100, BLOCK_100.toLowerCase());
  legacy.close();

  const store = new ChainStore(path);
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 6);
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);
  assert.throws(
    () => store.claimSync(CHAIN_ID, CONTRACT, 100n, '00000000-0000-4000-8000-000000000001'),
    /CHAIN_SYNC_TARGET_BEHIND/,
  );
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);
  store.close();
});

test('chain projection online backup reopens independently and never overwrites a destination', async () => {
  const path = await databasePath();
  const target = `${path}.backup`;
  const store = new ChainStore(path);
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
  store.commitProjections(CHAIN_ID, CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OWNER_A,
      contract: CONTRACT,
      projectionKey: 'm3-vault',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      state: { strategyId: 'trend', principalBasis: '1000000' },
    },
  ]);

  const recovery = store as ChainStore & {
    backupTo(targetPath: string): Promise<string>;
    health(): { status: string; schemaVersion: number | null; integrity: string };
  };
  assert.deepEqual(recovery.health(), { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' });
  assert.equal(await recovery.backupTo(target), target);
  await assert.rejects(recovery.backupTo(target), /BACKUP_TARGET_EXISTS/);

  const restored = new ChainStore(target);
  try {
    assert.deepEqual(restored.health(), { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' });
    assert.deepEqual(restored.checkpoint(CHAIN_ID, CONTRACT), {
      blockNumber: 100n,
      blockHash: BLOCK_100,
    });
    assert.equal(
      restored.projection(CHAIN_ID, OWNER_A, CONTRACT, 'm3-vault')?.state.principalBasis,
      '1000000',
    );
    assert.equal(restored.canonicalEvents(CHAIN_ID, CONTRACT).length, 1);
  } finally {
    restored.close();
    store.close();
  }
});

test('local recovery drill measures backup, reopen and 128-block catch-up separately', async (context) => {
  const block = (number: bigint) => ({
    number,
    hash: asBlockHash(`0x${number.toString(16).padStart(64, '0')}`),
    parentHash: asBlockHash(`0x${(number - 1n).toString(16).padStart(64, '0')}`),
    timestamp: 1_700_000_000n + number,
  });
  const manifest = {
    schemaVersion: 1,
    environment: 'robinhood-chain-testnet',
    chainId: CHAIN_ID,
    contractName: 'AlphaForgeVault',
    contractType: 'vault',
    contractAddress: CONTRACT,
    deploymentBlock: 1n,
    abiVersion: 'm3-vault-drill',
    abiHash: asBlockHash(`0x${'21'.repeat(32)}`),
    runtimeBytecodeHash: asBlockHash(`0x${'22'.repeat(32)}`),
    strategyPassAddress: OWNER_B,
    strategyPassDeploymentBlock: 1n,
    strategyPassAbiHash: asBlockHash(`0x${'23'.repeat(32)}`),
    strategyPassRuntimeBytecodeHash: asBlockHash(`0x${'24'.repeat(32)}`),
    manifestDigest: asBlockHash(`0x${'25'.repeat(32)}`),
  } as unknown as DeploymentManifest;
  const measurements: Array<{
    backupBytes: number;
    backupMs: number;
    reopenAndHealthMs: number;
    catchupMs: number;
    restoreToHealthyMs: number;
  }> = [];
  for (let run = 0; run < 3; run++) {
    const directory = await mkdtemp(resolve('.checks/m3-recovery-drill-'));
    const sourcePath = resolve(directory, 'source.sqlite');
    const backupPath = resolve(directory, 'backup.sqlite');
    let head = 1_000n;
    const rpc: ReadonlyRpc = {
      chainId: async () => CHAIN_ID,
      block: async (number) => block(number === 'latest' ? head : number),
      code: async () => asHexData('0x01'),
      receipt: async () => null,
      logs: async () => [],
      call: async () => asHexData('0x'),
    };
    const integration = {
      decode: () => null,
      rebuildProjections: async () => [],
      reconcileOperation: async () => ({ status: 'MATCH' as const }),
    };
    let source: ChainStore | null = new ChainStore(sourcePath);
    const seed = new ChainSynchronizer({
      rpc,
      store: source,
      manifest,
      integration,
      policy: { softReadyDepth: 3, reorgSearchLimit: 128 },
      maxBlocksPerSync: 2_000,
    });
    try {
      await seed.syncTo(head, head);
      const backupStarted = performance.now();
      await source.backupTo(backupPath);
      const backupMs = performance.now() - backupStarted;
      source.close();
      source = null;

      head = 1_128n;
      const reopenStarted = performance.now();
      const restored = new ChainStore(backupPath);
      const restoredHealth = restored.health();
      const restoredCheckpoint = restored.checkpoint(CHAIN_ID, CONTRACT);
      const reopenAndHealthMs = performance.now() - reopenStarted;
      try {
        assert.deepEqual(restoredHealth, { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' });
        assert.equal(restoredCheckpoint?.blockNumber, 1_000n);
        const catchup = new ChainSynchronizer({
          rpc,
          store: restored,
          manifest,
          integration,
          policy: { softReadyDepth: 3, reorgSearchLimit: 128 },
          maxBlocksPerSync: 2_000,
        });
        const catchupStarted = performance.now();
        const result = await catchup.syncTo(head, head);
        const catchupMs = performance.now() - catchupStarted;
        assert.equal(result.scannedBlocks, 128);
        assert.equal(restored.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, head);
        assert.deepEqual(restored.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
        measurements.push({
          backupBytes: (await stat(backupPath)).size,
          backupMs,
          reopenAndHealthMs,
          catchupMs,
          restoreToHealthyMs: reopenAndHealthMs + catchupMs,
        });
      } finally {
        restored.close();
      }
    } finally {
      source?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
  const median = (key: keyof (typeof measurements)[number]) =>
    [...measurements].sort((left, right) => left[key] - right[key])[1]![key];
  context.diagnostic(
    JSON.stringify({
      fixture: { backupCheckpoint: 1_000, observedHead: 1_128, rpoBlocks: 128, runs: 3 },
      medianMs: {
        backup: Number(median('backupMs').toFixed(3)),
        reopenAndHealth: Number(median('reopenAndHealthMs').toFixed(3)),
        catchup: Number(median('catchupMs').toFixed(3)),
        restoreToHealthy: Number(median('restoreToHealthyMs').toFixed(3)),
      },
      backupBytes: median('backupBytes'),
    }),
  );
});

test('chain store rejects malformed recovery, operation and projection identities', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  assert.throws(
    () => store.commitProjections(CHAIN_ID, CONTRACT, block, []),
    /PROJECTION_BLOCK_NOT_CANONICAL/,
  );
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
  const projection = {
    chainId: CHAIN_ID,
    owner: OWNER_A,
    contract: CONTRACT,
    projectionKey: 'm3-vault',
    blockNumber: 100n,
    blockHash: BLOCK_100,
    state: { principalBasis: '1' },
  };
  for (const malformed of [
    { ...projection, chainId: 1 },
    { ...projection, contract: OWNER_B },
    { ...projection, blockNumber: 101n },
    { ...projection, projectionKey: '../unsafe' },
  ])
    assert.throws(
      () => store.commitProjections(CHAIN_ID, CONTRACT, block, [malformed]),
      /INVALID_PROJECTION/,
    );
  assert.throws(
    () => store.commitProjections(CHAIN_ID, CONTRACT, block, [projection, projection]),
    /DUPLICATE_PROJECTION/,
  );
  assert.throws(
    () =>
      store.commitProjections(CHAIN_ID, CONTRACT, block, [
        { ...projection, blockNumber: 99n, blockHash: BLOCK_99 },
      ]),
    /PROJECTION_BLOCK_NOT_CANONICAL/,
  );
  store.commitProjections(CHAIN_ID, CONTRACT, block, [projection]);
  assert.throws(() => store.trackableOperationIds(CHAIN_ID, CONTRACT, 0), /INVALID_OPERATION_QUERY_LIMIT/);
  assert.throws(
    () => store.trackableOperationIds(CHAIN_ID, CONTRACT, 1, '../unsafe'),
    /INVALID_OPERATION_ID/,
  );
  const unsigned = createOperation({
    operationId: 'valid-operation',
    chainId: CHAIN_ID,
    owner: OWNER_A,
    target: CONTRACT,
    state: 'AWAITING_SIGNATURE',
  });
  assert.throws(() => store.saveOperation({ ...unsigned, operationId: '../unsafe' }), /INVALID_OPERATION_ID/);
  store.saveOperation(unsigned);
  assert.throws(
    () =>
      store.saveOperationAtCheckpoint({ ...unsigned, operationId: 'other-operation' }, unsigned, {
        blockNumber: 100n,
        blockHash: BLOCK_100,
      }),
    /OPERATION_IDENTITY_CONFLICT/,
  );
  const submittedOperation = transitionOperation(
    createOperation({
      operationId: 'stale-operation',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_B, submittedAt: '2026-09-20T00:00:00.000Z' },
  );
  store.saveOperation(submittedOperation);
  assert.throws(
    () =>
      store.saveOperationAtCheckpoint(
        submittedOperation,
        { ...submittedOperation, submittedAt: '2026-09-20T00:00:01.000Z' },
        { blockNumber: 100n, blockHash: BLOCK_100 },
      ),
    /CHAIN_SYNC_SUPERSEDED/,
  );
  store.close();
});

test('chain store fails closed on corrupted persisted event and projection JSON', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
  store.commitProjections(CHAIN_ID, CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OWNER_A,
      contract: CONTRACT,
      projectionKey: 'm3-vault',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      state: { principalBasis: '1' },
    },
  ]);
  store.db.prepare('UPDATE chain_events SET topics_json = ?').run('{');
  assert.throws(() => store.canonicalEvents(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);
  store.db.prepare('UPDATE chain_events SET topics_json = ?').run(JSON.stringify([SIGNATURE]));
  store.db.prepare('UPDATE product_projections SET state_json = ?').run('[]');
  assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'm3-vault'), /CORRUPT_CHAIN_DATABASE/);
  store.close();
});

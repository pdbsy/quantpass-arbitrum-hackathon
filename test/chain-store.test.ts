import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
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
const CONTRACT_B = asAddress('0x3333333333333333333333333333333333333333');
const OWNER_A = asAddress('0x1111111111111111111111111111111111111111');
const OWNER_B = asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const BLOCK_99 = asBlockHash(`0x${'09'.repeat(32)}`);
const BLOCK_100 = asBlockHash(`0x${'10'.repeat(32)}`);
const BLOCK_101 = asBlockHash(`0x${'11'.repeat(32)}`);
const BLOCK_101_ALT = asBlockHash(`0x${'12'.repeat(32)}`);
const TX_A = asTransactionHash(`0x${'aa'.repeat(32)}`);
const TX_B = asTransactionHash(`0x${'bb'.repeat(32)}`);
const SIGNATURE = asHexData(`0x${'cc'.repeat(32)}`);

test('a physically damaged projection row fails closed instead of appearing absent', async () => {
  const path = await databasePath();
  const store = new ChainStore(path);
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  store.commitProjections(CHAIN_ID, CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OWNER_A,
      contract: CONTRACT,
      projectionKey: 'damaged',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      state: { amount: '9' },
    },
  ]);
  const ddl = String(
    store.db.prepare("SELECT sql FROM sqlite_schema WHERE name='product_projections'").get()!.sql,
  );
  store.close();
  // Build an isolated corruption fixture: relax the declaration only while writing
  // the bad row, then restore the exact original DDL before the application reads it.
  const corrupt = new DatabaseSync(path);
  corrupt.enableDefensive(false);
  corrupt.exec('PRAGMA writable_schema=ON');
  corrupt
    .prepare("UPDATE sqlite_schema SET sql=? WHERE name='product_projections'")
    .run(ddl.replace('block_number INTEGER NOT NULL', 'block_number INTEGER'));
  corrupt.exec('PRAGMA writable_schema=RESET');
  corrupt.exec("UPDATE product_projections SET block_number=NULL WHERE projection_key='damaged'");
  corrupt.exec('PRAGMA writable_schema=ON');
  corrupt.prepare("UPDATE sqlite_schema SET sql=? WHERE name='product_projections'").run(ddl);
  corrupt.exec('PRAGMA writable_schema=RESET');
  corrupt.close();
  const reopened = new ChainStore(path);
  try {
    assert.equal(
      reopened.db.prepare("SELECT sql FROM sqlite_schema WHERE name='product_projections'").get()!.sql,
      ddl,
    );
    assert.throws(
      () => reopened.projection(CHAIN_ID, OWNER_A, CONTRACT, 'damaged'),
      /CORRUPT_CHAIN_DATABASE/,
    );
    assert.equal(reopened.projection(CHAIN_ID, OWNER_B, CONTRACT, 'damaged'), null);
    assert.equal(reopened.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, 100n);
    assert.equal(reopened.db.isTransaction, false);
    reopened.db.exec("UPDATE product_projections SET block_number=100 WHERE projection_key='damaged'");
    assert.deepEqual(reopened.projection(CHAIN_ID, OWNER_A, CONTRACT, 'damaged')?.state, { amount: '9' });
  } finally {
    reopened.close();
  }
});

test('chain database refuses future schema versions without modifying their contents', async () => {
  const path = await databasePath();
  const seed = new DatabaseSync(path);
  seed.exec(
    "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserve'); PRAGMA user_version=8",
  );
  seed.close();
  assert.throws(() => new ChainStore(path), /UNSUPPORTED_CHAIN_DATABASE/);
  const inspect = new DatabaseSync(path);
  assert.equal(inspect.prepare('SELECT value FROM unrelated').get()?.value, 'preserve');
  assert.equal(inspect.prepare('PRAGMA user_version').get()?.user_version, 8);
  inspect.close();
});

test('recognized chain tables with a future version are rejected without migrating stored observations', async () => {
  const path = await databasePath();
  const seed = new ChainStore(path);
  seed.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n },
    [event()],
  );
  const before = seed.db.prepare('SELECT * FROM chain_events').all();
  seed.db.exec('PRAGMA user_version=8');
  seed.close();
  assert.throws(() => new ChainStore(path), /UNSUPPORTED_CHAIN_DATABASE/);
  const inspect = new DatabaseSync(path);
  try {
    assert.equal(inspect.prepare('PRAGMA user_version').get()?.user_version, 8);
    assert.deepEqual(inspect.prepare('SELECT * FROM chain_events').all(), before);
    assert.equal(inspect.prepare('SELECT block_number FROM chain_checkpoints').get()?.block_number, 100);
  } finally {
    inspect.close();
  }
});

test('missing reconciliation failure reason cannot replace a valid stored operation', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const submitted = transitionOperation(
      createOperation({
        operationId: 'failure-reason',
        chainId: CHAIN_ID,
        owner: OWNER_A,
        target: CONTRACT,
        state: 'AWAITING_SIGNATURE',
      }),
      { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-23T00:00:00.000Z' },
    );
    const mined = transitionOperation(submitted, {
      state: 'MINED',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      receiptStatus: 'SUCCESS',
    });
    store.saveOperation(mined);
    assert.throws(
      () => store.saveOperation({ ...mined, state: 'RECONCILIATION_FAILED', errorCode: null }),
      /INVALID_OPERATION_EVIDENCE/,
    );
    assert.deepEqual(store.operation(mined.operationId), mined);
  } finally {
    store.close();
  }
});

test('unsubmitted operation checkpoint updates and full cursor pages preserve identity', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
    store.commitProjections(CHAIN_ID, CONTRACT, block, []);
    const pending = createOperation({
      operationId: 'unsigned',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    });
    store.saveOperation(pending);
    const rejected = transitionOperation(pending, { state: 'REJECTED', errorCode: 'WALLET_REJECTED' });
    store.saveOperationAtCheckpoint(rejected, pending, store.checkpoint(CHAIN_ID, CONTRACT)!);
    assert.deepEqual(store.operation('unsigned'), rejected);
    assert.deepEqual(store.trackableOperationIds(CHAIN_ID, CONTRACT), []);
    for (const [id, txHash] of [
      ['one', TX_A],
      ['two', TX_B],
    ] as const)
      store.saveOperation(
        transitionOperation(
          createOperation({
            operationId: id,
            chainId: CHAIN_ID,
            owner: OWNER_A,
            target: CONTRACT,
            state: 'AWAITING_SIGNATURE',
          }),
          { state: 'SUBMITTED', txHash, submittedAt: '2026-09-23T00:00:00.000Z' },
        ),
      );
    assert.deepEqual(store.trackableOperationIds(CHAIN_ID, CONTRACT, 1, 'one'), ['two']);
    assert.deepEqual(store.trackableOperationIds(CHAIN_ID, CONTRACT, 1, 'two'), ['one']);
    assert.deepEqual(store.trackableOperationIds(CHAIN_ID, CONTRACT_B), []);
  } finally {
    store.close();
  }
});

test('automatic SQLite rollbacks leave chain transactions, projections and leases unchanged for retry', async () => {
  const cases = [
    'claim',
    'unhealthy',
    'healthy',
    'release',
    'record',
    'operation',
    'projection',
    'rewind',
  ] as const;
  for (const kind of cases) {
    const store = new ChainStore(await databasePath());
    try {
      const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n };
      const nextBlock = { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1001n };
      const projection = {
        chainId: CHAIN_ID,
        owner: OWNER_A,
        contract: CONTRACT,
        projectionKey: 'm3-vault',
        blockNumber: 100n,
        blockHash: BLOCK_100,
        state: { amount: '9' },
      };
      store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
      store.commitProjections(CHAIN_ID, CONTRACT, block, [projection]);
      const pending = createOperation({
        operationId: 'unsigned',
        chainId: CHAIN_ID,
        owner: OWNER_A,
        target: CONTRACT,
        state: 'AWAITING_SIGNATURE',
      });
      store.saveOperation(pending);
      const owner = '00000000-0000-4000-8000-000000000003';
      if (kind === 'healthy' || kind === 'release') store.claimSync(CHAIN_ID, CONTRACT, 100n, owner);
      const before = () =>
        [
          'chain_blocks',
          'chain_events',
          'chain_transactions',
          'chain_checkpoints',
          'chain_sync_leases',
          'product_projections',
        ].map((table) => store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const original = before();
      const triggers = {
        claim: 'BEFORE INSERT ON chain_sync_leases',
        unhealthy: 'BEFORE UPDATE ON chain_checkpoints',
        healthy: 'BEFORE DELETE ON chain_sync_leases',
        release: 'BEFORE DELETE ON chain_sync_leases',
        record: 'BEFORE INSERT ON chain_events',
        operation: 'BEFORE INSERT ON chain_transactions',
        projection: 'BEFORE INSERT ON product_projections',
        rewind: 'BEFORE UPDATE OF canonical ON chain_events',
      };
      const action = () => {
        switch (kind) {
          case 'claim':
            return store.claimSync(CHAIN_ID, CONTRACT, 100n, owner);
          case 'unhealthy':
            return store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_REORG_DEPTH_EXCEEDED');
          case 'healthy':
            return store.markSyncHealthy(CHAIN_ID, CONTRACT, 100n, owner);
          case 'release':
            return store.releaseSyncIncomplete(CHAIN_ID, CONTRACT, 100n, owner);
          case 'record':
            return store.recordCanonicalBlock(CHAIN_ID, CONTRACT, nextBlock, [
              event({ transactionHash: TX_B, blockNumber: 101n, blockHash: BLOCK_101 }),
            ]);
          case 'operation':
            return store.saveOperationAtCheckpoint(
              transitionOperation(pending, { state: 'REJECTED', errorCode: 'WALLET_REJECTED' }),
              pending,
              store.checkpoint(CHAIN_ID, CONTRACT)!,
            );
          case 'projection':
            return store.commitProjections(CHAIN_ID, CONTRACT, block, [
              { ...projection, state: { amount: '10' } },
            ]);
          case 'rewind':
            return store.rollbackFromBlock(CHAIN_ID, CONTRACT, 100n);
        }
      };
      store.db.exec(
        `CREATE TEMP TRIGGER automatic_fault ${triggers[kind]} BEGIN SELECT RAISE(ROLLBACK, 'fixture automatic rollback'); END`,
      );
      assert.throws(action, /fixture automatic rollback/, kind);
      assert.equal(store.db.isTransaction, false, kind);
      assert.deepEqual(before(), original, kind);
      store.db.exec('DROP TRIGGER automatic_fault');
      action();
      assert.equal(store.db.isTransaction, false);
      assert.notDeepEqual(before(), original, `${kind} must remain usable after removing the storage fault`);
    } finally {
      store.close();
    }
  }
});

test('evidence read errors before and after automatic rollback preserve stored operation state', async () => {
  for (const automaticRollback of [false, true]) {
    const store = new ChainStore(await databasePath());
    try {
      const operation = createOperation({
        operationId: 'read-fault',
        chainId: CHAIN_ID,
        owner: OWNER_A,
        target: CONTRACT,
        state: 'AWAITING_SIGNATURE',
      });
      store.saveOperation(operation);
      store.db.function('fixture_read_fault', () => {
        if (automaticRollback) store.db.exec('ROLLBACK');
        throw new Error('fixture evidence read failure');
      });
      const columns = store.db
        .prepare('PRAGMA table_info(chain_transactions)')
        .all()
        .map((row) =>
          row.name === 'operation_id' ? 'fixture_read_fault() AS operation_id' : String(row.name),
        )
        .join(',');
      store.db.exec(`CREATE TEMP VIEW chain_transactions AS SELECT ${columns} FROM main.chain_transactions`);
      assert.throws(
        () => store.operationEvidence(operation.operationId, 'm3-vault'),
        /fixture evidence read failure/,
      );
      assert.equal(store.db.isTransaction, false);
      store.db.exec('DROP VIEW temp.chain_transactions');
      assert.deepEqual(store.operation(operation.operationId), operation);
      const recovered = store.operationEvidence(operation.operationId, 'm3-vault');
      assert.equal(recovered?.productReady, false);
      assert.equal(recovered?.lifecycle, 'AWAITING_SIGNATURE');
    } finally {
      store.close();
    }
  }
});

test('chain backup invalid parent does not reserve a file or modify chain state', async () => {
  const path = await databasePath();
  const store = new ChainStore(path);
  try {
    const target = resolve(`${path}.missing`, 'backup.sqlite');
    await assert.rejects(store.backupTo(target), { code: 'ENOENT' });
    await assert.rejects(stat(target), { code: 'ENOENT' });
    assert.equal(store.health().status, 'HEALTHY');
    assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  } finally {
    store.close();
  }
});

async function databasePath() {
  await mkdir('.checks', { recursive: true });
  const directory = await mkdtemp(resolve('.checks/chain-store-'));
  return resolve(directory, 'chain.sqlite');
}

function runRecovery(
  operation: 'backup' | 'restore',
  source: string,
  target: string,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [resolve('tools/chain-recovery.ts'), operation, source, target], {
    encoding: 'utf8',
  });
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

async function largeRecoveryDatabase(): Promise<string> {
  const source = await databasePath();
  const seed = new ChainStore(source);
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  seed.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  seed.commitProjections(CHAIN_ID, CONTRACT, block, []);
  seed.close();
  const fixture = new DatabaseSync(source);
  const insert = fixture.prepare(
    'INSERT INTO product_projections (chain_id, owner_address, contract_address, projection_key, block_number, block_hash, state_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const state = JSON.stringify({ payload: 'x'.repeat(60_000) });
  fixture.exec('BEGIN IMMEDIATE');
  for (let index = 0; index < 512; index++)
    insert.run(
      CHAIN_ID,
      `0x${index.toString(16).padStart(40, '0')}`,
      CONTRACT,
      `fixture-${index}`,
      100,
      BLOCK_100,
      state,
    );
  fixture.exec('COMMIT');
  fixture.close();
  return source;
}

test('unverified observations coexist while reconciled transaction identity remains exclusive', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const observed = transitionOperation(
      createOperation({
        operationId: 'wrong-observation',
        chainId: CHAIN_ID,
        owner: OWNER_B,
        target: CONTRACT,
        state: 'AWAITING_SIGNATURE',
      }),
      { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-20T00:00:00.000Z' },
    );
    store.saveOperation(observed);
    const correct = { ...observed, operationId: 'correct-observation', owner: OWNER_A };
    store.saveOperation(correct);
    assert.equal(store.operationByTransaction(CHAIN_ID, TX_A), null);
    const mined = transitionOperation(correct, {
      state: 'MINED',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      receiptStatus: 'SUCCESS',
      transactionIndex: 0,
    });
    store.saveOperation(mined);
    assert.equal(store.operationByTransaction(CHAIN_ID, TX_A), null);
    const reconciled = transitionOperation(mined, {
      state: 'CONFIRMING',
      confirmations: 1,
      reconciled: true,
    });
    store.saveOperation(reconciled);
    assert.equal(store.operationByTransaction(CHAIN_ID, TX_A)?.operationId, 'correct-observation');
    assert.throws(
      () => store.saveOperation({ ...reconciled, operationId: observed.operationId, owner: OWNER_B }),
      /OPERATION_IDENTITY_CONFLICT/,
    );
    assert.throws(
      () => store.saveOperation({ ...reconciled, operationId: 'second-confirmed-observation' }),
      /OPERATION_IDENTITY_CONFLICT/,
    );
    assert.equal(store.operation(observed.operationId)?.state, 'SUBMITTED');
    assert.equal(store.operation('second-confirmed-observation'), null);
  } finally {
    store.close();
  }
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
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 7);
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
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 7);
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
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 7);
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);
  assert.throws(
    () => store.claimSync(CHAIN_ID, CONTRACT, 100n, '00000000-0000-4000-8000-000000000001'),
    /CHAIN_SYNC_TARGET_BEHIND/,
  );
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);
  store.close();
});

test('chain store completes every supported migration and rolls back duplicate DDL', async () => {
  const migrationNames = [
    '001-chain-projection.sql',
    '002-projection-checkpoint.sql',
    '003-sync-target.sql',
    '004-sync-lease.sql',
    '005-transaction-index.sql',
    '006-operation-calldata.sql',
  ];
  for (const targetVersion of [2, 3, 4, 5, 6]) {
    const path = await databasePath();
    const legacy = new DatabaseSync(path);
    for (const name of migrationNames.slice(0, targetVersion))
      legacy.exec(readFileSync(new URL(`../apps/server/chain-migrations/${name}`, import.meta.url), 'utf8'));
    legacy.close();
    const store = new ChainStore(path);
    assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 7);
    store.close();
  }

  const duplicateDdl: readonly [number, string][] = [
    [1, 'ALTER TABLE chain_checkpoints ADD COLUMN projected_block_number INTEGER'],
    [2, 'ALTER TABLE chain_checkpoints ADD COLUMN sync_target_block_number INTEGER'],
    [3, 'ALTER TABLE chain_transactions ADD COLUMN transaction_index INTEGER'],
    [4, 'ALTER TABLE chain_transactions ADD COLUMN calldata TEXT'],
    [5, 'ALTER TABLE chain_transactions ADD COLUMN calldata TEXT'],
  ];
  for (const [version, ddl] of duplicateDdl) {
    const path = await databasePath();
    const legacy = new DatabaseSync(path);
    for (const name of migrationNames.slice(0, version))
      legacy.exec(readFileSync(new URL(`../apps/server/chain-migrations/${name}`, import.meta.url), 'utf8'));
    legacy.exec(ddl);
    legacy.exec(`PRAGMA user_version = ${version}`);
    legacy.close();
    assert.throws(() => new ChainStore(path));
    const reopened = new DatabaseSync(path, { readOnly: true });
    assert.equal(reopened.prepare('PRAGMA user_version').get()?.user_version, version);
    reopened.close();
  }

  const unsupported = await databasePath();
  const database = new DatabaseSync(unsupported);
  database.exec('PRAGMA user_version = 8');
  database.close();
  assert.throws(() => new ChainStore(unsupported), /UNSUPPORTED_CHAIN_DATABASE/);
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
  assert.deepEqual(recovery.health(), { status: 'HEALTHY', schemaVersion: 7, integrity: 'OK' });
  assert.equal(await recovery.backupTo(target), target);
  await assert.rejects(recovery.backupTo(target), /BACKUP_TARGET_EXISTS/);

  const restored = new ChainStore(target);
  try {
    assert.deepEqual(restored.health(), { status: 'HEALTHY', schemaVersion: 7, integrity: 'OK' });
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

test('a failed chain backup removes its incomplete destination so an operator can retry', async () => {
  const path = await databasePath();
  const target = `${path}.backup`;
  const store = new ChainStore(path);
  store.close();

  await assert.rejects(store.backupTo(target));
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

test('chain recovery rejects invalid usage, missing destination parents and integrity damage without changing source', async () => {
  const source = await databasePath();
  const store = new ChainStore(source);
  store.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n },
    [],
  );
  store.close();
  const before = readFileSync(source);
  const target = `${source}.new`;
  for (const args of [[], ['backup'], ['delete', source, target], ['backup', source, target, 'extra']]) {
    const result = spawnSync(process.execPath, [resolve('tools/chain-recovery.ts'), ...args], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /USAGE: chain-recovery/);
    assert.deepEqual(readFileSync(source), before);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
  const missingParent = runRecovery('backup', source, `${source}.absent/copy.sqlite`);
  assert.equal(missingParent.status, 1);
  assert.match(missingParent.stderr, /ENOENT/);
  assert.deepEqual(readFileSync(source), before);
  const corrupt = new DatabaseSync(source);
  corrupt.exec(
    'PRAGMA ignore_check_constraints=ON; UPDATE chain_blocks SET log_count=-1; PRAGMA ignore_check_constraints=OFF',
  );
  assert.notEqual(corrupt.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
  corrupt.close();
  const damagedBefore = readFileSync(source);
  const rejected = runRecovery('backup', source, target);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /CHAIN_RECOVERY_TARGET_UNHEALTHY/);
  assert.deepEqual(readFileSync(source), damagedBefore);
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

async function assertRecoveryBackupFault(t: TestContext, mode: 'tamper' | 'abort' | 'cleanup') {
  const pending = createOperation({
    operationId: 'backup-fault',
    chainId: CHAIN_ID,
    owner: OWNER_A,
    target: CONTRACT,
    state: 'AWAITING_SIGNATURE',
  });
  const source = await databasePath();
  const store = new ChainStore(source);
  t.after(() => store.close());
  store.saveOperation(pending);
  const target = `${source}.new`;
  const before = readFileSync(source);
  const walBefore = readFileSync(`${source}-wal`);
  assert.ok(walBefore.length > 0, 'the live source must have uncheckpointed WAL data');
  const preload = `${source}.fault.cjs`;
  // Inject only at the external backup completion boundary. The actual CLI,
  // SQLite copy, schema/integrity checks and cleanup run from unchanged source.
  await writeFile(
    preload,
    `
    const sqlite = require('node:sqlite');
    const { syncBuiltinESMExports } = require('node:module');
    const backup = sqlite.backup;
    sqlite.backup = async (source, target, ...args) => {
      const result = await backup(source, target, ...args);
      if (${JSON.stringify(mode)} !== 'abort') {
        const db = new sqlite.DatabaseSync(target);
        db.exec('DELETE FROM chain_transactions');
        db.exec('PRAGMA journal_mode=DELETE');
        db.close();
        if (${JSON.stringify(mode)} === 'cleanup')
          require('node:fs').chmodSync(require('node:path').dirname(target), 0o500);
      } else {
        source.exec('ROLLBACK');
        throw new Error('FIXTURE_BACKUP_TRANSACTION_ABORT');
      }
      return result;
    };
    syncBuiltinESMExports();
  `,
  );
  const result = spawnSync(
    process.execPath,
    ['--require', preload, resolve('tools/chain-recovery.ts'), 'backup', source, target],
    { encoding: 'utf8', timeout: 10_000 },
  );
  // The isolated fixture denies unlinking only for the child CLI; restore its
  // directory before assertions and normal retry/teardown in this parent.
  if (mode === 'cleanup') await chmod(resolve(source, '..'), 0o700);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    mode === 'abort' ? /FIXTURE_BACKUP_TRANSACTION_ABORT/ : /CHAIN_RECOVERY_CONTENT_MISMATCH/,
  );
  assert.doesNotMatch(result.stdout, /HEALTHY/);
  assert.deepEqual(readFileSync(source), before);
  assert.deepEqual(readFileSync(`${source}-wal`), walBefore);
  if (mode === 'cleanup') {
    assert.match(result.stderr, /CHAIN_RECOVERY_FAILED_CLEANUP_FAILED/);
    assert.match(result.stderr, /EACCES|EPERM/);
    assert.ok((await stat(target)).isFile(), 'a denied unlink must be reported as a remaining failed copy');
    await rm(target);
  } else await assert.rejects(stat(target), { code: 'ENOENT' });
  const retry = runRecovery('backup', source, target);
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(readFileSync(source), before);
  assert.deepEqual(readFileSync(`${source}-wal`), walBefore);
  const restored = new ChainStore(target);
  assert.deepEqual(restored.operation(pending.operationId), pending);
  restored.close();
}

test('recovery cleans up real copied data after boundary-injected tampering or SQLite transaction abort', async (t) => {
  for (const mode of ['tamper', 'abort'] as const) await assertRecoveryBackupFault(t, mode);
});

test(
  'recovery reports a POSIX directory permission cleanup failure without claiming a healthy copy',
  {
    skip:
      process.platform === 'win32'
        ? 'NOT_RUN: Windows directory chmod does not enforce POSIX unlink permissions'
        : false,
  },
  async (t) => {
    await assertRecoveryBackupFault(t, 'cleanup');
  },
);

test('chain recovery CLI creates and restores a validated independent database', async (t) => {
  const source = await databasePath();
  const backupPath = `${source}.backup`;
  const restoredPath = `${source}.restored`;
  const store = new ChainStore(source);
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
      state: { principalBasis: '1000000' },
    },
  ]);
  store.close();

  const backupResult = runRecovery('backup', source, backupPath);
  assert.equal(backupResult.status, 0, backupResult.stderr);
  assert.deepEqual(JSON.parse(backupResult.stdout), {
    operation: 'backup',
    status: 'HEALTHY',
    schemaVersion: 7,
    integrity: 'OK',
    content: 'MATCH',
  });
  const restoreResult = runRecovery('restore', backupPath, restoredPath);
  assert.equal(restoreResult.status, 0, restoreResult.stderr);
  assert.deepEqual(JSON.parse(restoreResult.stdout), {
    operation: 'restore',
    status: 'HEALTHY',
    schemaVersion: 7,
    integrity: 'OK',
    content: 'MATCH',
  });
  await t.test(
    'POSIX backup and restore files remain owner-readable and owner-writable only',
    {
      skip:
        process.platform === 'win32'
          ? 'NOT_RUN: Windows mode bits do not represent POSIX permissions or ACL isolation'
          : false,
    },
    async () => {
      assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
      assert.equal((await stat(restoredPath)).mode & 0o777, 0o600);
    },
  );
  const overwriteResult = runRecovery('restore', backupPath, restoredPath);
  assert.notEqual(overwriteResult.status, 0);

  const restored = new ChainStore(restoredPath);
  try {
    assert.deepEqual(restored.health(), { status: 'HEALTHY', schemaVersion: 7, integrity: 'OK' });
    assert.deepEqual(restored.checkpoint(CHAIN_ID, CONTRACT), {
      blockNumber: 100n,
      blockHash: BLOCK_100,
    });
    assert.equal(restored.canonicalEvents(CHAIN_ID, CONTRACT).length, 1);
    assert.equal(
      restored.projection(CHAIN_ID, OWNER_A, CONTRACT, 'm3-vault')?.state.principalBasis,
      '1000000',
    );
  } finally {
    restored.close();
  }
});

test('chain recovery CLI rejects an empty source without initializing or changing it', async () => {
  const directory = await mkdtemp(resolve('.checks/chain-recovery-empty-'));
  const source = resolve(directory, 'empty.sqlite');
  const target = resolve(directory, 'backup.sqlite');
  await writeFile(source, '');
  const before = readFileSync(source);

  const result = runRecovery('backup', source, target);

  assert.notEqual(result.status, 0);
  assert.deepEqual(readFileSync(source), before);
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

test('chain recovery CLI rejects a legacy chain source without migrating it', async () => {
  const directory = await mkdtemp(resolve('.checks/chain-recovery-legacy-'));
  const source = resolve(directory, 'legacy.sqlite');
  const target = resolve(directory, 'restored.sqlite');
  const legacy = new DatabaseSync(source);
  legacy.exec(
    readFileSync(
      new URL('../apps/server/chain-migrations/001-chain-projection.sql', import.meta.url),
      'utf8',
    ),
  );
  legacy.close();
  const before = readFileSync(source);

  const result = runRecovery('restore', source, target);

  assert.notEqual(result.status, 0);
  assert.deepEqual(readFileSync(source), before);
  const reopened = new DatabaseSync(source, { readOnly: true });
  assert.equal(reopened.prepare('PRAGMA user_version').get()?.user_version, 1);
  reopened.close();
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

test('chain recovery CLI rejects unrelated and damaged sources without creating a target', async () => {
  for (const fixture of ['unrelated', 'damaged'] as const) {
    const directory = await mkdtemp(resolve(`.checks/chain-recovery-${fixture}-`));
    const source = resolve(directory, 'source.sqlite');
    const target = resolve(directory, 'backup.sqlite');
    if (fixture === 'unrelated') {
      const database = new DatabaseSync(source);
      database.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('preserve');");
      database.close();
    } else {
      await writeFile(source, 'not-a-sqlite-database');
    }
    const before = readFileSync(source);

    const result = runRecovery('backup', source, target);

    assert.notEqual(result.status, 0);
    assert.deepEqual(readFileSync(source), before);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
});

test('chain recovery CLI rejects forged current-version schema definitions', async (t) => {
  const fixtures: { name: string; sql?: string; replacement?: readonly [string, string] }[] = [
    { name: 'six unrelated single-column tables' },
    { name: 'wrong column type', replacement: ['block_number INTEGER', 'block_number TEXT'] },
    {
      name: 'missing primary key',
      replacement: ['PRIMARY KEY (chain_id, contract_address)', 'CHECK (chain_id > 0)'],
    },
    { name: 'missing check constraint', replacement: ['CHECK (block_number >= 0)', ''] },
    { name: 'missing null constraint', replacement: ['block_hash TEXT NOT NULL', 'block_hash TEXT'] },
    { name: 'changed default', replacement: ['DEFAULT 1', 'DEFAULT 0'] },
    { name: 'missing canonical index', sql: 'DROP INDEX one_canonical_block_per_height' },
    {
      name: 'nonunique canonical index',
      sql: 'DROP INDEX one_canonical_block_per_height; CREATE INDEX one_canonical_block_per_height ON chain_blocks (chain_id, contract_address, block_number) WHERE canonical = 1',
    },
    {
      name: 'changed index keys',
      sql: 'DROP INDEX one_canonical_block_per_height; CREATE UNIQUE INDEX one_canonical_block_per_height ON chain_blocks (chain_id, contract_address, block_hash) WHERE canonical = 1',
    },
    {
      name: 'changed index predicate',
      sql: 'DROP INDEX one_canonical_block_per_height; CREATE UNIQUE INDEX one_canonical_block_per_height ON chain_blocks (chain_id, contract_address, block_number) WHERE canonical = 0',
    },
    {
      name: 'unexpected trigger',
      sql: 'CREATE TRIGGER discard_projection AFTER INSERT ON product_projections BEGIN DELETE FROM product_projections; END',
    },
    { name: 'unexpected view', sql: 'CREATE VIEW unexpected AS SELECT * FROM chain_checkpoints' },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const source = await databasePath();
      const seed = new ChainStore(source);
      seed.close();
      const malformed = new DatabaseSync(source);
      try {
        if (fixture.replacement) {
          const definition = malformed
            .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'chain_checkpoints'")
            .get()?.sql;
          assert.equal(typeof definition, 'string');
          const [from, to] = fixture.replacement;
          assert.ok(String(definition).includes(from));
          malformed.exec('DROP TABLE chain_checkpoints');
          malformed.exec(String(definition).replace(from, to));
        } else if (fixture.sql) {
          malformed.exec(fixture.sql);
        } else {
          for (const table of [
            'chain_blocks',
            'chain_checkpoints',
            'chain_events',
            'chain_sync_leases',
            'chain_transactions',
            'product_projections',
          ])
            malformed.exec(`DROP TABLE ${table}; CREATE TABLE ${table} (unrelated TEXT)`);
        }
        assert.equal(malformed.prepare('PRAGMA user_version').get()?.user_version, 7);
        assert.equal(malformed.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
      } finally {
        malformed.close();
      }
      const before = readFileSync(source);
      for (const operation of ['backup', 'restore'] as const) {
        const target = `${source}.${operation}`;
        const result = runRecovery(operation, source, target);
        assert.notEqual(result.status, 0, `${operation} accepted ${fixture.name}`);
        assert.match(result.stderr, /CHAIN_RECOVERY_SOURCE_UNSUPPORTED/);
        assert.equal(result.stdout, '');
        assert.deepEqual(readFileSync(source), before);
        await assert.rejects(stat(target), { code: 'ENOENT' });
      }
    });
  }
});

test('chain recovery CLI preserves the source and destination on path or overwrite conflicts', async () => {
  const source = await databasePath();
  const target = `${source}.existing`;
  const store = new ChainStore(source);
  store.close();
  await writeFile(target, 'preserve-existing-destination');
  const sourceBefore = readFileSync(source);
  const targetBefore = readFileSync(target);

  assert.notEqual(runRecovery('backup', source, source).status, 0);
  assert.notEqual(runRecovery('restore', source, target).status, 0);
  assert.deepEqual(readFileSync(source), sourceBefore);
  assert.deepEqual(readFileSync(target), targetBefore);
});

test('chain recovery CLI keeps a consistent source snapshot while writers continue', async () => {
  const source = await largeRecoveryDatabase();
  const target = `${source}.backup`;

  const child = spawn(process.execPath, [resolve('tools/chain-recovery.ts'), 'backup', source, target], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  for (let attempt = 0; attempt < 2_000; attempt++) {
    try {
      await stat(target);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (child.exitCode !== null) assert.fail(`recovery exited before reserving target: ${stderr}`);
      await delay(1);
    }
  }
  await stat(target);

  const competingWriter = new DatabaseSync(source);
  competingWriter
    .prepare('UPDATE product_projections SET state_json = ? WHERE projection_key = ?')
    .run('{}', 'fixture-0');
  competingWriter.close();
  const exitCode = child.exitCode === null ? (await once(child, 'exit'))[0] : child.exitCode;
  assert.equal(exitCode, 0, stderr);

  const current = new DatabaseSync(source, { readOnly: true });
  const recovered = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(
      current.prepare("SELECT state_json FROM product_projections WHERE projection_key = 'fixture-0'").get()
        ?.state_json,
      '{}',
    );
    assert.notEqual(
      recovered.prepare("SELECT state_json FROM product_projections WHERE projection_key = 'fixture-0'").get()
        ?.state_json,
      '{}',
    );
  } finally {
    recovered.close();
    current.close();
  }
});

test(
  'chain recovery CLI removes a completed copy when POSIX permissions deny validation',
  {
    skip:
      process.platform === 'win32'
        ? 'NOT_RUN: Windows chmod does not revoke file read access like POSIX mode 000'
        : false,
  },
  async () => {
    const source = await databasePath();
    const target = `${source}.backup`;
    const store = new ChainStore(source);
    store.close();
    const before = readFileSync(source);
    const preload = `${source}.deny-validation.cjs`;
    // Synchronize at actual SQLite backup completion rather than racing the
    // child's target reservation. Only the OS permission boundary is changed.
    await writeFile(
      preload,
      `
      const sqlite = require('node:sqlite');
      const { syncBuiltinESMExports } = require('node:module');
      const backup = sqlite.backup;
      sqlite.backup = async (source, target, ...args) => {
        const result = await backup(source, target, ...args);
        require('node:fs').chmodSync(target, 0o000);
        return result;
      };
      syncBuiltinESMExports();
    `,
    );
    const child = spawnSync(
      process.execPath,
      ['--require', preload, resolve('tools/chain-recovery.ts'), 'backup', source, target],
      { encoding: 'utf8', timeout: 10_000 },
    );
    // spawnSync returns only after the real CLI exits and its pipes close.
    // A timeout/launch error is a failure, never evidence that cleanup succeeded.
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /unable to open database file/);
    assert.doesNotMatch(child.stdout, /HEALTHY/);
    assert.deepEqual(readFileSync(source), before);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  },
);

test('sync leases and rollback remain isolated by contract in a shared chain database', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT_B, block, [
    event({ address: CONTRACT_B, transactionHash: TX_B }),
  ]);
  for (const [contract, owner] of [
    [CONTRACT, OWNER_A],
    [CONTRACT_B, OWNER_B],
  ] as const)
    store.commitProjections(CHAIN_ID, contract, block, [
      {
        chainId: CHAIN_ID,
        owner,
        contract,
        projectionKey: 'm3-vault',
        blockNumber: 100n,
        blockHash: BLOCK_100,
        state: { owner },
      },
    ]);

  const firstOwner = '00000000-0000-4000-8000-000000000001';
  const replacementOwner = '00000000-0000-4000-8000-000000000002';
  store.claimSync(CHAIN_ID, CONTRACT, 101n, firstOwner);
  assert.throws(
    () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()], null, replacementOwner),
    /CHAIN_SYNC_SUPERSEDED/,
  );
  assert.equal(store.projection(CHAIN_ID, OWNER_B, CONTRACT_B, 'm3-vault')?.state.owner, OWNER_B);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT_B), { healthy: true, error: null });

  store.claimSync(CHAIN_ID, CONTRACT, 101n, replacementOwner);
  assert.throws(
    () => store.releaseSyncIncomplete(CHAIN_ID, CONTRACT, 101n, firstOwner),
    /CHAIN_SYNC_SUPERSEDED/,
  );
  store.releaseSyncIncomplete(CHAIN_ID, CONTRACT, 101n, replacementOwner);
  assert.deepEqual(store.rollbackFromBlock(CHAIN_ID, CONTRACT, 100n), {
    blocks: 1,
    events: 1,
    operations: 0,
    projections: 1,
  });
  assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT_B), {
    blockNumber: 100n,
    blockHash: BLOCK_100,
  });
  assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT_B).length, 1);
  assert.equal(store.projection(CHAIN_ID, OWNER_B, CONTRACT_B, 'm3-vault')?.state.owner, OWNER_B);
  store.close();
});

test('healthy completion rolls back when its lease disappears inside the transaction', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  store.commitProjections(CHAIN_ID, CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OWNER_A,
      contract: CONTRACT,
      projectionKey: 'm3-vault',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      state: { owner: OWNER_A },
    },
  ]);
  const ownerToken = '00000000-0000-4000-8000-000000000003';
  store.claimSync(CHAIN_ID, CONTRACT, 100n, ownerToken);
  store.db.exec(`
    CREATE TRIGGER delete_healthy_lease_after_checkpoint_update
    AFTER UPDATE OF sync_healthy ON chain_checkpoints
    WHEN OLD.sync_healthy = 0 AND NEW.sync_healthy = 1
      AND NEW.chain_id = ${CHAIN_ID}
      AND NEW.contract_address = '${CONTRACT.toLowerCase()}'
    BEGIN
      DELETE FROM chain_sync_leases
      WHERE chain_id = NEW.chain_id AND contract_address = NEW.contract_address;
    END;
  `);

  assert.throws(() => store.markSyncHealthy(CHAIN_ID, CONTRACT, 100n, ownerToken), /CHAIN_SYNC_SUPERSEDED/);
  assert.equal(
    (
      store.db
        .prepare('SELECT owner_token FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ?')
        .get(CHAIN_ID, CONTRACT.toLowerCase()) as { owner_token: string }
    ).owner_token,
    ownerToken,
  );
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 100n);
  assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'm3-vault'), /CHAIN_SYNC_UNHEALTHY/);

  store.db.exec('DROP TRIGGER delete_healthy_lease_after_checkpoint_update');
  assert.equal(store.markSyncHealthy(CHAIN_ID, CONTRACT, 100n, ownerToken), true);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  assert.equal(store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'm3-vault')?.state.owner, OWNER_A);
  store.close();
});

test('incomplete release rolls back lease loss without changing another Vault', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  for (const [contract, owner] of [
    [CONTRACT, OWNER_A],
    [CONTRACT_B, OWNER_B],
  ] as const) {
    store.recordCanonicalBlock(CHAIN_ID, contract, block, []);
    store.commitProjections(CHAIN_ID, contract, block, [
      {
        chainId: CHAIN_ID,
        owner,
        contract,
        projectionKey: 'm3-vault',
        blockNumber: 100n,
        blockHash: BLOCK_100,
        state: { owner },
      },
    ]);
  }
  const firstOwner = '00000000-0000-4000-8000-000000000004';
  const secondOwner = '00000000-0000-4000-8000-000000000005';
  store.claimSync(CHAIN_ID, CONTRACT, 101n, firstOwner);
  store.claimSync(CHAIN_ID, CONTRACT_B, 102n, secondOwner);
  store.db.exec(`
    CREATE TRIGGER delete_incomplete_lease_after_checkpoint_update
    AFTER UPDATE OF sync_target_block_number ON chain_checkpoints
    WHEN NEW.chain_id = ${CHAIN_ID}
      AND NEW.contract_address = '${CONTRACT.toLowerCase()}'
    BEGIN
      DELETE FROM chain_sync_leases
      WHERE chain_id = NEW.chain_id AND contract_address = NEW.contract_address;
    END;
  `);

  assert.throws(
    () => store.releaseSyncIncomplete(CHAIN_ID, CONTRACT, 101n, firstOwner),
    /CHAIN_SYNC_SUPERSEDED/,
  );
  const leaseOwner = store.db.prepare(
    'SELECT owner_token FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ?',
  );
  assert.equal(
    (leaseOwner.get(CHAIN_ID, CONTRACT.toLowerCase()) as { owner_token: string }).owner_token,
    firstOwner,
  );
  assert.equal(
    (leaseOwner.get(CHAIN_ID, CONTRACT_B.toLowerCase()) as { owner_token: string }).owner_token,
    secondOwner,
  );
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 101n);
  assert.equal(store.syncTarget(CHAIN_ID, CONTRACT_B), 102n);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT_B), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });

  store.db.exec('DROP TRIGGER delete_incomplete_lease_after_checkpoint_update');
  store.releaseSyncIncomplete(CHAIN_ID, CONTRACT, 101n, firstOwner);
  assert.equal(leaseOwner.get(CHAIN_ID, CONTRACT.toLowerCase()), undefined);
  assert.equal(
    (leaseOwner.get(CHAIN_ID, CONTRACT_B.toLowerCase()) as { owner_token: string }).owner_token,
    secondOwner,
  );
  store.releaseSyncIncomplete(CHAIN_ID, CONTRACT_B, 102n, secondOwner);
  store.close();
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
        assert.deepEqual(restoredHealth, { status: 'HEALTHY', schemaVersion: 7, integrity: 'OK' });
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

test('chain store fails closed on inconsistent persisted health and identity fields', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);

  store.db
    .prepare('UPDATE chain_checkpoints SET projected_block_number = ?, projected_block_hash = NULL')
    .run(100);
  assert.throws(() => store.projectionCheckpoint(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);
  store.db
    .prepare('UPDATE chain_checkpoints SET projected_block_number = NULL, projected_block_hash = ?')
    .run(BLOCK_100);
  assert.throws(() => store.projectionCheckpoint(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);
  store.db
    .prepare('UPDATE chain_checkpoints SET projected_block_number = NULL, projected_block_hash = NULL')
    .run();

  for (const [healthy, error, target] of [
    [1, 'CHAIN_SYNC_INCOMPLETE', null],
    [0, 'UNKNOWN', null],
    [0, 'CHAIN_SYNC_INCOMPLETE', null],
  ] as const) {
    store.db
      .prepare('UPDATE chain_checkpoints SET sync_healthy = ?, sync_error = ?, sync_target_block_number = ?')
      .run(healthy, error, target);
    assert.throws(() => store.syncHealth(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);
  }
  store.db
    .prepare('UPDATE chain_checkpoints SET sync_healthy = 0, sync_error = ?, sync_target_block_number = NULL')
    .run('CHAIN_REORG_DEPTH_EXCEEDED');
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_REORG_DEPTH_EXCEEDED',
  });
  store.db
    .prepare('UPDATE chain_checkpoints SET sync_healthy = 0, sync_error = ?, sync_target_block_number = ?')
    .run('CHAIN_SYNC_INCOMPLETE', 101);
  assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });

  assert.throws(
    () => store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_SYNC_INCOMPLETE'),
    /INVALID_CHAIN_SYNC_HEALTH/,
  );
  assert.throws(
    () => store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_REORG_DEPTH_EXCEEDED', 101n),
    /INVALID_CHAIN_SYNC_HEALTH/,
  );
  assert.throws(
    () => store.markSyncUnhealthy(CHAIN_ID, CONTRACT_B, 'CHAIN_REORG_DEPTH_EXCEEDED'),
    /CHAIN_CHECKPOINT_NOT_FOUND/,
  );
  store.db
    .prepare(
      'INSERT INTO chain_sync_leases (chain_id, contract_address, owner_token, target_block_number) VALUES (?, ?, ?, ?)',
    )
    .run(CHAIN_ID, CONTRACT_B.toLowerCase(), '00000000-0000-4000-8000-000000000001', 101);
  assert.throws(
    () => store.releaseSyncIncomplete(CHAIN_ID, CONTRACT_B, 101n, '00000000-0000-4000-8000-000000000001'),
    /CHAIN_CHECKPOINT_NOT_FOUND/,
  );

  store.db
    .prepare(
      'UPDATE chain_checkpoints SET sync_healthy = 1, sync_error = NULL, sync_target_block_number = NULL',
    )
    .run();
  assert.equal(store.markSyncHealthy(CHAIN_ID, CONTRACT, 100n), false);

  store.db
    .prepare('UPDATE chain_events SET topics_json = ?, normalized_json = ?')
    .run(JSON.stringify({}), JSON.stringify({ owner: OWNER_A }));
  assert.throws(() => store.canonicalEvents(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);
  store.db
    .prepare('UPDATE chain_events SET topics_json = ?, normalized_json = ?')
    .run(JSON.stringify([SIGNATURE]), JSON.stringify([]));
  assert.throws(() => store.canonicalEvents(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);

  const operation = transitionOperation(
    createOperation({
      operationId: 'corrupt-persisted-operation',
      chainId: CHAIN_ID,
      owner: OWNER_A,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_A, submittedAt: '2026-09-20T00:00:00.000Z' },
  );
  store.saveOperation(operation);
  store.db
    .prepare('UPDATE chain_transactions SET state = ? WHERE operation_id = ?')
    .run('UNKNOWN', operation.operationId);
  assert.throws(() => store.operation(operation.operationId), /CORRUPT_CHAIN_DATABASE/);
  store.db
    .prepare('UPDATE chain_transactions SET state = ?, owner_address = ? WHERE operation_id = ?')
    .run('SUBMITTED', 'not-an-address', operation.operationId);
  assert.throws(() => store.operation(operation.operationId), /CORRUPT_CHAIN_DATABASE/);
  store.close();
});

test('chain store rejects malformed block and event evidence before changing the checkpoint', async () => {
  const store = new ChainStore(await databasePath());
  const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1_000n };
  for (const malformed of [
    event({ chainId: 1 }),
    event({ address: OWNER_B }),
    event({ blockNumber: 101n }),
    event({ blockHash: BLOCK_101 }),
    event({ removed: true }),
    event({ transactionIndex: -1 }),
    event({ logIndex: -1 }),
    event({ eventName: 'bad/name' }),
    event({ topics: [] }),
    event({ eventSignature: asHexData(`0x${'dd'.repeat(32)}`) }),
  ])
    assert.throws(
      () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [malformed]),
      /INVALID_CHAIN_EVENT/,
    );
  assert.throws(
    () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, { ...block, timestamp: -1n }, []),
    /INVALID_CHAIN_BLOCK/,
  );
  assert.throws(
    () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [], 99n),
    /INVALID_CHAIN_SYNC_TARGET/,
  );
  store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  assert.throws(
    () =>
      store.recordCanonicalBlock(
        CHAIN_ID,
        CONTRACT,
        { number: 101n, hash: BLOCK_101, parentHash: BLOCK_101_ALT, timestamp: 1_001n },
        [],
      ),
    /CHAIN_PARENT_MISMATCH/,
  );
  assert.throws(
    () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, { ...block, hash: BLOCK_101 }, []),
    /CHAIN_BLOCK_CONFLICT/,
  );
  assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), {
    blockNumber: 100n,
    blockHash: BLOCK_100,
  });
  store.close();
});

test('version-six backups remain read-only recoverable and observations survive migration', async () => {
  const source = await databasePath();
  const old = new DatabaseSync(source);
  for (const migration of [
    '001-chain-projection.sql',
    '002-projection-checkpoint.sql',
    '003-sync-target.sql',
    '004-sync-lease.sql',
    '005-transaction-index.sql',
    '006-operation-calldata.sql',
  ])
    old.exec(readFileSync(new URL(`../apps/server/chain-migrations/${migration}`, import.meta.url), 'utf8'));
  old
    .prepare(
      `INSERT INTO chain_transactions
    (operation_id, chain_id, tx_hash, owner_address, target_address, state, submitted_at, confirmations, canonical, reconciled, calldata)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(
      'legacy-unverified-owner',
      CHAIN_ID,
      TX_A,
      OWNER_B,
      CONTRACT,
      'SUBMITTED',
      '2026-09-20T00:00:00.000Z',
      '0x1234',
    );
  const beforeRows = old.prepare('SELECT * FROM chain_transactions').all();
  old.close();
  const before = readFileSync(source);
  for (const operation of ['backup', 'restore'] as const) {
    const destination = `${source}.${operation}`;
    const result = runRecovery(operation, source, destination);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).schemaVersion, 6);
    assert.deepEqual(readFileSync(source), before);
    const store = new ChainStore(destination);
    try {
      assert.equal(store.health().schemaVersion, 7);
      assert.deepEqual(store.db.prepare('SELECT * FROM chain_transactions').all(), beforeRows);
      const observed = store.operation('legacy-unverified-owner')!;
      store.saveOperation({ ...observed, operationId: 'correct-after-upgrade', owner: OWNER_A });
      assert.equal(store.operation('correct-after-upgrade')?.owner, OWNER_A);
      assert.equal(store.operation('legacy-unverified-owner')?.owner, OWNER_B);
    } finally {
      store.close();
    }
  }
});

// These cases protect persisted recovery boundaries, not SQLite's own constraints.
test('projection JSON rejects unsafe numeric and byte payloads without replacing the last good view', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
    const projection = {
      chainId: CHAIN_ID,
      owner: OWNER_A,
      contract: CONTRACT,
      projectionKey: 'vault-boundary',
      blockNumber: 100n,
      blockHash: BLOCK_100,
      state: { principal: '1000000' },
    };
    store.commitProjections(CHAIN_ID, CONTRACT, block, [projection]);
    for (const value of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () =>
          store.commitProjections(CHAIN_ID, CONTRACT, block, [{ ...projection, state: { amount: value } }]),
        /INVALID_CHAIN_JSON/,
      );
      assert.deepEqual(store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'vault-boundary')?.state, {
        principal: '1000000',
      });
    }
    assert.throws(
      () =>
        store.commitProjections(CHAIN_ID, CONTRACT, block, [
          { ...projection, state: { payload: '界'.repeat(22000) } },
        ]),
      /CHAIN_JSON_TOO_LARGE/,
    );
    assert.equal(store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'vault-boundary')?.state.principal, '1000000');
    assert.equal(store.db.isTransaction, false);
  } finally {
    store.close();
  }
});

test('negative chain ids, overflowing heights and malformed lease owners never establish a checkpoint', async () => {
  const store = new ChainStore(await databasePath());
  try {
    for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => store.checkpoint(id, CONTRACT), /INVALID_CHAIN_ID/);
    for (const number of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])
      assert.throws(
        () =>
          store.recordCanonicalBlock(
            CHAIN_ID,
            CONTRACT,
            { number, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1n },
            [],
          ),
        /CHAIN_BLOCK_NUMBER_UNSUPPORTED/,
      );
    assert.throws(
      () => store.claimSync(CHAIN_ID, CONTRACT, 100n, 'not-a-lease-owner'),
      /INVALID_CHAIN_SYNC_OWNER/,
    );
    assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
    assert.equal(store.projectionCheckpoint(CHAIN_ID, CONTRACT), null);
    assert.equal(store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'missing'), null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM chain_sync_leases').get()?.n, 0);
  } finally {
    store.close();
  }
});

test('canonical replay refuses old heights and lost event rows without advancing state', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const first = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1000n };
    const second = { number: 101n, hash: BLOCK_101, parentHash: BLOCK_100, timestamp: 1001n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, first, [event()]);
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, second, []);
    assert.throws(
      () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, first, [event()]),
      /CHAIN_BLOCK_OUT_OF_ORDER/,
    );
    assert.equal(store.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, 101n);
    // Restored database has lost an event while its checkpoint still claims one.
    store.db.prepare('DELETE FROM chain_events').run();
    store.db.prepare('DELETE FROM chain_blocks WHERE block_number = 101').run();
    store.db.prepare('UPDATE chain_checkpoints SET block_number = 100, block_hash = ?').run(BLOCK_100);
    assert.throws(
      () => store.recordCanonicalBlock(CHAIN_ID, CONTRACT, first, [event()]),
      /CHAIN_BLOCK_CONFLICT/,
    );
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM chain_events').get()?.n, 0);
    assert.equal(store.db.isTransaction, false);
  } finally {
    store.close();
  }
});

test('orphan projections and contradictory sync health cannot become readable product evidence', async () => {
  const store = new ChainStore(await databasePath());
  try {
    store.db
      .prepare('INSERT INTO product_projections VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(CHAIN_ID, OWNER_A, CONTRACT, 'orphan', 100, BLOCK_100, '{"principal":"1000000"}');
    assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'orphan'), /CORRUPT_CHAIN_DATABASE/);
    const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
    store.commitProjections(CHAIN_ID, CONTRACT, block, []);
    for (const error of ['CHAIN_REORG_DEPTH_EXCEEDED', 'CHAIN_REORG_NO_COMMON_ANCESTOR'] as const) {
      store.markSyncUnhealthy(CHAIN_ID, CONTRACT, error);
      assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), { healthy: false, error });
      assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'orphan'), /CHAIN_SYNC_UNHEALTHY/);
    }
    store.db.prepare('UPDATE chain_checkpoints SET sync_healthy = 0, sync_error = NULL').run();
    assert.throws(() => store.syncHealth(CHAIN_ID, CONTRACT), /CORRUPT_CHAIN_DATABASE/);
    assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'orphan'), /CORRUPT_CHAIN_DATABASE/);
  } finally {
    store.close();
  }
});

test('database health exposes changed schema and closed handle as unhealthy', async () => {
  const store = new ChainStore(await databasePath());
  store.db.exec('PRAGMA user_version = 8');
  assert.deepEqual(store.health(), { status: 'UNHEALTHY', schemaVersion: 8, integrity: 'FAILED' });
  store.close();
  assert.deepEqual(store.health(), { status: 'UNHEALTHY', schemaVersion: null, integrity: 'FAILED' });
});

test('sync targets remain monotonic and a fatal reorg releases only its owning lease', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
    const owner = '00000000-0000-4000-8000-000000000021';
    store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_SYNC_INCOMPLETE', 103n);
    store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_SYNC_INCOMPLETE', 102n);
    store.claimSync(CHAIN_ID, CONTRACT, 103n, owner);
    assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 103n);
    assert.throws(
      () =>
        store.markSyncUnhealthy(
          CHAIN_ID,
          CONTRACT,
          'CHAIN_REORG_DEPTH_EXCEEDED',
          null,
          '00000000-0000-4000-8000-000000000022',
        ),
      /CHAIN_SYNC_SUPERSEDED/,
    );
    assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), 103n);
    store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_REORG_DEPTH_EXCEEDED', null, owner);
    assert.equal(store.syncTarget(CHAIN_ID, CONTRACT), null);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM chain_sync_leases').get()?.n, 0);
    assert.deepEqual(store.syncHealth(CHAIN_ID, CONTRACT), {
      healthy: false,
      error: 'CHAIN_REORG_DEPTH_EXCEEDED',
    });
    assert.throws(() => store.projection(CHAIN_ID, OWNER_A, CONTRACT, 'm3-vault'), /CHAIN_SYNC_UNHEALTHY/);
  } finally {
    store.close();
  }
});

test('reorg rollback is atomic when storage fails after changing canonical blocks', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const block = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, [event()]);
    const before = {
      checkpoint: store.checkpoint(CHAIN_ID, CONTRACT),
      events: store.canonicalEvents(CHAIN_ID, CONTRACT),
    };
    store.db.exec(
      "CREATE TRIGGER rollback_fault BEFORE UPDATE OF canonical ON chain_events BEGIN SELECT RAISE(ABORT, 'fixture storage unavailable'); END;",
    );
    assert.throws(() => store.rollbackFromBlock(CHAIN_ID, CONTRACT, 100n), /fixture storage unavailable/);
    assert.equal(store.db.isTransaction, false);
    assert.deepEqual(store.checkpoint(CHAIN_ID, CONTRACT), before.checkpoint);
    assert.deepEqual(store.canonicalEvents(CHAIN_ID, CONTRACT), before.events);
    assert.equal(store.canonicalBlock(CHAIN_ID, CONTRACT, 100n)?.hash, BLOCK_100);
    store.db.exec('DROP TRIGGER rollback_fault');
    assert.deepEqual(store.rollbackFromBlock(CHAIN_ID, CONTRACT, 100n), {
      blocks: 1,
      events: 1,
      operations: 0,
      projections: 0,
    });
    assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
  } finally {
    store.close();
  }
});

test('orphaned event reinclusion rejects changed payload atomically but accepts unchanged payload on a new block', async () => {
  const store = new ChainStore(await databasePath());
  try {
    const first = { number: 100n, hash: BLOCK_100, parentHash: BLOCK_99, timestamp: 1n };
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, first, [event()]);
    store.rollbackFromBlock(CHAIN_ID, CONTRACT, 100n);
    const replacement = { ...first, hash: BLOCK_101_ALT };
    for (const change of [
      { data: asHexData('0xabcd') },
      { normalizedData: { owner: OWNER_A, amount: '2' } },
    ]) {
      assert.throws(
        () =>
          store.recordCanonicalBlock(CHAIN_ID, CONTRACT, replacement, [
            event({ blockHash: BLOCK_101_ALT, ...change }),
          ]),
        /CHAIN_EVENT_CONFLICT/,
      );
      assert.equal(store.checkpoint(CHAIN_ID, CONTRACT), null);
      assert.deepEqual(store.canonicalEvents(CHAIN_ID, CONTRACT), []);
      assert.equal(store.db.isTransaction, false);
    }
    store.recordCanonicalBlock(CHAIN_ID, CONTRACT, replacement, [event({ blockHash: BLOCK_101_ALT })]);
    assert.equal(store.checkpoint(CHAIN_ID, CONTRACT)?.blockHash, BLOCK_101_ALT);
    assert.equal(store.canonicalEvents(CHAIN_ID, CONTRACT).length, 1);
  } finally {
    store.close();
  }
});

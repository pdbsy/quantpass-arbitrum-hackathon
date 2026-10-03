import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';
import { verifyServerBackup } from '../packages/testnet/src/server-backups.ts';
import { createReleaseSession, OWNER_A, OWNER_B } from '../tools/testing/alphaforge-release-mock/session.mjs';
import { FIXTURE_IDENTITY, canonicalHash } from './fixtures/release-mock/scenario.mjs';

async function withSession(run) {
  const s = await createReleaseSession();
  try {
    await run(s);
  } finally {
    await s.close();
  }
}
const hash = '0x' + 'cd'.repeat(32);
const prepare = async (s, cookie) => {
  const result = await s.request(
    '/api/testnet/vaults/mock-owner-a/prepare',
    { action: { kind: 'DEPOSIT', amountUsdc: '1' } },
    cookie,
  );
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
};
const order = (s, id = 'release-ema-minute-1') => ({
  id,
  chainId: 46630,
  owner: OWNER_A,
  executor: s.executor,
  vault: s.runtime.manifest.contractAddress,
  manifestDigest: s.runtime.manifest.manifestDigest,
  sourceDigest: FIXTURE_IDENTITY,
  grantVersion: '1',
  stateVersion: '4',
  snapshotHash: canonicalHash(16),
  calldata: '0x12345678',
  createdAt: 1000,
});

test('unknown submission, duplicate observation and restart never imply fill or automatic broadcast', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A),
      prepared = await prepare(s, cookie);
    for (let i = 0; i < 2; i++) {
      const response = await s.request(
        '/api/testnet/vaults/mock-owner-a/observe',
        { operationId: prepared.operationId, transactionHash: hash },
        cookie,
      );
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().state, 'SUBMITTED');
      assert.equal(response.json().productReady, false);
    }
    const response = await s.request(
      '/api/testnet/vaults/mock-owner-a/observe',
      { operationId: prepared.operationId, transactionHash: '0x' + 'ef'.repeat(32) },
      cookie,
    );
    assert.equal(response.statusCode, 500);
    await s.restart();
    const current = await s.request(
      '/api/testnet/vaults/mock-owner-a/operations/' + prepared.operationId,
      undefined,
      cookie,
    );
    assert.equal(current.json().state, 'SUBMITTED');
    assert.equal(current.json().productReady, false);
    assert.equal(current.json().txHash, hash);
    assert.equal(s.broadcasts, 0);
    const b = await s.login(OWNER_B);
    assert.equal(
      (await s.request('/api/testnet/vaults/mock-owner-a/operations/' + prepared.operationId, undefined, b))
        .statusCode,
      404,
    );
  }));

test('wrong sender, chain, target, calldata and value fail observation without erasing intent', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A),
      p = await prepare(s, cookie);
    const envelope = {
      hash,
      chainId: '0xb626',
      from: OWNER_A,
      to: s.runtime.manifest.contractAddress,
      input: p.transaction.data,
      value: '0x0',
      nonce: '0x7',
      blockHash: null,
      blockNumber: null,
      transactionIndex: null,
    };
    for (const change of [
      { from: OWNER_B },
      { chainId: '0x1237' },
      { to: OWNER_B },
      { input: '0x12345678' },
      { value: '0x1' },
    ]) {
      s.fixture.transaction = { ...envelope, ...change };
      assert.equal(
        (
          await s.request(
            '/api/testnet/vaults/mock-owner-a/observe',
            { operationId: p.operationId, transactionHash: hash },
            cookie,
          )
        ).statusCode,
        500,
      );
      assert.equal(s.runtime.operationView(OWNER_A, p.operationId).state, 'AWAITING_SIGNATURE');
    }
  }));

test('canonical reverted receipt remains failure across restart and requires exact verified envelope', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A),
      p = await prepare(s, cookie),
      blockHash = canonicalHash(14);
    s.fixture.transaction = {
      hash,
      chainId: '0xb626',
      from: OWNER_A,
      to: s.runtime.manifest.contractAddress,
      input: p.transaction.data,
      value: '0x0',
      nonce: '0x7',
      blockHash,
      blockNumber: '0xe',
      transactionIndex: '0x0',
    };
    s.fixture.receipt = {
      transactionHash: hash,
      from: OWNER_A,
      to: s.runtime.manifest.contractAddress,
      blockHash,
      blockNumber: '0xe',
      transactionIndex: '0x0',
      status: '0x0',
      logs: [],
    };
    assert.equal(
      (
        await s.request(
          '/api/testnet/vaults/mock-owner-a/observe',
          { operationId: p.operationId, transactionHash: hash },
          cookie,
        )
      ).statusCode,
      200,
    );
    await s.runtime.syncToHead();
    let view = (
      await s.request('/api/testnet/vaults/mock-owner-a/operations/' + p.operationId, undefined, cookie)
    ).json();
    assert.equal(view.state, 'REVERTED');
    assert.equal(view.productReady, false);
    assert.equal(view.failedFinalConfirmed, true);
    await s.restart();
    view = s.runtime.operationView(OWNER_A, p.operationId);
    assert.equal(view.state, 'REVERTED');
    assert.equal(view.productReady, false);
  }));

for (const fault of ['DISCONNECTED', 'TIMEOUT', 'CHAIN'])
  test(`${fault} RPC fault suppresses published personal snapshot and retains prior evidence`, async () =>
    withSession(async (s) => {
      const cookie = await s.login(OWNER_A),
        before = s.runtime.evidence.verify();
      s.setFault(fault);
      await assert.rejects(s.runtime.syncToHead(), /TRADING_SYNC_FAILED/);
      const view = (await s.request('/api/testnet/vaults', undefined, cookie)).json().vaults[0];
      assert.equal(view.status, 'DEGRADED');
      assert.equal(view.snapshot, null);
      assert.equal(view.performance, null);
      assert.deepEqual(s.runtime.evidence.verify(), before);
      s.setFault('NONE');
      await s.runtime.syncToHead();
      assert.equal(s.runtime.status(), 'HEALTHY');
      assert.equal(s.broadcasts, 0);
    }));

test('canonical reorg retains orphaned original events and does not publish inconsistent replacement', async () =>
  withSession(async (s) => {
    const original = s.runtime.evidence.verify(),
      fork = '0x' + 'ef'.repeat(32);
    s.fixture.hashAt = (n) => (n === 16 ? fork : canonicalHash(n));
    await assert.rejects(s.runtime.syncToHead(), /TRADING_SYNC_FAILED/);
    assert.equal(s.runtime.ownedView(OWNER_A).performance, null);
    assert.deepEqual(s.runtime.evidence.verify(), original);
    s.fixture.logs = s.fixture.logs.map((log) =>
      log.blockNumber === '0x10' ? { ...log, blockHash: fork } : log,
    );
    await s.runtime.syncToHead();
    assert.equal(s.runtime.evidence.verify().records, original.records + 1);
    assert.equal(
      s.runtime.store.db.prepare('SELECT count(*) AS n FROM chain_blocks WHERE canonical=0').get().n,
      1,
    );
  }));

test('nonce locks survive process-style close/reopen and cannot be reset by a new order', async () =>
  withSession(async (s) => {
    s.orders.prepare(order(s));
    s.orders.reserve('release-ema-minute-1', '7');
    await s.restart();
    assert.equal(s.orders.blocked(s.executor), true);
    assert.equal(s.orders.get('release-ema-minute-1').state, 'RESERVED');
    s.orders.prepare(order(s, 'release-ema-minute-2'));
    assert.throws(() => s.orders.reserve('release-ema-minute-2', '8'), /ORDER_EXECUTOR_BLOCKED/);
    assert.equal(s.broadcasts, 0);
  }));

test('manual production backup verifies independent restore and keeps reserved nonce; tampering fails', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A);
    s.orders.prepare(order(s));
    s.orders.reserve('release-ema-minute-1', '7');
    const response = await s.request('/api/testnet/backups', {}, cookie);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state, 'VERIFIED');
    const folder = join(s.storage.folder, 'backups', response.json().id);
    const bytes = readFileSync(join(folder, 'orders.sqlite'));
    assert.equal((await verifyServerBackup(folder, FIXTURE_IDENTITY)).state, 'VERIFIED');
    assert.deepEqual(readFileSync(join(folder, 'orders.sqlite')), bytes);
    const restore = join(s.directory, 'restore');
    mkdirSync(restore);
    copyFileSync(join(folder, 'orders.sqlite'), join(restore, 'orders.sqlite'));
    const restored = new OrderJournal(join(restore, 'orders.sqlite'), FIXTURE_IDENTITY);
    try {
      assert.equal(restored.blocked(s.executor), true);
      assert.equal(restored.get('release-ema-minute-1').nonce, '7');
    } finally {
      restored.close();
    }
    assert.equal((await s.request('/api/testnet/backups', {}, cookie)).statusCode, 429);
    writeFileSync(join(folder, 'orders.sqlite'), 'deliberately corrupted MOCK backup');
    await assert.rejects(verifyServerBackup(folder, FIXTURE_IDENTITY), /BACKUP/);
    assert.equal(s.orders.blocked(s.executor), true);
  }));

test('startup rejects incompatible stored order schema without losing reserved original rows', async () =>
  withSession(async (s) => {
    s.orders.prepare(order(s));
    s.orders.reserve('release-ema-minute-1', '7');
    s.orders.db.exec('PRAGMA user_version=999');
    s.orders.close();
    assert.throws(
      () => new OrderJournal(s.storage.databasePath('orders'), FIXTURE_IDENTITY),
      /ORDER_DATABASE_SCHEMA/,
    );
    // Original bytes are retained. Restore the fixture schema only to permit owned cleanup.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(s.storage.databasePath('orders'));
    try {
      assert.equal(
        db.prepare('SELECT state FROM orders WHERE id=?').get('release-ema-minute-1').state,
        'RESERVED',
      );
    } finally {
      db.close();
    }
  }));

test('successful receipt requires exact canonical event and envelope; refresh and restart agree on confirmation', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A);
    const response = await s.request(
      '/api/testnet/vaults/mock-owner-a/prepare',
      { action: { kind: 'DEPOSIT', amountUsdc: '1000000000' } },
      cookie,
    );
    assert.equal(response.statusCode, 200);
    const p = response.json(),
      deposit = s.fixture.logs[0],
      transactionHash = deposit.transactionHash;
    s.fixture.transaction = {
      hash: transactionHash,
      chainId: '0xb626',
      from: OWNER_A,
      to: s.runtime.manifest.contractAddress,
      input: p.transaction.data,
      value: '0x0',
      nonce: '0x7',
      blockHash: deposit.blockHash,
      blockNumber: deposit.blockNumber,
      transactionIndex: deposit.transactionIndex,
    };
    s.fixture.receipt = {
      transactionHash,
      from: OWNER_A,
      to: s.runtime.manifest.contractAddress,
      blockHash: deposit.blockHash,
      blockNumber: deposit.blockNumber,
      transactionIndex: deposit.transactionIndex,
      status: '0x1',
      logs: [deposit],
    };
    assert.equal(
      (
        await s.request(
          '/api/testnet/vaults/mock-owner-a/observe',
          { operationId: p.operationId, transactionHash },
          cookie,
        )
      ).statusCode,
      200,
    );
    await s.runtime.syncToHead();
    const current = (
      await s.request('/api/testnet/vaults/mock-owner-a/operations/' + p.operationId, undefined, cookie)
    ).json();
    assert.equal(current.state, 'CONFIRMED');
    assert.equal(current.productReady, true);
    assert.equal(current.canonical, true);
    assert.equal(current.reconciled, true);
    const before = (await s.request('/api/testnet/vaults', undefined, cookie)).json().vaults[0];
    await s.restart();
    const after = (await s.request('/api/testnet/vaults', undefined, cookie)).json().vaults[0];
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.deepEqual(after.performance, before.performance);
    assert.equal(
      (
        await s.request('/api/testnet/vaults/mock-owner-a/operations/' + p.operationId, undefined, cookie)
      ).json().productReady,
      true,
    );
  }));

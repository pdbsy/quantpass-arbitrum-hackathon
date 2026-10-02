import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';

const owner = '0x1111111111111111111111111111111111111111';
const executor = '0x2222222222222222222222222222222222222222';
const vault = '0x3333333333333333333333333333333333333333';
const hash = '0x' + 'ab'.repeat(32);
const order = {
  id: 'ema-msft-minute-1',
  chainId: 46630,
  owner,
  executor,
  vault,
  manifestDigest: hash,
  sourceDigest: hash,
  grantVersion: '1',
  stateVersion: '4',
  snapshotHash: hash,
  calldata: '0x12345678',
  createdAt: 1000,
};
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-orders-'));
  const path = join(folder, 'orders.sqlite');
  return { folder, path };
}
test('intent replay is idempotent but changed source, authority or calldata cannot reuse an ID', () => {
  const f = fixture();
  const db = new OrderJournal(f.path, hash);
  try {
    assert.equal(db.prepare(order).state, 'PREPARED');
    assert.equal(db.prepare(order).state, 'PREPARED');
    for (const changed of [
      { ...order, calldata: '0x12345679' },
      { ...order, grantVersion: '2' },
      { ...order, owner: '0x4444444444444444444444444444444444444444' },
      { ...order, sourceDigest: '0x' + 'cd'.repeat(32) },
    ])
      assert.throws(() => db.prepare(changed), /ORDER_ID_CONFLICT/);
    assert.throws(() => db.prepare({ ...order, id: 'wrong-chain', chainId: 4663 }), /ORDER_INPUT/);
  } finally {
    db.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});
test('nonce reservation is durable before signing; uncertainty and restart never reset it for automatic retry', () => {
  const f = fixture();
  let db = new OrderJournal(f.path, hash);
  try {
    db.prepare(order);
    db.reserve(order.id, '7');
    assert.equal(db.get(order.id)?.state, 'RESERVED');
    db.prepare({ ...order, id: 'other-minute' });
    assert.throws(() => db.reserve('other-minute', '7'), /ORDER_NONCE_CONFLICT/);
    assert.throws(() => db.reserve(order.id, '8'), /ORDER_TRANSITION/);
    db.close();
    db = new OrderJournal(f.path, hash);
    assert.equal(db.get(order.id)?.nonce, '7');
    assert.equal(db.blocked(executor), true);
    assert.throws(() => db.reserve('other-minute', '8'), /ORDER_EXECUTOR_BLOCKED/);
    assert.throws(() => db.signed(order.id, '0x1234'), /ORDER_SIGNED_TRANSACTION/);
    assert.equal(db.get(order.id)?.state, 'RESERVED');
    db.close();
    assert.throws(() => new OrderJournal(f.path, '0x' + 'cd'.repeat(32)), /ORDER_DATABASE_IDENTITY/);
  } finally {
    db.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});
test('journal refuses unsupported schema and preserves existing records', () => {
  const f = fixture();
  const db = new OrderJournal(f.path, hash);
  try {
    db.prepare(order);
    db.db.exec('PRAGMA user_version=999');
    db.close();
    assert.throws(() => new OrderJournal(f.path, hash), /ORDER_DATABASE_SCHEMA/);
  } finally {
    db.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});
test('corrupted persisted signed bytes cannot be released to a broadcast transport', () => {
  const f = fixture(),
    db = new OrderJournal(f.path, hash);
  try {
    db.prepare(order);
    db.reserve(order.id, '7');
    // Deliberately corrupt persisted evidence, without generating any signature.
    db.db
      .prepare("UPDATE orders SET state='SIGNED',raw_transaction=?,transaction_hash=? WHERE id=?")
      .run('0x1234', hash, order.id);
    assert.throws(() => db.claimBroadcast(order.id), /ORDER_SIGNED_TRANSACTION/);
    assert.equal(db.get(order.id)?.state, 'SIGNED');
    assert.equal(db.blocked(executor), true);
  } finally {
    db.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});

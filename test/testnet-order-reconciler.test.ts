import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';
import { BatchJournal } from '../packages/market-data/src/batch-journal.ts';
import { restrictedOrderReconciler } from '../apps/server/src/testnet-order-reconciler.ts';
import { asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
const hash = '0x' + 'ab'.repeat(32),
  txhash = '0x' + 'cd'.repeat(32);
test('unknown and reorged restricted submissions remain blocked; canonical reverts retain gas and original outcomes', async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-order-reconcile-'))),
    orders = new OrderJournal(join(folder, 'orders.sqlite'), hash),
    batches = new BatchJournal(join(folder, 'batches.sqlite')),
    f = tradingRpcFixture();
  const intent = {
    id: 'canonical-outcome',
    chainId: 46630,
    owner: f.inventory.owner,
    executor: address(40),
    vault: f.manifest.contractAddress,
    manifestDigest: f.manifest.manifestDigest,
    sourceDigest: hash,
    grantVersion: '1',
    stateVersion: '4',
    snapshotHash: hash,
    calldata: '0x12345678',
    createdAt: 1000000,
  };
  // Deliberately construct persisted state at the receipt-reader boundary. No signature or send occurs.
  orders.prepare(intent);
  orders.reserve(intent.id, '7');
  orders.db
    .prepare("UPDATE orders SET state='BROADCAST_UNCERTAIN',transaction_hash=? WHERE id=?")
    .run(txhash, intent.id);
  let receipt: Awaited<ReturnType<typeof f.client.receipt>> = null;
  const transaction = {
    hash: txhash,
    chainId: 46630,
    from: address(40),
    to: f.manifest.contractAddress,
    data: '0x12345678',
    value: 0n,
    nonce: 7n,
    blockHash: hash,
    blockNumber: 14n,
    transactionIndex: 0,
  };
  const block = await f.client.block(14n);
  assert.ok(block);
  transaction.blockHash = block.hash;
  const rpc = {
    chainId: f.client.chainId.bind(f.client),
    block: f.client.block.bind(f.client),
    code: f.client.code.bind(f.client),
    call: f.client.call.bind(f.client),
    logs: f.client.logs.bind(f.client),
    receipt: async () => receipt,
    transaction: async () => transaction as Awaited<ReturnType<NonNullable<typeof f.client.transaction>>>,
  };
  const reconcile = restrictedOrderReconciler(
    orders,
    rpc,
    [{ id: 'owner', manifest: f.manifest, inventory: f.inventory }],
    batches,
    [],
  );
  try {
    await reconcile();
    assert.equal(orders.blocked(address(40)), true);
    receipt = {
      transactionHash: asTransactionHash(txhash),
      blockNumber: 14n,
      blockHash: block.hash,
      transactionIndex: 0,
      from: address(40),
      to: f.manifest.contractAddress,
      status: 'REVERTED',
      logs: [],
      gasUsed: 21000n,
      effectiveGasPrice: 100n,
    };
    await reconcile();
    assert.equal(orders.get(intent.id)!.state, 'REVERTED');
    assert.match(orders.get(intent.id)!.evidence!, /2100000/);
    receipt = null;
    await reconcile();
    assert.equal(orders.get(intent.id)!.state, 'REORGED');
    assert.equal(orders.blocked(address(40)), true);
    assert.equal(orders.db.prepare('SELECT count(*) AS n FROM order_outcomes').get()!.n, 2);
    orders.verifyOutcomes();
  } finally {
    orders.close();
    batches.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

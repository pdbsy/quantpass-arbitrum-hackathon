import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedOwnerRevert } from '../packages/testnet/src/failed-owner-transaction.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import { asHexData, asTransactionHash, asBlockHash } from '../packages/chain-adapter/src/types.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
test('manual acknowledgement of a failed owner transaction requires its exact envelope and fresh canonical depth', async () => {
  const f = tradingRpcFixture(),
    block = (await f.client.block(14n))!,
    hash = asTransactionHash('0x' + 'cd'.repeat(32)),
    data = asHexData('0x12345678');
  const operation = transitionOperation(
    transitionOperation(
      createOperation({
        operationId: 'failed-owner',
        chainId: 46630,
        owner: address(1),
        target: f.manifest.contractAddress,
        calldata: data,
        state: 'AWAITING_SIGNATURE',
      }),
      { state: 'SUBMITTED', txHash: hash, submittedAt: '2026-10-02T00:00:00Z' },
    ),
    {
      state: 'REVERTED',
      blockNumber: block.number,
      blockHash: block.hash,
      receiptStatus: 'REVERTED',
      transactionIndex: 0,
      errorCode: 'TRANSACTION_REVERTED',
    },
  );
  const receipt = {
      transactionHash: hash,
      from: address(1),
      to: f.manifest.contractAddress,
      blockNumber: block.number,
      blockHash: block.hash,
      transactionIndex: 0,
      status: 'REVERTED' as const,
      logs: [],
    },
    tx = {
      hash,
      from: address(1),
      to: f.manifest.contractAddress,
      chainId: 46630,
      value: 0n,
      nonce: 1n,
      data,
      blockNumber: block.number,
      blockHash: block.hash,
      transactionIndex: 0,
    };
  const rpc = {
    chainId: f.client.chainId.bind(f.client),
    block: f.client.block.bind(f.client),
    code: f.client.code.bind(f.client),
    call: f.client.call.bind(f.client),
    logs: f.client.logs.bind(f.client),
    receipt: async () => receipt,
    transaction: async () => tx,
  };
  assert.equal(await verifiedOwnerRevert(rpc, operation), true);
  assert.equal(await verifiedOwnerRevert({ ...rpc, receipt: async () => null }, operation), false);
  assert.equal(
    await verifiedOwnerRevert(
      { ...rpc, transaction: async () => ({ ...tx, data: asHexData('0x87654321') }) },
      operation,
    ),
    false,
  );
  assert.equal(
    await verifiedOwnerRevert(
      { ...rpc, block: async (n) => (n === 'latest' ? f.client.block(15n) : f.client.block(n)) },
      operation,
    ),
    false,
  );
  assert.equal(
    await verifiedOwnerRevert(
      { ...rpc, receipt: async () => ({ ...receipt, status: 'SUCCESS' }) },
      operation,
    ),
    false,
  );
  assert.equal(await verifiedOwnerRevert({ ...rpc, chainId: async () => 4663 }, operation), false);
  assert.equal(
    await verifiedOwnerRevert(
      {
        ...rpc,
        block: async (n) =>
          n === 14n
            ? ({ ...block, hash: asBlockHash('0x' + 'ef'.repeat(32)) } as typeof block)
            : f.client.block(n),
      },
      operation,
    ),
    false,
  );
});

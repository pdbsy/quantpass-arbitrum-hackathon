import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
import {
  TradingVaultContractIntegration,
  decodeTradingEvent,
} from '../apps/server/src/trading-vault-integration.ts';
import { tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import { asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import type { ChainLog, ChainReceipt } from '../packages/chain-adapter/src/rpc.ts';
import type { CanonicalContractEvent } from '../packages/chain-adapter/src/reconciliation.ts';
const txHash = asTransactionHash('0x' + 'cd'.repeat(32)),
  blockHash = '0x' + 'ab'.repeat(32);
function transaction(data: string) {
  return {
    hash: txHash,
    chainId: '0xb626',
    from: address(40),
    to: address(50),
    input: data,
    value: '0x0',
    nonce: '0x7',
    blockHash,
    blockNumber: '0x10',
    transactionIndex: '0x0',
  };
}
async function context(
  txChange: Record<string, unknown> = {},
  eventChange: readonly unknown[] | null = null,
) {
  const data = tradingInterface.encodeFunctionData('execute', [
    [address(3), address(10), 100000000n, 10n ** 18n, 1100n, 3n],
  ]);
  const f = tradingRpcFixture('NONE', { transaction: { ...transaction(data), ...txChange } }),
    block = (await f.client.block('latest'))!;
  const encoded = tradingInterface.encodeEventLog(
    tradingInterface.getEvent('SwapExecuted')!,
    eventChange ?? [4n, 1n, address(10), true, 100000000n, 10n ** 18n],
  );
  const log: ChainLog = {
    address: address(50),
    blockHash: block.hash,
    blockNumber: 16n,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 0,
    topics: encoded.topics.map(asHexData),
    data: asHexData(encoded.data),
    removed: false,
  };
  const event: CanonicalContractEvent = { ...log, ...decodeTradingEvent(log)!, chainId: 46630 };
  const receipt: ChainReceipt = {
    transactionHash: txHash,
    blockNumber: 16n,
    blockHash: block.hash,
    transactionIndex: 0,
    from: address(40),
    to: address(50),
    status: 'SUCCESS',
    logs: [log],
  };
  const operation = transitionOperation(
    createOperation({
      operationId: 'fixture-buy',
      chainId: 46630,
      owner: address(40),
      target: address(50),
      calldata: asHexData(data),
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash, submittedAt: '2026-10-02T00:00:00Z' },
  );
  return {
    rpc: f.client,
    manifest: f.manifest,
    block,
    operation,
    receipt,
    events: [event],
    integration: new TradingVaultContractIntegration(f.inventory),
  };
}
test('fill reconciliation binds the actual transaction envelope to canonical receipt, typed call and measured fill', async () => {
  const c = await context();
  assert.deepEqual(await c.integration.reconcileOperation(c), { status: 'MATCH' });
  for (const change of [
    { from: address(41) },
    { to: address(51) },
    { input: '0x12345678' },
    { value: '0x1' },
    { chainId: '0x1237' },
    { blockHash: '0x' + 'ef'.repeat(32) },
    { transactionIndex: '0x1' },
  ]) {
    const bad = await context(change);
    assert.equal((await bad.integration.reconcileOperation(bad)).status, 'MISMATCH');
  }
  for (const values of [
    [4n, 1n, address(11), true, 100000000n, 10n ** 18n],
    [4n, 1n, address(10), false, 100000000n, 10n ** 18n],
    [4n, 1n, address(10), true, 100000001n, 10n ** 18n],
    [4n, 1n, address(10), true, 100000000n, 10n ** 18n - 1n],
    [5n, 1n, address(10), true, 100000000n, 10n ** 18n],
  ]) {
    const bad = await context({}, values);
    assert.equal((await bad.integration.reconcileOperation(bad)).status, 'MISMATCH');
  }
});
test('a reverted receipt or another block context cannot publish a valid-looking fill', async () => {
  const c = await context();
  assert.equal(
    (await c.integration.reconcileOperation({ ...c, receipt: { ...c.receipt, status: 'REVERTED' } })).status,
    'MISMATCH',
  );
  assert.equal(
    (await c.integration.reconcileOperation({ ...c, block: { ...c.block, number: 17n } })).status,
    'MISMATCH',
  );
});

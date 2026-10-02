import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingRpcFixture } from './helpers/testnet-trading-rpc.ts';
import { readTradingSnapshot } from '../packages/testnet/src/trading-reader.ts';
test('canonical snapshot checks deployment, all three pools, PASS backing and exact reference NAV', async () => {
  const f = tradingRpcFixture();
  const result = await readTradingSnapshot(f.client, f.manifest, f.inventory);
  assert.equal(result.runtimeEquity, '900000000');
  assert.equal(result.vaultEquity, '1000000000');
  assert.equal(result.unitNav, '1000000');
  assert.equal(result.stocks.length, 3);
  assert.equal(result.lockedPass, String(1000n * 10n ** 18n));
  assert.equal(result.valuation, 'VALID');
});
test('wrong chain, code, backing, venue and reorg fail; stale valuation never invents equity', async () => {
  for (const failure of [
    'CHAIN',
    'CODE',
    'BACKING',
    'POOL',
    'REORG',
    'PASS_BACKING',
    'ALLOWANCE',
    'SMART_OWNER',
  ] as const) {
    const f = tradingRpcFixture(failure);
    await assert.rejects(readTradingSnapshot(f.client, f.manifest, f.inventory), /TRADING_/);
  }
  const f = tradingRpcFixture('STALE');
  const result = await readTradingSnapshot(f.client, f.manifest, f.inventory);
  assert.equal(result.valuation, 'STALE_REFERENCE');
  assert.equal(result.unitNav, null);
  assert.equal(result.vaultEquity, null);
});

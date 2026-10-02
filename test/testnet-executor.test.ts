import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingRpcFixture, tradingFixtureAddress } from './helpers/testnet-trading-rpc.ts';
import { readTradingSnapshot } from '../packages/testnet/src/trading-reader.ts';
import { planExecutorTrade, riskNeedsLiquidation } from '../packages/testnet/src/executor-plan.ts';
import { tradingInterface } from '../packages/testnet/src/trading-abi.ts';
const digest = '0x' + 'cd'.repeat(32);
const input = {
  stockIndex: 1,
  side: 'BUY' as const,
  amountIn: '100000000',
  deadline: '1010',
  sourceDigest: digest,
  createdAt: 1000000,
  executor: tradingFixtureAddress(41),
};
test('restricted planner binds single pool, source, version, grant and conservative reference floor', async () => {
  const f = tradingRpcFixture();
  const base = await readTradingSnapshot(f.client, f.manifest, f.inventory);
  const snapshot = {
    ...base,
    grant: {
      ...base.grant,
      executor: input.executor,
      expiresAt: '1100',
      liquidationWindow: '60',
      maxOrderUsdc: '200000000',
      maxTotalBuyUsdc: '1000000000',
      maxSlippageBps: '100',
    },
  };
  const plan = planExecutorTrade(snapshot, f.inventory, input, '995000000000000000');
  assert.equal(plan.state, 'READY');
  const decoded = tradingInterface.decodeFunctionData('execute', plan.intent!.calldata)[0];
  assert.equal(decoded.tokenIn.toLowerCase(), f.inventory.usdc);
  assert.equal(decoded.tokenOut.toLowerCase(), f.inventory.stocks[1]!.token);
  assert.equal(decoded.expectedVersion.toString(), snapshot.stateVersion);
  assert.equal(decoded.minAmountOut, 990000000000000000n);
  assert.equal(
    planExecutorTrade(snapshot, f.inventory, input, '980000000000000000').state,
    'PAUSED_POOL_PRICE_DEVIATION',
  );
  for (const change of [
    { executor: snapshot.owner },
    { amountIn: '300000000' },
    { deadline: '1101' },
    { stockIndex: 3 },
    { side: 'WITHDRAW' },
    { sourceDigest: '0x0' },
  ])
    assert.throws(
      () =>
        planExecutorTrade(
          snapshot,
          f.inventory,
          { ...input, ...change } as typeof input,
          '995000000000000000',
        ),
      /EXECUTOR_/,
    );
  assert.throws(
    () => planExecutorTrade({ ...snapshot, liquidating: true }, f.inventory, input, '995000000000000000'),
    /EXECUTOR_/,
  );
  assert.throws(
    () =>
      planExecutorTrade(
        { ...snapshot, upperUnitNav: snapshot.unitNav! },
        f.inventory,
        input,
        '995000000000000000',
      ),
    /EXECUTOR_/,
  );
});
test('expiry allows bounded sells only, stale references never become execution, risk limits latch inclusively', async () => {
  const f = tradingRpcFixture();
  const base = await readTradingSnapshot(f.client, f.manifest, f.inventory);
  const s = {
    ...base,
    grant: {
      ...base.grant,
      executor: input.executor,
      expiresAt: '999',
      liquidationWindow: '60',
      maxOrderUsdc: '200000000',
      maxTotalBuyUsdc: '1000000000',
      maxSlippageBps: '100',
    },
  };
  assert.equal(riskNeedsLiquidation(s), true);
  assert.throws(() => planExecutorTrade(s, f.inventory, input, '995000000000000000'), /EXECUTOR_/);
  const sell = {
    ...input,
    stockIndex: 0,
    side: 'SELL' as const,
    amountIn: '1000000000000000000',
    deadline: '1059',
  };
  assert.equal(planExecutorTrade(s, f.inventory, sell, '99500000').state, 'READY');
  assert.throws(
    () => planExecutorTrade(s, f.inventory, { ...sell, deadline: '1060' }, '99500000'),
    /EXECUTOR_/,
  );
  assert.throws(
    () =>
      planExecutorTrade(
        { ...s, stocks: s.stocks.map((x) => ({ ...x, priceValid: false })) },
        f.inventory,
        sell,
        '99500000',
      ),
    /EXECUTOR_/,
  );
});

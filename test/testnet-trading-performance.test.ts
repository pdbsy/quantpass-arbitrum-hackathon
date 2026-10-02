import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingPerformance } from '../packages/testnet/src/trading-performance.ts';

test('personal Testnet returns separate external cash flows from trading and never invent fee attribution', () => {
  const events = [
    { eventName: 'Deposited', normalizedData: { amountUsdc: '1000000000' } },
    {
      eventName: 'CapitalChanged',
      normalizedData: { allocated: true, amountUsdc: '900000000', units: '900000000000000000000' },
    },
    {
      eventName: 'SwapExecuted',
      normalizedData: {
        stock: '0x' + '11'.repeat(20),
        buy: true,
        input: '100000000',
        output: '1000000000000000000',
      },
    },
    { eventName: 'Withdrawn', normalizedData: { amountUsdc: '100000000', principalExited: '100000000' } },
  ];
  const result = tradingPerformance(events, '910000000');
  assert.equal(result.pnlUsdc, '10000000');
  assert.equal(result.netContributedUsdc, '900000000');
  assert.equal(result.publicationScope, 'OWNER_ONLY_TESTNET');
  assert.equal(result.costs.dexFees, 'INCLUDED_IN_FILL_NOT_SEPARATELY_ATTRIBUTED');
  assert.equal(result.positions[0]!.costBasisUsdc, '100000000');
  assert.equal(
    tradingPerformance(
      [...events, { eventName: 'Closed', normalizedData: { returnedUsdc: '910000000' } }],
      '0',
    ).pnlUsdc,
    '10000000',
  );
  assert.equal(tradingPerformance(events, null).pnlUsdc, null);
});
test('weighted cost and realized return can be recomputed from exact fills; holdings cannot become negative', () => {
  const stock = '0x' + '11'.repeat(20);
  const fill = (buy: boolean, input: string, output: string) => ({
    eventName: 'SwapExecuted',
    normalizedData: { stock, buy, input, output },
  });
  const result = tradingPerformance(
    [
      fill(true, '100000000', '1000000000000000000'),
      fill(true, '120000000', '1000000000000000000'),
      fill(false, '1000000000000000000', '130000000'),
    ],
    '240000000',
  );
  assert.equal(result.positions[0]!.quantityRaw, '1000000000000000000');
  assert.equal(result.positions[0]!.costBasisUsdc, '110000000');
  assert.equal(result.positions[0]!.realizedPnlUsdc, '20000000');
  assert.throws(() => tradingPerformance([fill(false, '1', '1')], '0'), /TRADING_PERFORMANCE/);
});

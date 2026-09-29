import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, transition, equity, returnBps } from '../packages/automata/src/engine.ts';
import type { Frame, Parameters, Run } from '../packages/automata/src/model.ts';

const params = (patch: Partial<Parameters> = {}): Parameters => ({
  weights: { 'rwa-a': 5000 },
  deviationBps: 100,
  intervalMs: 1000,
  feeBps: 0,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
  ...patch,
});
const frame = (seq: number, price = '100000000', patch = {}): Frame => ({
  seq,
  at: seq * 1000,
  quotes: [
    {
      assetId: 'rwa-a',
      bid: price,
      ask: price,
      observedAt: seq * 1000,
      expiresAt: seq * 1000 + 1000,
      capacity: '1000000000',
      slippageBps: 0,
      available: true,
      ...patch,
    },
  ],
});
const tick = (run: Run, f: Frame) => transition(run, { type: 'frame', frame: f });

test('rebalance buys five units with 1000 cash, without mutating prior state', () => {
  const start = createRun('run-1', '1000000000', params());
  const next = tick(start, frame(1));
  assert.equal(next.cash, '500000000');
  assert.equal(next.positions['rwa-a']?.quantity, '5000000');
  assert.equal(equity(next), 1000000000n);
  assert.equal(start.cash, '1000000000');
  assert.equal(next.trades.length, 1);
});
test('duplicate frame is a no-op and conflicting or out-of-order input is refused', () => {
  const a = tick(createRun('run-1', '1000000000', params()), frame(1));
  assert.deepEqual(tick(a, frame(1)), a);
  assert.throws(() => tick(a, frame(1, '99000000')), /FRAME_CONFLICT/);
  assert.throws(() => tick(a, frame(3)), /FRAME_ORDER/);
});
test('invalid prices, unregistered instruments and impossible weights fail closed', () => {
  assert.throws(() => createRun('run-1', '100', params({ weights: { 'rwa-a': 10001 } })), /PARAMETERS/);
  assert.throws(() => createRun('run-1', '100', params({ weights: { unknown: 5000 } })), /PARAMETERS/);
  assert.throws(() => tick(createRun('run-1', '100', params()), frame(1, '0')), /QUOTE/);
  assert.throws(() => tick(createRun('run-1', '100', params()), frame(1, 'NaN')), /QUOTE/);
});
test('manual stop liquidates and remains stopped after later market recovery', () => {
  const a = tick(createRun('run-1', '1000000000', params()), frame(1));
  const b = transition(a, { type: 'stop' });
  assert.equal(b.status, 'stopped');
  assert.equal(b.cash, '1000000000');
  assert.equal(b.positions['rwa-a']?.quantity, '0');
  assert.equal(b.trigger?.reason, 'manual');
  assert.deepEqual(transition(b, { type: 'stop' }), b);
  assert.equal(tick(b, frame(2, '150000000')).trades.length, 2);
  assert.throws(() => transition(b, { type: 'resume' }), /STATUS/);
});
for (const [price, reason, cash] of [
  ['120000000', 'upper', '1100000000'],
  ['90000000', 'lower', '950000000'],
] as const) {
  test(`portfolio ${reason} threshold is inclusive and checked before rebalance`, () => {
    const a = tick(
      createRun(
        'run-1',
        '1000000000',
        params({
          limits: { mode: 'percent', upperBps: 1000, lowerBps: -500 },
        }),
      ),
      frame(1),
    );
    const b = tick(a, frame(2, price));
    assert.equal(b.trigger?.reason, reason);
    assert.equal(b.status, 'stopped');
    assert.equal(b.cash, cash);
    assert.equal(b.trades.at(-1)?.side, 'sell');
    assert.equal(b.trades.length, 2);
  });
}
test('price trigger liquidates every holding in a multi-asset run', () => {
  const config = params({
    weights: { 'rwa-a': 4000, 'rwa-b': 4000 },
    limits: { mode: 'price', assetId: 'rwa-a', upper: '120000000' },
  });
  const aFrame = frame(1);
  aFrame.quotes.push({ ...aFrame.quotes[0]!, assetId: 'rwa-b' });
  const a = tick(createRun('run-1', '1000000000', config), aFrame);
  const bFrame = frame(2, '120000000');
  bFrame.quotes.push({ ...bFrame.quotes[0]!, assetId: 'rwa-b', bid: '80000000', ask: '80000000' });
  const b = tick(a, bFrame);
  assert.equal(b.status, 'stopped');
  assert.equal(b.positions['rwa-a']?.quantity, '0');
  assert.equal(b.positions['rwa-b']?.quantity, '0');
  assert.equal(b.cash, '1000000000');
});
test('capacity is consumed once, partial liquidation survives JSON restart', () => {
  const a = tick(createRun('run-1', '1000000000', params()), frame(1, '100000000', { capacity: '6000000' }));
  const b = transition(a, { type: 'stop' });
  assert.equal(b.positions['rwa-a']?.quantity, '4000000');
  assert.notEqual(b.status, 'stopped');
  const c = transition(JSON.parse(JSON.stringify(b)), { type: 'stop' });
  assert.equal(c.cash, b.cash);
  assert.equal(c.trades.length, b.trades.length);
  const d = tick(c, frame(2, '100000000', { capacity: '4000000' }));
  assert.equal(d.status, 'stopped');
  assert.equal(d.cash, '1000000000');
});
test('unavailable quotes block liquidation and later recovery cannot resume buying', () => {
  const a = tick(createRun('run-1', '1000000000', params()), frame(1));
  const b = tick(transition(a, { type: 'pause' }), frame(2, '100000000', { available: false }));
  const c = transition(b, { type: 'stop' });
  assert.equal(c.status, 'blocked');
  assert.ok(c.reason);
  const d = tick(c, frame(3, '90000000'));
  assert.equal(d.status, 'stopped');
  assert.equal(d.trigger?.reason, 'manual');
});
test('slippage over the cap and expired quotes cannot execute', () => {
  for (const patch of [{ slippageBps: 101 }, { observedAt: 0, expiresAt: 999 }]) {
    const a = tick(createRun('run-1', '1000000000', params()), frame(1, '100000000', patch));
    assert.equal(a.cash, '1000000000');
    assert.equal(a.trades.length, 0);
    assert.ok(a.reason);
  }
});
test('cash-only withdrawal refuses to sell holdings or withdraw more than available cash', () => {
  const a = tick(createRun('run-1', '1000000000', params()), frame(1));
  assert.throws(
    () => transition(a, { type: 'fund', direction: 'out', amount: '500000001' }),
    /INSUFFICIENT_BOT_CASH/,
  );
  const b = transition(a, { type: 'fund', direction: 'out', amount: '500000000' });
  assert.equal(b.cash, '0');
  assert.equal(b.positions['rwa-a']?.quantity, '5000000');
  assert.equal(b.trades.length, 1);
  assert.equal(returnBps(b), 0);
});
test('fees and adverse slippage reduce equity and appear in the trade ledger', () => {
  const a = tick(createRun('run-1', '1000000000', params({ feeBps: 100 })), frame(1));
  assert.equal(a.cash, '495000000');
  assert.equal(a.fees, '5000000');
  assert.equal(equity(a), 995000000n);
  const b = transition(a, { type: 'stop' });
  assert.equal(b.cash, '990000000');
  assert.equal(b.realizedPnl, '-10000000');
  assert.equal(returnBps(b), -100);
});
test('funding changes shares, not performance; cannot revive a liquidating run', () => {
  const a = tick(createRun('run-1', '1000000000', params({ deviationBps: 9999 })), frame(1));
  const b = transition(a, { type: 'fund', amount: '500000000', direction: 'in' });
  assert.equal(b.cash, '1500000000');
  assert.equal(returnBps(b), 0);
  const c = transition(b, { type: 'fund', amount: '250000000', direction: 'out' });
  assert.equal(c.cash, '1250000000');
  assert.equal(returnBps(c), 0);
  assert.throws(
    () => transition(transition(c, { type: 'stop' }), { type: 'fund', amount: '1', direction: 'in' }),
    /STATUS/,
  );
});
test('funding at a profit preserves unit NAV and the percentage boundary', () => {
  const a = tick(createRun('run-1', '1000000000', params()), frame(1));
  const b = tick(transition(a, { type: 'pause' }), frame(2, '120000000'));
  assert.equal(returnBps(b), 1000);
  const c = transition(b, { type: 'fund', amount: '550000000', direction: 'in' });
  assert.equal(returnBps(c), 1000);
  const d = transition(c, { type: 'fund', amount: '110000000', direction: 'out' });
  assert.equal(returnBps(d), 1000);
  assert.equal(equity(d), 1540000000n);
});
test('paused strategies still monitor liquidation limits', () => {
  const a = tick(
    createRun(
      'run-1',
      '1000000000',
      params({ limits: { mode: 'price', assetId: 'rwa-a', lower: '90000000' } }),
    ),
    frame(1),
  );
  const b = tick(transition(a, { type: 'pause' }), frame(2, '90000000'));
  assert.equal(b.status, 'stopped');
  assert.equal(b.trigger?.reason, 'lower');
});
test('all cash can be withdrawn from a flat run and later funded without resetting unit NAV', () => {
  const a = createRun('flat', '1000000000', params({ weights: { 'rwa-a': 0 } }));
  const b = transition(a, { type: 'fund', direction: 'out', amount: '1000000000' });
  assert.equal(b.cash, '0');
  assert.equal(returnBps(b), 0);
  const c = transition(b, { type: 'fund', direction: 'in', amount: '200000000' });
  assert.equal(c.cash, '200000000');
  assert.equal(returnBps(c), 0);
});

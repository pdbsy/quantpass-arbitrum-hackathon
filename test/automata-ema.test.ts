import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emaTargets } from '../packages/automata/src/ema-strategy.ts';
import type { Frame, Parameters, Run } from '../packages/automata/src/model.ts';
const parameters: Parameters = {
  strategyMode: 'external',
  weights: { 'rwa-a': 5000, 'rwa-b': 5000 },
  deviationBps: 1,
  intervalMs: 1000,
  feeBps: 10,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
};
function context(prices: number[], held = false) {
  const observations: Frame[] = prices.map((price, i) => ({
    seq: i + 1,
    at: (i + 1) * 1000,
    quotes: ['rwa-a', 'rwa-b'].map((assetId) => ({
      assetId,
      bid: String(price * 1000000),
      ask: String(price * 1000000),
      observedAt: (i + 1) * 1000,
      expiresAt: (i + 2) * 1000,
      capacity: '1000000000',
      slippageBps: 0,
      available: true,
    })),
  }));
  const positions: Run['positions'] = held
    ? {
        'rwa-a': { quantity: '1000000', cost: '100000000' },
        'rwa-b': { quantity: '1000000', cost: '100000000' },
      }
    : {};
  return { observations, frameSeq: prices.length, parameters, positions };
}
test('EMA waits for 30 observations and enters after a verified rising crossover', () => {
  assert.equal(emaTargets(context(Array(29).fill(100))), null);
  assert.equal(emaTargets(context(Array(30).fill(100))), null);
  const c = context([...Array(29).fill(100), 120]);
  assert.deepEqual(emaTargets(c), { 'rwa-a': 5000, 'rwa-b': 5000 });
  assert.deepEqual(emaTargets(JSON.parse(JSON.stringify(c))), { 'rwa-a': 5000, 'rwa-b': 5000 });
});
test('EMA exits held assets on a falling crossover without continuously rebalancing', () => {
  assert.deepEqual(emaTargets(context([...Array(30).fill(100), 80], true)), { 'rwa-a': 0, 'rwa-b': 0 });
  assert.equal(emaTargets(context([...Array(30).fill(100), 120], true)), null);
});
test('EMA rejects future or missing frames and refuses stale/unavailable input', () => {
  const c = context([...Array(29).fill(100), 120]);
  assert.throws(() => emaTargets({ ...c, frameSeq: 29 }));
  assert.throws(() => emaTargets({ ...c, observations: c.observations.slice(1) }));
  c.observations[29]!.quotes[0]!.available = false;
  assert.equal(emaTargets(c), null);
});

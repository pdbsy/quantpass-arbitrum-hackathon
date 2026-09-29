import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, transition } from '../packages/automata/src/engine.ts';
import type { Frame, Parameters } from '../packages/automata/src/model.ts';

const parameters: Parameters = {
  weights: { 'rwa-a': 5000, 'rwa-b': 0 },
  strategyMode: 'external',
  deviationBps: 1,
  intervalMs: 5000,
  feeBps: 0,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
};
function frame(seq: number, price = '100000000', capacity = '1000000000'): Frame {
  return {
    seq,
    at: seq * 1000,
    quotes: ['rwa-a', 'rwa-b'].map((assetId) => ({
      assetId,
      bid: price,
      ask: price,
      observedAt: seq * 1000,
      expiresAt: (seq + 1) * 1000,
      capacity,
      slippageBps: 0,
      available: true,
    })),
  };
}
const ready = () =>
  transition(createRun('external', '1000000000', parameters), { type: 'frame', frame: frame(1) });
const decision = (targets: Record<string, number>, frameSeq = 1) => ({
  type: 'decision' as const,
  id: 'signal1',
  frameSeq,
  targets,
});

test('external strategy stays in cash until a frame-bound target arrives', () => {
  const observed = ready();
  assert.equal(observed.cash, '1000000000');
  assert.equal(observed.trades.length, 0);
  const executed = transition(observed, decision({ 'rwa-a': 5000 }));
  assert.equal(executed.cash, '500000000');
  assert.equal(executed.positions['rwa-a']?.quantity, '5000000');
  assert.equal(observed.trades.length, 0);
  assert.deepEqual(executed.lastDecision, {
    id: 'signal1',
    frameSeq: 1,
    at: 1000,
    targets: { 'rwa-a': 5000 },
    trades: 1,
  });
});
test('missing targets mean zero and rotation sells before buying another eligible asset', () => {
  const a = transition(ready(), decision({ 'rwa-a': 10000 }));
  const b = transition(a, { ...decision({ 'rwa-b': 10000 }), id: 'rotate' });
  assert.equal(b.positions['rwa-a']?.quantity, '0');
  assert.equal(b.positions['rwa-b']?.quantity, '10000000');
  assert.deepEqual(
    b.trades.slice(-2).map((t) => [t.assetId, t.side]),
    [
      ['rwa-a', 'sell'],
      ['rwa-b', 'buy'],
    ],
  );
});
test('stale, future, malformed and ineligible decisions do not mutate state', () => {
  const run = ready(),
    before = structuredClone(run);
  for (const bad of [
    decision({ 'rwa-a': 5000 }, 0),
    decision({ 'rwa-a': 5000 }, 2),
    decision({ unknown: 5000 }),
    decision({ 'rwa-a': -1 }),
    decision({ 'rwa-a': 5000.5 }),
    decision({ 'rwa-a': 6000, 'rwa-b': 6000 }),
    { ...decision({}), id: '' },
  ]) {
    assert.throws(() => transition(run, bad));
    assert.deepEqual(run, before);
  }
  assert.throws(() => transition(createRun('unpriced', '1000', parameters), decision({})), /STRATEGY_FRAME/);
});
test('external decisions cannot target an asset outside the immutable eligible universe', () => {
  const run = transition(createRun('only-a', '1000000000', { ...parameters, weights: { 'rwa-a': 5000 } }), {
    type: 'frame',
    frame: frame(1),
  });
  assert.throws(() => transition(run, decision({ 'rwa-b': 10000 })), /STRATEGY_TARGETS/);
});
test('paused, stopped and internal runs reject external decisions', () => {
  const run = ready();
  assert.throws(() => transition(transition(run, { type: 'pause' }), decision({})), /INVALID_STATUS/);
  assert.throws(() => transition(transition(run, { type: 'stop' }), decision({})), /INVALID_STATUS/);
  const internal = transition(
    createRun('internal', '1000000000', { ...parameters, strategyMode: 'rebalance' }),
    { type: 'frame', frame: frame(1) },
  );
  assert.throws(() => transition(internal, decision({})), /STRATEGY_MODE/);
});
test('risk supervision still liquidates external runs and later signals cannot restart them', () => {
  let run = createRun('risk', '1000000000', { ...parameters, limits: { mode: 'percent', upperBps: 1000 } });
  run = transition(run, { type: 'frame', frame: frame(1) });
  run = transition(run, decision({ 'rwa-a': 5000, 'rwa-b': 5000 }));
  run = transition(run, { type: 'frame', frame: frame(2, '110000000') });
  assert.equal(run.status, 'stopped');
  assert.equal(run.trigger?.reason, 'upper');
  assert.equal(run.positions['rwa-a']?.quantity, '0');
  assert.equal(run.positions['rwa-b']?.quantity, '0');
  assert.throws(() => transition(run, decision({ 'rwa-a': 10000 }, 2)), /INVALID_STATUS/);
});
test('partial decision execution consumes quote capacity once and needs a fresh strategy decision', () => {
  let run = transition(createRun('partial', '1000000000', parameters), {
    type: 'frame',
    frame: frame(1, '100000000', '1000000'),
  });
  run = transition(run, decision({ 'rwa-a': 5000 }));
  assert.equal(run.positions['rwa-a']?.quantity, '1000000');
  run = transition(run, { ...decision({ 'rwa-a': 5000 }), id: 'same-quote' });
  assert.equal(run.positions['rwa-a']?.quantity, '1000000');
  run = transition(JSON.parse(JSON.stringify(run)), { type: 'frame', frame: frame(2) });
  assert.equal(run.positions['rwa-a']?.quantity, '1000000');
  run = transition(run, decision({ 'rwa-a': 5000 }, 2));
  assert.equal(run.positions['rwa-a']?.quantity, '5000000');
});

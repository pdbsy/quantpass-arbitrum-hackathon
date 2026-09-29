// Adapted from QuantConnect/Lean MovingAverageCrossAlgorithm.py (Apache-2.0).
// Copyright 2014 QuantConnect Corporation. See third_party/lean-ema/README.md.
// AlphaForge changes: fixed-point rounding, synthetic periods, target budgets and multi-asset output.
import { amount, requireThat, validateParameters } from './model.ts';
import type { Frame, Parameters, Run } from './model.ts';

export const EMA_STRATEGY = 'lean-ema-15-30-adapted-v1';
const PRECISION = 1000000n;
function ema(values: bigint[], period: number) {
  let value = values.slice(0, period).reduce((n, price) => n + price * PRECISION, 0n) / BigInt(period);
  for (const price of values.slice(period))
    value = (2n * price * PRECISION + BigInt(period - 1) * value) / BigInt(period + 1);
  return value;
}
export function emaTargets(context: {
  observations: Frame[];
  frameSeq: number;
  parameters: Parameters;
  positions: Run['positions'];
}): Record<string, number> | null {
  const { observations, frameSeq, parameters, positions } = context;
  validateParameters(parameters);
  requireThat(
    Number.isSafeInteger(frameSeq) &&
      frameSeq >= 0 &&
      frameSeq <= 120 &&
      observations.length === frameSeq &&
      observations.every(
        (f, i) => f.seq === i + 1 && Number.isSafeInteger(f.at) && f.at > (observations[i - 1]?.at ?? 0),
      ),
    'STRATEGY_HISTORY',
  );
  if (frameSeq < 30) return null;
  const targets: Record<string, number> = {};
  let changed = false;
  for (const [id, budget] of Object.entries(parameters.weights)) {
    const quotes = observations.map((f) => f.quotes.find((q) => q.assetId === id));
    if (
      quotes.some(
        (q, i) =>
          !q || !q.available || q.observedAt > observations[i]!.at || q.expiresAt < observations[i]!.at,
      )
    )
      return null;
    const values = quotes.map((q) => {
      const price = amount(q!.bid);
      requireThat(price > 0n, 'STRATEGY_HISTORY');
      return price;
    });
    const fast = ema(values, 15),
      slow = ema(values, 30);
    const held = amount(positions[id]?.quantity ?? '0') > 0n;
    const enter = !held && budget > 0 && fast * 100000n > slow * 100015n;
    const exit = held && fast < slow;
    targets[id] = exit ? 0 : held || enter ? budget : 0;
    changed ||= enter || exit;
  }
  return changed ? targets : null;
}

// Adapted from QuantConnect/Lean MovingAverageCrossAlgorithm.py (Apache-2.0).
// Copyright 2014 QuantConnect Corporation. See third_party/lean-ema/README.md.
// AlphaForge changes: incremental fixed-point state, sampled minute input, reference-only signals.
import { requireValue } from '../../market-data/src/robinhood.ts';
interface Accumulator {
  count: number;
  sum: string;
  value: string | null;
}
export interface EmaState {
  fast: Accumulator;
  slow: Accumulator;
}
export function createEma(): EmaState {
  return { fast: { count: 0, sum: '0', value: null }, slow: { count: 0, sum: '0', value: null } };
}
export function advanceEma(before: EmaState, price: string): EmaState {
  requireValue(/^[1-9][0-9]{0,77}$/.test(price), 'INVALID_EMA_PRICE');
  const state = structuredClone(before),
    scaled = BigInt(price) * 1000000n;
  for (const [key, period] of [
    ['fast', 15],
    ['slow', 30],
  ] as const) {
    const a = state[key];
    if (a.count < period) {
      a.sum = (BigInt(a.sum) + scaled).toString();
      a.count++;
      if (a.count === period) {
        a.value = (BigInt(a.sum) / BigInt(period)).toString();
        a.sum = '0';
      }
    } else a.value = ((2n * scaled + BigInt(period - 1) * BigInt(a.value!)) / BigInt(period + 1)).toString();
  }
  return state;
}

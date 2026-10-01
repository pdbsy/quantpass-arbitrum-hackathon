import { requireValue } from '../../market-data/src/robinhood.ts';
import type { ReferenceObservation } from '../../market-data/src/robinhood.ts';
export const MINUTE_MS = 60000;
export interface MinuteSample {
  at: number;
  bid: string;
  ask: string;
  assetId: string;
  multiplier: string;
}
export interface MinuteState {
  identities: string[];
  latest: Record<string, MinuteSample>;
  nextMinute: number | null;
  pending: Record<string, Record<string, MinuteSample>>;
}
export type MinuteEvent =
  | { kind: 'CLOSE'; at: number; prices: Record<string, string> }
  | { kind: 'GAP'; from: number; until: number };
export function createMinutes(identities: string[]): MinuteState {
  requireValue(identities.length === 3 && new Set(identities).size === 3, 'INVALID_MINUTE_IDENTITIES');
  return { identities: [...identities], latest: {}, nextMinute: null, pending: {} };
}
/** Sampled reference closes, not exchange OHLC. The slowest source clock closes a minute. */
export function advanceMinutes(
  before: MinuteState,
  observations: ReferenceObservation[],
  maxCloseAgeMs: number,
): { state: MinuteState; events: MinuteEvent[] } {
  requireValue(
    Number.isSafeInteger(maxCloseAgeMs) && maxCloseAgeMs > 0 && maxCloseAgeMs <= MINUTE_MS,
    'INVALID_MINUTE_POLICY',
  );
  requireValue(
    observations.length === before.identities.length &&
      observations.every((o, i) => o.identity === before.identities[i]),
    'MINUTE_IDENTITY_MISMATCH',
  );
  const state = structuredClone(before),
    events: MinuteEvent[] = [];
  for (const o of observations) {
    requireValue(
      Number.isSafeInteger(o.generatedAt) &&
        o.generatedAt >= 0 &&
        o.generatedAt <= Number.MAX_SAFE_INTEGER - MINUTE_MS,
      'INVALID_MINUTE_CLOCK',
    );
    requireValue(
      /^[1-9][0-9]{0,77}$/.test(o.tokenBidUsd18) &&
        /^[1-9][0-9]{0,77}$/.test(o.tokenAskUsd18) &&
        BigInt(o.tokenAskUsd18) >= BigInt(o.tokenBidUsd18),
      'INVALID_MINUTE_PRICE',
    );
    const sample: MinuteSample = {
      at: o.generatedAt,
      bid: o.tokenBidUsd18,
      ask: o.tokenAskUsd18,
      assetId: o.assetId,
      multiplier: o.multiplier,
    };
    const old = state.latest[o.identity];
    requireValue(!old || sample.at >= old.at, 'REFERENCE_QUOTE_REGRESSION');
    requireValue(
      !old || (old.assetId === sample.assetId && old.multiplier === sample.multiplier),
      'REFERENCE_TERMS_CHANGED',
    );
    if (old && sample.at === old.at) {
      requireValue(sample.bid === old.bid && sample.ask === old.ask, 'REFERENCE_QUOTE_CONFLICT');
      continue;
    }
    state.latest[o.identity] = sample;
    const start = Math.floor(sample.at / MINUTE_MS) * MINUTE_MS;
    (state.pending[String(start)] ??= {})[o.identity] = sample;
  }
  const watermark = Math.min(...state.identities.map((id) => state.latest[id]!.at));
  const boundary = Math.floor(watermark / MINUTE_MS) * MINUTE_MS;
  state.nextMinute ??= Math.min(...Object.keys(state.pending).map(Number));
  function gap(from: number, until: number) {
    if (from >= until) return;
    const previous = events.at(-1);
    if (previous?.kind === 'GAP' && previous.until === from) previous.until = until;
    else events.push({ kind: 'GAP', from, until });
  }
  for (const start of Object.keys(state.pending)
    .map(Number)
    .sort((a, b) => a - b)) {
    if (start >= boundary) continue;
    gap(state.nextMinute, start);
    const samples = state.pending[String(start)]!,
      end = start + MINUTE_MS;
    if (state.identities.every((id) => samples[id] && end - samples[id]!.at <= maxCloseAgeMs))
      events.push({
        kind: 'CLOSE',
        at: end,
        prices: Object.fromEntries(state.identities.map((id) => [id, samples[id]!.bid])),
      });
    else gap(start, end);
    delete state.pending[String(start)];
    state.nextMinute = end;
  }
  gap(state.nextMinute, boundary);
  state.nextMinute = Math.max(state.nextMinute, boundary);
  requireValue(Object.keys(state.pending).length <= 3, 'MINUTE_PENDING_LIMIT');
  return { state, events };
}

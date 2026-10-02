import { createHash } from 'node:crypto';
import { parseRegistry } from '../../market-data/src/robinhood.ts';
import {
  replayReferenceBatch,
  validateReferenceBatch,
  type ReferenceBatch,
} from '../../market-data/src/batch.ts';
import { createEma, advanceEma, type EmaState } from '../../automata/src/reference-ema.ts';
import { createMinutes, advanceMinutes, type MinuteState } from '../../automata/src/reference-minutes.ts';

export interface ReferenceTerms {
  readonly identity: string;
  readonly assetId: string;
  readonly symbol: string;
  readonly multiplier: string;
}
export interface ReferenceEngineState {
  readonly terms: readonly ReferenceTerms[];
  readonly paused: 'TERMS_CHANGED' | null;
  readonly minutes: MinuteState;
  readonly ema: Readonly<Record<string, EmaState>>;
  readonly lastMinute: number | null;
  readonly signals: readonly ('BUY' | 'SELL' | 'WARMUP')[];
}
export function createReferenceEngine(terms: readonly ReferenceTerms[]): ReferenceEngineState {
  if (
    terms.length !== 3 ||
    JSON.stringify(terms.map((t) => t.symbol)) !== JSON.stringify(['MSFT', 'NVDA', 'AAPL']) ||
    new Set(terms.map((t) => t.identity)).size !== 3 ||
    terms.some(
      (t) =>
        !/^(4663|46630):0x[0-9a-f]{40}$/.test(t.identity) ||
        !/^0x[0-9a-f]{1,128}$/.test(t.assetId) ||
        !/^[0-9]+(?:\.[0-9]{1,18})?$/.test(t.multiplier) ||
        Number(t.multiplier) <= 0,
    )
  )
    throw new Error('REFERENCE_TERMS');
  return {
    terms: structuredClone(terms),
    paused: null,
    minutes: createMinutes(terms.map((t) => t.identity)),
    ema: Object.fromEntries(terms.map((t) => [t.identity, createEma()])),
    lastMinute: null,
    signals: ['WARMUP', 'WARMUP', 'WARMUP'],
  };
}
/** Replay raw official responses before deriving a price. Invalid minutes never advance EMA. */
export function advanceReferenceEngine(before: ReferenceEngineState, batch: ReferenceBatch) {
  validateReferenceBatch(batch);
  if (
    batch.policy.maxAgeMs !== 30000 ||
    batch.policy.maxQuoteSkewMs !== 10000 ||
    batch.policy.maxCaptureSpanMs > 30000
  )
    throw new Error('REFERENCE_POLICY_MISMATCH');
  const state = { ...structuredClone(before), ema: { ...structuredClone(before.ema) } };
  // Even rejected captures can prove a pending/changed corporate action. Latch it permanently.
  for (const capture of batch.captures)
    for (const source of capture.sources) {
      if (source.url !== 'https://api.robinhood.com/rhj/assets') continue;
      let registry;
      try {
        registry = parseRegistry(JSON.parse(source.body));
      } catch {
        continue;
      }
      for (const term of state.terms) {
        const [chain, address] = term.identity.split(':');
        const matches = registry.filter((asset) =>
          asset.deployments.some((d) => d.chainId === Number(chain) && d.contractAddress === address),
        );
        if (
          matches.length !== 1 ||
          matches[0]!.id !== term.assetId ||
          matches[0]!.symbol !== term.symbol ||
          matches[0]!.multiplier !== term.multiplier ||
          matches[0]!.pendingMultiplier !== ''
        )
          state.paused = 'TERMS_CHANGED';
      }
    }
  if (state.paused || batch.status !== 'ACCEPTED') return { state, quotes: null, sourceDigest: null };
  const observations = replayReferenceBatch(batch);
  if (
    observations.some(
      (o, i) =>
        o.identity !== state.terms[i]!.identity ||
        o.assetId !== state.terms[i]!.assetId ||
        o.multiplier !== state.terms[i]!.multiplier,
    )
  )
    return { state: { ...state, paused: 'TERMS_CHANGED' as const }, quotes: null, sourceDigest: null };
  const minute = advanceMinutes(state.minutes, observations, 30000);
  state.minutes = minute.state;
  for (const event of minute.events)
    if (event.kind === 'CLOSE') {
      for (const term of state.terms)
        state.ema[term.identity] = advanceEma(state.ema[term.identity]!, event.prices[term.identity]!);
      state.lastMinute = event.at;
      state.signals = state.terms.map((term) => {
        const ema = state.ema[term.identity]!;
        return ema.fast.value === null || ema.slow.value === null
          ? 'WARMUP'
          : BigInt(ema.fast.value) > BigInt(ema.slow.value)
            ? 'BUY'
            : 'SELL';
      });
    }
  const sourceDigest = '0x' + createHash('sha256').update(JSON.stringify(batch)).digest('hex');
  const quotes = observations.map((o) => {
    // USD18 -> USDC6 valuation, rounded down explicitly. PASS capacity never uses this conversion.
    const priceUsdc = (BigInt(o.tokenBidUsd18) + BigInt(o.tokenAskUsd18)) / (2n * 10n ** 12n);
    if (priceUsdc === 0n) throw new Error('REFERENCE_SUBPRECISION');
    return Object.freeze({
      identity: o.identity,
      priceUsdc: String(priceUsdc),
      observedAt: String(Math.floor(o.generatedAt / 1000)),
      sourceDigest,
    });
  });
  return { state, quotes, sourceDigest };
}

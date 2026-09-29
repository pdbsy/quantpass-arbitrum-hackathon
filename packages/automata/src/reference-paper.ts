import { isDeepStrictEqual } from 'node:util';
import {
  exactFields,
  parseBatchPolicy,
  replayReferenceBatch,
  validateReferenceBatch,
} from '../../market-data/src/batch.ts';
import type { BatchPolicy, ReferenceBatch } from '../../market-data/src/batch.ts';
import { requireValue } from '../../market-data/src/robinhood.ts';
import type { ReferenceObservation } from '../../market-data/src/robinhood.ts';
import { advanceMinutes, createMinutes } from './reference-minutes.ts';
import type { MinuteState } from './reference-minutes.ts';
import { advanceEma, createEma } from './reference-ema.ts';
import type { EmaState } from './reference-ema.ts';
const BPS = 10000n,
  VALUE_SCALE = 10n ** 30n,
  MAX = 2n ** 256n - 1n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function paperAmount(value: unknown, positive = false): bigint {
  requireValue(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value), 'INVALID_PAPER_AMOUNT');
  const n = BigInt(value);
  requireValue(n <= MAX && (!positive || n > 0n), 'INVALID_PAPER_AMOUNT');
  return n;
}
type Limits =
  | { mode: 'off' }
  | { mode: 'percent'; lowerBps: number | null; upperBps: number | null }
  | { mode: 'price'; identity: string; lowerUsd18: string | null; upperUsd18: string | null };
export interface PaperConfig {
  version: 'alphaforge-reference-paper-1';
  mode: 'REFERENCE_PAPER';
  market: BatchPolicy;
  minuteCloseMaxAgeMs: number;
  gapPolicy: 'retain' | 'reset';
  feeBps: number;
  slippageBps: number;
  initialCash6: string;
  limits: Limits;
}
export interface PaperState {
  config: PaperConfig;
  clock: number;
  status: 'running' | 'liquidating' | 'stopped';
  trigger: 'manual' | 'upper' | 'lower' | null;
  cash6: string;
  positions: Record<string, { quantity18: string; cost6: string }>;
  quotes: Record<string, ReferenceObservation>;
  netContributed6: string;
  fees6: string;
  realizedPnl6: string;
  units: { numerator: string; denominator: string };
  emptyValue: { numerator: string; denominator: string };
  minutes: MinuteState;
  emas: Record<string, EmaState>;
  closedMinutes: number;
  fills: number;
}
export type PaperEvent = { kind: string; [key: string]: unknown };
export interface PaperResult {
  state: PaperState;
  events: PaperEvent[];
}
function clock(at: number): void {
  requireValue(Number.isSafeInteger(at) && at >= 0, 'INVALID_PAPER_CLOCK');
}
function bps(value: unknown): number {
  requireValue(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 10000,
    'INVALID_PAPER_COST',
  );
  return value;
}
export function parsePaperConfig(input: unknown): PaperConfig {
  const r = exactFields(input, [
    'version',
    'mode',
    'market',
    'minuteCloseMaxAgeMs',
    'gapPolicy',
    'feeBps',
    'slippageBps',
    'initialCash6',
    'limits',
  ]);
  requireValue(
    r.version === 'alphaforge-reference-paper-1' && r.mode === 'REFERENCE_PAPER',
    'INVALID_PAPER_CONFIG',
  );
  const market = parseBatchPolicy(r.market);
  requireValue(market.selections.length === 3 && market.maxQuoteSkewMs < 60000, 'INVALID_PAPER_MARKET');
  requireValue(
    typeof r.minuteCloseMaxAgeMs === 'number' &&
      Number.isSafeInteger(r.minuteCloseMaxAgeMs) &&
      r.minuteCloseMaxAgeMs > 0 &&
      r.minuteCloseMaxAgeMs <= 60000,
    'INVALID_PAPER_MINUTE_POLICY',
  );
  requireValue(r.gapPolicy === 'retain' || r.gapPolicy === 'reset', 'INVALID_PAPER_GAP_POLICY');
  paperAmount(r.initialCash6, true);
  const l = r.limits as Record<string, unknown>;
  let limits: Limits;
  if (l?.mode === 'off') {
    exactFields(l, ['mode']);
    limits = { mode: 'off' };
  } else if (l?.mode === 'percent') {
    exactFields(l, ['mode', 'lowerBps', 'upperBps']);
    requireValue(
      l.lowerBps === null ||
        (typeof l.lowerBps === 'number' &&
          Number.isSafeInteger(l.lowerBps) &&
          l.lowerBps < 0 &&
          l.lowerBps >= -10000),
      'INVALID_PAPER_LIMIT',
    );
    requireValue(
      l.upperBps === null ||
        (typeof l.upperBps === 'number' &&
          Number.isSafeInteger(l.upperBps) &&
          l.upperBps > 0 &&
          l.upperBps <= 100000000),
      'INVALID_PAPER_LIMIT',
    );
    requireValue(l.lowerBps !== null || l.upperBps !== null, 'INVALID_PAPER_LIMIT');
    limits = { mode: 'percent', lowerBps: l.lowerBps, upperBps: l.upperBps };
  } else {
    exactFields(l, ['mode', 'identity', 'lowerUsd18', 'upperUsd18']);
    requireValue(
      l.mode === 'price' &&
        typeof l.identity === 'string' &&
        market.selections.some((s) => s.chainId + ':' + s.contractAddress === l.identity),
      'INVALID_PAPER_LIMIT',
    );
    if (l.lowerUsd18 !== null) paperAmount(l.lowerUsd18, true);
    if (l.upperUsd18 !== null) paperAmount(l.upperUsd18, true);
    requireValue(l.lowerUsd18 !== null || l.upperUsd18 !== null, 'INVALID_PAPER_LIMIT');
    requireValue(
      l.lowerUsd18 === null ||
        l.upperUsd18 === null ||
        BigInt(l.lowerUsd18 as string) < BigInt(l.upperUsd18 as string),
      'INVALID_PAPER_LIMIT',
    );
    limits = {
      mode: 'price',
      identity: l.identity,
      lowerUsd18: l.lowerUsd18 as string | null,
      upperUsd18: l.upperUsd18 as string | null,
    };
  }
  return {
    version: r.version,
    mode: r.mode,
    market,
    minuteCloseMaxAgeMs: r.minuteCloseMaxAgeMs,
    gapPolicy: r.gapPolicy,
    feeBps: bps(r.feeBps),
    slippageBps: bps(r.slippageBps),
    initialCash6: r.initialCash6 as string,
    limits,
  };
}
export function createPaper(input: unknown): PaperState {
  const config = parsePaperConfig(input),
    ids = config.market.selections.map((s) => s.chainId + ':' + s.contractAddress);
  return {
    config,
    clock: 0,
    status: 'running',
    trigger: null,
    cash6: config.initialCash6,
    positions: Object.fromEntries(ids.map((id) => [id, { quantity18: '0', cost6: '0' }])),
    quotes: {},
    netContributed6: config.initialCash6,
    fees6: '0',
    realizedPnl6: '0',
    units: { numerator: config.initialCash6, denominator: '1' },
    emptyValue: { numerator: '1', denominator: '1' },
    minutes: createMinutes(ids),
    emas: Object.fromEntries(ids.map((id) => [id, createEma()])),
    closedMinutes: 0,
    fills: 0,
  };
}
function fresh(state: PaperState, id: string, at: number): boolean {
  const q = state.quotes[id];
  return !!q && q.generatedAt <= at && at - q.generatedAt <= state.config.market.maxAgeMs;
}
export function paperNav(state: PaperState, at: number): string | null {
  clock(at);
  requireValue(at >= state.clock, 'PAPER_CLOCK_REGRESSION');
  let value = BigInt(state.cash6);
  for (const [id, p] of Object.entries(state.positions)) {
    if (p.quantity18 === '0') continue;
    if (!fresh(state, id, at)) return null;
    value += (BigInt(p.quantity18) * BigInt(state.quotes[id]!.tokenBidUsd18)) / VALUE_SCALE;
  }
  return value.toString();
}
function rational(n: bigint, d: bigint) {
  requireValue(n >= 0n && d > 0n, 'INVALID_PAPER_UNITS');
  let a = n,
    b = d;
  while (b) {
    const x = a % b;
    a = b;
    b = x;
  }
  return { numerator: (n / a).toString(), denominator: (d / a).toString() };
}
/** Exact fraction of baseline unit value; rendering, not engine, decides display rounding. */
export function paperReturn(
  state: PaperState,
  at: number,
): { numerator: string; denominator: string } | null {
  const nav = paperNav(state, at);
  if (nav === null) return null;
  return state.units.numerator === '0'
    ? state.emptyValue
    : rational(BigInt(nav) * BigInt(state.units.denominator), BigInt(state.units.numerator));
}
function valuation(state: PaperState): bigint {
  const nav = paperNav(state, state.clock);
  requireValue(nav !== null, 'STALE_PAPER_VALUATION');
  return BigInt(nav);
}
function tradeNumbers(state: PaperState, id: string, side: 'buy' | 'sell', quantity: bigint) {
  requireValue(Object.hasOwn(state.positions, id), 'PAPER_ASSET_MISMATCH');
  requireValue(fresh(state, id, state.clock), 'STALE_PAPER_VALUATION');
  const quote = state.quotes[id]!,
    slip = BigInt(state.config.slippageBps);
  const price =
    side === 'buy'
      ? ceil(BigInt(quote.tokenAskUsd18) * (BPS + slip), BPS)
      : (BigInt(quote.tokenBidUsd18) * (BPS - slip)) / BPS;
  const gross = side === 'buy' ? ceil(quantity * price, VALUE_SCALE) : (quantity * price) / VALUE_SCALE;
  const fee = ceil(gross * BigInt(state.config.feeBps), BPS);
  return { price, gross, fee };
}
function withinCap(state: PaperState, id: string, quantity: bigint): boolean {
  const { gross, fee } = tradeNumbers(state, id, 'buy', quantity),
    charge = gross + fee,
    cash = BigInt(state.cash6);
  if (charge > cash) return false;
  const p = state.positions[id]!,
    bid = BigInt(state.quotes[id]!.tokenBidUsd18),
    old = (BigInt(p.quantity18) * bid) / VALUE_SCALE;
  const after = valuation(state) - charge + ((BigInt(p.quantity18) + quantity) * bid) / VALUE_SCALE - old;
  return (old + charge) * 3n <= after;
}
function execute(
  state: PaperState,
  id: string,
  side: 'buy' | 'sell',
  quantity: bigint,
  events: PaperEvent[],
) {
  requireValue(quantity > 0n && quantity <= MAX, 'INVALID_PAPER_AMOUNT');
  requireValue(side === 'buy' || side === 'sell', 'INVALID_PAPER_SIDE');
  requireValue(
    state.status !== 'stopped' && (side === 'sell' || state.status === 'running'),
    'PAPER_NOT_RUNNING',
  );
  requireValue(Number.isSafeInteger(state.fills + 1), 'PAPER_COUNTER_LIMIT');
  const { price, gross, fee } = tradeNumbers(state, id, side, quantity),
    p = state.positions[id]!;
  requireValue(gross > fee, 'PAPER_MINIMUM_FILL');
  if (side === 'buy') {
    requireValue(withinCap(state, id, quantity), 'ALLOCATION_LIMIT');
    requireValue(
      BigInt(p.quantity18) + quantity <= MAX && BigInt(p.cost6) + gross + fee <= MAX,
      'INVALID_PAPER_AMOUNT',
    );
    state.cash6 = (BigInt(state.cash6) - gross - fee).toString();
    p.quantity18 = (BigInt(p.quantity18) + quantity).toString();
    p.cost6 = (BigInt(p.cost6) + gross + fee).toString();
  } else {
    requireValue(quantity <= BigInt(p.quantity18), 'INSUFFICIENT_POSITION');
    paperAmount((BigInt(state.cash6) + gross - fee).toString());
    const cost =
      quantity === BigInt(p.quantity18)
        ? BigInt(p.cost6)
        : (BigInt(p.cost6) * quantity) / BigInt(p.quantity18);
    state.cash6 = (BigInt(state.cash6) + gross - fee).toString();
    p.quantity18 = (BigInt(p.quantity18) - quantity).toString();
    p.cost6 = (BigInt(p.cost6) - cost).toString();
    state.realizedPnl6 = (BigInt(state.realizedPnl6) + gross - fee - cost).toString();
  }
  state.fees6 = (BigInt(state.fees6) + fee).toString();
  state.fills++;
  events.push({
    kind: 'FILL',
    at: state.clock,
    identity: id,
    side,
    quantity18: quantity.toString(),
    priceUsd18: price.toString(),
    gross6: gross.toString(),
    fee6: fee.toString(),
    mode: 'REFERENCE_PAPER',
  });
}
export function executePaperOrder(
  before: PaperState,
  id: string,
  side: 'buy' | 'sell',
  quantity18: string,
): PaperResult {
  const state = structuredClone(before),
    events: PaperEvent[] = [];
  execute(state, id, side, paperAmount(quantity18, true), events);
  return { state, events };
}
function isLiquidating(state: PaperState): boolean {
  return state.status === 'liquidating';
}
function liquidate(state: PaperState, events: PaperEvent[]) {
  for (const [id, p] of Object.entries(state.positions))
    if (p.quantity18 !== '0') {
      try {
        execute(state, id, 'sell', BigInt(p.quantity18), events);
      } catch (error) {
        events.push({ kind: 'LIQUIDATION_BLOCKED', identity: id, at: state.clock, reason: code(error) });
      }
    }
  if (Object.values(state.positions).every((p) => p.quantity18 === '0')) {
    state.status = 'stopped';
    events.push({ kind: 'STOPPED', at: state.clock, trigger: state.trigger });
  }
}
function latch(state: PaperState, trigger: PaperState['trigger'], events: PaperEvent[]) {
  if (state.status === 'stopped') return;
  if (!state.trigger) events.push({ kind: 'LIQUIDATION_TRIGGER', at: state.clock, trigger });
  state.trigger ??= trigger;
  state.status = 'liquidating';
}
function evaluateLimits(state: PaperState, events: PaperEvent[]) {
  if (state.status !== 'running') return;
  const l = state.config.limits;
  if (l.mode === 'percent') {
    const r = paperReturn(state, state.clock);
    if (!r) return;
    const n = (BigInt(r.numerator) - BigInt(r.denominator)) * BPS,
      d = BigInt(r.denominator);
    if (l.lowerBps !== null && n <= BigInt(l.lowerBps) * d) latch(state, 'lower', events);
    else if (l.upperBps !== null && n >= BigInt(l.upperBps) * d) latch(state, 'upper', events);
  } else if (l.mode === 'price' && fresh(state, l.identity, state.clock)) {
    const bid = BigInt(state.quotes[l.identity]!.tokenBidUsd18);
    if (l.lowerUsd18 !== null && bid <= BigInt(l.lowerUsd18)) latch(state, 'lower', events);
    else if (l.upperUsd18 !== null && bid >= BigInt(l.upperUsd18)) latch(state, 'upper', events);
  }
}
function code(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{1,80}$/.test(value) ? value : 'PAPER_FAILED';
}
function buyBudget(state: PaperState, id: string): bigint {
  const { price } = tradeNumbers(state, id, 'buy', 1n);
  let low = 0n,
    high = (BigInt(state.cash6) * VALUE_SCALE) / price;
  if (high > MAX) high = MAX;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (withinCap(state, id, middle)) low = middle;
    else high = middle - 1n;
  }
  return low;
}
export function applyPaperBatch(before: PaperState, batch: ReferenceBatch): PaperResult {
  validateReferenceBatch(batch);
  requireValue(
    isDeepStrictEqual(before.config.market, parseBatchPolicy(batch.policy)),
    'PAPER_POLICY_MISMATCH',
  );
  clock(batch.completedAt);
  if (batch.completedAt < before.clock)
    return {
      state: structuredClone(before),
      events: [
        {
          kind: 'REFERENCE_REJECTED',
          at: before.clock,
          reason: 'PAPER_INPUT_BEFORE_CONTROL',
          sourceCompletedAt: batch.completedAt,
        },
      ],
    };
  const state = structuredClone(before),
    events: PaperEvent[] = [];
  state.clock = batch.completedAt;
  if (batch.status === 'REJECTED')
    return { state, events: [{ kind: 'REFERENCE_REJECTED', at: state.clock, reason: batch.reason }] };
  const observations = replayReferenceBatch(batch);
  let minuteResult;
  try {
    minuteResult = advanceMinutes(state.minutes, observations, state.config.minuteCloseMaxAgeMs);
  } catch (error) {
    return { state, events: [{ kind: 'REFERENCE_REJECTED', at: state.clock, reason: code(error) }] };
  }
  state.minutes = minuteResult.state;
  state.quotes = Object.fromEntries(observations.map((o) => [o.identity, o]));
  let closed = false;
  for (const event of minuteResult.events) {
    events.push(event);
    if (event.kind === 'GAP') {
      if (state.config.gapPolicy === 'reset')
        state.emas = Object.fromEntries(state.minutes.identities.map((id) => [id, createEma()]));
      continue;
    }
    requireValue(Number.isSafeInteger(state.closedMinutes + 1), 'PAPER_COUNTER_LIMIT');
    state.closedMinutes++;
    closed = true;
    for (const id of state.minutes.identities)
      state.emas[id] = advanceEma(state.emas[id]!, event.prices[id]!);
  }
  evaluateLimits(state, events);
  if (isLiquidating(state)) liquidate(state, events);
  else if (state.status === 'running' && closed) {
    const signals = state.minutes.identities.map((id) => {
      const e = state.emas[id]!,
        held = state.positions[id]!.quantity18 !== '0';
      return {
        id,
        signal:
          e.slow.value === null
            ? 'warmup'
            : held
              ? BigInt(e.fast.value!) < BigInt(e.slow.value)
                ? 'sell'
                : 'hold'
              : BigInt(e.fast.value!) * 100000n > BigInt(e.slow.value) * 100015n
                ? 'buy'
                : 'cash',
      };
    });
    events.push({ kind: 'SIGNALS', at: state.clock, signals });
    for (const s of signals.filter((s) => s.signal === 'sell')) {
      try {
        execute(state, s.id, 'sell', BigInt(state.positions[s.id]!.quantity18), events);
      } catch (error) {
        events.push({ kind: 'ORDER_BLOCKED', at: state.clock, identity: s.id, reason: code(error) });
      }
      evaluateLimits(state, events);
    }
    for (const s of signals.filter((s) => s.signal === 'buy')) {
      if (state.status !== 'running') break;
      const quantity = buyBudget(state, s.id);
      if (quantity === 0n) {
        events.push({ kind: 'ORDER_BLOCKED', at: state.clock, identity: s.id, reason: 'ALLOCATION_LIMIT' });
        continue;
      }
      try {
        execute(state, s.id, 'buy', quantity, events);
      } catch (error) {
        events.push({ kind: 'ORDER_BLOCKED', at: state.clock, identity: s.id, reason: code(error) });
      }
      evaluateLimits(state, events);
    }
    if (isLiquidating(state)) liquidate(state, events);
  }
  events.push({
    kind: 'NAV',
    at: state.clock,
    equity6: paperNav(state, state.clock),
    unitValue: paperReturn(state, state.clock),
    cash6: state.cash6,
    netContributed6: state.netContributed6,
    fees6: state.fees6,
    realizedPnl6: state.realizedPnl6,
    mode: 'REFERENCE_PAPER',
  });
  return { state, events };
}
export function fundPaper(
  before: PaperState,
  direction: 'in' | 'out',
  amount6: string,
  at: number,
): PaperResult {
  clock(at);
  requireValue(at >= before.clock, 'PAPER_CLOCK_REGRESSION');
  const amount = paperAmount(amount6, true),
    state = structuredClone(before);
  requireValue(direction === 'in' || direction === 'out', 'INVALID_PAPER_FUND_DIRECTION');
  requireValue(direction === 'out' || state.status === 'running', 'PAPER_NOT_RUNNING');
  state.clock = at;
  const nav = valuation(state),
    n = BigInt(state.units.numerator),
    d = BigInt(state.units.denominator);
  requireValue(nav > 0n || n === 0n, 'INSOLVENT_PAPER');
  requireValue(direction === 'in' || amount <= BigInt(state.cash6), 'INSUFFICIENT_CASH');
  const delta = direction === 'in' ? amount : -amount;
  if (n === 0n)
    state.units = rational(amount * BigInt(state.emptyValue.denominator), BigInt(state.emptyValue.numerator));
  else {
    state.emptyValue = rational(nav * d, n);
    state.units = rational(n * (nav + delta), d * nav);
  }
  state.cash6 = (BigInt(state.cash6) + delta).toString();
  paperAmount(state.cash6);
  state.netContributed6 = (BigInt(state.netContributed6) + delta).toString();
  return {
    state,
    events: [
      {
        kind: 'VIRTUAL_FUND',
        at,
        direction,
        amount6,
        mode: 'REFERENCE_PAPER',
        unitValue: paperReturn(state, at),
      },
    ],
  };
}
export function stopPaper(before: PaperState, at: number): PaperResult {
  clock(at);
  requireValue(at >= before.clock, 'PAPER_CLOCK_REGRESSION');
  const state = structuredClone(before),
    events: PaperEvent[] = [];
  state.clock = at;
  latch(state, 'manual', events);
  if (state.status === 'liquidating') liquidate(state, events);
  return { state, events };
}

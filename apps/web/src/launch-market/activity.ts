import { getAddress } from 'ethers';
import { uint } from '../../../../packages/launch-market/src/config.ts';
import { createLaunchApi, newerLocation, validLocation, type LaunchApi } from './client.ts';
import type { ChainLocation, StrategyId } from './model.ts';
import { escapeHtml as esc, rawAmount } from './presentation.ts';

export interface MarketEvent {
  readonly name: string;
  readonly emitter: string;
  readonly strategyId: StrategyId | null;
  readonly fields: Readonly<Record<string, string | boolean>>;
  readonly timestamp: number;
  readonly location: ChainLocation;
}
export interface MarketCandle {
  readonly timestamp: number;
  readonly openRaw: string;
  readonly highRaw: string;
  readonly lowRaw: string;
  readonly closeRaw: string;
  readonly volumeUsdcRaw: string;
}
export interface PassHolder {
  readonly owner: string;
  readonly balanceRaw: string;
}
export interface MarketActivity {
  readonly strategyId: StrategyId;
  readonly phase: 'IDLE' | 'LOADING' | 'READY' | 'UNAVAILABLE';
  readonly location: ChainLocation | null;
  readonly events: readonly MarketEvent[];
  readonly candles: readonly MarketCandle[];
  readonly holders: readonly PassHolder[];
  readonly unavailable: readonly ('history' | 'candles' | 'holders')[];
}
type Evidence = { location: ChainLocation; indexer: { state: string } };
type Response = Evidence & { history?: MarketEvent[]; candles?: MarketCandle[]; holders?: PassHolder[] };
const empty = (strategyId: StrategyId): MarketActivity => ({
  strategyId,
  phase: 'IDLE',
  location: null,
  events: [],
  candles: [],
  holders: [],
  unavailable: [],
});
const time = (timestamp: number): string =>
  new Date(timestamp * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
function validTime(timestamp: number): void {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    !Number.isFinite(new Date(timestamp * 1000).getTime())
  )
    throw new Error('INVALID_MARKET_HISTORY');
}
function validateResponse(
  name: 'history' | 'candles' | 'holders',
  response: Response,
  strategy: StrategyId,
): void {
  validLocation(response.location);
  if (response.indexer?.state !== 'HEALTHY' || !Array.isArray(response[name]) || response[name]!.length > 100)
    throw new Error('MARKET_HISTORY_SYNCING');
  if (name === 'history')
    for (const event of response.history!) {
      validLocation(event.location);
      validTime(event.timestamp);
      getAddress(event.emitter);
      if (
        event.strategyId !== strategy ||
        typeof event.name !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event.name) ||
        !event.fields ||
        Object.keys(event.fields).length > 20 ||
        Object.values(event.fields).some(
          (field) => typeof field !== 'boolean' && (typeof field !== 'string' || field.length > 256),
        )
      )
        throw new Error('INVALID_MARKET_HISTORY');
    }
  if (name === 'candles') {
    let previous = -1;
    for (const candle of response.candles!) {
      validTime(candle.timestamp);
      const open = uint(candle.openRaw),
        high = uint(candle.highRaw),
        low = uint(candle.lowRaw),
        close = uint(candle.closeRaw);
      uint(candle.volumeUsdcRaw);
      if (
        candle.timestamp <= previous ||
        low > high ||
        low > open ||
        low > close ||
        high < open ||
        high < close
      )
        throw new Error('INVALID_MARKET_HISTORY');
      previous = candle.timestamp;
    }
  }
  if (name === 'holders')
    for (const holder of response.holders!) {
      getAddress(holder.owner);
      if (uint(holder.balanceRaw) === 0n) throw new Error('INVALID_MARKET_HISTORY');
    }
}

/** Reads only the active trade page, at most once per five seconds per strategy. Rendering does not fetch. */
export class MarketActivityClient {
  readonly #api: LaunchApi;
  readonly #now: () => number;
  readonly #enabled: boolean;
  readonly #listeners = new Set<() => void>();
  readonly #state: Record<StrategyId, MarketActivity> = { TSLA: empty('TSLA'), AMZN: empty('AMZN') };
  readonly #lastRead: Record<StrategyId, number> = { TSLA: -Infinity, AMZN: -Infinity };
  #active: StrategyId | null = null;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #inFlight = new Set<StrategyId>();
  constructor(options: { api?: LaunchApi; now?: () => number; enabled?: boolean } = {}) {
    this.#api = options.api ?? createLaunchApi();
    this.#now = options.now ?? Date.now;
    this.#enabled = options.enabled ?? true;
  }
  get state(): Record<StrategyId, MarketActivity> {
    return structuredClone(this.#state);
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
  async setActive(strategy: StrategyId | null): Promise<void> {
    if (strategy === this.#active) return;
    this.#active = strategy;
    ++this.#generation;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (strategy) {
      await this.refresh();
      if (this.#state[strategy].phase === 'LOADING') this.requestRefresh();
    }
  }
  requestRefresh(reorg = false): void {
    if (!this.#enabled) return;
    if (reorg) {
      ++this.#generation;
      for (const strategy of ['TSLA', 'AMZN'] as const)
        this.#state[strategy] = { ...empty(strategy), phase: 'LOADING' };
      this.#notify();
    }
    if (!this.#active || this.#timer) return;
    const wait = Math.max(0, 5000 - (this.#now() - this.#lastRead[this.#active]));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.refresh();
    }, wait);
  }
  async refresh(): Promise<void> {
    const strategy = this.#active;
    if (
      !this.#enabled ||
      !strategy ||
      this.#inFlight.has(strategy) ||
      this.#now() - this.#lastRead[strategy] < 5000
    )
      return;
    const generation = this.#generation;
    this.#inFlight.add(strategy);
    this.#lastRead[strategy] = this.#now();
    if (this.#state[strategy].phase === 'IDLE') {
      this.#state[strategy] = { ...empty(strategy), phase: 'LOADING' };
      this.#notify();
    }
    const names = ['history', 'candles', 'holders'] as const;
    const results = await Promise.allSettled(
      names.map(async (name) => {
        const response = await this.#api<Response>(
          `/api/launch-market/${name}?strategyId=${strategy}&limit=100${name === 'candles' ? '&bucketSeconds=300' : ''}`,
        );
        validateResponse(name, response, strategy);
        return response;
      }),
    );
    this.#inFlight.delete(strategy);
    if (generation !== this.#generation || strategy !== this.#active) {
      this.requestRefresh();
      return;
    }
    const next: { -readonly [K in keyof MarketActivity]: MarketActivity[K] } = {
      ...empty(strategy),
      phase: 'READY',
    };
    const unavailable: ('history' | 'candles' | 'holders')[] = [];
    for (let index = 0; index < names.length; ++index) {
      const name = names[index]!,
        result = results[index]!;
      if (result.status === 'rejected') {
        unavailable.push(name);
        continue;
      }
      if (
        next.location &&
        (next.location.blockNumber !== result.value.location.blockNumber ||
          next.location.blockHash.toLowerCase() !== result.value.location.blockHash.toLowerCase() ||
          next.location.version !== result.value.location.version)
      ) {
        unavailable.push(name);
        continue;
      }
      next.location = result.value.location;
      if (name === 'history') next.events = result.value.history!;
      if (name === 'candles') next.candles = result.value.candles!;
      if (name === 'holders') next.holders = result.value.holders!;
    }
    next.unavailable = unavailable;
    if (unavailable.length === 3) next.phase = 'UNAVAILABLE';
    const previous = this.#state[strategy];
    if (next.location && previous.location && !newerLocation(next.location, previous.location)) {
      this.#state[strategy] = { ...previous, phase: 'UNAVAILABLE', unavailable: [...names] };
      this.#notify();
      return;
    }
    this.#state[strategy] = next;
    this.#notify();
  }
  dispose(): void {
    this.#active = null;
    ++this.#generation;
    if (this.#timer) clearTimeout(this.#timer);
    this.#listeners.clear();
  }
}

function candlesSvg(candles: readonly MarketCandle[]): string {
  const highs = candles.map((candle) => BigInt(candle.highRaw)),
    lows = candles.map((candle) => BigInt(candle.lowRaw));
  let high = highs.reduce((a, b) => (a > b ? a : b)),
    low = lows.reduce((a, b) => (a < b ? a : b));
  if (high === low) {
    const padding = high / 100n || 1n;
    high += padding;
    low -= padding;
  }
  const span = high - low,
    y = (raw: string) => 16 + Number(((high - BigInt(raw)) * 180n) / span);
  const width = Math.min(16, (500 / candles.length) * 0.6),
    maximumVolume = candles.reduce(
      (maximum, candle) => (BigInt(candle.volumeUsdcRaw) > maximum ? BigInt(candle.volumeUsdcRaw) : maximum),
      1n,
    );
  return `<svg class="launch-candles" viewBox="0 0 600 280" role="img" aria-label="${candles.length} actual five-minute PASS AMM OHLCV candles"><title>PASS AMM execution prices in AF-USDC with actual AF-USDC swap volume</title><text x="2" y="20">${esc(rawAmount(String(high), 6))}</text><text x="2" y="195">${esc(rawAmount(String(low < 0n ? 0n : low), 6))}</text><line x1="62" y1="204" x2="585" y2="204" class="launch-chart-axis"/>${candles
    .map((candle, index) => {
      const x = 75 + index * (500 / Math.max(1, candles.length - 1)),
        open = y(candle.openRaw),
        close = y(candle.closeRaw),
        volume = Number((BigInt(candle.volumeUsdcRaw) * 46n) / maximumVolume),
        fill = BigInt(candle.closeRaw) >= BigInt(candle.openRaw) ? '#42684e' : '#a34f3e';
      return `<g><title>${esc(time(candle.timestamp))} · O ${rawAmount(candle.openRaw, 6)} · H ${rawAmount(candle.highRaw, 6)} · L ${rawAmount(candle.lowRaw, 6)} · C ${rawAmount(candle.closeRaw, 6)} AF-USDC/PASS · Volume ${rawAmount(candle.volumeUsdcRaw, 6)} AF-USDC</title><line x1="${x}" x2="${x}" y1="${y(candle.highRaw)}" y2="${y(candle.lowRaw)}" stroke="${fill}"/><rect x="${x - width / 2}" y="${Math.min(open, close)}" width="${width}" height="${Math.max(1, Math.abs(open - close))}" fill="${fill}"/><rect x="${x - width / 2}" y="${260 - volume}" width="${width}" height="${volume}" fill="${fill}" opacity="0.5"/></g>`;
    })
    .join(
      '',
    )}<text x="62" y="276">${esc(time(candles[0]!.timestamp).slice(0, 16))}</text><text x="585" y="276" text-anchor="end">${esc(time(candles.at(-1)!.timestamp).slice(0, 16))} UTC</text></svg>`;
}

function eventDetails(event: MarketEvent, pass?: string): string {
  const fields = event.fields;
  if (event.name === 'Swap')
    return `${fields.buy ? 'Buy' : 'Sell'} · ${rawAmount(String(fields[fields.buy ? 'amountOut' : 'amountIn']), 18)} PASS · ${rawAmount(String(fields[fields.buy ? 'amountIn' : 'amountOut']), 6)} AF-USDC`;
  if (event.name === 'Subscription')
    return `${rawAmount(String(fields.passAmount), 18)} PASS · ${rawAmount(String(fields.usdcAmount), 6)} AF-USDC`;
  if (event.name === 'Transfer')
    return pass && event.emitter.toLowerCase() === pass.toLowerCase()
      ? `${rawAmount(String(fields.value), 18)} PASS`
      : `ERC-20 transfer · ${String(fields.value)} raw units`;
  if (event.name === 'Launch')
    return `${rawAmount(String(fields.passAmount), 18)} PASS · ${rawAmount(String(fields.usdcAmount), 6)} AF-USDC LP`;
  return Object.entries(fields)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

export function renderActivity(activity: MarketActivity, deployed = true, pass?: string): string {
  const unavailable = (name: 'history' | 'candles' | 'holders') => activity.unavailable.includes(name);
  const pending = activity.phase === 'IDLE' || activity.phase === 'LOADING';
  const message = !deployed
    ? 'Market event history is available after contract deployment.'
    : pending
      ? 'Reading indexed chain events…'
      : 'The event indexer is syncing or unavailable. Refresh to retry.';
  const latest = activity.candles.at(-1);
  return `<section class="wrap launch-market launch-activity" data-launch-activity><header><span class="section-label">${activity.strategyId} · INDEXED CHAIN EVENTS</span><h2>PASS market activity</h2><p class="small muted">${activity.location ? `Read at block ${esc(activity.location.blockNumber)}. PASS prices reflect actual AMM swaps; strategy stock performance is separate.` : esc(message)}</p></header><article class="sketch-box launch-chart"><h3>PASS price · 5-minute OHLCV</h3>${pending || unavailable('candles') || !deployed ? `<p class="small muted">${esc(message)}</p>` : activity.candles.length ? `${candlesSvg(activity.candles)}<p class="small muted">Latest O ${rawAmount(latest!.openRaw, 6)} · H ${rawAmount(latest!.highRaw, 6)} · L ${rawAmount(latest!.lowRaw, 6)} · C ${rawAmount(latest!.closeRaw, 6)} AF-USDC/PASS. Volume ${rawAmount(latest!.volumeUsdcRaw, 6)} AF-USDC.</p>` : '<p class="small muted">No indexed AMM swaps yet. Candles appear after actual swaps.</p>'}</article><div class="launch-activity-grid"><article class="sketch-box"><h3>Recent chain events</h3>${pending || unavailable('history') || !deployed ? `<p class="small muted">${esc(message)}</p>` : activity.events.length ? `<div class="launch-history-scroll"><table><thead><tr><th>Time · UTC</th><th>Event</th><th>Settlement</th><th>Evidence</th></tr></thead><tbody>${activity.events.map((event) => `<tr><td>${esc(time(event.timestamp))}</td><td>${esc(event.name)}</td><td>${esc(eventDetails(event, pass))}</td><td>${event.location.transactionHash ? `<a class="text-link" href="https://explorer.testnet.chain.robinhood.com/tx/${esc(event.location.transactionHash)}" target="_blank" rel="noopener noreferrer">${esc(event.location.transactionHash.slice(0, 10))}… ↗</a>` : 'Block event'}<span class="small muted">${event.location.confirmations >= 3 ? 'Confirmed' : 'Included'} · ${event.location.confirmations} blocks</span></td></tr>`).join('')}</tbody></table></div><p class="small muted">Latest ${activity.events.length} indexed strategy events, including transfers and approvals.</p>` : '<p class="small muted">No indexed strategy events yet.</p>'}</article><article class="sketch-box"><h3>PASS holders</h3>${pending || unavailable('holders') || !deployed ? `<p class="small muted">${esc(message)}</p>` : activity.holders.length ? `<p class="small muted">Largest ${activity.holders.length} indexed PASS balances, up to 100 addresses. Includes contract custody and pool reserves.</p><ol class="launch-holder-list">${activity.holders.map((holder) => `<li><a class="text-link" href="https://explorer.testnet.chain.robinhood.com/address/${esc(holder.owner)}" target="_blank" rel="noopener noreferrer">${esc(holder.owner.slice(0, 8))}…${esc(holder.owner.slice(-6))} ↗</a><span>${rawAmount(holder.balanceRaw, 18)} PASS</span></li>`).join('')}</ol>` : '<p class="small muted">No indexed holder balances yet.</p>'}</article></div></section>`;
}

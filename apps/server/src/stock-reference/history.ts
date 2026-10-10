/** Display-only historical OHLCV. This module has no credentials, order, keeper or settlement path. */
export type StockHistorySymbol = 'TSLA' | 'AMZN';
export type StockHistoryRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';
export interface StockHistoryCandle {
  /** Unix seconds; Nasdaq daily timestamps represent the reported session date at UTC midnight. */
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}
export interface StockHistoryResult {
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly symbol: StockHistorySymbol;
  readonly range: StockHistoryRange;
  readonly interval: 'day';
  /** The current private reference integration reads one year, including for the ALL selection. */
  readonly sourceRange: '1Y';
  readonly source: 'Nasdaq';
  /** Official provider reference page; the upstream API response is never exposed. */
  readonly sourceUrl: string;
  readonly timestampBasis: 'reported-session-date';
  readonly fetchedAt: number;
  readonly lastDataAt: number | null;
  readonly currency: 'USD';
  readonly referenceOnly: true;
  readonly candles: readonly StockHistoryCandle[];
  readonly reason?: StockHistoryUnavailableReason;
}
type StockHistoryUnavailableReason =
  'SOURCE_UNAVAILABLE' | 'INVALID_SOURCE_DATA' | 'EMPTY_HISTORY' | 'RESPONSE_TOO_LARGE';
interface StockHistoryOptions {
  readonly fetcher?: typeof fetch;
  /** Unix seconds. */
  readonly now?: () => number;
}
const ranges: readonly StockHistoryRange[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];
const maxBytes = 2_097_152,
  maxCandles = 10_000,
  timeoutMs = 3_000,
  successTtlSeconds = 300,
  failureTtlSeconds = 30;

export class StockHistoryRequestError extends Error {
  constructor() {
    super('UNSUPPORTED_STOCK_HISTORY_REQUEST');
    this.name = 'StockHistoryRequestError';
  }
}
class SourceError extends Error {
  readonly reason: StockHistoryUnavailableReason;
  constructor(reason: StockHistoryUnavailableReason) {
    super(reason);
    this.reason = reason;
  }
}
function invalid(): never {
  throw new SourceError('INVALID_SOURCE_DATA');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function candle(t: unknown, o: unknown, h: unknown, l: unknown, c: unknown, v: unknown): StockHistoryCandle {
  if (
    typeof t !== 'number' ||
    !Number.isSafeInteger(t) ||
    t <= 0 ||
    typeof o !== 'number' ||
    typeof h !== 'number' ||
    typeof l !== 'number' ||
    typeof c !== 'number' ||
    typeof v !== 'number' ||
    ![o, h, l, c, v].every(Number.isFinite) ||
    Math.min(o, h, l, c) <= 0 ||
    !Number.isSafeInteger(v) ||
    v < 0 ||
    h < Math.max(o, l, c) ||
    l > Math.min(o, h, c)
  )
    return invalid();
  return Object.freeze({ t, o, h, l, c, v });
}
function ordered(candles: StockHistoryCandle[], now: number): readonly StockHistoryCandle[] {
  candles.sort((a, b) => a.t - b.t);
  if (!candles.length) throw new SourceError('EMPTY_HISTORY');
  if (candles.length > maxCandles) return invalid();
  for (let i = 0; i < candles.length; i++) {
    if (candles[i]!.t > now + 60 || (i && candles[i]!.t === candles[i - 1]!.t)) return invalid();
  }
  return Object.freeze(candles);
}
function decimal(value: unknown, volume = false): number {
  if (typeof value !== 'string') return invalid();
  const format = volume ? /^(?:\d+|\d{1,3}(?:,\d{3})+)$/ : /^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!format.test(value)) return invalid();
  const result = Number(value.replace(/[$,]/g, ''));
  if (!Number.isFinite(result)) return invalid();
  return result;
}
function reportedDate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return invalid();
  const [month, day, year] = value.split('/').map(Number),
    timestamp = Date.UTC(year!, month! - 1, day!);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
    return invalid();
  return timestamp / 1000;
}
function parseNasdaq(
  payload: unknown,
  symbol: StockHistorySymbol,
  now: number,
): readonly StockHistoryCandle[] {
  const root = object(payload);
  if (object(root.status).rCode !== 200 || !root.data) throw new SourceError('SOURCE_UNAVAILABLE');
  const data = object(root.data);
  if (data.symbol !== symbol) return invalid();
  const rows = object(data.tradesTable).rows;
  if (!Array.isArray(rows) || rows.length > maxCandles) return invalid();
  return ordered(
    rows.map((raw) => {
      const row = object(raw);
      return candle(
        reportedDate(row.date),
        decimal(row.open),
        decimal(row.high),
        decimal(row.low),
        decimal(row.close),
        decimal(row.volume, true),
      );
    }),
    now,
  );
}
function nasdaqUrl(symbol: StockHistorySymbol, now: number): string {
  const end = new Date(now * 1000),
    start = new Date(now * 1000);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=stocks&limit=10000&fromdate=${start.toISOString().slice(0, 10)}&todate=${end.toISOString().slice(0, 10)}`;
}

export class StockReferenceHistory {
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly #cache = new Map<StockHistorySymbol, { expiresAt: number; result: StockHistoryResult }>();
  readonly #pending = new Map<StockHistorySymbol, Promise<StockHistoryResult>>();
  constructor(options: StockHistoryOptions = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }
  async #get(url: string): Promise<unknown> {
    const response = await this.#fetcher(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': 'AlphaForge-StockReference/1.0' },
    });
    if (!response.ok || !response.body) throw new SourceError('SOURCE_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel();
      throw new SourceError('RESPONSE_TOO_LARGE');
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maxBytes) throw new SourceError('RESPONSE_TOO_LARGE');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
    } catch {
      return invalid();
    }
  }
  async read(symbol: StockHistorySymbol, range: StockHistoryRange = '1Y'): Promise<StockHistoryResult> {
    if (!['TSLA', 'AMZN'].includes(symbol) || !ranges.includes(range)) throw new StockHistoryRequestError();
    const now = this.#now(),
      cached = this.#cache.get(symbol);
    if (cached && now < cached.expiresAt) return selectRange(cached.result, range, now);
    const pending = this.#pending.get(symbol);
    if (pending) return selectRange(await pending, range, this.#now());
    const request = this.#load(symbol, now)
      .then((result) => {
        this.#cache.set(symbol, {
          expiresAt:
            result.fetchedAt + (result.status === 'AVAILABLE' ? successTtlSeconds : failureTtlSeconds),
          result,
        });
        return result;
      })
      .finally(() => this.#pending.delete(symbol));
    this.#pending.set(symbol, request);
    return selectRange(await request, range, this.#now());
  }
  async #load(symbol: StockHistorySymbol, now: number): Promise<StockHistoryResult> {
    const requestUrl = nasdaqUrl(symbol, now),
      sourceUrl = `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/historical`,
      metadata = {
        symbol,
        range: '1Y' as const,
        interval: 'day' as const,
        sourceRange: '1Y' as const,
        source: 'Nasdaq' as const,
        sourceUrl,
        timestampBasis: 'reported-session-date' as const,
        currency: 'USD' as const,
        referenceOnly: true as const,
      };
    try {
      const payload = await this.#get(requestUrl),
        fetchedAt = this.#now(),
        candles = parseNasdaq(payload, symbol, fetchedAt);
      return Object.freeze({
        ...metadata,
        status: 'AVAILABLE',
        fetchedAt,
        lastDataAt: candles.at(-1)!.t,
        candles,
      });
    } catch (error) {
      return Object.freeze({
        ...metadata,
        status: 'UNAVAILABLE',
        fetchedAt: this.#now(),
        lastDataAt: null,
        candles: Object.freeze([]),
        reason: error instanceof SourceError ? error.reason : 'SOURCE_UNAVAILABLE',
      });
    }
  }
}

function selectRange(result: StockHistoryResult, range: StockHistoryRange, now: number): StockHistoryResult {
  if (range === '1Y' || range === 'ALL' || result.status === 'UNAVAILABLE')
    return Object.freeze({ ...result, range });
  // One daily point for 1D is accurate; no hourly candles are derived from it.
  const candles =
    range === '1D'
      ? result.candles.slice(-1)
      : result.candles.filter(
          (point) => point.t >= now - (range === '1W' ? 7 : range === '1M' ? 30 : 90) * 86_400,
        );
  if (!candles.length)
    return Object.freeze({
      ...result,
      range,
      status: 'UNAVAILABLE',
      lastDataAt: null,
      candles: Object.freeze([]),
      reason: 'EMPTY_HISTORY',
    });
  return Object.freeze({ ...result, range, lastDataAt: candles.at(-1)!.t, candles: Object.freeze(candles) });
}

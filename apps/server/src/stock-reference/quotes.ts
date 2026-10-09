import type { StockHistorySymbol } from './history.ts';
import { StockHistoryRequestError } from './history.ts';

/** Nasdaq display reference. Never use this quote for orders, vault accounting, or keeper updates. */
export interface StockQuoteResult {
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly symbol: StockHistorySymbol;
  readonly source: 'Nasdaq';
  readonly sourceUrl: string;
  readonly referenceOnly: true;
  readonly currency: 'USD';
  readonly fetchedAt: number;
  readonly lastDataAt: number | null;
  readonly price: number | null;
  /** The upstream provider flag; this does not imply consolidated SIP coverage. */
  readonly isRealtime: boolean | null;
  readonly marketStatus: string | null;
  /** Unmodified provider quote timestamp, which is only precise to the minute. */
  readonly quoteTime: string | null;
  readonly timestampPrecision: 'minute';
  readonly reason?: 'SOURCE_UNAVAILABLE' | 'INVALID_SOURCE_DATA' | 'RESPONSE_TOO_LARGE';
}
interface StockQuoteOptions {
  readonly fetcher?: typeof fetch;
  /** Unix seconds. */
  readonly now?: () => number;
}
const maxBytes = 262_144,
  timeoutMs = 3_000,
  ttlSeconds = 10;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const newYork = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
class QuoteSourceError extends Error {
  readonly reason: NonNullable<StockQuoteResult['reason']>;
  constructor(reason: NonNullable<StockQuoteResult['reason']>) {
    super(reason);
    this.reason = reason;
  }
}
function invalid(): never {
  throw new QuoteSourceError('INVALID_SOURCE_DATA');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function quoteTimestamp(value: unknown): number {
  if (typeof value !== 'string') return invalid();
  const match =
    /^(?:Closed at )?([A-Z][a-z]{2}) ([1-9]|[12]\d|3[01]), (\d{4}) (1[0-2]|[1-9]):([0-5]\d) (AM|PM) ET$/.exec(
      value,
    );
  if (!match) return invalid();
  const month = months.indexOf(match[1]!),
    day = Number(match[2]),
    year = Number(match[3]),
    hour = (Number(match[4]) % 12) + (match[6] === 'PM' ? 12 : 0),
    minute = Number(match[5]);
  if (month < 0 || year < 2000) return invalid();
  const target = Date.UTC(year, month, day, hour, minute),
    candidates: number[] = [];
  // Intl validates New York's actual DST offset. Ambiguous or nonexistent ET times are rejected.
  for (const offsetHours of [4, 5]) {
    const candidate = target + offsetHours * 3_600_000,
      parts = Object.fromEntries(
        newYork.formatToParts(candidate).map((part) => [part.type, Number(part.value)]),
      );
    if (
      parts.year === year &&
      parts.month === month + 1 &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    )
      candidates.push(candidate / 1000);
  }
  if (candidates.length !== 1) return invalid();
  return candidates[0]!;
}
function quotePrice(value: unknown): number {
  if (typeof value !== 'string' || !/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return invalid();
  const price = Number(value.replace(/[$,]/g, ''));
  if (!Number.isFinite(price) || price <= 0) return invalid();
  return price;
}

export class StockReferenceQuotes {
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly #cache = new Map<StockHistorySymbol, StockQuoteResult>();
  readonly #pending = new Map<StockHistorySymbol, Promise<StockQuoteResult>>();
  constructor(options: StockQuoteOptions = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }
  async #get(symbol: StockHistorySymbol): Promise<unknown> {
    const response = await this.#fetcher(
      `https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=stocks`,
      {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'AlphaForge-StockReference/1.0' },
      },
    );
    if (!response.ok || !response.body) throw new QuoteSourceError('SOURCE_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel();
      throw new QuoteSourceError('RESPONSE_TOO_LARGE');
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maxBytes) throw new QuoteSourceError('RESPONSE_TOO_LARGE');
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
  async read(symbol: StockHistorySymbol): Promise<StockQuoteResult> {
    if (!['TSLA', 'AMZN'].includes(symbol)) throw new StockHistoryRequestError();
    const cached = this.#cache.get(symbol),
      now = this.#now();
    if (cached && now < cached.fetchedAt + ttlSeconds) return cached;
    const pending = this.#pending.get(symbol);
    if (pending) return pending;
    const request = this.#load(symbol)
      .then((result) => {
        this.#cache.set(symbol, result);
        return result;
      })
      .finally(() => this.#pending.delete(symbol));
    this.#pending.set(symbol, request);
    return request;
  }
  async #load(symbol: StockHistorySymbol): Promise<StockQuoteResult> {
    const metadata = {
      symbol,
      source: 'Nasdaq' as const,
      sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}`,
      referenceOnly: true as const,
      currency: 'USD' as const,
      timestampPrecision: 'minute' as const,
    };
    try {
      const root = object(await this.#get(symbol));
      if (object(root.status).rCode !== 200 || !root.data) throw new QuoteSourceError('SOURCE_UNAVAILABLE');
      const data = object(root.data);
      if (
        data.symbol !== symbol ||
        data.assetClass !== 'STOCKS' ||
        data.exchange !== 'NASDAQ-GS' ||
        typeof data.marketStatus !== 'string' ||
        data.marketStatus.length > 32
      )
        return invalid();
      const primary = object(data.primaryData),
        fetchedAt = this.#now(),
        price = quotePrice(primary.lastSalePrice),
        lastDataAt = quoteTimestamp(primary.lastTradeTimestamp);
      if (typeof primary.isRealTime !== 'boolean' || lastDataAt > fetchedAt + 60) return invalid();
      return Object.freeze({
        ...metadata,
        status: 'AVAILABLE',
        fetchedAt,
        lastDataAt,
        price,
        isRealtime: primary.isRealTime,
        marketStatus: data.marketStatus,
        quoteTime: primary.lastTradeTimestamp as string,
      });
    } catch (error) {
      return Object.freeze({
        ...metadata,
        status: 'UNAVAILABLE',
        fetchedAt: this.#now(),
        lastDataAt: null,
        price: null,
        isRealtime: null,
        marketStatus: null,
        quoteTime: null,
        reason: error instanceof QuoteSourceError ? error.reason : 'SOURCE_UNAVAILABLE',
      });
    }
  }
}

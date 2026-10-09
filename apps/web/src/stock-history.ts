/** Display-only equity references. No price in this module is an execution quote or Vault NAV input. */
type StockSymbol = 'TSLA' | 'AMZN';
export interface StockCandle {
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}
export interface StockHistoryResult {
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly symbol: StockSymbol;
  readonly source: 'Nasdaq';
  readonly sourceUrl: string;
  readonly fetchedAt: number;
  readonly lastDataAt: number | null;
  readonly referenceOnly: true;
  readonly currency: 'USD';
  readonly range: '1Y';
  readonly sourceRange: '1Y';
  readonly interval: 'day';
  readonly timestampBasis: 'reported-session-date';
  readonly candles: readonly StockCandle[];
  readonly reason?: string;
}
export interface StockQuoteResult {
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly symbol: StockSymbol;
  readonly source: 'Nasdaq';
  readonly sourceUrl: string;
  readonly fetchedAt: number;
  readonly lastDataAt: number | null;
  readonly referenceOnly: true;
  readonly currency: 'USD';
  readonly price: number | null;
  readonly isRealtime: boolean | null;
  readonly marketStatus: string | null;
  readonly quoteTime: string | null;
  readonly timestampPrecision: 'minute';
  readonly reason?: string;
}
export interface StockQuoteInfo extends StockQuoteResult {
  /** Available even when the current request failed; its original quote time remains unchanged. */
  readonly lastGood: StockQuoteResult | null;
}
export interface StockHistoryInfo extends StockHistoryResult {
  readonly lastGood: StockHistoryResult | null;
}
export interface StockReferencePoint {
  readonly t: number;
  readonly price: number;
  readonly kind: 'daily' | 'quote';
}
export interface StockHistoryHost {
  stockHistory?: {
    candles(id: string, range: string): readonly StockCandle[] | null;
    info(id: string): StockHistoryInfo | null;
    quote(id: string): StockQuoteInfo | null;
    points(id: string, range: string): readonly StockReferencePoint[] | null;
    subscribe(listener: () => void): () => void;
  };
  app: { render(options?: { preserve?: boolean }): void };
}
const symbols: readonly StockSymbol[] = ['TSLA', 'AMZN'];
const periods: Readonly<Record<string, number>> = {
  '24h': 86400,
  '1d': 86400,
  '7d': 7 * 86400,
  '1w': 7 * 86400,
  '30d': 30 * 86400,
  '1m': 30 * 86400,
  '90d': 90 * 86400,
  '3m': 90 * 86400,
  '1y': 366 * 86400,
};
const maxQuotePoints = 360;
const quoteDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
function symbolFor(id: string): StockSymbol | null {
  const symbol = id.toUpperCase();
  return symbol === 'TSLA' || symbol === 'AMZN' ? symbol : null;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function metadata(value: unknown, symbol: StockSymbol, history: boolean): value is Record<string, unknown> {
  return (
    object(value) &&
    value.symbol === symbol &&
    value.referenceOnly === true &&
    value.currency === 'USD' &&
    value.source === 'Nasdaq' &&
    value.sourceUrl ===
      `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}${history ? '/historical' : ''}` &&
    (value.status === 'AVAILABLE' || value.status === 'UNAVAILABLE') &&
    timestamp(value.fetchedAt) &&
    value.fetchedAt <= Math.floor(Date.now() / 1000) + 60 &&
    (value.reason === undefined || (typeof value.reason === 'string' && value.reason.length <= 64))
  );
}
function historyResult(value: unknown, symbol: StockSymbol): StockHistoryResult | null {
  if (
    !metadata(value, symbol, true) ||
    value.range !== '1Y' ||
    value.sourceRange !== '1Y' ||
    value.interval !== 'day' ||
    value.timestampBasis !== 'reported-session-date' ||
    !Array.isArray(value.candles) ||
    value.candles.length > 1000
  )
    return null;
  let previous = 0;
  const candles: StockCandle[] = [];
  for (const row of value.candles) {
    if (
      !object(row) ||
      !timestamp(row.t) ||
      row.t <= previous ||
      row.t > (value.fetchedAt as number) ||
      ![row.o, row.h, row.l, row.c].every(
        (price) => typeof price === 'number' && Number.isFinite(price) && price > 0,
      ) ||
      typeof row.v !== 'number' ||
      !Number.isSafeInteger(row.v) ||
      row.v < 0
    )
      return null;
    const { o, h, l, c } = row as unknown as StockCandle;
    if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) return null;
    previous = row.t;
    candles.push(Object.freeze({ t: row.t, o, h, l, c, v: row.v }));
  }
  if (
    value.status === 'AVAILABLE'
      ? !candles.length || value.lastDataAt !== previous
      : candles.length !== 0 || value.lastDataAt !== null
  )
    return null;
  return Object.freeze({ ...value, candles: Object.freeze(candles) }) as unknown as StockHistoryResult;
}
function quoteResult(value: unknown, symbol: StockSymbol): StockQuoteResult | null {
  if (!metadata(value, symbol, false) || value.timestampPrecision !== 'minute') return null;
  if (value.status === 'UNAVAILABLE') {
    if (
      [value.lastDataAt, value.price, value.isRealtime, value.marketStatus, value.quoteTime].some(
        (field) => field !== null,
      )
    )
      return null;
  } else {
    if (
      !timestamp(value.lastDataAt) ||
      value.lastDataAt % 60 !== 0 ||
      value.lastDataAt > (value.fetchedAt as number) + 60 ||
      typeof value.price !== 'number' ||
      !Number.isFinite(value.price) ||
      value.price <= 0 ||
      typeof value.isRealtime !== 'boolean' ||
      typeof value.marketStatus !== 'string' ||
      !value.marketStatus.length ||
      value.marketStatus.length > 32 ||
      typeof value.quoteTime !== 'string'
    )
      return null;
    // The provider's minute must match the source timestamp, including New York DST.
    const parts = Object.fromEntries(
      quoteDate.formatToParts(value.lastDataAt * 1000).map((part) => [part.type, part.value]),
    );
    const expected = `${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`;
    if (value.quoteTime !== expected && value.quoteTime !== `Closed at ${expected}`) return null;
  }
  return Object.freeze({ ...value }) as unknown as StockQuoteResult;
}
function rangePoints<T extends { readonly t: number }>(points: readonly T[], range: string): readonly T[] {
  if (!points.length) return Object.freeze([]);
  const latest = points.at(-1)!.t,
    seconds = periods[range.toLowerCase()];
  return Object.freeze(points.filter((point) => seconds === undefined || point.t > latest - seconds));
}

export function installStockHistory(host: StockHistoryHost): () => void {
  const histories = new Map<StockSymbol, StockHistoryResult>(),
    goodHistories = new Map<StockSymbol, StockHistoryResult>(),
    quotes = new Map<StockSymbol, StockQuoteResult>(),
    goodQuotes = new Map<StockSymbol, StockQuoteResult>(),
    referencePoints = new Map<StockSymbol, readonly StockReferencePoint[]>(),
    listeners = new Set<() => void>(),
    pending = new Map<string, AbortController>();
  let stopped = false;
  host.stockHistory = {
    info: (id) => {
      const symbol = symbolFor(id),
        current = symbol && histories.get(symbol);
      return current ? Object.freeze({ ...current, lastGood: goodHistories.get(symbol!) ?? null }) : null;
    },
    quote: (id) => {
      const symbol = symbolFor(id),
        current = symbol && quotes.get(symbol);
      return current ? Object.freeze({ ...current, lastGood: goodQuotes.get(symbol!) ?? null }) : null;
    },
    candles: (id, range) => {
      const symbol = symbolFor(id),
        result = symbol && goodHistories.get(symbol);
      return result ? rangePoints(result.candles, range) : null;
    },
    points: (id, range) => {
      const symbol = symbolFor(id);
      if (!symbol) return null;
      const points = new Map<number, StockReferencePoint>();
      for (const row of goodHistories.get(symbol)?.candles ?? [])
        points.set(row.t, Object.freeze({ t: row.t, price: row.c, kind: 'daily' }));
      for (const point of referencePoints.get(symbol) ?? []) points.set(point.t, point);
      return points.size
        ? rangePoints(
            [...points.values()].sort((a, b) => a.t - b.t),
            range,
          )
        : null;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const notify = () => {
    for (const listener of listeners) listener();
    host.app.render({ preserve: true });
  };
  const rememberQuote = (result: StockQuoteResult) => {
    const points = new Map((referencePoints.get(result.symbol) ?? []).map((point) => [point.t, point]));
    points.set(
      result.lastDataAt!,
      Object.freeze({ t: result.lastDataAt!, price: result.price!, kind: 'quote' }),
    );
    const sorted = [...points.values()].sort((a, b) => a.t - b.t),
      latest = sorted.at(-1)!.t;
    referencePoints.set(
      result.symbol,
      Object.freeze(sorted.filter((point) => point.t > latest - 86400).slice(-maxQuotePoints)),
    );
  };
  const update = async (symbol: StockSymbol, history: boolean) => {
    const key = `${symbol}:${history ? 'history' : 'quote'}`;
    if (stopped || document.hidden || pending.has(key)) return;
    const controller = new AbortController();
    pending.set(key, controller);
    try {
      const response = await fetch(
        `/api/stock-reference/${history ? 'candles' : 'quote'}?symbol=${symbol}${history ? '&range=1Y' : ''}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) throw new Error('SOURCE_UNAVAILABLE');
      const raw: unknown = await response.json();
      if (stopped || document.hidden || controller.signal.aborted) return;
      if (history) {
        const result = historyResult(raw, symbol);
        if (!result) throw new Error('INVALID_SOURCE_DATA');
        histories.set(symbol, result);
        if (result.status === 'AVAILABLE') goodHistories.set(symbol, result);
      } else {
        const result = quoteResult(raw, symbol);
        if (!result) throw new Error('INVALID_SOURCE_DATA');
        quotes.set(symbol, result);
        if (result.status === 'AVAILABLE') {
          goodQuotes.set(symbol, result);
          rememberQuote(result);
        }
      }
      notify();
    } catch (error) {
      if (stopped || document.hidden || controller.signal.aborted) return;
      const metadata = {
        symbol,
        source: 'Nasdaq' as const,
        sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}${history ? '/historical' : ''}`,
        status: 'UNAVAILABLE' as const,
        referenceOnly: true as const,
        currency: 'USD' as const,
        fetchedAt: Math.floor(Date.now() / 1000),
        lastDataAt: null,
        reason:
          error instanceof Error && error.message === 'INVALID_SOURCE_DATA'
            ? 'INVALID_SOURCE_DATA'
            : 'SOURCE_UNAVAILABLE',
      };
      if (history)
        histories.set(
          symbol,
          Object.freeze({
            ...metadata,
            range: '1Y',
            sourceRange: '1Y',
            interval: 'day',
            timestampBasis: 'reported-session-date',
            candles: Object.freeze([]),
          }),
        );
      else
        quotes.set(
          symbol,
          Object.freeze({
            ...metadata,
            price: null,
            isRealtime: null,
            marketStatus: null,
            quoteTime: null,
            timestampPrecision: 'minute',
          }),
        );
      notify();
    } finally {
      pending.delete(key);
    }
  };
  const refresh = (history: boolean) => {
    for (const symbol of symbols) void update(symbol, history);
  };
  refresh(true);
  refresh(false);
  const quoteInterval = window.setInterval(() => refresh(false), 15_000),
    historyInterval = window.setInterval(() => refresh(true), 300_000);
  const onVisibility = () => {
    if (!document.hidden) {
      refresh(false);
      refresh(true);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(quoteInterval);
    window.clearInterval(historyInterval);
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    listeners.clear();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

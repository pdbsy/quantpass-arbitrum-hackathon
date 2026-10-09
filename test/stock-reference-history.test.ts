import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  StockReferenceHistory,
  StockHistoryRequestError,
} from '../apps/server/src/stock-reference/history.ts';

const now = Date.parse('2026-10-09T04:00:00Z') / 1000;
// Offline parser fixtures, never served as application stock data.
const row = (date = '10/08/2026') => ({
  date,
  open: '$374.12',
  high: '$375.96',
  low: '$368.0301',
  close: '$375.00',
  volume: '28,394,950',
});
function payload(symbol = 'TSLA', rows: unknown[] = [row()]) {
  return { status: { rCode: 200 }, data: { symbol, totalRecords: rows.length, tradesTable: { rows } } };
}
function reader(raw: unknown = payload()) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const source = new StockReferenceHistory({
    now: () => now,
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(raw));
    },
  });
  return { source, requests };
}

test('daily reference keeps actual OHLCV and reported session date with a fixed GET source', async () => {
  const f = reader(payload('TSLA', [row(), row('10/07/2026')]));
  const result = await f.source.read('TSLA');
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.source, 'Nasdaq');
  assert.equal(result.sourceRange, '1Y');
  assert.equal(result.interval, 'day');
  assert.equal(result.timestampBasis, 'reported-session-date');
  assert.equal(result.fetchedAt, now);
  assert.equal(result.lastDataAt, Date.parse('2026-10-08T00:00:00Z') / 1000);
  assert.equal(result.referenceOnly, true);
  assert.deepEqual(result.candles.at(-1), {
    t: result.lastDataAt,
    o: 374.12,
    h: 375.96,
    l: 368.0301,
    c: 375,
    v: 28394950,
  });
  assert.equal(result.sourceUrl, 'https://www.nasdaq.com/market-activity/stocks/tsla/historical');
  assert.equal(
    f.requests[0]!.url,
    'https://api.nasdaq.com/api/quote/TSLA/historical?assetclass=stocks&limit=10000&fromdate=2025-10-09&todate=2026-10-09',
  );
  assert.equal(f.requests[0]!.init?.method, 'GET');
  assert.equal(f.requests[0]!.init?.redirect, 'error');
  assert.equal(f.requests[0]!.init?.credentials, 'omit');
  assert.deepEqual(Object.keys(f.requests[0]!.init!.headers!), ['Accept', 'User-Agent']);
});

test('range selections reuse one year of real points; 1D has one daily point and ALL declares one-year coverage', async () => {
  const f = reader(payload('AMZN', [row(), row('10/01/2026'), row('09/01/2026'), row('07/01/2026')]));
  const daily = await f.source.read('AMZN', '1D');
  assert.equal(daily.candles.length, 1);
  assert.equal(daily.interval, 'day');
  assert.equal((await f.source.read('AMZN', '1W')).candles.length, 1);
  assert.equal((await f.source.read('AMZN', '1M')).candles.length, 2);
  assert.equal((await f.source.read('AMZN', '3M')).candles.length, 3);
  const all = await f.source.read('AMZN', 'ALL');
  assert.equal(all.candles.length, 4);
  assert.equal(all.sourceRange, '1Y');
  assert.equal(f.requests.length, 1);
});

test('unknown symbol, URLs, symbol casing, and ranges are rejected before any network request', async () => {
  const f = reader();
  for (const symbol of ['IBM', 'tsla', 'https://localhost/', 'TSLA/../../orders']) {
    await assert.rejects(f.source.read(symbol as 'TSLA'), StockHistoryRequestError);
  }
  for (const range of ['1H', '1y', 'https://localhost/']) {
    await assert.rejects(f.source.read('TSLA', range as '1Y'), StockHistoryRequestError);
  }
  assert.equal(f.requests.length, 0);
});

test('source failure, empty data and malformed OHLCV return unavailable with no fabricated points', async () => {
  for (const raw of [
    payload('AMZN'),
    payload('TSLA', []),
    { status: { rCode: 500 }, data: null },
    payload('TSLA', [{ ...row(), high: '$370.00' }]),
    payload('TSLA', [{ ...row(), volume: '28,39,950' }]),
    payload('TSLA', [{ ...row(), open: '$3,74.12' }]),
    payload('TSLA', [{ ...row(), close: null }]),
    payload('TSLA', [row('02/30/2026')]),
    payload('TSLA', [row('10/10/2026')]),
    payload('TSLA', [row(), row()]),
  ]) {
    const result = await reader(raw).source.read('TSLA');
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.lastDataAt, null);
    assert.deepEqual(result.candles, []);
    assert.equal(result.referenceOnly, true);
  }
});

test('valid monetary thousands separators are parsed without accepting malformed grouping', async () => {
  const result = await reader(
    payload('TSLA', [{ ...row(), open: '$1,000.12', high: '$1,100.00', low: '$900.00', close: '$1,001.50' }]),
  ).source.read('TSLA');
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.candles[0]!.c, 1001.5);
});

test('singleflight spans ranges; successful references expire in five minutes and errors retry after thirty seconds', async () => {
  let clock = now,
    calls = 0,
    fail = false;
  const source = new StockReferenceHistory({
    now: () => clock,
    fetcher: async () => {
      calls++;
      await Promise.resolve();
      return new Response(JSON.stringify(payload()), { status: fail ? 503 : 200 });
    },
  });
  await Promise.all([source.read('TSLA'), source.read('TSLA', '1D'), source.read('TSLA', '1W')]);
  assert.equal(calls, 1);
  clock += 299;
  await source.read('TSLA');
  assert.equal(calls, 1);
  clock += 1;
  fail = true;
  assert.equal((await source.read('TSLA')).status, 'UNAVAILABLE');
  assert.equal(calls, 2);
  clock += 29;
  await source.read('TSLA');
  assert.equal(calls, 2);
  clock += 1;
  fail = false;
  assert.equal((await source.read('TSLA')).status, 'AVAILABLE');
  assert.equal(calls, 3);
});

test('oversize declared and streamed bodies and non-JSON responses do not become candle data', async () => {
  for (const response of [
    new Response('{}', { headers: { 'Content-Length': '2097153' } }),
    new Response(new Uint8Array(2_097_153)),
    new Response('<html>Data unavailable</html>'),
  ]) {
    const source = new StockReferenceHistory({ now: () => now, fetcher: async () => response });
    const result = await source.read('TSLA');
    assert.equal(result.status, 'UNAVAILABLE');
    assert.deepEqual(result.candles, []);
    assert.equal(result.lastDataAt, null);
  }
});

test('upstream reads abort within the three-second budget and do not return stale cached prices', async () => {
  const source = new StockReferenceHistory({
    now: () => now,
    fetcher: async (_url, init) => {
      await delay(10_000, undefined, { signal: init!.signal! });
      return new Response(JSON.stringify(payload()));
    },
  });
  const started = performance.now();
  const result = await source.read('TSLA');
  assert.equal(result.status, 'UNAVAILABLE');
  assert.deepEqual(result.candles, []);
  assert.ok(performance.now() - started < 4_000);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { StockReferenceQuotes } from '../apps/server/src/stock-reference/quotes.ts';
import { StockHistoryRequestError } from '../apps/server/src/stock-reference/history.ts';

const now = Date.parse('2026-10-09T12:25:45Z') / 1000;
// Offline parser fixture. The application always fetches its own provider response.
function payload(symbol = 'TSLA', quoteTime = 'Oct 9, 2026 8:25 AM ET', realtime = true) {
  return {
    status: { rCode: 200 },
    data: {
      symbol,
      assetClass: 'STOCKS',
      exchange: 'NASDAQ-GS',
      marketStatus: 'Pre-Market',
      primaryData: { lastSalePrice: '$380.10', lastTradeTimestamp: quoteTime, isRealTime: realtime },
    },
  };
}
function reader(raw: unknown = payload(), clock = now) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  return {
    requests,
    source: new StockReferenceQuotes({
      now: () => clock,
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify(raw));
      },
    }),
  };
}

test('reference quote preserves provider time, realtime flag and market status without using fetch time as trade time', async () => {
  const f = reader();
  const result = await f.source.read('TSLA');
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.price, 380.1);
  assert.equal(result.isRealtime, true);
  assert.equal(result.marketStatus, 'Pre-Market');
  assert.equal(result.quoteTime, 'Oct 9, 2026 8:25 AM ET');
  assert.equal(result.timestampPrecision, 'minute');
  assert.equal(result.lastDataAt, Date.parse('2026-10-09T12:25:00Z') / 1000);
  assert.equal(result.fetchedAt, now);
  assert.notEqual(result.lastDataAt, result.fetchedAt);
  assert.equal(result.referenceOnly, true);
  assert.equal(result.source, 'Nasdaq');
  assert.equal(result.sourceUrl, 'https://www.nasdaq.com/market-activity/stocks/tsla');
  assert.equal(f.requests[0]!.url, 'https://api.nasdaq.com/api/quote/TSLA/info?assetclass=stocks');
  assert.equal(f.requests[0]!.init?.method, 'GET');
  assert.equal(f.requests[0]!.init?.redirect, 'error');
  assert.equal(f.requests[0]!.init?.credentials, 'omit');
  assert.deepEqual(Object.keys(f.requests[0]!.init!.headers!), ['Accept', 'User-Agent']);
});

test('New York quote timestamp resolves winter and summer offsets and keeps delayed or closed flags unchanged', async () => {
  for (const [quoteTime, at] of [
    ['Jan 20, 2026 9:30 AM ET', '2026-01-20T14:30:00Z'],
    ['Oct 9, 2026 8:25 AM ET', '2026-10-09T12:25:00Z'],
    ['Closed at Oct 8, 2026 4:00 PM ET', '2026-10-08T20:00:00Z'],
  ]) {
    const timestamp = Date.parse(at!) / 1000;
    const result = await reader(payload('AMZN', quoteTime!, false), timestamp + 45).source.read('AMZN');
    assert.equal(result.status, 'AVAILABLE');
    assert.equal(result.lastDataAt, timestamp);
    assert.equal(result.isRealtime, false);
    assert.equal(result.quoteTime, quoteTime);
  }
});

test('ambiguous, nonexistent, malformed and future provider timestamps fail without replacing their time', async () => {
  for (const quoteTime of [
    'Mar 8, 2026 2:30 AM ET',
    'Nov 1, 2026 1:30 AM ET',
    'Feb 30, 2026 9:30 AM ET',
    'Oct 9, 2026 8:30 AM ET',
    'Oct 9, 2026 8:25 AM',
    'Just now',
  ]) {
    const result = await reader(payload('TSLA', quoteTime)).source.read('TSLA');
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.price, null);
    assert.equal(result.lastDataAt, null);
    assert.equal(result.isRealtime, null);
  }
});

test('symbol allowlist and response symbol, price, realtime type and size are validated', async () => {
  const f = reader();
  await assert.rejects(f.source.read('https://localhost' as 'TSLA'), StockHistoryRequestError);
  assert.equal(f.requests.length, 0);
  for (const raw of [
    payload('AMZN'),
    { status: { rCode: 503 }, data: null },
    {
      ...payload(),
      data: { ...payload().data, primaryData: { ...payload().data.primaryData, isRealTime: 'true' } },
    },
    {
      ...payload(),
      data: { ...payload().data, primaryData: { ...payload().data.primaryData, lastSalePrice: '$3,80.10' } },
    },
  ]) {
    const result = await reader(raw).source.read('TSLA');
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.price, null);
    assert.equal(result.lastDataAt, null);
  }
  for (const response of [
    new Response(new Uint8Array(262_145)),
    new Response('{}', { headers: { 'Content-Length': '262145' } }),
    new Response('{}', { status: 302 }),
  ]) {
    const source = new StockReferenceQuotes({ now: () => now, fetcher: async () => response });
    assert.equal((await source.read('TSLA')).status, 'UNAVAILABLE');
  }
});

test('quotes coalesce concurrent reads and refresh successful and failed results after ten seconds', async () => {
  let clock = now,
    calls = 0,
    fail = false;
  const source = new StockReferenceQuotes({
    now: () => clock,
    fetcher: async () => {
      calls++;
      await Promise.resolve();
      return new Response(JSON.stringify(payload()), { status: fail ? 503 : 200 });
    },
  });
  await Promise.all([source.read('TSLA'), source.read('TSLA')]);
  assert.equal(calls, 1);
  clock += 9;
  await source.read('TSLA');
  assert.equal(calls, 1);
  clock += 1;
  fail = true;
  assert.equal((await source.read('TSLA')).status, 'UNAVAILABLE');
  assert.equal(calls, 2);
  clock += 10;
  fail = false;
  assert.equal((await source.read('TSLA')).status, 'AVAILABLE');
  assert.equal(calls, 3);
});

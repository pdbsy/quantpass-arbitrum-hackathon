import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { installStockHistory, type StockHistoryHost } from '../apps/web/src/stock-history.ts';

const firstQuoteAt = Date.parse('2026-10-09T12:25:00Z') / 1000;
const dailyAt = Date.parse('2026-10-08T00:00:00Z') / 1000;
async function harness(t: TestContext) {
  const timers = new Map<number, { callback: () => void; period: number }>();
  const browser = Object.assign(new EventTarget(), {
    setInterval(callback: () => void, period: number) {
      const id = timers.size + 1;
      timers.set(id, { callback, period });
      return id;
    },
    clearInterval(id: number) {
      timers.delete(id);
    },
  });
  const page = Object.assign(new EventTarget(), { hidden: false });
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page });
  const state = {
    clock: firstQuoteAt + 45,
    at: firstQuoteAt,
    price: 380.1,
    quoteTime: 'Oct 9, 2026 8:25 AM ET',
    fail: false,
    malformed: false,
    hold: false,
  };
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const releases: (() => void)[] = [];
  t.mock.method(Date, 'now', () => state.clock * 1000);
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const symbol = url.includes('symbol=TSLA') ? 'TSLA' : 'AMZN';
    const history = url.includes('/candles?');
    if (!history && state.hold) await new Promise<void>((resolve) => releases.push(resolve));
    if (!history && state.fail) return new Response('{}', { status: 503 });
    const common = {
      symbol,
      source: 'Nasdaq',
      sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}${history ? '/historical' : ''}`,
      status: 'AVAILABLE',
      referenceOnly: true,
      currency: 'USD',
      fetchedAt: state.clock,
    };
    return Response.json(
      history
        ? {
            ...common,
            lastDataAt: dailyAt,
            range: '1Y',
            sourceRange: '1Y',
            interval: 'day',
            timestampBasis: 'reported-session-date',
            candles: [{ t: dailyAt, o: 374.12, h: 375.96, l: 368.0301, c: 375, v: 28394950 }],
          }
        : {
            ...common,
            lastDataAt: state.malformed ? state.clock : state.at,
            price: state.price,
            quoteTime: state.quoteTime,
            isRealtime: true,
            marketStatus: 'Pre-Market',
            timestampPrecision: 'minute',
          },
    );
  });
  let renders = 0;
  const host: StockHistoryHost = {
    app: {
      render: () => {
        renders++;
      },
    },
  };
  const dispose = installStockHistory(host);
  t.after(() => {
    dispose();
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  await setImmediate();
  return {
    host,
    state,
    requests,
    timers,
    browser,
    page,
    releases,
    renders: () => renders,
    async poll(period: number) {
      for (const timer of timers.values()) if (timer.period === period) timer.callback();
      await setImmediate();
    },
  };
}

test('fifteen-second GET polling adds actual quote-time points and replaces the same minute without inventing OHLC', async (t) => {
  const h = await harness(t),
    stock = h.host.stockHistory!;
  assert.deepEqual(
    [...h.timers.values()].map((timer) => timer.period),
    [15000, 300000],
  );
  assert.deepEqual(stock.points('TSLA', 'ALL'), [
    { t: dailyAt, price: 375, kind: 'daily' },
    { t: firstQuoteAt, price: 380.1, kind: 'quote' },
  ]);
  h.state.clock += 15;
  h.state.at += 60;
  h.state.quoteTime = 'Oct 9, 2026 8:26 AM ET';
  h.state.price = 381;
  await h.poll(15000);
  assert.deepEqual(stock.points('TSLA', '1D')!.at(-1), { t: firstQuoteAt + 60, price: 381, kind: 'quote' });
  h.state.clock += 15;
  h.state.price = 382;
  await h.poll(15000);
  assert.equal(stock.points('TSLA', 'ALL')!.length, 3);
  assert.deepEqual(stock.points('TSLA', 'ALL')!.at(-1), { t: firstQuoteAt + 60, price: 382, kind: 'quote' });
  assert.notEqual(stock.points('TSLA', 'ALL')!.at(-1)!.t, stock.quote('TSLA')!.fetchedAt);
  assert.equal(stock.candles('TSLA', 'ALL')!.length, 1);
  assert.equal(h.requests.filter((request) => request.url.includes('/candles?')).length, 2);
  await h.poll(300000);
  assert.equal(h.requests.filter((request) => request.url.includes('/candles?')).length, 4);
  for (const request of h.requests) {
    assert.equal(request.init?.method, 'GET');
    assert.equal(request.init?.credentials, 'same-origin');
    assert.equal(request.init?.redirect, 'error');
    assert.match(
      request.url,
      /^\/api\/stock-reference\/(?:quote|candles)\?symbol=(?:TSLA|AMZN)(?:&range=1Y)?$/,
    );
  }
});

test('failed or malformed quotes remain visibly unavailable while keeping last-good prices and their source time', async (t) => {
  const h = await harness(t),
    stock = h.host.stockHistory!;
  const points = stock.points('TSLA', 'ALL');
  h.state.clock += 15;
  h.state.fail = true;
  await h.poll(15000);
  assert.equal(stock.quote('TSLA')!.status, 'UNAVAILABLE');
  assert.equal(stock.quote('TSLA')!.price, null);
  assert.equal(stock.quote('TSLA')!.lastDataAt, null);
  assert.equal(stock.quote('TSLA')!.lastGood!.price, 380.1);
  assert.equal(stock.quote('TSLA')!.lastGood!.lastDataAt, firstQuoteAt);
  assert.deepEqual(stock.points('TSLA', 'ALL'), points);
  h.state.clock += 15;
  h.state.fail = false;
  h.state.malformed = true;
  await h.poll(15000);
  assert.equal(stock.quote('TSLA')!.status, 'UNAVAILABLE');
  assert.equal(stock.quote('TSLA')!.reason, 'INVALID_SOURCE_DATA');
  assert.deepEqual(stock.points('TSLA', 'ALL'), points);
  assert.equal(stock.quote('TSLA')!.lastGood!.quoteTime, 'Oct 9, 2026 8:25 AM ET');
});

test('hidden tabs pause reads and pagehide cancels pending requests without accepting late data or starting other actions', async (t) => {
  const h = await harness(t),
    stock = h.host.stockHistory!;
  h.page.hidden = true;
  const initialCount = h.requests.length;
  await h.poll(15000);
  await h.poll(300000);
  assert.equal(h.requests.length, initialCount);
  h.page.hidden = false;
  h.page.dispatchEvent(new Event('visibilitychange'));
  await setImmediate();
  assert.equal(h.requests.length, initialCount + 4);
  h.state.hold = true;
  await h.poll(15000);
  const pendingCount = h.requests.length,
    points = stock.points('TSLA', 'ALL'),
    renders = h.renders();
  await h.poll(15000);
  assert.equal(h.requests.length, pendingCount);
  h.browser.dispatchEvent(new Event('pagehide'));
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.at(-1)!.init!.signal!.aborted, true);
  h.state.price = 999;
  for (const release of h.releases) release();
  await setImmediate();
  assert.deepEqual(stock.points('TSLA', 'ALL'), points);
  assert.equal(h.renders(), renders);
  h.page.dispatchEvent(new Event('visibilitychange'));
  await h.poll(15000);
  assert.equal(h.requests.length, pendingCount);
});

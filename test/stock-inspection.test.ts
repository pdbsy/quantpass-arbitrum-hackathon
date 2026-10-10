import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeStockInspectionRender,
  stockInspectionDetails,
  stockInspectionIndex,
} from '../apps/web/src/stock-inspection.ts';
import type { StockQuoteInfo, StockReferencePoint } from '../apps/web/src/stock-history.ts';

const dailyAt = Date.parse('2026-10-08T00:00:00Z') / 1000,
  quoteAt = Date.parse('2026-10-09T12:25:00Z') / 1000;
const quote: StockQuoteInfo = {
  symbol: 'TSLA',
  status: 'AVAILABLE',
  source: 'Nasdaq',
  sourceUrl: 'https://www.nasdaq.com/market-activity/stocks/tsla',
  referenceOnly: true,
  currency: 'USD',
  timestampPrecision: 'minute',
  fetchedAt: quoteAt + 45,
  lastDataAt: quoteAt,
  price: 103,
  quoteTime: 'Oct 9, 2026 8:25 AM ET',
  isRealtime: true,
  marketStatus: 'Pre-Market',
  lastGood: null,
};
function values(details: ReturnType<typeof stockInspectionDetails>) {
  assert.ok(details);
  return Object.fromEntries(details.fields.map((field) => [field.key, field.value]));
}

test('daily stock inspection shows matching real OHLCV, session date and change from the first visible stock point', () => {
  const points: readonly StockReferencePoint[] = [
    { t: dailyAt - 86400, price: 90, kind: 'daily' },
    { t: dailyAt, price: 100, kind: 'daily' },
  ];
  const candle = { t: dailyAt, o: 99, h: 102, l: 98.0301, c: 100, v: 123456 };
  const details = stockInspectionDetails('tsla', points, 1, [candle]);
  assert.equal(details!.kind, 'Daily session');
  assert.deepEqual(values(details), {
    price: '100.00 USD',
    change: '+10.00 USD',
    changePercent: '+11.11%',
    time: '2026-10-08',
    open: '99.00 USD',
    high: '102.00 USD',
    low: '98.0301 USD',
    close: '100.00 USD',
    volume: '123,456 shares',
    source: 'Nasdaq',
  });
  assert.doesNotMatch(values(details).time!, /00:00|UTC/);
  const unmatched = values(stockInspectionDetails('tsla', points, 1, [{ ...candle, t: dailyAt - 86400 }]));
  assert.equal(unmatched.open, undefined);
  assert.equal(unmatched.volume, undefined);
});

test('quotes expose only matching source metadata, never invent OHLCV, and use updated same-minute prices', () => {
  const points: readonly StockReferencePoint[] = [
    { t: dailyAt, price: 100, kind: 'daily' },
    { t: quoteAt - 60, price: 102, kind: 'quote' },
    { t: quoteAt, price: 103, kind: 'quote' },
  ];
  const current = values(stockInspectionDetails('TSLA', points, 2, [], null, quote, quoteAt + 90));
  assert.equal(current.time, quote.quoteTime);
  assert.equal(current.marketStatus, 'Pre-Market');
  assert.equal(current.isRealtime, 'Real-time · provider flag');
  assert.equal(current.sourceAge, '~1 min 30 s');
  for (const key of ['open', 'high', 'low', 'close', 'volume']) assert.equal(current[key], undefined);
  const old = stockInspectionDetails('TSLA', points, 1, [], null, quote, quoteAt + 90);
  assert.equal(old!.kind, 'Historical quote point');
  assert.equal(values(old).time, '2026-10-09 12:24 UTC');
  assert.equal(values(old).marketStatus, undefined);
  assert.equal(values(old).isRealtime, undefined);
  const updated = points.map((point) => (point.t === quoteAt ? { ...point, price: 104 } : point));
  const newest = values(
    stockInspectionDetails(
      'TSLA',
      updated,
      2,
      [],
      null,
      { ...quote, price: 104, fetchedAt: quoteAt + 95 },
      quoteAt + 95,
    ),
  );
  assert.equal(newest.price, '104.00 USD');
  assert.equal(newest.changePercent, '+4.00%');
  assert.equal(newest.time, quote.quoteTime);
  assert.doesNotMatch(newest.time!, /12:26|8:26/);
  const cached = stockInspectionDetails('TSLA', points, 2, [], null, {
    ...quote,
    status: 'UNAVAILABLE',
    price: null,
    lastDataAt: null,
    quoteTime: null,
    isRealtime: null,
    marketStatus: null,
    fetchedAt: quoteAt + 120,
    lastGood: quote,
  });
  assert.equal(values(cached).time, quote.quoteTime);
  assert.equal(cached!.kind, 'Cached source quote');
  assert.match(cached!.note, /update unavailable.*cached point/i);
});

test('return-line inspection selects actual endpoints and nearest points, rejecting axes and invalid selections', () => {
  for (const count of [1, 2, 24, 56]) {
    for (let i = 0; i < count; i++) {
      const x = 16 + (count === 1 ? 0.5 : i / (count - 1)) * 802;
      assert.equal(stockInspectionIndex(x, count, 16, 818), i);
    }
    assert.equal(stockInspectionIndex(15, count, 16, 818), null);
    assert.equal(stockInspectionIndex(819, count, 16, 818), null);
  }
  assert.equal(stockInspectionIndex(NaN, 24, 16, 818), null);
  assert.equal(stockInspectionIndex(100, 0, 16, 818), null);
  assert.equal(stockInspectionDetails('TSLA', [], 0), null);
});

test('unrelated product renders refresh active stock inspection after rendering and preserve later installers on disposal', () => {
  let selected = false,
    revision = 0;
  const inspections: number[] = [];
  const app = {
    render(options?: { preserve?: boolean }) {
      assert.equal(this, app);
      assert.equal(options?.preserve, true);
      revision++;
    },
  };
  const original = app.render;
  const restore = observeStockInspectionRender(
    app,
    () => selected,
    () => inspections.push(revision),
  );
  app.render({ preserve: true });
  assert.equal(inspections.length, 0);
  selected = true;
  app.render({ preserve: true });
  assert.deepEqual(inspections, [2], 'inspection must observe the freshly rendered product');
  restore();
  assert.equal(app.render, original);
  app.render({ preserve: true });
  assert.deepEqual(inspections, [2]);
  const restoreAgain = observeStockInspectionRender(
    app,
    () => selected,
    () => inspections.push(revision),
  );
  const laterRender = () => {
    revision++;
  };
  app.render = laterRender;
  restoreAgain();
  assert.equal(app.render, laterRender, 'dispose cannot overwrite a subsequent installer');
});

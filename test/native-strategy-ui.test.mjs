import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const prototype = new URL('../apps/web/prototype/AlphaForge_v3_EN.html', import.meta.url);

// Run the real page factories without booting the browser controllers. A small
// DOM boundary is enough for the native SVG readout; no financial data is mocked
// by the page itself in this fixture.
function nativeUI({ saved = {}, stockHistory } = {}) {
  const html = readFileSync(prototype, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'prototype executable script is available');
  const pageBoundary = script.indexOf('AF.homeHtml =');
  assert.ok(pageBoundary > 0, 'native page factory boundary is available');
  const storage = new Map(Object.entries(saved));
  const elements = new Map();
  function node(id) {
    if (!elements.has(id)) {
      const attributes = new Map();
      const children = new Map();
      elements.set(id, {
        id,
        attributes,
        innerHTML: '',
        textContent: '',
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: (name) => attributes.get(name) ?? null,
        querySelector: (selector) => {
          if (!children.has(selector)) children.set(selector, node(id + '/' + selector));
          return children.get(selector);
        },
      });
    }
    return elements.get(id);
  }
  const AF = stockHistory ? { stockHistory } : {};
  runInNewContext(script.slice(0, pageBoundary), {
    AF,
    window: { AF, innerWidth: 1000 },
    document: {
      getElementById: node,
      querySelector: (selector) => (selector.startsWith('#') ? node(selector.slice(1)) : null),
      querySelectorAll: () => [],
    },
    structuredClone,
    crypto: { randomUUID },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  return { AF, node, storage };
}

test('native catalogue and trade factories expose only the two admitted stock strategies', () => {
  const { AF } = nativeUI();
  assert.deepEqual(
    Array.from(AF.strategies, (strategy) => strategy.id),
    ['tsla', 'amzn'],
  );
  const market = AF.pages.market();
  for (const id of ['tsla', 'amzn']) {
    assert.ok(market.includes('#/trade/' + id));
    assert.ok(AF.pages.trade(id).includes(AF.strategy(id).name));
  }
  for (const id of ['trend', 'factor', 'mean', 'rotate', 'breakout', 'pairs']) {
    assert.equal(AF.strategy(id), undefined);
    assert.ok(!market.includes('#/trade/' + id));
  }
});

test('old local balances cannot become funds and every local financial entry point refuses mutation', () => {
  const legacyIds = ['trend', 'factor', 'mean', 'rotate', 'breakout', 'pairs'];
  const legacyAllocations = () => Object.fromEntries(legacyIds.map((id) => [id, 0]));
  const historical = {
    version: 2,
    revision: 8,
    profile: { name: 'Saved researcher', bio: 'My original notes' },
    favorites: [],
    likes: [],
    bookmarks: [],
    samplePass: false,
    passes: { trend: { at: 'Initial demo sample', quota: 100000 } },
    idle: 999999,
    allocated: legacyAllocations(),
    pending: [],
    netFunding: 999999,
    history: [],
    posts: [
      {
        id: 'local-kept',
        title: 'Keep this note',
        body: 'Original research remains available.',
        category: 'Research Notes',
        author: 'Saved researcher',
        date: '2026-10-01T00:00:00Z',
        replies: [],
      },
    ],
    comments: [],
    draft: { title: '', body: '', category: 'Research Notes' },
    lastStrategy: 'trend',
  };
  const legacyExchange = {
    version: 1,
    revision: 8,
    cash: 999999,
    initialCapital: 999999,
    realized: 0,
    fees: 0,
    positions: Object.fromEntries(legacyIds.map((id) => [id, { qty: 0, cost: 0 }])),
    allocations: legacyAllocations(),
    fundingHistory: [],
    funding: {
      asset: 'USDC',
      cash: 10000000000,
      initialCapital: 10000000000,
      allocations: legacyAllocations(),
      history: [],
    },
    orders: [],
    executed: [],
  };
  const { AF, storage } = nativeUI({
    saved: {
      'alphaforge.prototype.v3': JSON.stringify(historical),
      'alphaforge.passmarket.v3': JSON.stringify(legacyExchange),
    },
  });
  const state = AF.store.read();
  assert.equal(state.profile.name, historical.profile.name);
  assert.equal(state.posts[0].body, historical.posts[0].body);
  const exchange = AF.exchange.read();
  assert.equal(exchange.cash, 0);
  assert.equal(exchange.funding.cash, 0);
  assert.ok(Object.values(exchange.positions).every((position) => position.qty === 0 && position.cost === 0));
  for (const type of [
    'claim',
    'allocate',
    'release',
    'deposit',
    'withdraw',
    'confirmWithdrawal',
    'cancelWithdrawal',
  ]) {
    assert.throws(
      () => AF.store.dispatch({ type, strategy: 'tsla', amount: 100, id: 'old' }),
      /ONCHAIN_TRANSACTION_REQUIRED/,
    );
  }
  for (const entry of [
    'quote',
    'review',
    'execute',
    'reviewFunding',
    'executeFunding',
    'ensureMockHoldings',
  ]) {
    assert.throws(
      () => AF.exchange[entry]({ strategy: 'tsla', side: 'buy', qty: 1, amount: 100 }),
      /ONCHAIN_TRANSACTION_REQUIRED/,
    );
  }
  assert.deepEqual(AF.store.read(), state);
  assert.deepEqual(AF.exchange.read(), exchange);
  assert.equal(storage.get('alphaforge.passmarket.v3'), JSON.stringify(legacyExchange));
  assert.equal(storage.get('alphaforge.prototype.v3'), JSON.stringify(historical));
  const actionPanel = AF.trade.actionPanel(AF.strategy('tsla'));
  assert.match(actionPanel, /<button\b[^>]*disabled/);
  assert.match(actionPanel, /—/, 'an unconnected wallet balance remains unavailable');
  const funds = AF.pages.account('funds');
  assert.doesNotMatch(funds, /9,?999\.99/, 'historical local funds cannot appear as a wallet balance');
  for (const action of ['deposit', 'withdraw']) {
    const button = funds.match(new RegExp('<button\\b[^>]*data-cash="' + action + '"[^>]*>'))?.[0];
    assert.ok(button, 'the existing ' + action + ' button is retained');
    assert.match(button, /\bdisabled\b/);
  }
  AF.store.dispatch({ type: 'favorite', strategy: 'tsla' });
  assert.ok(AF.store.read().favorites.includes('tsla'));
  assert.equal(AF.store.read().posts[0].body, historical.posts[0].body);
});

test('a PASS without trades remains an AF-USDC reference and has no invented candles', () => {
  const { AF } = nativeUI();
  for (const id of ['tsla', 'amzn']) {
    const metric = AF.marketData.metrics(id);
    assert.equal(Number(AF.marketData.fmt(metric.price).replaceAll(',', '')), 0.5);
    for (const range of ['24h', '7d', '30d', '90d']) {
      assert.equal(AF.marketData.candles(id, range).length, 0);
    }
    const chart = AF.charts.priceBlock(AF.strategy(id));
    assert.match(chart, /AF-USDC/);
    assert.match(chart, /0\.50?/);
    const readout = chart.match(/id="price-readout"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(readout, 'the original chart readout container is retained');
    assert.doesNotMatch(readout, /\b[OHLC]\s+[\d.,]+/, 'no synthetic OHLC figures are supplied');
    assert.doesNotMatch(chart, /<tbody>\s*<tr>/, 'no trade rows are invented');
    assert.ok(!chart.includes('data-v3-chart="price"'), 'the reference does not bind trade hover');
    assert.doesNotMatch(chart, /NaN|Infinity/);
  }
});

test('the native stock graph reads provider candles in seconds and derives change from actual closes', () => {
  const first = Date.parse('2026-10-01T00:00:00Z') / 1000;
  const candles = [
    { t: first, o: 95, h: 101, l: 93, c: 100, v: 10 },
    { t: first + 86400, o: 100, h: 111, l: 97, c: 108, v: 20 },
    { t: first + 172800, o: 108, h: 125, l: 107, c: 120, v: 30 },
  ];
  const calls = [];
  const { AF, node } = nativeUI({
    stockHistory: {
      candles: (id, range) => {
        calls.push({ id, range });
        return candles;
      },
    },
  });
  AF.view.returnRange = '30d';
  for (const id of ['tsla', 'amzn']) {
    const rows = AF.marketData.returns(id, '30d');
    assert.equal(rows.length, 3);
    assert.equal(rows[0].time, first * 1000);
    assert.equal(rows.at(-1).time, (first + 172800) * 1000);
    assert.equal(rows[0].value, 0);
    assert.ok(Math.abs(rows.at(-1).value - 20) < 0.000001);
    assert.equal(rows.at(-1).close, 120);
    assert.ok(
      rows.every((row) => row.benchmark === undefined),
      'a benchmark requires its own price source',
    );
    const chart = AF.charts.returnBlock(AF.strategy(id));
    assert.match(chart, /20\.00|20\.0/);
    assert.doesNotMatch(chart, /NaN|Infinity/);
    AF.charts.hover({ dataset: { v3Chart: 'returns', strategy: id } }, 2);
    const readout = node('returns-readout').textContent;
    assert.match(readout, /120(?:\.00)?/);
    assert.match(readout, /USD|\$/);
    assert.match(readout, /10[/-]03|Oct 03|Oct 3/);
    assert.ok(calls.some((call) => call.id === id && call.range === '30d'));
  }
});

test('stock quote points take priority over candle closes and never become invented OHLC', () => {
  const first = Date.parse('2026-10-01T00:00:00Z') / 1000;
  let points = [
    { t: first, price: 200, kind: 'daily' },
    { t: first + 86400, price: 250, kind: 'quote' },
  ];
  const pointCalls = [];
  let candleCalls = 0;
  const { AF, node } = nativeUI({
    stockHistory: {
      points: (id, range) => {
        pointCalls.push({ id, range });
        return points;
      },
      candles: () => {
        candleCalls++;
        return [
          { t: first, o: 95, h: 101, l: 93, c: 100, v: 10 },
          { t: first + 86400, o: 100, h: 121, l: 97, c: 120, v: 20 },
        ];
      },
    },
  });
  AF.view.returnRange = '30d';
  let rows = AF.marketData.returns('tsla', '30d');
  assert.deepEqual(pointCalls, [{ id: 'tsla', range: '30d' }]);
  assert.equal(candleCalls, 0);
  assert.equal(rows.at(-1).close, 250);
  assert.equal(rows.at(-1).kind, 'quote');
  assert.equal(rows.at(-1).value, 25);
  points = [{ t: first + 86400, price: 250, kind: 'quote' }];
  rows = AF.marketData.returns('tsla', '30d');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'quote');
  assert.equal(rows[0].close, 250);
  const chart = AF.charts.returnBlock(AF.strategy('tsla'));
  assert.doesNotMatch(chart, /NaN|Infinity|\b[OHLC]\s+[\d.,]+|class="chart-(?:up|down)"/);
  AF.charts.hover({ dataset: { v3Chart: 'returns', strategy: 'tsla' } }, 0);
  assert.match(node('returns-readout').textContent, /250(?:\.00)?/);
  assert.doesNotMatch(node('returns-readout').textContent, /\b[OHLC]\s+[\d.,]+/);
  assert.equal(candleCalls, 0);
  for (const missing of [null, []]) {
    points = missing;
    rows = AF.marketData.returns('tsla', '30d');
    assert.equal(rows.at(-1).close, 120);
  }
  assert.equal(candleCalls, 2);
});

test('missing or unavailable stock history leaves an honest empty native chart', () => {
  for (const stockHistory of [
    undefined,
    { candles: () => [] },
    {
      candles: () => {
        throw Error('history unavailable');
      },
    },
  ]) {
    const { AF } = nativeUI({ stockHistory });
    AF.view.returnRange = '30d';
    assert.equal(AF.marketData.returns('tsla', '30d').length, 0);
    const chart = AF.charts.returnBlock(AF.strategy('tsla'));
    assert.doesNotMatch(chart, /NaN|Infinity/);
    assert.ok(!chart.includes('data-v3-chart="returns"'), 'missing prices cannot produce a stock curve');
  }
});

test('a single real stock candle renders safely and unusable OHLC data stays unavailable', () => {
  const candle = { t: 1790812800, o: 95, h: 101, l: 93, c: 100, v: 10 };
  const single = nativeUI({ stockHistory: { candles: () => [candle] } }).AF;
  single.view.returnRange = '30d';
  assert.equal(single.marketData.returns('tsla', '30d').length, 1);
  assert.doesNotMatch(single.charts.returnBlock(single.strategy('tsla')), /NaN|Infinity/);
  for (const invalid of [
    { ...candle, h: 99 },
    { ...candle, v: -1 },
    { ...candle, t: Number.MAX_SAFE_INTEGER },
  ]) {
    const { AF } = nativeUI({ stockHistory: { candles: () => [invalid] } });
    assert.equal(AF.marketData.returns('tsla', '30d').length, 0);
    assert.doesNotMatch(AF.charts.returnBlock(AF.strategy('tsla')), /NaN|Infinity/);
  }
});

test('stock source information uses declared freshness, source time and session-date precision', () => {
  const session = Date.parse('2026-10-08T00:00:00Z') / 1000;
  const quoted = Date.parse('2026-10-09T13:30:42Z') / 1000;
  const base = {
    status: 'AVAILABLE',
    symbol: 'TSLA',
    price: 250,
    isRealtime: true,
    marketStatus: 'Closed',
    quoteTime: 'Oct 9, 2026 9:30 AM ET',
    lastDataAt: quoted,
    fetchedAt: quoted + 60,
    referenceOnly: true,
    timestampPrecision: 'minute',
    source: 'Nasdaq',
    sourceUrl: 'https://www.nasdaq.com/market-activity/stocks/tsla',
  };
  let quote = base;
  let points = [
    { t: session, price: 200, kind: 'daily' },
    { t: quoted, price: 250, kind: 'quote' },
  ];
  const { AF, node } = nativeUI({
    stockHistory: {
      points: () => points,
      quote: () => quote,
      info: () => ({ source: 'Nasdaq', status: 'AVAILABLE', timestampBasis: 'reported-session-date' }),
    },
  });
  const render = () => AF.charts.returnBlock(AF.strategy('tsla'));
  assert.match(render(), /Live reference/);
  assert.match(render(), /Market: Closed/);
  assert.match(render(), /Source quote: Oct 9, 2026 9:30 AM ET/);
  assert.doesNotMatch(render(), /\d+\s*(?:minute|minutes|second|seconds)\s*(?:delay|delayed|late)/i);
  quote = { ...base, isRealtime: false };
  assert.match(render(), /Delayed reference/);
  assert.doesNotMatch(render(), /Live reference/);
  quote = { ...base, isRealtime: null, quoteTime: null };
  assert.match(render(), /Source quote: 2026-10-09 13:30 UTC/);
  assert.doesNotMatch(render(), /Live reference|Delayed reference|13:30:42/);
  quote = { ...base, status: 'UNAVAILABLE', price: null, quoteTime: null, lastDataAt: null, lastGood: base };
  assert.match(render(), /Update unavailable/);
  assert.match(render(), /Cached last successful quote/);
  assert.match(render(), /Oct 9, 2026 9:30 AM ET/);
  assert.doesNotMatch(render(), /Live reference|Delayed reference/);
  quote = null;
  points = [{ t: session, price: 200, kind: 'daily' }];
  assert.match(render(), /Daily session date: 2026-10-08/);
  assert.doesNotMatch(render(), /2026-10-08[ T]00:00|Latest source quote/);
  AF.charts.hover({ dataset: { v3Chart: 'returns', strategy: 'tsla' } }, 0);
  assert.match(node('returns-readout').textContent, /2026-10-08 session date/);
  assert.doesNotMatch(node('returns-readout').textContent, /00:00|UTC/);
});

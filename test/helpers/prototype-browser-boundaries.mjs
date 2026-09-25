/* global window, document */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyRuntimePortJourneys } from './product-runtime-boundaries.mjs';
import { verifyPrototypeReceiptRecovery } from './prototype-receipt-recovery.mjs';
import { verifyLegacyApiJourneys, verifyRecoveryJourneys } from './product-recovery-journeys.mjs';

// Exercise the actual loaded browser model. All values are fictional ETH fixtures;
// these checks are separate from visible journeys and never certify chain accounting.
export async function verifyPrototypeBoundaries(page, { v1Supported = true, unsupportedChecks = [] } = {}) {
  assert.equal(typeof v1Supported, 'boolean');
  assert.ok(Array.isArray(unsupportedChecks));
  const original = await page.evaluate(() => ({
    local: window.AF.store.read(),
    exchange: window.AF.exchange.read(),
  }));
  const cases = await page.evaluate(() => {
    const { store, exchange } = window.AF;
    const passed = [];
    function check(condition, label) {
      if (!condition) throw new Error(`Prototype boundary failed: ${label}`);
      passed.push(label);
    }
    function reject(label, operation, message) {
      const before = JSON.stringify({ local: store.read(), market: exchange.read() });
      let error;
      try {
        operation();
      } catch (caught) {
        error = caught;
      }
      check(error instanceof Error && error.message.includes(message), `${label}: explicit rejection`);
      check(
        JSON.stringify({ local: store.read(), market: exchange.read() }) === before,
        `${label}: no mutation`,
      );
    }
    store.reset();
    exchange.reset();
    const ledger = store.read();
    const malformedLedgers = [
      ['missing state', () => null, 'STATE_INVALID'],
      ['wrong schema', (s) => ({ ...s, version: 1 }), 'STATE_INVALID'],
      ['negative revision', (s) => ({ ...s, revision: -1 }), 'STATE_INVALID'],
      ['fractional revision', (s) => ({ ...s, revision: 0.5 }), 'STATE_INVALID'],
      ['negative idle', (s) => ({ ...s, idle: -1 }), 'LEDGER_INVALID'],
      ['excess funding', (s) => ({ ...s, netFunding: 100000001 }), 'LEDGER_INVALID'],
      ['missing pending list', (s) => ({ ...s, pending: null }), 'LEDGER_INVALID'],
      [
        'pending limit',
        (s) => ({ ...s, pending: Array(201).fill({ id: 'x', amount: 1 }) }),
        'LEDGER_INVALID',
      ],
      ['missing allocations', (s) => ({ ...s, allocated: null }), 'LEDGER_INVALID'],
      ['missing passes', (s) => ({ ...s, passes: null }), 'LEDGER_INVALID'],
      ['unsafe allocation', (s) => ({ ...s, allocated: { ...s.allocated, trend: NaN } }), 'LEDGER_INVALID'],
      [
        'allocation capacity',
        (s) => ({ ...s, allocated: { ...s.allocated, trend: 100001 } }),
        'LEDGER_INVALID',
      ],
      [
        'allocation without pass',
        (s) => ({ ...s, allocated: { ...s.allocated, factor: 1 } }),
        'LEDGER_INVALID',
      ],
      ['null pending', (s) => ({ ...s, pending: [null] }), 'LEDGER_INVALID'],
      ['negative pending', (s) => ({ ...s, pending: [{ id: 'x', amount: -1 }] }), 'LEDGER_INVALID'],
      ['zero pending', (s) => ({ ...s, pending: [{ id: 'x', amount: 0 }] }), 'LEDGER_INVALID'],
      ['nonstring pending ID', (s) => ({ ...s, pending: [{ id: 1, amount: 1 }] }), 'LEDGER_INVALID'],
      [
        'duplicate pending ID',
        (s) => ({
          ...s,
          idle: s.idle - 2,
          pending: [
            { id: 'x', amount: 1 },
            { id: 'x', amount: 1 },
          ],
        }),
        'BALANCE_MISMATCH',
      ],
      ['unbalanced ledger', (s) => ({ ...s, idle: s.idle - 1 }), 'BALANCE_MISMATCH'],
      [
        'unknown pass',
        (s) => ({ ...s, passes: { ...s.passes, unknown: { quota: 100000 } } }),
        'PASS_INVALID',
      ],
      ['invalid pass capacity', (s) => ({ ...s, passes: { trend: { quota: 1 } } }), 'PASS_INVALID'],
    ];
    for (const [label, change, message] of malformedLedgers)
      reject(label, () => store.validate(change(structuredClone(ledger))), message);
    for (const input of ['0', '00.10', '1.001', '1e3', '-1', '1000000', 'Infinity'])
      reject(`money input ${input}`, () => store.parseMoney(input), 'Enter a valid amount');
    check(
      store.parseMoney(' 12.3 ') === 1230 && store.parseMoney('0.01') === 1,
      'decimal money converts exactly',
    );
    for (const amount of [0, -1, 1.5, 100000001])
      reject(`deposit amount ${amount}`, () => store.dispatch({ type: 'deposit', amount }), 'valid amount');
    for (const [label, action, message] of [
      ['unknown strategy', { type: 'claim', strategy: 'unknown' }, 'Strategy not found'],
      ['unknown action', { type: 'arbitrary' }, 'Unsupported local action'],
      ['pass required', { type: 'allocate', strategy: 'factor', amount: 1 }, 'Claim the demo Pass'],
      ['idle required', { type: 'allocate', strategy: 'trend', amount: 1000001 }, 'Insufficient idle'],
      ['capacity required', { type: 'allocate', strategy: 'trend', amount: 100001 }, 'allocation limit'],
      ['release unallocated', { type: 'release', strategy: 'trend', amount: 1 }, 'exceeds the allocation'],
      ['deposit cap', { type: 'deposit', amount: 100000000 }, 'balance limit'],
      ['withdraw cap', { type: 'withdraw', amount: 1000001 }, 'Only idle funds'],
      ['unknown withdrawal', { type: 'confirmWithdrawal', id: 'missing' }, 'has been processed'],
      ['short note', { type: 'post', title: 'x', body: 'y', category: 'Research Notes' }, 'at least 4'],
      [
        'invalid note section',
        { type: 'post', title: 'Note', body: 'A useful research note body.', category: 'All' },
        'Choose a section',
      ],
      ['short comment', { type: 'comment', post: 'missing', body: 'x' }, 'at least 2'],
      ['missing note', { type: 'comment', post: 'missing', body: 'valid reply' }, 'Note not found'],
    ])
      reject(label, () => store.dispatch(action), message);
    const claimed = store.read();
    store.dispatch({ type: 'claim', strategy: 'trend' });
    check(
      JSON.stringify(store.read()) === JSON.stringify(claimed),
      'reclaim is idempotent including revision',
    );
    store.dispatch({ type: 'withdraw', amount: 123 });
    const withdrawal = store.read().pending[0];
    store.dispatch({ type: 'confirmWithdrawal', id: withdrawal.id });
    check(
      store.read().idle === 999877 && store.read().netFunding === 999877 && store.read().pending.length === 0,
      'withdrawal confirmation debits funding once',
    );
    reject(
      'withdrawal replay',
      () => store.dispatch({ type: 'confirmWithdrawal', id: withdrawal.id }),
      'has been processed',
    );
    store.dispatch({ type: 'profile', name: '   ', bio: 42 });
    check(
      store.read().profile.name === 'Workshop Guest' && store.read().profile.bio === '',
      'profile input has bounded fallback',
    );
    store.dispatch({ type: 'draft', title: 42, body: null, category: 'invalid' });
    check(
      store.read().draft.category === 'Research Notes' && store.read().draft.title === '',
      'invalid draft values normalize safely',
    );
    const beforeStale = store.read();
    const newer = {
      ...beforeStale,
      revision: beforeStale.revision + 1,
      idle: beforeStale.idle + 10,
      netFunding: beforeStale.netFunding + 10,
    };
    localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(newer));
    let staleError;
    try {
      store.dispatch({ type: 'deposit', amount: 200, expectedRevision: beforeStale.revision });
    } catch (error) {
      staleError = error;
    }
    check(
      staleError?.message.includes('Records have changed') &&
        JSON.stringify(store.read()) === JSON.stringify(newer),
      'newer persisted revision prevents a stale write',
    );

    const market = exchange.read();
    const malformedMarkets = [
      ['missing market', () => null, 'corrupted'],
      ['market schema', (s) => ({ ...s, version: 2 }), 'corrupted'],
      ['market revision', (s) => ({ ...s, revision: -1 }), 'corrupted'],
      ['market cash', (s) => ({ ...s, cash: -1 }), 'corrupted'],
      ['market cash cap', (s) => ({ ...s, cash: 100000001 }), 'corrupted'],
      ['market capital', (s) => ({ ...s, initialCapital: -1 }), 'corrupted'],
      ['market realized', (s) => ({ ...s, realized: 0.5 }), 'corrupted'],
      ['market fees', (s) => ({ ...s, fees: -1 }), 'corrupted'],
      ['market positions', (s) => ({ ...s, positions: null }), 'corrupted'],
      ['market orders', (s) => ({ ...s, orders: null }), 'corrupted'],
      ['market executed', (s) => ({ ...s, executed: null }), 'corrupted'],
      ['market order limit', (s) => ({ ...s, orders: Array(301).fill(null) }), 'corrupted'],
      ['market execution limit', (s) => ({ ...s, executed: Array(301).fill('x') }), 'corrupted'],
      ['missing position', (s) => ({ ...s, positions: { ...s.positions, trend: null } }), 'Invalid position'],
      [
        'negative quantity',
        (s) => ({ ...s, positions: { ...s.positions, trend: { qty: -1, cost: 0 } } }),
        'Invalid position',
      ],
      [
        'position cap',
        (s) => ({ ...s, positions: { ...s.positions, trend: { qty: 1000001, cost: 0 } } }),
        'Invalid position',
      ],
      [
        'negative cost',
        (s) => ({ ...s, positions: { ...s.positions, trend: { qty: 1, cost: -1 } } }),
        'Invalid position',
      ],
      [
        'cost without units',
        (s) => ({ ...s, positions: { ...s.positions, trend: { qty: 0, cost: 1 } } }),
        'Invalid position',
      ],
      ['market imbalance', (s) => ({ ...s, cash: s.cash - 1 }), 'does not balance'],
      [
        'unknown position',
        (s) => ({ ...s, positions: { ...s.positions, unknown: { qty: 0, cost: 0 } } }),
        'do not match',
      ],
      ['duplicate execution', (s) => ({ ...s, executed: ['x', 'x'] }), 'do not match'],
      ['nonstring execution', (s) => ({ ...s, executed: [1] }), 'Invalid trade ID'],
      ['oversized execution', (s) => ({ ...s, executed: ['x'.repeat(151)] }), 'Invalid trade ID'],
    ];
    for (const [label, change, message] of malformedMarkets)
      reject(label, () => exchange.validate(change(structuredClone(market))), message);
    for (const value of ['0', '01', '1.1', '1e2', '-1', '1000001'])
      reject(`quantity ${value}`, () => exchange.parseQty(value), 'whole number');
    check(exchange.parseQty(' 1000000 ') === 1000000, 'quantity upper boundary is inclusive');
    const order = { strategy: 'trend', side: 'buy', qty: 1 };
    for (const [label, changes, message] of [
      ['quote unknown strategy', { strategy: 'unknown' }, 'Invalid trading target'],
      ['quote invalid side', { side: 'swap' }, 'Invalid trading target'],
      ['quote fractional quantity', { qty: 1.5 }, 'Invalid Pass quantity'],
      ['quote zero quantity', { qty: 0 }, 'Invalid Pass quantity'],
      ['quote excessive quantity', { qty: 1000001 }, 'Invalid Pass quantity'],
      ['quote invalid slippage', { slippage: 0 }, 'Invalid slippage'],
      ['quote gross cap', { qty: 1000000 }, 'demo quote limit'],
    ])
      reject(label, () => exchange.quote({ ...order, ...changes }), message);
    reject(
      'trial pass cannot sell',
      () => exchange.review({ ...order, side: 'sell' }),
      'Trial Passes cannot be sold',
    );
    reject('unreviewed execution', () => exchange.execute(null), 'Review the order first');
    reject('unidentified execution', () => exchange.execute({ id: 1 }), 'Review the order first');
    const now = 1700000000000;
    const quote = exchange.review(order, now);
    for (const [label, changes, message] of [
      ['stale market revision', { expectedRevision: quote.expectedRevision - 1 }, 'account has changed'],
      ['quote nonfinite expiry', { expiresAt: Infinity }, 'quote has expired'],
      ['quote nonfinite creation', { createdAt: NaN }, 'quote has expired'],
      ['quote future creation', { createdAt: now + 1, expiresAt: now + 30001 }, 'quote has expired'],
      ['quote invalid lifetime', { expiresAt: now + 29999 }, 'quote has expired'],
    ])
      reject(label, () => exchange.execute({ ...quote, ...changes }, now), message);
    reject(
      'quote expires exactly at deadline',
      () => exchange.execute(quote, now + 30000),
      'quote has expired',
    );
    for (const field of ['price', 'gross', 'impact', 'impactBps', 'fee', 'total', 'bound'])
      reject(
        `tampered quote ${field}`,
        () => exchange.execute({ ...quote, [field]: quote[field] + 1 }, now),
        'quote has changed',
      );
    const receipt = exchange.execute(quote, now);
    check(
      receipt.scope === 'LOCAL_SIMULATION' && receipt.status === 'recorded',
      'execution receipt stays explicitly local',
    );
    reject('market replay', () => exchange.execute(quote, now), 'already been executed');
    const filled = exchange.read();
    for (const [label, changes] of [
      ['unknown strategy', { strategy: 'unknown' }],
      ['invalid side', { side: 'swap' }],
      ['nonstring ID', { id: 1 }],
      ['unrecorded ID', { id: 'unrecorded' }],
      ['nonstring time', { at: 1 }],
      ['invalid time', { at: 'invalid' }],
      ['unsafe quantity', { qty: -1 }],
      ['zero quantity', { qty: 0 }],
      ['excess quantity', { qty: 1000001 }],
      ['noninteger pnl', { pnl: 0.5 }],
      ['wrong scope', { scope: 'ONCHAIN' }],
      ['wrong status', { status: 'pending' }],
    ])
      reject(
        `fill ${label}`,
        () => exchange.validate({ ...filled, orders: [{ ...receipt, ...changes }] }),
        'Invalid fill record',
      );
    reject('null fill', () => exchange.validate({ ...filled, orders: [null] }), 'Invalid fill record');
    for (const field of ['price', 'gross', 'impact', 'impactBps', 'fee', 'total', 'bound'])
      reject(
        `fill negative ${field}`,
        () => exchange.validate({ ...filled, orders: [{ ...receipt, [field]: -1 }] }),
        'Invalid fill amount',
      );
    const sell = exchange.review({ ...order, side: 'sell' }, now + 1);
    const sale = exchange.execute(sell, now + 1);
    const closed = exchange.read();
    check(
      closed.positions.trend.qty === 0 && closed.positions.trend.cost === 0,
      'full sale clears exact position cost',
    );
    check(
      closed.cash === closed.initialCapital + sale.pnl && closed.realized === sale.pnl,
      'roundtrip cash and realized pnl reconcile',
    );
    check(closed.fees === receipt.fee + sale.fee, 'roundtrip retains both exact fee debits');
    const max = exchange.maxBuy('trend', 300);
    check(Number.isSafeInteger(max) && max > 0, 'max buy is a positive whole quantity');
    const maximumQuote = exchange.review({ ...order, qty: max, slippage: 300 });
    check(maximumQuote.bound <= closed.cash, 'max buy retains slippage reserve');
    reject(
      'max plus one',
      () => exchange.review({ ...order, qty: max + 1, slippage: 300 }),
      'Insufficient Pass trading balance',
    );
    const data = window.AF.marketData;
    check(data.candles('missing').length === 0, 'unknown market series returns no invented candles');
    check(data.candles('trend').length === 24, 'default candle window is exactly 24 hours');
    check(
      data.candles('trend', 'invalid').length === 24,
      'unknown candle window uses documented daily fallback',
    );
    for (const [range, count] of [
      ['24h', 24],
      ['7d', 56],
      ['30d', 30],
      ['90d', 90],
    ]) {
      const candles = data.candles('trend', range);
      check(candles.length === count, `${range}: stable candle aggregation size`);
      check(
        candles.every(
          (c, i) =>
            c.low <= c.open &&
            c.low <= c.close &&
            c.high >= c.open &&
            c.high >= c.close &&
            c.volume > 0 &&
            (i === 0 || c.time > candles[i - 1].time),
        ),
        `${range}: valid chronological OHLC candles`,
      );
      const returns = data.returns('trend', range);
      check(
        returns[0].value === 0 && returns[0].benchmark === 0,
        `${range}: returns start at zero for both series`,
      );
      const performance = data.performance('trend', range);
      check(
        Math.abs(performance.change - returns.at(-1).value) < 1e-10 && performance.drawdown >= 0,
        `${range}: independent return chart agrees with period performance`,
      );
    }
    check(
      data.returns('trend').length === 31 && data.returns('trend', 'invalid').length === 31,
      'return window defaults and unknown input retain a 30-day baseline',
    );
    check(
      data.performance('trend').days === 30 && data.performance('trend', 'invalid').days === 30,
      'performance fallback retains 30 complete days',
    );
    for (const [mode, field, direction] of [
      ['price', 'change', -1],
      ['volume', 'volume', -1],
      ['returns', 'strategyReturn', -1],
      ['risk', 'drawdown', 1],
    ]) {
      const ranked = data.ranking({ mode });
      check(
        ranked.length === 6 && new Set(ranked.map((r) => r.id)).size === 6,
        `${mode}: all six strategies appear once`,
      );
      check(
        ranked.slice(1).every((r, i) => direction * (r.market[field] - ranked[i].market[field]) >= 0),
        `${mode}: documented ranking direction`,
      );
    }
    check(
      JSON.stringify(data.ranking()) === JSON.stringify(data.ranking({ mode: 'unknown' })),
      'unknown ranking mode follows default price ordering',
    );
    const favoriteIds = store.read().favorites;
    check(
      data.ranking({ savedOnly: true }).every((r) => favoriteIds.includes(r.id)),
      'saved ranking cannot introduce unbookmarked strategies',
    );
    check(
      data.ranking({ category: 'Trend' }).every((r) => r.category === 'Trend'),
      'category ranking remains scoped',
    );
    check(
      data.ranking({ query: 'no-such-strategy' }).length === 0,
      'unknown ranking search returns no synthetic matches',
    );
    check(
      data.compact(1) === '0.01' && data.compact(123456) === '1.2k' && data.compact(100000000) === '1.00m',
      'market denomination formatting covers cents, thousands and millions',
    );
    exchange.reset();
    const price = data.metrics('trend').price;
    const liquidity = data.metrics('trend').liquidity;
    reject(
      'excessive simulated impact',
      () => exchange.review({ strategy: 'trend', side: 'buy', qty: Math.ceil((liquidity * 0.061) / price) }),
      'price impact exceeds 3%',
    );
    for (let index = 0; index < 300; index++) {
      const next = exchange.review({ strategy: 'trend', side: index % 2 === 0 ? 'buy' : 'sell', qty: 1 });
      exchange.execute(next);
    }
    const capacity = exchange.read();
    check(
      capacity.orders.length === 300 &&
        capacity.executed.length === 300 &&
        capacity.positions.trend.qty === 0,
      '300 actual local fills retain all receipts with no residual position',
    );
    const blocked = exchange.review({ strategy: 'trend', side: 'buy', qty: 1 });
    reject('demo receipt capacity', () => exchange.execute(blocked), '300-order demo limit');
    return passed;
  });
  assert.ok(cases.length > 200, 'the actual model reports all boundary assertions');
  assert.equal(new Set(cases).size, cases.length, 'boundary assertion labels are distinct');

  // Loading malformed persisted data must expose recovery and restore a balanced demo.
  await page.evaluate(() => {
    localStorage.setItem('alphaforge.prototype.v3', '{broken');
    localStorage.setItem('alphaforge.passmarket.v3', '{broken');
  });
  await page.reload();
  const recovered = await page.evaluate(() => ({
    local: window.AF.store.read(),
    localRecovery: window.AF.store.recovery,
    market: window.AF.exchange.read(),
    marketRecovery: window.AF.exchange.recovery,
  }));
  assert.match(recovered.localRecovery, /could not be read/);
  assert.match(recovered.marketRecovery, /unreadable data was not used/);
  assert.equal(recovered.local.idle, 1000000);
  assert.equal(recovered.local.netFunding, 1000000);
  assert.equal(recovered.market.cash, 1000000);
  assert.deepEqual(recovered.market.orders, []);
  cases.push('corrupt persistence restores balanced demo with explicit recovery');

  // Persisted records can predate the current UI or contain malformed optional
  // content. Reloading the actual application must sanitize without changing funds.
  const legacySaved = await page.evaluate(() => ({
    v2: localStorage.getItem('alphaforge.prototype.v2'),
    home: localStorage.getItem('alphaforge.home-concept.v1'),
  }));
  await page.evaluate(() => {
    const raw = window.AF.store.read();
    Object.assign(raw, {
      profile: null,
      favorites: null,
      likes: null,
      bookmarks: null,
      posts: null,
      comments: null,
      history: null,
      draft: null,
      lastStrategy: 'unknown',
    });
    localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(raw));
  });
  await page.reload();
  let normalized = await page.evaluate(() => window.AF.store.read());
  assert.deepEqual(normalized.profile, { name: 'Workshop Guest', bio: '' });
  for (const field of ['favorites', 'likes', 'bookmarks', 'posts', 'comments', 'history'])
    assert.deepEqual(normalized[field], [], field);
  assert.deepEqual(normalized.draft, { title: '', body: '', category: 'Research Notes' });
  assert.equal(normalized.lastStrategy, 'trend');
  assert.equal(normalized.idle, 1000000);
  cases.push('Missing optional persisted content falls back without changing the ledger');
  await page.evaluate(() => {
    const raw = window.AF.store.read();
    Object.assign(raw, {
      profile: { name: 'x'.repeat(30), bio: 'b'.repeat(110) },
      favorites: ['trend', 'trend', 'unknown'],
      likes: [1, 'note'],
      bookmarks: [null, 'note'],
      posts: [
        null,
        {},
        { id: 'external', category: 'Research Notes' },
        {
          id: 'local-note',
          category: 'Research Notes',
          title: 42,
          body: 'valid body',
          author: null,
          excerpt: 0,
        },
      ],
      comments: [
        null,
        { post: 1, body: 'invalid' },
        { post: 'local-note', body: 'valid reply', author: null },
      ],
      history: [
        null,
        {},
        { id: 'negative', amount: -1 },
        { id: 'valid', amount: 1, type: 'Fixture history' },
      ],
      draft: { title: 1, body: null, category: 'All' },
      lastStrategy: 'unknown',
    });
    localStorage.removeItem('alphaforge.prototype.v3');
    localStorage.setItem('alphaforge.prototype.v2', JSON.stringify(raw));
  });
  await page.reload();
  normalized = await page.evaluate(() => window.AF.store.read());
  assert.deepEqual(normalized.favorites, ['trend']);
  assert.deepEqual(normalized.likes, ['note']);
  assert.deepEqual(normalized.bookmarks, ['note']);
  assert.equal(normalized.profile.name, 'x'.repeat(20));
  assert.equal(normalized.profile.bio, 'b'.repeat(100));
  assert.equal(normalized.posts.length, 1);
  assert.equal(normalized.posts[0].title, '');
  assert.deepEqual(normalized.posts[0].replies, []);
  assert.equal(normalized.comments.length, 1);
  assert.equal(normalized.comments[0].author, '');
  assert.deepEqual(normalized.history, [{ id: 'valid', amount: 1, type: 'Fixture history' }]);
  assert.equal(normalized.draft.category, 'Research Notes');
  assert.equal(normalized.netFunding, 1000000);
  cases.push('Legacy v2 storage deduplicates and bounds optional content while preserving funds');
  await page.evaluate(() => {
    localStorage.removeItem('alphaforge.prototype.v3');
    localStorage.removeItem('alphaforge.prototype.v2');
    localStorage.setItem(
      'alphaforge.home-concept.v1',
      JSON.stringify({ favorites: ['trend', 'trend', 'unknown'], samplePass: true }),
    );
  });
  await page.reload();
  normalized = await page.evaluate(() => window.AF.store.read());
  assert.deepEqual(normalized.favorites, ['trend']);
  assert.equal(normalized.samplePass, true);
  assert.equal(normalized.netFunding, 1000000);
  cases.push('Legacy home preferences migrate without inventing balances or allocations');

  // Simulate browser-level denial/quota errors only for the two local demo keys.
  // This fault injection never replaces production functions or counters.
  await page.addInitScript(() => {
    const mode = sessionStorage.getItem('alphaforge-test-storage-fault');
    if (!mode) return;
    const method = mode === 'read' ? 'getItem' : 'setItem';
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (key, ...rest) {
      if (
        this === localStorage &&
        [
          'alphaforge.prototype.v3',
          'alphaforge.prototype.v2',
          'alphaforge.home-concept.v1',
          'alphaforge.passmarket.v3',
        ].includes(key)
      )
        throw new DOMException(
          'Injected browser storage failure',
          mode === 'read' ? 'SecurityError' : 'QuotaExceededError',
        );
      return original.call(this, key, ...rest);
    };
  });
  await page.evaluate(() => sessionStorage.setItem('alphaforge-test-storage-fault', 'read'));
  await page.reload();
  let storageState = await page.evaluate(() => ({
    local: window.AF.store.available(),
    market: window.AF.exchange.available(),
    localRecovery: window.AF.store.recovery,
    marketRecovery: window.AF.exchange.recovery,
  }));
  assert.deepEqual(storageState, { local: false, market: false, localRecovery: '', marketRecovery: '' });
  cases.push('Browser read denial reports unavailable storage distinctly from corrupt records');
  await page.evaluate(() => sessionStorage.setItem('alphaforge-test-storage-fault', 'write'));
  await page.reload();
  storageState = await page.evaluate(() => {
    const before = {
      local: localStorage.getItem('alphaforge.prototype.v3'),
      market: localStorage.getItem('alphaforge.passmarket.v3'),
    };
    window.AF.store.dispatch({ type: 'deposit', amount: 1 });
    window.AF.exchange.reset();
    return {
      available: [window.AF.store.available(), window.AF.exchange.available()],
      before,
      after: {
        local: localStorage.getItem('alphaforge.prototype.v3'),
        market: localStorage.getItem('alphaforge.passmarket.v3'),
      },
    };
  });
  assert.deepEqual(storageState.available, [false, false]);
  assert.deepEqual(storageState.after, storageState.before);
  cases.push('Browser quota failure never claims durable storage or overwrites prior records');
  await page.evaluate(() => sessionStorage.removeItem('alphaforge-test-storage-fault'));
  await page.reload();
  await page.evaluate((legacy) => {
    for (const [key, value] of [
      ['alphaforge.prototype.v2', legacy.v2],
      ['alphaforge.home-concept.v1', legacy.home],
    ]) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }, legacySaved);
  await page.reload();

  const address = page.url().split('#')[0];
  await page.goto(`${address}#/account/funds`);
  const exportBefore = await page.evaluate(() => ({
    state: window.AF.store.read(),
    passMarket: window.AF.exchange.read(),
  }));
  const downloaded = page.waitForEvent('download');
  await page.locator('[data-action="export"]').first().click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), 'AlphaForge_local_demo.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.product, 'AlphaForge');
  assert.equal(exported.scope, 'LOCAL_PROTOTYPE_ONLY');
  assert.deepEqual(exported.state, JSON.parse(JSON.stringify(exportBefore.state)));
  assert.deepEqual(exported.passMarket, exportBefore.passMarket);
  assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
  assert.deepEqual(
    await page.evaluate(() => ({ state: window.AF.store.read(), passMarket: window.AF.exchange.read() })),
    exportBefore,
  );
  cases.push('Visible export downloads the exact two local ledgers without mutating either');
  await page.goto(`${address}#/account/settings`);
  await page.locator('[data-action="reset-confirm"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Start a fresh demo/);
  await page.locator('#app-dialog[open] [data-close]').click();
  assert.deepEqual(
    await page.evaluate(() => ({ state: window.AF.store.read(), passMarket: window.AF.exchange.read() })),
    exportBefore,
  );
  await page.locator('[data-action="reset-confirm"]').click();
  await page.locator('#app-dialog[open] [data-action="reset-run"]').click();
  const reset = await page.evaluate(() => ({
    local: window.AF.store.read(),
    market: window.AF.exchange.read(),
  }));
  assert.equal(reset.local.idle, 1000000);
  assert.equal(reset.local.netFunding, 1000000);
  assert.deepEqual(reset.local.pending, []);
  assert.deepEqual(Object.keys(reset.local.passes), ['trend']);
  assert.equal(reset.market.cash, 1000000);
  assert.deepEqual(reset.market.orders, []);
  assert.deepEqual(reset.market.executed, []);
  cases.push('Visible reset requires confirmation and restores both demo ledgers; cancel preserves data');
  for (const [route, message] of [
    ['account/trades', 'No market holdings yet.'],
    ['account/saved', 'Your bookmarks are still light.'],
    ['account/notes', 'The first page is yours.'],
  ]) {
    await page.goto(`${address}#/${route}`);
    await page.getByText(message, { exact: true }).waitFor();
  }
  cases.push('Empty holdings, bookmarks and notes explain the absence without fabricated activity');
  await page.goto(`${address}#/rankings`);
  await page.locator('#rank-saved').uncheck();
  await page.locator('#rank-category').selectOption('All');
  await page.locator('#rank-search').fill('');
  for (const [mode, label] of [
    ['risk', 'Strategy drawdown'],
    ['returns', 'Strategy return'],
    ['price', 'Pass Gainers'],
  ]) {
    await page.locator(`[data-rank-mode="${mode}"]`).click();
    assert.match(await page.locator('.ranking-table thead th.sorted').textContent(), new RegExp(label));
    assert.equal(await page.locator('[data-ranking-row]').count(), 6);
  }
  for (const range of ['24h', '7d', '30d']) {
    await page.locator(`[data-rank-range="${range}"]`).click();
    assert.equal(await page.locator(`[data-rank-range="${range}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('h1').focus();
  await page.keyboard.press('/');
  assert.equal(
    await page.locator('#rank-search').evaluate((element) => element === document.activeElement),
    true,
  );
  cases.push(
    'All ranking modes and outer periods are selectable, with keyboard search and six real fixture rows',
  );
  for (const route of ['not-a-page', '%E0%A4']) {
    await page.goto(`${address}#/${route}`);
    await page.getByText('This page is not in the workshop yet.', { exact: true }).waitFor();
  }
  await page.goto(`${address}#/forum/post/missing-local-note`);
  await page.getByText('This note is not here.', { exact: true }).waitFor();
  await page.goto(`${address}#/trade`);
  await page.locator('h1').waitFor();
  assert.equal(await page.evaluate(() => window.AF.route.id), 'trend');
  cases.push(
    'Unknown, malformed and missing-note routes fail safely; an omitted trade ID uses the saved strategy',
  );

  // Restore the earlier visible-journey fixture, preserving the original six strategies.
  // Visit each current strategy through actual routes and controls. This does not
  // invoke obsolete chart implementations or rewrite fixture/coverage functions.
  const strategyIds = await page.evaluate(() => window.AF.strategies.map((item) => item.id));
  for (const id of strategyIds) {
    await page.goto(`${address}#/trade/${id}`);
    await page.locator('#trade-panel').waitFor();
    for (const [tab, text] of [
      ['discussion', 'discuss'],
      ['rights', 'separate trial flow'],
      ['fills', 'No trades yet.'],
      ['assets', 'Related assets'],
    ]) {
      await page.locator(`[data-trade-tab="${tab}"]`).click();
      assert.match(
        (await page.locator('#trade-content').textContent()).toLowerCase(),
        new RegExp(text.toLowerCase()),
      );
    }
    for (const range of ['24h', '7d', '30d', '90d']) {
      await page.locator(`[data-price-range="${range}"]`).click();
      assert.equal(await page.locator(`[data-price-range="${range}"]`).getAttribute('aria-pressed'), 'true');
      assert.match(
        await page.locator('[data-v3-chart="price"]').getAttribute('aria-label'),
        new RegExp(range),
      );
    }
    for (const range of ['7d', '30d', '90d']) {
      await page.locator(`[data-return-range="${range}"]`).click();
      assert.equal(await page.locator(`[data-return-range="${range}"]`).getAttribute('aria-pressed'), 'true');
      const chart = page.locator('[data-v3-chart="returns"]');
      await chart.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      assert.match(await page.locator('#returns-readout').textContent(), /Strategy|Reference/i);
      const box = await chart.boundingBox();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
      assert.doesNotMatch(await page.locator('#returns-readout').textContent(), /NaN|undefined/);
    }
    await page.locator('[data-price-style="candle"]').click();
    await page.locator('[data-pass-shortcut="max"]').click();
    assert.match(await page.locator('#pass-qty').inputValue(), /^[1-9][0-9]*$/);
    await page.locator('[data-pass-shortcut="10"]').click();
    assert.equal(await page.locator('#pass-qty').inputValue(), '10');
    await page.locator('[data-trade-pane="pass"]').click();
    assert.match(
      await page.locator('#trade-panel').textContent(),
      /Trial allocations and Pass trading use separate demo ledgers/,
    );
    await page.locator('[data-trade-pane="market"]').click();
    cases.push(
      `Visible strategy ${id}: all current chart ranges, readouts, empty fills and separate trial scope`,
    );
  }
  await page.evaluate(() => {
    const { store } = window.AF;
    store.dispatch({ type: 'favorite', strategy: 'trend' });
    store.dispatch({ type: 'allocate', strategy: 'trend', amount: 100000 });
    store.dispatch({ type: 'withdraw', amount: 10000 });
  });
  await page.goto(`${address}#/account/funds`);
  assert.equal(await page.locator('.pending-row').count(), 1);
  assert.equal(await page.locator('.allocation-row').count(), 1);
  await page.goto(`${address}#/market`);
  await page.locator('#market-sort').selectOption('saved');
  assert.equal(await page.locator('.market-card [data-save]').first().getAttribute('data-save'), 'trend');
  await page.locator('[data-save="trend"]').click();
  assert.equal(await page.locator('[data-save="trend"]').getAttribute('aria-pressed'), 'false');
  cases.push(
    'Visible saved-first sorting reacts to bookmark removal; pending and allocated demo balances remain distinct',
  );

  // Real second-tab writes exercise storage synchronization and stale-review rejection.
  await page.goto(`${address}#/account/funds`);
  await page.locator('[data-cash="deposit"]').click();
  await page.locator('#cash-amount').fill('1');
  await page.locator('#cash-form button[type="submit"]').click();
  const sibling = await page.context().newPage();
  try {
    await sibling.goto(`${address}#/home`);
    await sibling.locator('h1').waitFor();
    const otherLedger = await sibling.evaluate(() =>
      window.AF.store.dispatch({ type: 'deposit', amount: 1 }),
    );
    await page.locator('[data-action="commit"]').click();
    await page
      .locator('#review-error')
      .filter({ hasText: /Records have changed/ })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => window.AF.store.read()), otherLedger);
    await page.locator('dialog[open] [data-close]').first().click();

    await page.goto(`${address}#/trade/trend`);
    await page.locator('#pass-qty').fill('1');
    await page.locator('#pass-order-form button[type="submit"]').click();
    const otherExchange = await sibling.evaluate(() => {
      const e = window.AF.exchange;
      e.execute(e.review({ strategy: 'trend', side: 'buy', qty: 1 }));
      return e.read();
    });
    await page.locator('[data-v3-action="commit-order"]').click();
    await page
      .locator('#pass-review-error')
      .filter({ hasText: /trading account has changed/ })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => window.AF.exchange.read()), otherExchange);
    await page.locator('dialog[open] [data-close]').first().click();
    cases.push(
      'Real second-tab ledger and Pass writes invalidate stale reviews without a duplicate mutation',
    );
  } finally {
    await sibling.close();
  }

  // Use the real clock: no replacement timer, Date stub or coverage counter mutation.
  await page.locator('#pass-qty').fill('1');
  await page.locator('#pass-order-form button[type="submit"]').click();
  const beforeExpiry = await page.evaluate(() => window.AF.exchange.read());
  await page.waitForFunction(
    () => document.querySelector('#quote-countdown')?.textContent === '1 second',
    undefined,
    {
      timeout: 35_000,
    },
  );
  await page
    .locator('[data-v3-action="commit-order"]')
    .filter({ hasText: /Quote expired/ })
    .waitFor({ timeout: 5_000 });
  assert.equal(await page.locator('[data-v3-action="commit-order"]').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.AF.exchange.read()), beforeExpiry);
  await page.locator('dialog[open] [data-close]').first().click();
  cases.push(
    'Real 30-second quote expiry disables confirmation and leaves the complete Pass ledger unchanged',
  );

  await page.locator('[data-trade-tab="fills"]').click();
  assert.match(await page.locator('#trade-content').textContent(), /BUY|Buy|buy/);
  await page.locator('[data-pass-side="sell"]').click();
  await page.locator('[data-pass-shortcut="100%"] ').click();
  assert.equal(await page.locator('#pass-qty').inputValue(), '1');
  await page.locator('#pass-order-form button[type="submit"]').click();
  await page.locator('[data-v3-action="commit-order"]').click();
  await page.locator('[data-route="/account/trades"]').click();
  await page.locator('.exchange-account').waitFor();
  assert.match(await page.locator('main').textContent(), /SELL|Sell|sell/);
  assert.equal(await page.evaluate(() => window.AF.exchange.read().positions.trend.qty), 0);
  cases.push('Visible full-position sale records a loss and renders both buy and sell fills in the account');

  await page.goto(`${address}#/trade/trend`);
  for (const width of [600, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150);
    const chart = page.locator('[data-v3-chart="price"]');
    const box = await chart.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await chart.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    assert.doesNotMatch(await page.locator('#price-readout').textContent(), /NaN|undefined/);
    assert.equal(await chart.isVisible(), true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.menu-toggle').click();
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('.menu-toggle').click();
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  cases.push(
    'Responsive chart reflow preserves valid pointer and keyboard readouts; mobile navigation toggles both ways',
  );

  cases.push(...(await verifyAdditionalReachableJourneys(page)));
  cases.push(...(await verifyDamagedDateJourneys(page)));
  cases.push(...(await verifyConfiguredBootstrapJourneys(page)));
  cases.push(...(await verifyRuntimePortJourneys(page)));
  cases.push(...(await verifyRecoveryJourneys(page)));
  cases.push(...(await verifyLegacyApiJourneys(page, { v1Supported, unsupportedChecks })));

  await page.evaluate((saved) => {
    localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(saved.local));
    localStorage.setItem('alphaforge.passmarket.v3', JSON.stringify(saved.exchange));
  }, original);
  await page.reload();
  const restored = await page.evaluate(() => ({
    local: window.AF.store.read(),
    exchange: window.AF.exchange.read(),
  }));
  assert.deepEqual(restored, original);
  cases.push(...(await verifyApiLossAndThrottle(page, { v1Supported, unsupportedChecks })));
  if (v1Supported) {
    const receiptRecovery = await verifyPrototypeReceiptRecovery(page);
    cases.push(...receiptRecovery.map((observation) => observation.name));
  } else {
    unsupportedChecks.push({
      name: 'v1-snapshot-receipt-recovery',
      status: 'NOT_SUPPORTED',
      execution: 'NOT_RUN',
      requiredCapability: 'v1',
      equivalentCoverage: false,
    });
  }
  return cases;
}

async function verifyApiLossAndThrottle(page, { v1Supported, unsupportedChecks }) {
  const origin = new URL(page.url()).origin;
  const savedRoute = page.url();
  const state = async () => {
    const response = await page.request.get(`${origin}/api/vaults`);
    assert.equal(response.status(), 200);
    return response.json();
  };
  const ready = () =>
    page
      .locator('[data-product-state]')
      .filter({ hasText: /^(READY|EMPTY)$/ })
      .waitFor();
  const command = async (type, fields = {}) => {
    await page.locator(`[data-product-command="${type}"]`).first().click();
    const dialog = page.locator('dialog[open]');
    for (const [key, value] of Object.entries(fields)) await dialog.locator(`[name="${key}"]`).fill(value);
    await dialog.locator('[data-product-review]').click();
    await dialog.locator('[data-product-confirm]').click();
    await ready();
  };
  const alice = await state();
  await page.locator('[data-product-login="bob"]').click();
  await ready();
  assert.deepEqual(await state(), []);
  await page.goto(`${origin}/#/trade/core-flow-demo`);
  await page.locator('[data-product-claim="core-flow-demo"]').click();
  await page.locator('dialog[open] [data-product-confirm]').click();
  await ready();
  for (const [type, fields] of [
    ['deposit', { amount: '1' }],
    ['allocate', { amount: '1' }],
    ['start', {}],
    ['reserveBuy', { amount: '1' }],
    ['fillBuy', {}],
    ['markPosition', { value: '0' }],
    ['stop', {}],
    ['settlePosition', { proceeds: '0' }],
  ])
    await command(type, fields);
  const loss = (await state())[0];
  assert.equal(loss.balances.realizedPnl, '-1000000');
  assert.equal(loss.positionValue, '0');
  assert.equal(loss.status, 'stopped');
  assert.equal(loss.balances.equity, '0');
  assert.match(await page.locator('main').textContent(), /Realized simulation P&L\s*-1\.000000/);
  if (!v1Supported) {
    unsupportedChecks.push({
      name: 'v1-command-rate-limit-retry',
      status: 'NOT_SUPPORTED',
      execution: 'NOT_RUN',
      requiredCapability: 'v1',
      equivalentCoverage: false,
    });
    await page.locator('[data-product-login="alice"]').click();
    await ready();
    await page.goto(savedRoute);
    assert.deepEqual(await state(), alice);
    return ['Visible API loss settles to zero equity with exact negative P&L and no phantom funds'];
  }
  const attempted = [];
  let retryAfter = 0;
  const pattern = '**/api/v1/vaults/*/commands';
  await page.route(pattern, async (route) => {
    attempted.push(route.request().postDataJSON());
    if (attempted.length === 1) {
      retryAfter = Date.now() + 3000;
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '3' },
        contentType: 'application/json',
        body: '{}',
      });
    } else await route.continue();
  });
  try {
    await page.locator('[data-product-command="deposit"]').first().click();
    await page.locator('dialog[open] [name="amount"]').fill('0.1');
    await page.locator('[data-product-review]').click();
    await page.locator('[data-product-confirm]').click();
    await page
      .locator('[data-product-retry]')
      .filter({ hasText: /after [1-3]s/ })
      .waitFor();
    assert.equal(await page.locator('[data-product-retry]').isDisabled(), true);
    assert.equal(await page.locator('[data-product-command="deposit"]').first().isDisabled(), true);
    assert.deepEqual((await state())[0], loss);
    const pending = await page.evaluate(() => localStorage.getItem('quantpass.local.pending-command.v1'));
    assert.ok(pending);
    await page.reload();
    assert.equal(
      await page.evaluate(() => localStorage.getItem('quantpass.local.pending-command.v1')),
      pending,
    );
    // Reload cannot expose owner-specific pending data before a fresh session read.
    // Once the actual HTTP deadline has elapsed, the visible refresh re-establishes it.
    await page.waitForTimeout(Math.max(0, retryAfter - Date.now()) + 150);
    await page.locator('[data-product-refresh]').click();
    await page.locator('[data-product-retry]').waitFor();
    await page.locator('[data-product-retry]:not([disabled])').waitFor({ timeout: 6_000 });
    await page.locator('[data-product-retry]').click();
    await ready();
    assert.equal(attempted.length, 2);
    assert.deepEqual(attempted[1], attempted[0]);
    const accepted = (await state())[0];
    assert.equal(accepted.revision, loss.revision + 1);
    assert.equal(accepted.idle, '100000');
    assert.equal(accepted.balances.realizedPnl, '-1000000');
    assert.equal(await page.evaluate(() => localStorage.getItem('quantpass.local.pending-command.v1')), null);
  } finally {
    await page.unroute(pattern);
    await page.locator('[data-product-login="alice"]').click();
    await ready();
    await page.goto(savedRoute);
  }
  assert.deepEqual(await state(), alice);
  return [
    'Visible API loss settles to zero equity with exact negative P&L and no phantom funds',
    'HTTP 429 disables writes, persists the original request across reload, re-establishes its owner, and retries exactly once after the real deadline',
  ];
}

// Real corrupted-persistence fixtures run in separate contexts, through the
// existing driver's browser (and therefore its instrumentation lifecycle).
export async function verifyDamagedDateJourneys(parent) {
  const origin = new URL(parent.url()).origin;
  const browser = parent.context().browser();
  assert.ok(browser, 'the existing driver must own the browser');
  const snapshot = (page) =>
    page.evaluate(() => ({
      local: window.AF.store.read(),
      persistedLocal: JSON.parse(localStorage.getItem('alphaforge.prototype.v3')),
      exchange: window.AF.exchange.read(),
      persistedExchange: localStorage.getItem('alphaforge.passmarket.v3'),
    }));
  const parentBefore = await snapshot(parent);
  const parentUrl = parent.url();
  const backend = async () => {
    const response = await parent.request.get(`${origin}/api/vaults`);
    assert.equal(response.status(), 200);
    return response.json();
  };
  const backendBefore = await backend();
  const cases = [];
  async function isolated(label, action) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    });
    let firstError;
    let failed = false;
    const errors = [];
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      context.on('page', (other) => other.on('pageerror', (error) => errors.push(error.message)));
      page.on('pageerror', (error) => errors.push(error.message));
      context.on('console', (message) => {
        if (/Content Security Policy|Refused to (?:apply|execute)/i.test(message.text()))
          errors.push(message.text());
      });
      await page.goto(`${origin}/#/account/funds`);
      await page.locator('[data-product-login="alice"]').click();
      await page
        .locator('[data-product-state]')
        .filter({ hasText: /^(READY|EMPTY)$/ })
        .waitFor();
      await action(page, context);
      assert.deepEqual(errors, [], `${label}: no page/CSP errors`);
    } catch (error) {
      firstError = error;
      failed = true;
    } finally {
      // Explicit page.close lets the existing collector flush each page before
      // context.close; every cleanup is attempted even after another rejection.
      const closed = await Promise.allSettled(context.pages().map((page) => page.close()));
      try {
        await context.close();
      } catch (error) {
        closed.push({ status: 'rejected', reason: error });
      }
      for (const result of closed)
        if (result.status === 'rejected' && !failed) {
          firstError = result.reason;
          failed = true;
        }
    }
    if (failed) throw firstError;
    assert.equal(parent.url(), parentUrl);
    assert.deepEqual(
      await snapshot(parent),
      parentBefore,
      'isolated fixture must not change the driver state',
    );
    assert.deepEqual(await backend(), backendBefore, 'prototype journeys must not change API funds');
    cases.push(label);
  }
  async function corrupt(context, local) {
    const other = await context.newPage();
    await other.goto(`${origin}/#/home`);
    await other.locator('#press-button').waitFor();
    // Boundary fixture: change only the stated persisted dates and revision.
    // No private helpers, event replacement, counter writes or production stubs.
    await other.evaluate(
      (state) => localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(state)),
      local,
    );
    await other.close();
  }
  const preserved = (before, local) => ({ ...before, local, persistedLocal: local });
  async function home(page) {
    await page.locator('a[href="#/home"]').first().click();
    await page.locator('#press-button').waitFor();
    assert.equal(await page.evaluate(() => window.AF.route.name), 'home');
  }
  async function compose(page, title) {
    await page.locator('a[href="#/forum"]').first().click();
    await page.locator('#forum-results').waitFor();
    await page.locator('[data-action="compose"]').first().click();
    await page.locator('#compose-title').fill(title);
    await page
      .locator('#compose-body')
      .fill('A real local note for persisted date boundary recovery and stable ordering.');
    await page.locator('#compose-form button[type="submit"]').click();
    await page.locator('.article-page').waitFor();
  }
  for (const [label, value] of [
    ['non-coercible object', { toString: null }],
    ['invalid string', 'not-a-date'],
    ['null', null],
    ['array', []],
    ['out-of-range number', 1e20],
  ]) {
    await isolated(
      `Damaged history ${label}: native profile save, rejected withdrawal and navigation preserve funds, storage and exchange`,
      async (page, context) => {
        await page.locator('[data-cash="deposit"]').click();
        await page.locator('#cash-amount').fill('3');
        await page.locator('#cash-form button[type="submit"]').click();
        await page.locator('[data-action="commit"]').click();
        await page
          .locator('#dialog-body h2')
          .filter({ hasText: /recorded/ })
          .waitFor();
        await page.locator('#close-dialog').click();
        const before = await snapshot(page);
        assert.equal(before.local.history.length, 1);
        assert.equal(before.local.idle, 1000300);
        assert.equal(before.local.netFunding, 1000300);
        await page.locator('[data-action="profile"]').first().click();
        await page.locator('#profile-name').fill('Date boundary');
        const damaged = structuredClone(before.local);
        damaged.revision++;
        damaged.history[0].at = value;
        await corrupt(context, damaged);
        await page.locator('#profile-form button[type="submit"]').click();
        assert.match(await page.locator('#toast').textContent(), /Local profile updated/);
        const expected = preserved(before, {
          ...damaged,
          revision: damaged.revision + 1,
          profile: { ...damaged.profile, name: 'Date boundary' },
        });
        assert.deepEqual(await snapshot(page), expected);
        const row = page.locator('.ledger-entry').filter({ hasText: 'Add demo funds' });
        assert.equal(await row.count(), 1);
        assert.match(await row.textContent(), /Date unavailable/);
        assert.match(await row.locator('.ledger-amount').textContent(), /3\.00\s*ETH/);
        assert.deepEqual(await page.locator('.balance-columns strong').allTextContents(), [
          '10,003.00',
          '0.00',
          '0.00',
        ]);
        await page.locator('[data-cash="withdraw"]').click();
        await page.locator('#cash-amount').fill('10003.01');
        await page.locator('#cash-form button[type="submit"]').click();
        assert.match(await page.locator('#cash-error').textContent(), /Only idle demo funds/);
        assert.equal(await page.locator('[data-action="commit"]').count(), 0);
        assert.deepEqual(await snapshot(page), expected);
        await page.locator('#close-dialog').click();
        await home(page);
        assert.deepEqual(await snapshot(page), expected);
        await page.reload();
        await page.locator('#press-button').waitFor();
        assert.deepEqual(
          await snapshot(page),
          expected,
          'reload keeps the damaged record without resetting money',
        );
      },
    );
    await isolated(
      `Damaged post ${label}: native discussion, resize and later navigation preserve both ledgers and persisted records`,
      async (page, context) => {
        await compose(page, 'Date boundary research');
        await home(page);
        await page.locator('[data-route="/trade/trend"]').first().click();
        await page.locator('[data-trade-tab="discussion"]').click();
        await home(page);
        const before = await snapshot(page);
        assert.equal(before.local.posts.length, 1);
        const damaged = structuredClone(before.local);
        damaged.revision++;
        damaged.posts[0].date = value;
        await corrupt(context, damaged);
        await page.locator('#press-button').click();
        await page.waitForFunction(() => window.AF.store.read().samplePass === true);
        const expected = preserved(before, { ...damaged, samplePass: true, revision: damaged.revision + 1 });
        assert.deepEqual(await snapshot(page), expected);
        await page.locator('[data-route="/trade/trend"]').first().click();
        await page.locator('#trade-price svg').waitFor();
        assert.equal(await page.locator('#trade-returns svg').count(), 1);
        await page.setViewportSize({ width: 600, height: 900 });
        await page.waitForFunction(() =>
          document.querySelector('#trade-price svg')?.getAttribute('viewBox')?.endsWith('540'),
        );
        assert.equal(await page.locator('#trade-returns svg').count(), 1);
        assert.doesNotMatch(await page.locator('#price-readout').textContent(), /NaN|undefined/);
        assert.doesNotMatch(await page.locator('#returns-readout').textContent(), /NaN|undefined/);
        await page.locator('#main a[href="#/forum"]').first().click();
        await page.locator('#forum-results').waitFor();
        const row = page.locator('.journal-row').filter({ hasText: 'Date boundary research' });
        assert.match(await row.textContent(), /Date unavailable/);
        assert.equal(
          await page.locator('#forum-results .journal-row h3').last().textContent(),
          'Date boundary research',
        );
        assert.deepEqual(await snapshot(page), expected);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await home(page);
        await page.locator('.nav-right a[data-nav="account"]').click();
        await page.locator('.account-tabs a[href="#/account/funds"]').click();
        await page.locator('.balance-columns').waitFor();
        assert.deepEqual(await page.locator('.balance-columns strong').allTextContents(), [
          '10,000.00',
          '0.00',
          '0.00',
        ]);
        assert.deepEqual(await snapshot(page), expected);
        await page.reload();
        await page.locator('.balance-columns').waitFor();
        assert.deepEqual(await snapshot(page), expected);
      },
    );
  }
  await isolated(
    'Mixed valid and invalid persisted post dates sort newest first with stable equal/invalid ties and no ledger or storage mutation',
    async (page, context) => {
      await page.locator('a[href="#/forum"]').first().click();
      await page.locator('#forum-results').waitFor();
      const samples = await page.locator('#forum-results .journal-row h3').allTextContents();
      assert.equal(samples.length, 6);
      // Created through the real form; dates alone become a named storage fixture.
      for (const title of [
        'Invalid first',
        'Equal first',
        'Future latest',
        'Epoch note',
        'Equal second',
        'Invalid second',
        'Older valid',
      ])
        await compose(page, title);
      await home(page);
      const before = await snapshot(page);
      assert.deepEqual(
        before.local.posts.map((post) => post.title),
        [
          'Older valid',
          'Invalid second',
          'Equal second',
          'Epoch note',
          'Future latest',
          'Equal first',
          'Invalid first',
        ],
      );
      const damaged = structuredClone(before.local);
      const dates = {
        'Invalid first': { toString: null },
        'Equal first': '2099-02-01T12:00:00.000Z',
        'Future latest': '2099-03-01T12:00:00.000Z',
        'Epoch note': 0,
        'Equal second': '2099-02-01T12:00:00.000Z',
        'Invalid second': [],
        'Older valid': '2098-01-01T12:00:00.000Z',
      };
      for (const post of damaged.posts) post.date = dates[post.title];
      damaged.revision++;
      await corrupt(context, damaged);
      await page.locator('#press-button').click();
      await page.waitForFunction(() => window.AF.store.read().samplePass === true);
      const expected = preserved(before, { ...damaged, samplePass: true, revision: damaged.revision + 1 });
      const titles = [
        'Future latest',
        'Equal second',
        'Equal first',
        'Older valid',
        ...samples,
        'Epoch note',
        'Invalid second',
        'Invalid first',
      ];
      await page.locator('a[href="#/forum"]').first().click();
      await page.locator('#forum-results').waitFor();
      assert.deepEqual(await page.locator('#forum-results .journal-row h3').allTextContents(), titles);
      for (const [title, date] of [
        ['Future latest', '03/01'],
        ['Equal second', '02/01'],
        ['Equal first', '02/01'],
        ['Epoch note', '01/01'],
        ['Invalid second', 'Date unavailable'],
        ['Invalid first', 'Date unavailable'],
      ]) {
        const row = page.locator('.journal-row').filter({ hasText: title });
        assert.ok((await row.locator('.post-meta').textContent()).includes(date));
      }
      assert.deepEqual(await snapshot(page), expected);
      await page.reload();
      await page.locator('#forum-results').waitFor();
      assert.deepEqual(await page.locator('#forum-results .journal-row h3').allTextContents(), titles);
      assert.deepEqual(await snapshot(page), expected);
      await home(page);
      assert.deepEqual(await snapshot(page), expected);
    },
  );
  return cases;
}

export async function verifyAdditionalReachableJourneys(page) {
  const origin = new URL(page.url()).origin;
  // Exercise a supported persisted legacy profile through the real startup migration.
  await page.evaluate(() => {
    window.AF.store.reset();
    const state = window.AF.store.read();
    state.profile = { name: '工坊访客', bio: '保持好奇，认真研究。' };
    state.history = [
      { id: 'legacy-deposit', type: '添加演示余额', amount: 100, strategy: '', at: 'invalid-date' },
    ];
    state.passes.trend.at = '初始演示样例';
    localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(state));
  });
  await page.reload();
  const migrated = await page.evaluate(() => window.AF.store.read());
  assert.equal(migrated.profile.name, 'Workshop Guest');
  assert.equal(migrated.profile.bio, 'Stay curious. Research carefully.');
  assert.equal(migrated.history[0].type, 'Add demo funds');
  assert.equal(migrated.passes.trend.at, 'Initial demo sample');
  await page.goto(`${origin}/#/account/funds`);
  const migratedRow = page.locator('.ledger-entry').filter({ hasText: 'Add demo funds' });
  assert.equal(await migratedRow.count(), 1);
  assert.match(await migratedRow.textContent(), /Date unavailable/);

  // SPA navigation must retain active catalogue choices in the rebuilt controls.
  await page.goto(`${origin}/#/market`);
  await page.locator('#market-search').fill('Trend');
  await page.locator('[data-market-category="Trend"]').click();
  await page.locator('#market-sort').selectOption('name');
  await page.locator('.nav-link[href="#/home"]').click();
  await page.locator('.nav-link[href="#/market"]').click();
  assert.equal(await page.locator('#market-search').inputValue(), 'Trend');
  assert.equal(await page.locator('#market-sort').inputValue(), 'name');
  assert.equal(await page.locator('[data-market-category="Trend"]').getAttribute('aria-pressed'), 'true');
  assert.ok((await page.locator('#market-results .market-card').count()) > 0);
  await page.locator('#market-search').fill('No matching strategy');
  assert.equal(await page.locator('#market-results .market-card').count(), 0);
  await page.locator('[data-action="market-reset"]').click();

  await page.goto(`${origin}/#/trade/trend`);
  const chart = page.locator('[data-v3-chart="returns"]');
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  const box = await chart.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  assert.doesNotMatch(await page.locator('#returns-readout').textContent(), /NaN|undefined/);
  await page.locator('#trade-panel [data-trade-pane="pass"]').click();
  await page.locator('#trade-panel [data-trade-pane="funds"]').first().click();
  await page.locator('#allocate-amount').fill('1');
  await page.locator('#allocate-form [name="consent"]').uncheck();
  const before = await page.evaluate(() => window.AF.store.read());
  await page.locator('#allocate-form button[type="submit"]').click();
  const consent = await page.locator('#allocate-form [name="consent"]').evaluate((input) => ({
    valid: input.validity.valid,
    message: input.validationMessage,
  }));
  assert.equal(consent.valid, false);
  assert.ok(consent.message.length > 0);
  assert.equal(await page.locator('#app-dialog[open]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.AF.store.read()), before);
  await page.locator('#allocate-form [name="consent"]').check();
  await page.locator('[data-amount="250"]').click();
  assert.equal(await page.locator('#allocate-amount').inputValue(), '250');
  for (const [amount, message] of [
    ['1000.01', /1,000 ETH allocation limit/],
    ['10000.01', /Insufficient idle demo balance/],
  ]) {
    await page.locator('#allocate-amount').fill(amount);
    await page.locator('#allocate-form button[type="submit"]').click();
    assert.match(await page.locator('#allocate-error').textContent(), message);
    assert.equal(await page.locator('#app-dialog[open]').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.AF.store.read()), before);
  }
  await page.goto(`${origin}/#/account/funds`);
  for (const [kind, amount, message] of [
    ['withdraw', '10000.01', /Only idle demo funds/],
    ['deposit', '999999.99', /prototype demo balance limit/],
  ]) {
    await page.locator(`[data-cash="${kind}"]`).click();
    await page.locator('#cash-amount').fill(amount);
    await page.locator('#cash-form button[type="submit"]').click();
    assert.match(await page.locator('#cash-error').textContent(), message);
    assert.deepEqual(await page.evaluate(() => window.AF.store.read()), before);
    await page.locator('#app-dialog[open] [data-close]').click();
  }
  await page.goto(`${origin}/#/trade/trend`);
  await page.locator('#trade-panel [data-trade-pane="market"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion });
    await page.locator('.mobile-order-dock [data-v3-action="jump-order"]').click();
    assert.equal(await page.locator('#pass-qty').evaluate((input) => input === document.activeElement), true);
  }
  await page.emulateMedia({ reducedMotion: null });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return [
    'Persisted Chinese legacy profile and history migrate through startup without inventing balances; invalid history date explicitly shows Date unavailable',
    'Real SPA catalogue navigation preserves selected filters, while return-chart keyboard and pointer controls retain finite values',
    'Allocation without consent remains visibly rejected and leaves the local ledger unchanged',
    'Visible allocation, withdrawal and deposit budget rejections preserve the ledger exactly',
    'Mobile order navigation focuses the real quantity input with either reduced-motion preference',
  ];
}

export async function verifyConfiguredBootstrapJourneys(parent) {
  const origin = new URL(parent.url()).origin;
  const deployment = {
    source: 'reviewed-deployment-manifest',
    chainId: 46630,
    vaultAddress: '0x2222222222222222222222222222222222222222',
    deploymentBlock: '1',
    abiVersion: 'm3-vault-db620d6',
    abiHash: '0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977',
    manifestDigest: '0x' + '12'.repeat(32),
    runtimeBytecodeHash: '0x' + '34'.repeat(32),
    strategyPassAddress: '0x4444444444444444444444444444444444444444',
    strategyPassDeploymentBlock: '2',
    strategyPassAbiHash: '0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f',
    strategyPassRuntimeBytecodeHash: '0x' + '56'.repeat(32),
  };
  const cases = [];
  for (const scenario of [
    { name: 'allowlist without provider', many: true, provider: false, configured: true },
    { name: 'allowlist with unavailable RPC', many: true, provider: true, configured: true },
    { name: 'single deployment with unavailable RPC', many: false, provider: true, configured: true },
    { name: 'wallet without deployment', many: false, provider: true, configured: false },
  ]) {
    const page = await parent.context().newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.addInitScript(
        ({ scenario, deployment }) => {
          // Boundary fixture only: no provider method can sign or broadcast.
          window.bootstrapRequests = [];
          window.AF = scenario.many
            ? { m3Deployments: [deployment] }
            : scenario.configured
              ? { m3Deployment: deployment }
              : {};
          if (scenario.provider)
            window.ethereum = {
              on() {},
              removeListener() {},
              async request(input) {
                window.bootstrapRequests.push(input.method);
                if (input.method === 'eth_chainId') return '0xb626';
                if (input.method === 'eth_accounts' || input.method === 'eth_requestAccounts')
                  return ['0x1111111111111111111111111111111111111111'];
                throw Error('LOCAL_MOCK_RPC_UNAVAILABLE');
              },
            };
        },
        { scenario, deployment },
      );
      await page.goto(`${origin}/#/trade/trend`);
      await page.locator('[data-product-login="alice"]').click();
      await page.waitForFunction(() =>
        /^(READY|EMPTY)$/.test(document.querySelector('[data-product-state]')?.textContent ?? ''),
      );
      await page.locator('[aria-label="M3 product chain status"]').waitFor();
      assert.equal(await page.locator('[data-chain-vault-select]').count(), scenario.many ? 1 : 0);
      await page.locator('[data-chain-connect]').click();
      if (scenario.configured) {
        await page.waitForFunction(
          () => document.querySelector('[data-product-state]')?.textContent === 'ERROR',
        );
        assert.match(
          await page.locator('[role="alert"]').first().textContent(),
          scenario.provider ? /M3_LIVE_READ_FAILED/ : /WALLET_PROVIDER_UNAVAILABLE/,
        );
      } else {
        await page.waitForFunction(() =>
          document
            .querySelector('[aria-label="M3 product chain status"]')
            ?.textContent.includes('Connected to the required Robinhood Chain Testnet.'),
        );
        assert.match(
          await page.locator('[aria-label="M3 product chain status"]').textContent(),
          /NOT DEPLOYED/,
        );
      }
      for (const button of await page.locator('[data-chain-action], [data-pass-transfer]').all())
        assert.equal(await button.isEnabled(), false);
      assert.equal(
        (await page.evaluate(() => window.bootstrapRequests)).includes('eth_sendTransaction'),
        false,
      );
      assert.deepEqual(errors, []);
      cases.push(
        `Configured startup ${scenario.name}: real product module keeps writes disabled and sends no transaction`,
      );
    } finally {
      await page.close();
    }
  }
  return cases;
}

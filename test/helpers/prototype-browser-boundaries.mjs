/* global window, document */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual loaded browser model. All values are fictional DEMO fixtures;
// these checks are separate from visible journeys and never certify chain accounting.
export async function verifyPrototypeBoundaries(page) {
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
  return cases;
}

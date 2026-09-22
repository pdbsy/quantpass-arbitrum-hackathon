/* global window */
import assert from 'node:assert/strict';

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

  // Restore the earlier visible-journey fixture, preserving the original six strategies.
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

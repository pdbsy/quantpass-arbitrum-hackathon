import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockWalletSession, MOCK_STARTER_PASS_GRANTS } from '../apps/web/src/mock-wallet.ts';
import { mockExchangeFixture } from './helpers/mock-exchange-fixture.ts';

const strategies = [
  { id: 'trend', name: 'Ridgeline · Trend Following' },
  { id: 'factor', name: 'Prism · Multi-factor Research' },
  { id: 'mean', name: 'Echo · Mean Reversion' },
];
const storageAdapter = (stored: Map<string, string>) => ({
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => {
    stored.set(key, value);
  },
  removeItem: (key: string) => {
    stored.delete(key);
  },
});

test('connecting a Mock Wallet grants real starter Pass without spending either asset', () => {
  const { exchange, storage } = mockExchangeFixture(undefined, strategies);
  const before = exchange.read();
  const session = createMockWalletSession(
    () => exchange.read(),
    strategies,
    storageAdapter(storage),
    (grants) => exchange.ensureMockHoldings(grants),
  );
  assert.equal(session.snapshot(), undefined);
  assert.deepEqual(exchange.read(), before, 'visiting the page cannot grant before connecting');
  session.connect();
  const seeded = exchange.read();
  assert.equal(seeded.cash, before.cash);
  assert.equal(seeded.initialCapital, before.initialCapital);
  assert.equal(seeded.realized, before.realized);
  assert.equal(seeded.fees, before.fees);
  assert.deepEqual(seeded.orders, before.orders);
  assert.deepEqual(seeded.executed, before.executed);
  assert.deepEqual(seeded.funding, before.funding);
  assert.equal(seeded.revision, before.revision + 1);
  assert.deepEqual(
    seeded.mockPassGrants?.map(({ strategy, quantity, status }) => ({ strategy, quantity, status })),
    [
      { strategy: 'trend', quantity: 1000, status: 'granted' },
      { strategy: 'factor', quantity: 750, status: 'granted' },
      { strategy: 'mean', quantity: 500, status: 'granted' },
    ],
  );
  for (const grant of MOCK_STARTER_PASS_GRANTS) {
    assert.equal(seeded.positions[grant.strategy]?.qty, grant.quantity);
    assert.equal(seeded.positions[grant.strategy]?.cost, 0);
    assert.equal(exchange.fundingSnapshot(grant.strategy).available, grant.quantity * 1000000);
  }
  assert.deepEqual(
    session.snapshot()?.holdings?.map(({ id, quantity, availablePass, frozenPass }) => ({
      id,
      quantity,
      availablePass,
      frozenPass,
    })),
    [
      { id: 'trend', quantity: 1000, availablePass: '1000', frozenPass: '0' },
      { id: 'factor', quantity: 750, availablePass: '750', frozenPass: '0' },
      { id: 'mean', quantity: 500, availablePass: '500', frozenPass: '0' },
    ],
  );
});

test('an already connected Mock Wallet receives starter Pass once and retains them on reload', () => {
  const stored = new Map<string, string>([['alphaforge.mock-wallet.v1', 'connected']]);
  const { exchange, storage } = mockExchangeFixture(undefined, strategies);
  const session = createMockWalletSession(
    () => exchange.read(),
    strategies,
    storageAdapter(stored),
    (grants) => exchange.ensureMockHoldings(grants),
  );
  assert.equal(session.snapshot()?.holdings?.length, 3);
  const seeded = exchange.read();
  session.connect();
  assert.deepEqual(exchange.read(), seeded, 'reconnecting cannot grant twice');
  const reloaded = mockExchangeFixture(storage.get('alphaforge.passmarket.v3'), strategies);
  createMockWalletSession(
    () => reloaded.exchange.read(),
    strategies,
    storageAdapter(stored),
    (grants) => reloaded.exchange.ensureMockHoldings(grants),
  );
  assert.deepEqual(reloaded.exchange.read(), seeded, 'the permanent grant survives a page reload');
});

test('starter grants preserve existing positions, past sales and funding history', () => {
  const { exchange } = mockExchangeFixture(undefined, strategies);
  exchange.execute(exchange.review({ strategy: 'trend', side: 'buy', qty: 5 }));
  exchange.executeFunding(exchange.reviewFunding({ strategy: 'trend', kind: 'deposit', amount: 2000000 }));
  exchange.execute(exchange.review({ strategy: 'factor', side: 'buy', qty: 3 }));
  exchange.execute(exchange.review({ strategy: 'factor', side: 'sell', qty: 3 }));
  const before = exchange.read();
  const seeded = exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS);
  assert.deepEqual(
    seeded.positions.trend,
    before.positions.trend,
    'existing Pass are not overwritten or enlarged',
  );
  assert.deepEqual(seeded.positions.factor, before.positions.factor, 'sold positions are not reissued');
  assert.equal(seeded.positions.mean?.qty, 500);
  assert.equal(seeded.cash, before.cash);
  assert.equal(seeded.initialCapital, before.initialCapital);
  assert.equal(seeded.realized, before.realized);
  assert.equal(seeded.fees, before.fees);
  assert.deepEqual(seeded.funding, before.funding);
  assert.deepEqual(seeded.orders, before.orders);
  assert.deepEqual(seeded.executed, before.executed);
  assert.deepEqual(
    seeded.mockPassGrants?.map(({ strategy, quantity, status }) => ({ strategy, quantity, status })),
    [
      { strategy: 'trend', quantity: 0, status: 'existing' },
      { strategy: 'factor', quantity: 0, status: 'existing' },
      { strategy: 'mean', quantity: 500, status: 'granted' },
    ],
  );
});

test('selling gifted Pass does not make reconnect or reload a new grant', () => {
  const { exchange, storage } = mockExchangeFixture(undefined, strategies);
  exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS);
  exchange.execute(exchange.review({ strategy: 'trend', side: 'sell', qty: 1000 }));
  const sold = exchange.read();
  assert.equal(sold.positions.trend?.qty, 0);
  assert.deepEqual(exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS), sold);
  const reloaded = mockExchangeFixture(storage.get('alphaforge.passmarket.v3'), strategies);
  assert.deepEqual(reloaded.exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS), sold);
});

test('generated Pass use the same one-to-one USDC capacity and funding controls', () => {
  const { exchange } = mockExchangeFixture(undefined, strategies);
  exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS);
  const before = exchange.read();
  exchange.executeFunding(exchange.reviewFunding({ strategy: 'trend', kind: 'deposit', amount: 250000000 }));
  assert.equal(exchange.read().cash, before.cash);
  assert.equal(exchange.read().funding.cash, before.funding.cash - 250000000);
  assert.equal(exchange.fundingSnapshot('trend').passQty, 1000);
  assert.equal(exchange.fundingSnapshot('trend').frozen, 250000000);
  assert.equal(exchange.fundingSnapshot('trend').available, 750000000);
  assert.throws(
    () => exchange.reviewFunding({ strategy: 'trend', kind: 'deposit', amount: 751000000 }),
    /Insufficient available Pass capacity/,
  );
  exchange.executeFunding(exchange.reviewFunding({ strategy: 'trend', kind: 'withdraw', amount: 250000000 }));
  assert.equal(exchange.fundingSnapshot('trend').available, 1000000000);
  assert.equal(exchange.read().funding.cash, before.funding.cash);
});

test('invalid grants and persistence failures preserve all current wallet records', () => {
  const { exchange, storage } = mockExchangeFixture(undefined, strategies);
  const before = exchange.read();
  for (const grants of [
    [{ strategy: 'unknown', quantity: 1000 }],
    [{ strategy: 'trend', quantity: -1 }],
    [{ strategy: 'trend', quantity: 0.5 }],
    [{ strategy: 'trend', quantity: 1000001 }],
    [
      { strategy: 'trend', quantity: 1 },
      { strategy: 'trend', quantity: 1 },
    ],
  ]) {
    assert.throws(() => exchange.ensureMockHoldings(grants), /Invalid Mock starter Pass request/);
    assert.deepEqual(exchange.read(), before);
  }
  const save = storage.set.bind(storage);
  storage.set = () => {
    throw Error('Storage unavailable');
  };
  assert.throws(() => exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS), /could not be saved/);
  assert.deepEqual(exchange.read(), before, 'no in-memory mint survives a failed persistent write');
  storage.set = save;
  exchange.ensureMockHoldings(MOCK_STARTER_PASS_GRANTS);
  const seeded = exchange.read();
  assert.throws(
    () => exchange.ensureMockHoldings([{ strategy: 'trend', quantity: 999 }]),
    /already configured with a different quantity/,
  );
  assert.deepEqual(exchange.read(), seeded);
});

test('Mock Wallet connects without fabricated Pass when seeding is unavailable', () => {
  const { exchange } = mockExchangeFixture(undefined, strategies);
  const before = exchange.read();
  const session = createMockWalletSession(
    () => exchange.read(),
    strategies,
    undefined,
    () => {
      throw Error('Storage unavailable');
    },
  );
  session.connect();
  assert.equal(session.snapshot()?.ethBalance, '10000.00');
  assert.deepEqual(session.snapshot()?.holdings, []);
  assert.deepEqual(exchange.read(), before);
});

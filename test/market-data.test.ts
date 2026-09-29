import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistry, normalizeReference } from '../packages/market-data/src/robinhood.ts';

const address = '0x' + '12'.repeat(20);
const id = '0x' + 'ab'.repeat(32);
const at = Date.parse('2026-09-30T01:00:00Z');
const selection = { chainId: 4663 as const, contractAddress: address, symbol: 'AAPL' };
const asset = () => ({
  id,
  isin: 'US0378331005',
  tokenSymbol: 'AAPL',
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1.500000000000000000',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: address }],
  tradingCapabilities: { market: { whole: 'TRADING_STATUS_TRADABLE' } },
});
const quotes = (patch = {}) => ({
  quotes: [
    {
      tokenSymbol: 'AAPL',
      deployments: [{ chainId: 4663, contractAddress: address }],
      bid: '100.123456789',
      ask: '100.223456789',
      currency: 'USD',
      isTradingHalt: false,
      generatedAt: '2026-09-30T01:00:00Z',
      ...patch,
    },
  ],
});
const registry = () => parseRegistry({ assets: [asset()] });

test('reference conversion preserves eighteen decimal prices and is never trading admission', () => {
  const q = normalizeReference(registry(), quotes(), selection, at + 1000, 30000);
  assert.equal(q.tokenBidUsd18, '150185185183500000000');
  assert.equal(q.tokenAskUsd18, '150335185183500000000');
  assert.equal(q.kind, 'REFERENCE_ONLY');
  assert.equal(q.assetId, id);
  assert.equal(q.identity, '4663:' + address);
  assert.equal(q.receivedAt, at + 1000);
  assert.equal(q.generatedAt, at);
});
test('matching ticker cannot substitute another deployment or another chain', () => {
  assert.throws(
    () => normalizeReference(registry(), quotes(), { ...selection, chainId: 46630 }, at, 30000),
    /DEPLOYMENT/,
  );
  assert.throws(
    () =>
      normalizeReference(
        registry(),
        quotes({ deployments: [{ chainId: 4663, contractAddress: '0x' + '34'.repeat(20) }] }),
        selection,
        at,
        30000,
      ),
    /DEPLOYMENT/,
  );
});
test('stale, future, halted, inverted, zero and non-decimal prices cannot become observations', () => {
  for (const patch of [
    { isTradingHalt: true },
    { bid: '101' },
    { ask: '0' },
    { bid: '1e2' },
    { bid: 100 },
    { currency: 'EUR' },
    { generatedAt: 'tomorrow' },
    { generatedAt: '2026-09-30T01:00:01Z' },
  ]) {
    assert.throws(() => normalizeReference(registry(), quotes(patch), selection, at, 30000));
  }
  assert.throws(() => normalizeReference(registry(), quotes(), selection, at + 30001, 30000), /STALE/);
  assert.throws(() => normalizeReference(registry(), quotes(), selection, at, NaN));
});
test('inactive assets and unapplied corporate-action transitions fail closed', () => {
  for (const patch of [
    { status: 'ASSET_STATUS_INACTIVE' },
    { currentMultiplier: '0' },
    { pendingMultiplier: '2.0' },
  ]) {
    assert.throws(() =>
      normalizeReference(
        parseRegistry({ assets: [{ ...asset(), ...patch }] }),
        quotes(),
        selection,
        at,
        30000,
      ),
    );
  }
});
test('duplicate registry identity or deployment and ambiguous quotes are rejected', () => {
  assert.throws(() => parseRegistry({ assets: [asset(), asset()] }), /DUPLICATE/);
  assert.throws(
    () => parseRegistry({ assets: [asset(), { ...asset(), id: '0x' + 'cd'.repeat(32) }] }),
    /DUPLICATE/,
  );
  assert.throws(
    () =>
      normalizeReference(
        registry(),
        { quotes: [...quotes().quotes, ...quotes().quotes] },
        selection,
        at,
        30000,
      ),
    /AMBIGUOUS/,
  );
});
test('price bounds round conservatively when multiplication exceeds price precision', () => {
  const r = parseRegistry({ assets: [{ ...asset(), currentMultiplier: '1.000000000000000001' }] });
  const q = normalizeReference(
    r,
    quotes({ bid: '1.000000000000000001', ask: '1.000000000000000001' }),
    selection,
    at,
    30000,
  );
  assert.equal(q.tokenBidUsd18, '1000000000000000002');
  assert.equal(q.tokenAskUsd18, '1000000000000000003');
});

test('official nanosecond timestamps normalize to milliseconds without rejecting valid quotes', () => {
  const q = normalizeReference(
    registry(),
    quotes({ generatedAt: '2026-09-30T01:00:00.338002665Z' }),
    selection,
    at + 1000,
    30000,
  );
  assert.equal(q.generatedAt, at + 338);
});
test('invalid calendar dates do not silently roll into another trading day', () => {
  assert.throws(
    () =>
      normalizeReference(
        registry(),
        quotes({ generatedAt: '2026-02-30T01:00:00Z' }),
        selection,
        Date.parse('2026-03-02T01:00:00Z'),
        30000,
      ),
    /TIME/,
  );
});

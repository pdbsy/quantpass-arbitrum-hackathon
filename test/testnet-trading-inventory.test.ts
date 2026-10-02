import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { validateTradingInventory } from '../packages/testnet/src/trading-inventory.ts';

const address = (i: number) => '0x' + i.toString(16).padStart(40, '0');
const hash = '0x' + 'ab'.repeat(32);
const input = () => ({
  schemaVersion: 1,
  chainId: 46630,
  kind: 'TEST_SUBSTITUTES',
  deploymentManifestDigest: hash,
  owner: address(1),
  passLocker: address(2),
  usdc: address(3),
  router: address(4),
  quoter: address(5),
  factory: address(6),
  maxPriceAge: 30,
  stocks: ['MSFT', 'NVDA', 'AAPL'].map((symbol, i) => ({
    symbol,
    token: address(10 + i),
    feed: address(20 + i),
    pool: address(30 + i),
    referenceIdentity: '0x' + String(i + 1).repeat(64),
    keeper: address(40),
  })),
  codeHashes: [
    address(2),
    address(3),
    address(4),
    address(5),
    address(6),
    ...Array.from({ length: 3 }, (_, i) => [address(10 + i), address(20 + i), address(30 + i)]).flat(),
  ].map((address) => ({ address, hash })),
});
const digest = (value: unknown) => '0x' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('inventory binds exact test substitutes, ordered identities and complete code evidence', () => {
  const raw = input(),
    approved = validateTradingInventory(raw, digest(raw), hash);
  assert.equal(approved.stocks[2]!.symbol, 'AAPL');
  assert.equal(Object.isFrozen(approved.stocks[0]), true);
  raw.stocks[0]!.symbol = 'AAPL';
  assert.equal(approved.stocks[0]!.symbol, 'MSFT');
  for (const change of [
    { ...input(), chainId: 4663 },
    { ...input(), kind: 'CANONICAL_STOCK_TOKEN' },
    { ...input(), codeHashes: input().codeHashes.slice(1) },
    { ...input(), stocks: [...input().stocks, input().stocks[0]] },
    { ...input(), maxPriceAge: 0 },
  ])
    assert.throws(() => validateTradingInventory(change, digest(change), hash), /TRADING_INVENTORY/);
  assert.throws(() => validateTradingInventory(input(), '0x' + 'cd'.repeat(32), hash), /TRADING_INVENTORY/);
});

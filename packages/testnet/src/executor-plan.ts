import { createHash } from 'node:crypto';
import { walletAddress } from './address.ts';
import type { TradingSnapshot } from './trading-reader.ts';
import type { TradingInventory } from './trading-inventory.ts';
import type { OrderIntent } from './order-journal.ts';
import { tradingInterface } from './trading-abi.ts';

export interface TradeRequest {
  readonly stockIndex: number;
  readonly side: 'BUY' | 'SELL';
  readonly amountIn: string;
  readonly deadline: string;
  readonly sourceDigest: string;
  readonly createdAt: number;
  readonly executor: string;
}
export const evidenceHash = (v: unknown) =>
  '0x' + createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uint = (v: string) => {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 2n ** 256n) throw new Error('EXECUTOR_INPUT');
  return BigInt(v);
};
const reached = (value: bigint, low: string, high: string) =>
  (uint(low) !== 0n && value <= uint(low)) || (uint(high) !== 0n && value >= uint(high));
/** Inclusive bounds; missing valuation blocks preparation rather than inventing a NAV. */
export function riskNeedsLiquidation(s: TradingSnapshot): boolean {
  return (
    s.liquidating ||
    (s.grant.executor !== '0x' + '0'.repeat(40) && uint(s.blockTimestamp) >= uint(s.grant.expiresAt)) ||
    (s.unitNav !== null &&
      uint(s.runtimeUnits) > 0n &&
      reached(uint(s.unitNav), s.lowerUnitNav, s.upperUnitNav)) ||
    s.stocks.some(
      (stock) =>
        uint(stock.position) > 0n &&
        stock.priceValid &&
        reached(uint(stock.priceUsdc), stock.lowerPrice, stock.upperPrice),
    )
  );
}
/** Internal pure planner. Its snapshot must come from readTradingSnapshot, never an HTTP assertion. */
export function planExecutorTrade(
  s: TradingSnapshot,
  inventory: TradingInventory,
  r: TradeRequest,
  quotedOut: string,
) {
  if (
    Object.keys(r).length !== 7 ||
    !Number.isInteger(r.stockIndex) ||
    r.stockIndex < 0 ||
    r.stockIndex > 2 ||
    !['BUY', 'SELL'].includes(r.side) ||
    !/^0x[0-9a-f]{64}$/.test(r.sourceDigest) ||
    /^0x0+$/.test(r.sourceDigest) ||
    !Number.isSafeInteger(r.createdAt) ||
    r.createdAt < 0 ||
    s.chainId !== 46630 ||
    s.closed ||
    s.manifestDigest !== inventory.deploymentManifestDigest ||
    s.owner !== inventory.owner ||
    walletAddress(r.executor) !== s.grant.executor ||
    r.executor === s.owner
  )
    throw new Error('EXECUTOR_AUTHORITY');
  const stock = s.stocks[r.stockIndex]!,
    mapping = inventory.stocks[r.stockIndex]!;
  if (stock.token !== mapping.token || stock.pool !== mapping.pool || !stock.priceValid)
    throw new Error('EXECUTOR_REFERENCE');
  const now = uint(s.blockTimestamp),
    deadline = uint(r.deadline),
    amount = uint(r.amountIn),
    quote = uint(quotedOut);
  if (
    BigInt(Math.floor(r.createdAt / 1000)) < now ||
    BigInt(Math.floor(r.createdAt / 1000)) - now > 30n ||
    deadline < now ||
    deadline >= 2n ** 64n ||
    amount === 0n ||
    quote === 0n
  )
    throw new Error('EXECUTOR_TIME_AMOUNT');
  const buy = r.side === 'BUY',
    expiry = now >= uint(s.grant.expiresAt);
  const last = s.liquidating
    ? uint(s.liquidationUntil)
    : uint(s.grant.expiresAt) + (expiry ? uint(s.grant.liquidationWindow) : 0n);
  if (now > last || deadline > last || (buy && riskNeedsLiquidation(s)))
    throw new Error('EXECUTOR_LIQUIDATION');
  const price = uint(stock.priceUsdc),
    position = uint(stock.position),
    notional = buy ? amount : (amount * price) / 10n ** 18n;
  const slip = uint(s.grant.maxSlippageBps);
  if (slip >= 10000n || uint(s.grant.maxOrderUsdc) === 0n || notional > uint(s.grant.maxOrderUsdc))
    throw new Error('EXECUTOR_LIMIT');
  const referenceOut = buy ? (amount * 10n ** 18n) / price : notional;
  const minOut = (referenceOut * (10000n - slip)) / 10000n;
  if (minOut === 0n) throw new Error('EXECUTOR_SUBPRECISION');
  if (buy) {
    if (
      s.runtimeEquity === null ||
      amount > uint(s.runtimeCash) ||
      amount + uint(s.totalBuyUsdc) > uint(s.grant.maxTotalBuyUsdc) ||
      ((position * price) / 10n ** 18n + amount) * 3n > uint(s.runtimeEquity)
    )
      throw new Error('EXECUTOR_CAPACITY');
  } else if (amount > position) throw new Error('EXECUTOR_POSITION');
  if (quote < minOut)
    return Object.freeze({
      state: 'PAUSED_POOL_PRICE_DEVIATION' as const,
      intent: null,
      quotedOut,
      minAmountOut: String(minOut),
    });
  // Validate the quoted post-fill cap too; the chain performs its own authoritative check.
  if (buy) {
    const value = ((position + quote) * price) / 10n ** 18n;
    const equity = uint(s.runtimeEquity!) - amount - (position * price) / 10n ** 18n + value;
    if (value * 3n > equity) throw new Error('EXECUTOR_POST_FILL_CAPACITY');
  }
  const calldata = tradingInterface.encodeFunctionData('execute', [
    [
      buy ? inventory.usdc : stock.token,
      buy ? stock.token : inventory.usdc,
      amount,
      minOut,
      deadline,
      uint(s.stateVersion),
    ],
  ]);
  const basis = {
    chainId: 46630,
    owner: s.owner,
    executor: s.grant.executor,
    vault: s.vault,
    manifestDigest: s.manifestDigest,
    sourceDigest: r.sourceDigest,
    grantVersion: s.grantVersion,
    stateVersion: s.stateVersion,
    snapshotHash: evidenceHash(s),
    calldata,
    createdAt: r.createdAt,
  };
  const intent: OrderIntent = Object.freeze({ id: evidenceHash(basis).slice(2), ...basis });
  return Object.freeze({ state: 'READY' as const, intent, quotedOut, minAmountOut: String(minOut) });
}

import { LaunchMarketError } from './types.ts';
import { PASS_UNIT, MINT_PRICE_USDC } from './config.ts';

export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
export function mintCost(passAmount: bigint): bigint {
  if (passAmount <= 0n) throw new LaunchMarketError('INVALID_AMOUNT', 400);
  if (passAmount % (PASS_UNIT / MINT_PRICE_USDC) !== 0n) throw new LaunchMarketError('MINT_PRECISION', 400);
  return (passAmount * MINT_PRICE_USDC) / PASS_UNIT;
}
export function minOutput(output: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500)
    throw new LaunchMarketError('SLIPPAGE_LIMIT', 400);
  const result = (output * BigInt(10_000 - slippageBps)) / 10_000n;
  if (result === 0n) throw new LaunchMarketError('ZERO_OUTPUT');
  return result;
}
export function ammQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n)
    throw new LaunchMarketError('INSUFFICIENT_LIQUIDITY');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000)
    throw new LaunchMarketError('INVALID_AMM_FEE');
  const fee = ceilDiv(amountIn * BigInt(feeBps), 10_000n);
  const effective = amountIn - fee;
  const output = (effective * reserveOut) / (reserveIn + effective);
  if (output === 0n || output >= reserveOut) throw new LaunchMarketError('ZERO_OUTPUT');
  const spot = (amountIn * reserveOut) / reserveIn;
  const impact = spot === 0n ? 0n : ((spot - output) * 10_000n) / spot;
  return { output, fee, priceImpactBps: Number(impact) };
}
/** ETH/USD is six-decimal USDC per ETH. Fees remain in the independent conversion reserve. */
export function ethForUsdc(usdc: bigint, ethUsdPrice: bigint, feeBps: number): bigint {
  if (usdc <= 0n || ethUsdPrice <= 0n || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000)
    throw new LaunchMarketError('INVALID_CONVERSION');
  const gross = ceilDiv(usdc * 10_000n, BigInt(10_000 - feeBps));
  return ceilDiv(gross * 10n ** 18n, ethUsdPrice);
}
export function usdcForEth(eth: bigint, ethUsdPrice: bigint, feeBps: number): bigint {
  if (eth <= 0n || ethUsdPrice <= 0n || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000)
    throw new LaunchMarketError('INVALID_CONVERSION');
  const gross = (eth * ethUsdPrice) / 10n ** 18n;
  return gross - ceilDiv(gross * BigInt(feeBps), 10_000n);
}
export function ethSaleOutput(usdc: bigint, ethUsdPrice: bigint, feeBps: number): bigint {
  if (usdc <= 0n || ethUsdPrice <= 0n || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000)
    throw new LaunchMarketError('INVALID_CONVERSION');
  const fee = ceilDiv(usdc * BigInt(feeBps), 10_000n);
  return ((usdc - fee) * 10n ** 18n) / ethUsdPrice;
}

import { decimalRaw } from '../testnet-action-form.ts';
import type {
  LaunchClientState,
  LaunchQuote,
  LaunchMarket,
  MarketOperation,
  PaymentAsset,
  StrategyId,
} from './model.ts';

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function rawAmount(value: string | null | undefined, decimals: number, digits = 6): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) return '—';
  const scale = 10n ** BigInt(decimals);
  const raw = BigInt(value);
  if (raw >= 2n ** 256n) return '—';
  const whole = new Intl.NumberFormat('en-US').format(raw / scale);
  const preciseFraction = (raw % scale).toString().padStart(decimals, '0');
  let fraction = preciseFraction.slice(0, Math.min(decimals, digits)).replace(/0+$/, '');
  const truncated = /[1-9]/.test(preciseFraction.slice(Math.min(decimals, digits)));
  // Never display a positive base-unit amount as zero. Rounded portfolio values are marked explicitly.
  if (raw > 0n && raw < scale && !/[1-9]/.test(fraction)) fraction = preciseFraction.replace(/0+$/, '');
  const approximate = truncated && !(raw < scale && fraction === preciseFraction.replace(/0+$/, ''));
  return `${approximate ? '≈' : ''}${fraction ? `${whole}.${fraction}` : whole}`;
}

export function inputRaw(operation: MarketOperation, asset: PaymentAsset, amount: string): string {
  if (operation === 'CLAIM' || operation === 'CLOSE' || operation === 'CREATE_VAULT') return '0';
  const decimals =
    operation === 'DEPOSIT' || operation === 'WITHDRAW' || (operation === 'BUY' && asset === 'AF_USDC')
      ? 6
      : 18;
  const raw = decimalRaw(amount, decimals);
  if (BigInt(raw) === 0n) throw new Error('Enter an amount greater than zero.');
  return raw;
}

export function inputUnit(operation: MarketOperation, asset: PaymentAsset): string {
  return operation === 'MINT' || operation === 'SELL' ? 'PASS' : asset === 'ETH' ? 'ETH' : 'AF-USDC';
}

export function outputUnit(quote: LaunchQuote): string {
  return quote.operation === 'MINT' || quote.operation === 'BUY'
    ? 'PASS'
    : quote.asset === 'ETH' && quote.operation === 'SELL'
      ? 'ETH'
      : 'AF-USDC';
}

export function poolPrice(market: LaunchMarket | undefined): string {
  if (!market || market.state !== 'LAUNCHED' || BigInt(market.reservePassRaw) === 0n) return '—';
  return rawAmount(String((BigInt(market.reserveUsdcRaw) * 10n ** 18n) / BigInt(market.reservePassRaw)), 6);
}

export function progress(market: LaunchMarket | undefined): string {
  if (!market || BigInt(market.publicSupplyRaw) === 0n) return '—';
  return `${Number((BigInt(market.soldRaw) * 10000n) / BigInt(market.publicSupplyRaw)) / 100}%`;
}

export function actionable(
  state: LaunchClientState,
  strategy: StrategyId,
  operation: MarketOperation,
  asset: PaymentAsset,
): boolean {
  if (
    state.config?.deployment !== 'CONFIGURED' ||
    !state.snapshot ||
    !state.owner ||
    !state.wallet ||
    state.busy ||
    ['AWAITING_WALLET', 'SUBMITTED', 'INCLUDED', 'CONFIRMED_L2', 'REORGED', 'RECOVERY_REQUIRED'].includes(
      state.transaction.state,
    )
  )
    return false;
  if (operation === 'CLAIM')
    return (
      state.snapshot.claim.funded && state.snapshot.claim.remainingClaims > 0 && !!state.wallet.accountId
    );
  if (operation === 'CREATE_VAULT')
    return (
      !!state.config.manifest?.vaultFactory &&
      !state.wallet.vaults.some((vault) => vault.strategyId === strategy)
    );
  if (['DEPOSIT', 'WITHDRAW', 'CLOSE'].includes(operation))
    return !!state.wallet.vaults.find((vault) => vault.strategyId === strategy && vault.status === 'OPEN');
  const market = state.snapshot.markets[strategy];
  if (operation === 'MINT' ? market.state !== 'MINTING' : market.state !== 'LAUNCHED') return false;
  if (asset === 'ETH')
    return operation === 'SELL'
      ? state.snapshot.conversion.ethSellAvailable
      : operation === 'MINT'
        ? (state.snapshot.conversion.ethMintAvailable ?? state.snapshot.conversion.ethBuyAvailable)
        : state.snapshot.conversion.ethBuyAvailable;
  return true;
}

export function signedAmount(value: string | null | undefined, decimals = 6): string {
  if (typeof value !== 'string') return '—';
  return value.startsWith('-') ? `-${rawAmount(value.slice(1), decimals)}` : rawAmount(value, decimals);
}

export function quoteIsFinalMint(state: LaunchClientState, quote: LaunchQuote): boolean {
  return (
    quote.operation === 'MINT' &&
    quote.strategyId === 'TSLA' &&
    !!state.snapshot &&
    BigInt(quote.estimatedOutRaw) === BigInt(state.snapshot.markets.TSLA.remainingRaw)
  );
}

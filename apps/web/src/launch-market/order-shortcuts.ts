import type { LaunchClientState, StrategyId } from './model.ts';
import type { OrderForm } from './shell.ts';
import { ammQuote, usdcForEth } from '../../../../packages/launch-market/src/math.ts';

const passUnit = 10n ** 18n;
export const nativeMaxPolicy = {
  mintGasUnits: 3_000_000n,
  buyGasUnits: 1_000_000n,
  safetyMultiplier: 2n,
  minimumReserveWei: 10_000_000_000_000n,
};

/** Input strings retain all asset decimals, with no display rounding or grouping. */
export function shortcutInput(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const fraction = (raw % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${raw / unit}${fraction ? `.${fraction}` : ''}`;
}

export function shortcutPresets(form: OrderForm, passQuantity = false) {
  const unit =
    form.operation === 'BUY' && !passQuantity ? (form.asset === 'ETH' ? 'ETH' : 'AF-USDC') : 'PASS';
  const values =
    form.operation === 'BUY' && form.asset === 'ETH' && !passQuantity
      ? ['0.0001', '0.0005', '0.001']
      : ['10', '50', '100'];
  return values.map((value) => ({ value, label: `${value} ${unit}` }));
}

export function maxShortcutAmount(
  state: LaunchClientState,
  strategy: StrategyId,
  form: OrderForm,
  native?: { gasReserveRaw: string; ethUsdPriceRaw?: string },
  passQuantity = false,
): string {
  const wallet = state.wallet;
  const market = state.snapshot?.markets[strategy];
  if (!wallet || !state.owner || wallet.owner.toLowerCase() !== state.owner.toLowerCase() || !market)
    throw new Error('Connect your wallet and refresh its balances before using Max.');
  if (form.operation === 'SELL') {
    const available = BigInt(wallet.passes[strategy].availableRaw);
    if (available === 0n) throw new Error('No unlocked PASS is available to sell.');
    return shortcutInput(available, 18);
  }
  let spend = BigInt(wallet.usdcBalanceRaw);
  if (form.asset === 'ETH') {
    if (!native) throw new Error('A fresh gas estimate is required for ETH Max.');
    const balance = BigInt(wallet.ethBalanceRaw),
      reserve = BigInt(native.gasReserveRaw);
    if (reserve <= 0n || balance <= reserve)
      throw new Error('Insufficient ETH after leaving a gas buffer. Enter a smaller amount or get test ETH.');
    spend = balance - reserve;
    if (form.operation === 'BUY' && !passQuantity) return shortcutInput(spend, 18);
    const price = BigInt(native.ethUsdPriceRaw ?? '0');
    if (price <= 0n) throw new Error('A fresh ETH/USD quote is required for Mint Max.');
    // Native Mint pays the recipient directly; it does not charge the conversion-reserve fee.
    spend =
      form.operation === 'BUY'
        ? usdcForEth(spend, price, state.snapshot!.conversion.feeBps)
        : (spend * price) / passUnit;
    if (form.operation === 'BUY') {
      const liquidity = BigInt(state.snapshot!.conversion.usdcReserveRaw);
      if (spend > liquidity) spend = liquidity;
    }
  } else if (form.operation === 'BUY') {
    if (spend === 0n) throw new Error('No AF-USDC is available to spend.');
    if (!passQuantity) return shortcutInput(spend, 6);
  }
  if (form.operation === 'BUY')
    return shortcutInput(
      ammQuote(spend, BigInt(market.reserveUsdcRaw), BigInt(market.reservePassRaw), market.ammFeeBps).output,
      18,
    );
  const price = BigInt(market.mintPriceUsdcRaw),
    remaining = BigInt(market.remainingRaw);
  if (price <= 0n || passUnit % price !== 0n) throw new Error('Mint price is unavailable.');
  const quantum = passUnit / price;
  const affordable = spend * quantum;
  const amount = ((affordable < remaining ? affordable : remaining) / quantum) * quantum;
  if (amount === 0n) throw new Error('No affordable Mint inventory is available.');
  return shortcutInput(amount, 18);
}

interface ShortcutHost {
  originalMarketLayout?: boolean;
  launchState?: LaunchClientState;
  launchForms?: Record<StrategyId, OrderForm>;
  trade?: { actionPanel(strategy: { id: string }): string };
}

/** Retain the native order layout and replace only its disabled demo shortcut controls. */
export function installOrderShortcuts(host: ShortcutHost, doc: Document = document): void {
  if (!host.originalMarketLayout || !host.trade) return;
  const original = host.trade.actionPanel;
  host.trade.actionPanel = (strategy) => {
    const html = original.call(host.trade, strategy),
      id = strategy.id.toUpperCase();
    if (id !== 'TSLA' && id !== 'AMZN') return html;
    const state = host.launchState,
      draft = host.launchForms?.[id];
    if (!state || !draft) return html;
    const template = doc.createElement('template');
    template.innerHTML = html;
    const market = state.snapshot?.markets[id];
    const editable =
      state.config?.deployment === 'CONFIGURED' &&
      !state.busy &&
      !['AWAITING_WALLET', 'SUBMITTED', 'INCLUDED', 'CONFIRMED_L2', 'REORGED', 'RECOVERY_REQUIRED'].includes(
        state.transaction.state,
      ) &&
      (draft.operation === 'MINT' ? market?.state === 'MINTING' : market?.state === 'LAUNCHED');
    const form = template.content.querySelector('[data-launch-order]');
    form?.setAttribute('data-launch-pass-quantity', '');
    if (draft.operation === 'BUY') {
      const input = template.content.querySelector<HTMLInputElement>('#pass-qty');
      if (input) input.placeholder = 'Enter PASS';
      const unit = template.content.querySelector('.pass-amount-wrap > span');
      if (unit) unit.textContent = 'PASS';
      const label = template.content.querySelector('label[for="pass-qty"]');
      if (label) label.textContent = 'PASS to buy';
    }
    const presets = shortcutPresets(draft, true);
    template.content.querySelectorAll<HTMLButtonElement>('[data-pass-shortcut]').forEach((button, index) => {
      button.removeAttribute('data-pass-shortcut');
      button.dataset.launchShortcut = index < presets.length ? presets[index]!.value : 'max';
      button.textContent = index < presets.length ? presets[index]!.label : 'Max';
      button.disabled = !editable || (index === presets.length && !state.wallet);
      if (
        draft.operation === 'MINT' &&
        index < presets.length &&
        market &&
        BigInt(presets[index]!.value) * passUnit > BigInt(market.remainingRaw)
      ) {
        button.disabled = true;
        button.title = 'This amount exceeds the remaining Mint inventory.';
      } else
        button.title =
          index < presets.length
            ? `Fill ${presets[index]!.label}. Review separately before any transaction.`
            : !state.wallet
              ? 'Connect your wallet to calculate Max.'
              : draft.asset === 'ETH' && draft.operation !== 'SELL'
                ? 'Max leaves a gas buffer. Review the final quote and wallet fees before confirming.'
                : 'Use the available balance, excluding locked PASS and remaining Mint limits.';
    });
    return template.innerHTML;
  };
}

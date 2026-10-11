import { uint } from '../../../../packages/launch-market/src/config.ts';
import { ammQuote, ceilDiv, ethForUsdc, ethSaleOutput } from '../../../../packages/launch-market/src/math.ts';
import { formatPoolSpotPrice } from '../pool-spot-price.ts';
import { inputRaw } from './presentation.ts';
import { shortcutInput } from './order-shortcuts.ts';
import type { LaunchClientState, StrategyId } from './model.ts';
import type { OrderForm } from './shell.ts';

export interface PaymentReference {
  readonly ethUsdPriceRaw: string;
  readonly observedAt: number;
  readonly validUntil: number;
}
export function validPaymentReference(value: PaymentReference, now: number): PaymentReference {
  if (
    !value ||
    uint(value.ethUsdPriceRaw) === 0n ||
    !Number.isSafeInteger(value.observedAt) ||
    value.observedAt < 0 ||
    value.observedAt > now ||
    !Number.isSafeInteger(value.validUntil) ||
    value.validUntil !== value.observedAt + 30 ||
    value.validUntil <= now
  )
    throw new Error('Fresh ETH/USD reference unavailable.');
  return value;
}

/** Minimum exact-input payment whose rounded AMM output reaches the requested PASS. */
export function buyPayment(pass: bigint, reservePass: bigint, reserveUsdc: bigint, feeBps: number): bigint {
  if (
    pass <= 0n ||
    pass >= reservePass ||
    reserveUsdc <= 0n ||
    !Number.isInteger(feeBps) ||
    feeBps < 0 ||
    feeBps > 1000
  )
    throw new Error('Requested PASS exceeds available pool liquidity.');
  const net = ceilDiv(pass * reserveUsdc, reservePass - pass);
  return uint(String(ceilDiv(net * 10000n, BigInt(10000 - feeBps))));
}

export function estimatePassPayment(
  state: LaunchClientState,
  strategy: StrategyId,
  form: OrderForm,
  reference?: PaymentReference,
  now = Math.floor(Date.now() / 1000),
) {
  const market = state.snapshot?.markets[strategy];
  if (state.config?.deployment !== 'CONFIGURED' || !market) throw new Error('Market unavailable.');
  const pass = uint(inputRaw('SELL', 'ETH', form.amount));
  if (pass === 0n) throw new Error('Enter a positive PASS amount.');
  const poolPass = uint(market.reservePassRaw),
    poolUsdc = uint(market.reserveUsdcRaw);
  let usdc: bigint;
  if (form.operation === 'MINT') {
    const price = uint(market.mintPriceUsdcRaw),
      product = pass * price;
    if (market.state !== 'MINTING' || pass > uint(market.remainingRaw))
      throw new Error('Requested PASS exceeds remaining Mint inventory.');
    if (price === 0n || product % 10n ** 18n !== 0n)
      throw new Error('Mint quantity must use exact AF-USDC precision.');
    usdc = product / 10n ** 18n;
  } else {
    if (market.state !== 'LAUNCHED') throw new Error('The PASS market is not live.');
    usdc =
      form.operation === 'BUY'
        ? buyPayment(pass, poolPass, poolUsdc, market.ammFeeBps)
        : ammQuote(pass, poolPass, poolUsdc, market.ammFeeBps).output;
  }
  let eth: bigint | null = null,
    assetInput = form.operation === 'BUY' ? usdc : pass;
  if (form.asset === 'ETH' && !reference && form.operation !== 'MINT') {
    const fee = state.snapshot!.conversion.feeBps;
    if (!Number.isInteger(fee) || fee < 0 || fee > 1000) throw new Error('Invalid conversion fee.');
    usdc =
      form.operation === 'BUY'
        ? ceilDiv(usdc * 10000n, BigInt(10000 - fee))
        : usdc - ceilDiv(usdc * BigInt(fee), 10000n);
  }
  if (form.asset === 'ETH' && reference) {
    const price = uint(validPaymentReference(reference, now).ethUsdPriceRaw);
    const conversion = state.snapshot!.conversion;
    eth =
      form.operation === 'MINT'
        ? ceilDiv(usdc * 10n ** 18n, price)
        : form.operation === 'BUY'
          ? ethForUsdc(usdc, price, conversion.feeBps)
          : ethSaleOutput(usdc, price, conversion.feeBps);
    if (form.operation === 'BUY') assetInput = eth;
    // Display the actual ETH payment/receipt's AF-USDC equivalent, including conversion fees.
    if (form.operation !== 'MINT') usdc = (eth * price) / 10n ** 18n;
  }
  return {
    passRaw: String(pass),
    usdcRaw: String(usdc),
    ethRaw: eth === null ? null : String(eth),
    assetInputRaw: String(assetInput),
  };
}

interface EstimateHost {
  originalMarketLayout?: boolean;
  launchState?: LaunchClientState;
  launchForms?: Record<StrategyId, OrderForm>;
  trade?: { quoteSummary(strategy: { id: string }): string };
}

/** Public display estimates are separate from reviewed, signed executable quotes. */
export function installPaymentEstimates(
  host: EstimateHost,
  readReference: () => Promise<PaymentReference>,
  doc: Document = document,
) {
  let reference: PaymentReference | undefined,
    pending = false,
    error = '',
    disposed = false,
    nextReadAt = 0;
  if (!host.originalMarketLayout || !host.trade) return { refresh() {}, dispose() {} };
  const original = host.trade.quoteSummary;
  host.trade.quoteSummary = (strategy) => {
    const template = doc.createElement('template');
    template.innerHTML = original.call(host.trade, strategy);
    const id = strategy.id.toUpperCase();
    if (id !== 'TSLA' && id !== 'AMZN') return template.innerHTML;
    const state = host.launchState,
      draft = host.launchForms?.[id];
    const total = template.content.querySelector('.order-total');
    if (!state || !draft || !total) return template.innerHTML;
    total.querySelector('dt')!.textContent =
      draft.operation === 'SELL' ? 'Estimated proceeds' : 'Estimated payment';
    const value = total.querySelector('dd')!;
    const now = Math.floor(Date.now() / 1000);
    if (reference && reference.validUntil <= now) reference = undefined;
    const market = state.snapshot?.markets[id];
    if (market?.state === 'LAUNCHED') {
      const row = template.content.querySelector('.order-quote > div');
      if (row) {
        row.querySelector('dt')!.textContent = 'Current pool spot';
        row.querySelector('dd')!.textContent =
          `${formatPoolSpotPrice(market.reserveUsdcRaw, market.reservePassRaw) ?? '—'} AF-USDC / PASS`;
      }
    }
    let ethText = '—',
      note = 'Enter a PASS amount.';
    value.textContent = '—';
    try {
      if (draft.amount) {
        const estimate = estimatePassPayment(state, id, draft, reference, now);
        value.textContent = `${shortcutInput(BigInt(estimate.usdcRaw), 6)} AF-USDC`;
        value.setAttribute('data-estimated-usdc-raw', estimate.usdcRaw);
        if (estimate.ethRaw !== null) {
          ethText = `${shortcutInput(BigInt(estimate.ethRaw), 18)} ETH`;
          note = `ETH/USD ${shortcutInput(BigInt(reference!.ethUsdPriceRaw), 6)} · ${new Date(reference!.observedAt * 1000).toISOString().slice(11, 19)} UTC · Estimate excludes gas. Review final amounts.`;
        } else
          note =
            draft.asset === 'ETH'
              ? pending
                ? 'Fetching ETH/USD reference…'
                : error || 'ETH estimate unavailable. AF-USDC estimate remains available.'
              : 'Includes AMM fees where applicable. Excludes gas. Review final amounts.';
      }
    } catch (failure) {
      note = failure instanceof Error ? failure.message : 'Estimate unavailable.';
    }
    if (draft.asset === 'ETH') {
      const row = doc.createElement('div'),
        label = doc.createElement('dt'),
        output = doc.createElement('dd');
      label.textContent = draft.operation === 'SELL' ? 'Estimated ETH received' : 'Estimated ETH payment';
      output.textContent = ethText;
      output.setAttribute('data-estimated-eth', '');
      row.append(label, output);
      total.after(row);
    }
    const caption = doc.createElement('p');
    caption.className = 'small muted';
    caption.setAttribute('data-payment-estimate-note', '');
    caption.textContent = note;
    template.content.append(caption);
    return template.innerHTML;
  };
  const refresh = () => {
    if (disposed) return;
    const form = doc.querySelector<HTMLFormElement>('[data-launch-order]'),
      id = form?.dataset.strategy;
    if (id !== 'TSLA' && id !== 'AMZN') return;
    const draft = host.launchForms?.[id];
    const now = Math.floor(Date.now() / 1000);
    const request =
      host.launchState?.config?.deployment === 'CONFIGURED' &&
      draft?.asset === 'ETH' &&
      !!draft.amount &&
      !pending &&
      now >= nextReadAt;
    if (request) {
      pending = true;
      nextReadAt = now + 5;
    }
    const summary = doc.querySelector('#pass-quote-summary');
    const html = host.trade!.quoteSummary({ id: id.toLowerCase() });
    if (summary && summary.innerHTML !== html) summary.innerHTML = html;
    if (!request) return;
    void readReference()
      .then((next) => {
        if (!disposed) {
          reference = validPaymentReference(next, Math.floor(Date.now() / 1000));
          error = '';
        }
      })
      .catch(() => {
        if (!disposed) {
          reference = undefined;
          error = 'Fresh ETH/USD reference unavailable. Choose AF-USDC or try again.';
        }
      })
      .finally(() => {
        pending = false;
        if (!disposed) {
          const active = doc.querySelector<HTMLFormElement>('[data-launch-order]')?.dataset.strategy;
          const target = doc.querySelector('#pass-quote-summary');
          if (target && (active === 'TSLA' || active === 'AMZN')) {
            const html = host.trade!.quoteSummary({ id: active.toLowerCase() });
            if (target.innerHTML !== html) target.innerHTML = html;
          }
        }
      });
  };
  const timer = setInterval(refresh, 1000);
  return {
    refresh,
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}

import type { LaunchClientState, LaunchMarket } from './model.ts';
import { escapeHtml as esc, rawAmount } from './presentation.ts';

export interface NativeMintHost {
  launchState?: LaunchClientState;
  charts: { priceBlock(strategy: { id: string }): string };
  pages: { trade(id: string): string; market?(): string };
  market?: { refresh(): void };
}

function market(state: LaunchClientState | undefined): LaunchMarket | undefined {
  return state?.config?.deployment === 'CONFIGURED' ? state.snapshot?.markets.TSLA : undefined;
}

export function nativeMintProgress(
  value: LaunchMarket | undefined,
): { label: string; percent: string } | null {
  if (!value) return null;
  const entries = [value.publicSupplyRaw, value.soldRaw, value.remainingRaw];
  if (entries.some((raw) => !/^(0|[1-9][0-9]{0,77})$/.test(raw))) return null;
  const [total, sold, remaining] = entries.map(BigInt) as [bigint, bigint, bigint];
  if (total === 0n || total >= 2n ** 256n || sold + remaining !== total) return null;
  const basisPoints = (sold * 10000n) / total;
  const percent = `${basisPoints / 100n}${basisPoints % 100n ? '.' + (basisPoints % 100n).toString().padStart(2, '0').replace(/0$/, '') : ''}`;
  return { percent, label: sold > 0n && basisPoints === 0n ? '<0.01%' : percent + '%' };
}

export function renderNativeMint(state: LaunchClientState | undefined): string {
  const observed = market(state),
    progress = nativeMintProgress(observed);
  const status =
    observed?.state ?? (state?.config?.deployment === 'NOT_DEPLOYED' ? 'NOT_DEPLOYED' : 'SYNCING');
  const note =
    status === 'MINTING'
      ? 'The final Mint launches the pool and opens trading in the same transaction.'
      : status === 'SOLD_OUT'
        ? 'Sold out. Pool launch must be verified on chain before trading opens.'
        : status === 'PREPARING'
          ? 'Mint is not open yet. Launch reserves must be prepared first.'
          : 'Mint progress will appear after the deployed contracts are synchronized.';
  const row = (name: string, key: string, value: string) =>
    `<div><dt>${name}</dt><dd data-mint-field="${key}">${esc(value)}</dd></div>`;
  return `<section class="terminal-chart sketch-box native-mint" data-native-mint aria-labelledby="mint-title"><div class="chart-section-head"><div><span class="section-label">TSLA FAIR LAUNCH / PUBLIC MINT</span><h2 id="mint-title">Mint progress</h2></div><span class="fixture-tag">${esc(status)}</span></div><div class="native-mint-progress"><strong data-mint-field="progress">${esc(progress?.label ?? '—')}</strong><span>of the public Mint subscribed</span></div><div class="native-mint-track" role="progressbar" aria-label="TSLA public Mint progress" aria-valuemin="0" aria-valuemax="100" ${progress ? `aria-valuenow="${progress.percent}" aria-valuetext="${esc(progress.label)}"` : 'aria-valuetext="Chain progress unavailable"'}><span style="width:${progress?.percent ?? '0'}%"></span></div><dl class="native-mint-stats">${row('Subscribed', 'sold', progress ? rawAmount(observed!.soldRaw, 18) + ' PASS' : '—')}${row('Remaining', 'remaining', progress ? rawAmount(observed!.remainingRaw, 18) + ' PASS' : '—')}${row(observed ? 'Public Mint' : 'Planned public Mint', 'publicSupply', observed ? rawAmount(observed.publicSupplyRaw, 18) + ' PASS' : '500,000 PASS')}${row(observed ? 'Total supply' : 'Planned total supply', 'totalSupply', observed ? rawAmount(observed.totalSupplyRaw, 18) + ' PASS' : '1,000,000 PASS')}</dl><p class="chart-bottomnote">${esc(note)}</p><p class="chart-bottomnote" data-mint-source>${observed && state?.snapshot ? `Chain snapshot · L2 block ${esc(state.snapshot.location.blockNumber)} · ${esc(state.snapshot.location.confirmations)} confirmations` : 'Chain progress unavailable · Planned quantities are not deployed balances.'}</p></section>`;
}

/** Preserve the original terminal and stock chart; only the prelaunch TSLA market view changes. */
export function installNativeMint(host: NativeMintHost, doc?: Document): () => void {
  const originalPrice = host.charts.priceBlock,
    originalTrade = host.pages.trade,
    originalMarket = host.pages.market,
    originalRefresh = host.market?.refresh;
  const mint = (id: string) => id.toLowerCase() === 'tsla' && market(host.launchState)?.state !== 'LAUNCHED';
  const price: typeof originalPrice = (strategy) =>
    mint(strategy.id) ? renderNativeMint(host.launchState) : originalPrice.call(host.charts, strategy);
  const cardQuote = () =>
    `<span>Mint <b>${esc(nativeMintProgress(market(host.launchState))?.label ?? '—')}</b></span><span>Public Mint <small>${market(host.launchState) ? esc(rawAmount(market(host.launchState)!.publicSupplyRaw, 18)) : 'Planned 500,000'} PASS</small></span>`;
  const catalogue = originalMarket
    ? () => {
        const html = originalMarket.call(host.pages);
        if (!mint('tsla')) return html;
        return html.replace(/<article class="market-card[\s\S]*?<\/article>/g, (card) =>
          card.includes('href="#/trade/tsla"')
            ? card.replace(
                /<div class="catalogue-market-quote">[\s\S]*?<\/div>/,
                `<div class="catalogue-market-quote">${cardQuote()}</div>`,
              )
            : card,
        );
      }
    : undefined;
  const refresh = originalRefresh
    ? () => {
        originalRefresh.call(host.market);
        if (!mint('tsla')) return;
        const quote = doc
          ?.querySelector('#market-results a[href="#/trade/tsla"]')
          ?.closest('article')
          ?.querySelector('.catalogue-market-quote');
        if (quote) quote.innerHTML = cardQuote();
      }
    : undefined;
  const trade: typeof originalTrade = (id) => {
    const html = originalTrade.call(host.pages, id);
    if (!mint(id)) return html;
    const observed = market(host.launchState),
      progress = nativeMintProgress(observed);
    const facts = `<div class="market-facts"><div><span>${observed ? 'Total PASS supply' : 'Planned PASS supply'}</span><strong>${observed ? esc(rawAmount(observed.totalSupplyRaw, 18)) : '1,000,000'} <small>PASS</small></strong></div><div><span>${observed ? 'Public Mint' : 'Planned public Mint'}</span><strong>${observed ? esc(rawAmount(observed.publicSupplyRaw, 18)) : '500,000'} <small>PASS</small></strong></div><div><span>Subscribed</span><strong>${progress ? esc(rawAmount(observed!.soldRaw, 18)) : '—'} <small>PASS</small></strong></div><div><span>Remaining</span><strong>${progress ? esc(rawAmount(observed!.remainingRaw, 18)) : '—'} <small>PASS</small></strong></div><div><span>Mint progress</span><strong>${esc(progress?.label ?? '—')}</strong></div></div><div class="terminal-layout">`;
    return html
      .replace(/<div class="market-facts">[\s\S]*?<div class="terminal-layout">/, facts)
      .replace(
        /<div class="mobile-order-dock">[\s\S]*?<\/div>/,
        `<div class="mobile-order-dock"><span>TSLA <b>${esc(progress?.label ?? '—')}</b><small> Mint progress</small></span><button class="primary-btn" data-v3-action="jump-order">Mint PASS ↗</button></div>`,
      );
  };
  host.charts.priceBlock = price;
  host.pages.trade = trade;
  if (catalogue) host.pages.market = catalogue;
  if (host.market && refresh) host.market.refresh = refresh;
  return () => {
    if (host.charts.priceBlock === price) host.charts.priceBlock = originalPrice;
    if (host.pages.trade === trade) host.pages.trade = originalTrade;
    if (host.pages.market === catalogue && originalMarket) host.pages.market = originalMarket;
    if (host.market && host.market.refresh === refresh && originalRefresh)
      host.market.refresh = originalRefresh;
  };
}

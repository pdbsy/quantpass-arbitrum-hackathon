import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installNativeMint,
  nativeMintProgress,
  renderNativeMint,
} from '../apps/web/src/launch-market/native-mint.ts';
import type { LaunchClientState } from '../apps/web/src/launch-market/model.ts';
import { config, snapshot } from './helpers/launch-market-ui-fixture.ts';

const P = 10n ** 18n;
function state(): LaunchClientState {
  return {
    enabled: true,
    config: config(),
    snapshot: snapshot(),
    wallet: null,
    owner: null,
    connecting: false,
    busy: false,
    quote: null,
    quoteRequest: null,
    error: null,
    notice: null,
    transaction: { state: 'IDLE', hash: null, id: null, confirmations: 0, approval: false, owner: null },
  };
}

test('missing deployed Mint data remains unknown and planned supply never becomes sold inventory', () => {
  for (const current of [
    undefined,
    { ...state(), snapshot: null },
    { ...state(), config: { ...config(), deployment: 'NOT_DEPLOYED' as const }, snapshot: snapshot() },
  ]) {
    const html = renderNativeMint(current);
    assert.match(html, /data-mint-field="progress">—/);
    assert.match(html, /data-mint-field="sold">—/);
    assert.match(html, /data-mint-field="remaining">—/);
    assert.match(html, /Planned public Mint/);
    assert.match(html, /500,000 PASS/);
    assert.doesNotMatch(html, /aria-valuenow=|>0%|data-price-reference|Pass price/);
  }
});

test('actual subscription integers determine progress, inventory and snapshot position', () => {
  const current = state(),
    market = current.snapshot!.markets.TSLA;
  const updated = { ...market, soldRaw: String(125000n * P), remainingRaw: String(375000n * P) };
  const html = renderNativeMint({
    ...current,
    snapshot: { ...current.snapshot!, markets: { ...current.snapshot!.markets, TSLA: updated } },
  });
  assert.match(html, /data-mint-field="progress">25%/);
  assert.match(html, /aria-valuenow="25"/);
  assert.match(html, /125,000 PASS/);
  assert.match(html, /375,000 PASS/);
  assert.match(html, /L2 block 100/);
  assert.doesNotMatch(html, /Live|data-price-reference|data-price-range/);
  assert.equal(
    nativeMintProgress({ ...market, soldRaw: '1', remainingRaw: String(BigInt(market.publicSupplyRaw) - 1n) })
      ?.label,
    '<0.01%',
  );
  assert.equal(
    nativeMintProgress({ ...market, soldRaw: '0', remainingRaw: market.publicSupplyRaw })?.label,
    '0%',
  );
  for (const invalid of [
    { ...market, soldRaw: market.publicSupplyRaw },
    { ...market, soldRaw: '-1' },
    { ...market, publicSupplyRaw: String(2n ** 256n) },
    { ...market, publicSupplyRaw: '0', soldRaw: '0', remainingRaw: '0' },
  ])
    assert.equal(nativeMintProgress(invalid), null);
});

test('preparing and sold out remain Mint states until actual launch is observed', () => {
  const current = state();
  const preparing = renderNativeMint({
    ...current,
    snapshot: {
      ...current.snapshot!,
      markets: {
        ...current.snapshot!.markets,
        TSLA: { ...current.snapshot!.markets.TSLA, state: 'PREPARING' },
      },
    },
  });
  assert.match(preparing, /Mint is not open yet/);
  const sold = renderNativeMint({
    ...current,
    snapshot: {
      ...current.snapshot!,
      markets: {
        ...current.snapshot!.markets,
        TSLA: {
          ...current.snapshot!.markets.TSLA,
          state: 'SOLD_OUT',
          soldRaw: String(500000n * P),
          remainingRaw: '0',
        },
      },
    },
  });
  assert.match(sold, /data-mint-field="progress">100%/);
  assert.match(sold, /launch must be verified on chain/);
  assert.doesNotMatch(sold, /LIVE TRADING|Pass price/);
});

test('only prelaunch TSLA changes its main panel, market facts and mobile dock; stock view and AMZN are preserved', () => {
  const host = {
    launchState: state(),
    charts: { priceBlock: ({ id }: { id: string }) => `<section>Pass price ${id}</section>` },
    pages: {
      trade: (id: string) =>
        `<div class="market-facts"><div>24h PASS turnover</div></div><div class="terminal-layout"><div id="trade-price">${host.charts.priceBlock({ id })}</div><div id="trade-returns">UNCHANGED_STOCK_AND_HOVER</div></div><div class="mobile-order-dock"><span>0.5 AF-USDC</span><button>Trade Pass</button></div>`,
    },
  };
  const originalPrice = host.charts.priceBlock,
    originalTrade = host.pages.trade,
    amzn = originalTrade('amzn');
  const dispose = installNativeMint(host);
  const mint = host.pages.trade('tsla');
  assert.match(mint, /data-native-mint/);
  assert.match(mint, /Mint PASS/);
  assert.match(mint, /UNCHANGED_STOCK_AND_HOVER/);
  assert.doesNotMatch(mint, /Pass price|24h PASS turnover|0.5 AF-USDC|Trade Pass/);
  assert.equal(host.pages.trade('amzn'), amzn);
  host.launchState = {
    ...host.launchState,
    snapshot: {
      ...host.launchState.snapshot!,
      markets: {
        ...host.launchState.snapshot!.markets,
        TSLA: { ...host.launchState.snapshot!.markets.TSLA, state: 'LAUNCHED' },
      },
    },
  };
  assert.equal(host.pages.trade('tsla'), originalTrade('tsla'));
  host.launchState = { ...host.launchState, snapshot: null };
  assert.match(host.pages.trade('tsla'), /data-mint-field="progress">—/);
  dispose();
  assert.equal(host.charts.priceBlock, originalPrice);
  assert.equal(host.pages.trade, originalTrade);
});

test('the catalogue shows TSLA Mint progress while retaining AMZN prices and restores price cards after launch', () => {
  const tsla =
    '<article class="market-card sketch-box"><a href="#/trade/tsla">TSLA</a><div class="catalogue-market-quote">Pass 0.50 AF-USDC</div></article>';
  const amzn =
    '<article class="market-card sketch-box"><a href="#/trade/amzn">AMZN</a><div class="catalogue-market-quote">Pass 0.50 AF-USDC</div></article>';
  const host = {
    launchState: state(),
    charts: { priceBlock: () => '' },
    pages: { trade: () => '', market: () => tsla + amzn },
  };
  const original = host.pages.market;
  const dispose = installNativeMint(host);
  const html = host.pages.market();
  assert.ok(html.endsWith(amzn));
  assert.match(html.slice(0, -amzn.length), /Mint <b>99.99%/);
  assert.doesNotMatch(html.slice(0, -amzn.length), /Pass 0.50 AF-USDC/);
  host.launchState = {
    ...host.launchState,
    snapshot: {
      ...host.launchState.snapshot!,
      markets: {
        ...host.launchState.snapshot!.markets,
        TSLA: { ...host.launchState.snapshot!.markets.TSLA, state: 'LAUNCHED' },
      },
    },
  };
  assert.equal(host.pages.market(), tsla + amzn);
  dispose();
  assert.equal(host.pages.market, original);
});

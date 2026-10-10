import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { actionable, inputRaw, poolPrice, rawAmount } from '../apps/web/src/launch-market/presentation.ts';
import {
  renderMarket,
  renderTrade,
  renderAccount,
  renderClaim,
  renderQuote,
  renderVaults,
} from '../apps/web/src/launch-market/shell.ts';
import type { LaunchClientState } from '../apps/web/src/launch-market/model.ts';
import { installLaunchMarket, type LaunchProductHost } from '../apps/web/src/launch-market/install.ts';
import { LaunchMarketClient, MarketApiError } from '../apps/web/src/launch-market/client.ts';
import { config, snapshot, wallet, quote, fixture, NOW, OWNER } from './helpers/launch-market-ui-fixture.ts';
function state(): { -readonly [K in keyof LaunchClientState]: LaunchClientState[K] } {
  return {
    enabled: true,
    config: config(),
    snapshot: snapshot(),
    wallet: wallet(),
    owner: OWNER,
    connecting: false,
    busy: false,
    quote: null,
    quoteRequest: null,
    error: null,
    notice: null,
    transaction: { state: 'IDLE', hash: null, id: null, confirmations: 0, approval: false, owner: null },
  };
}

test('Minting and Live Trading use independent actual projections with the existing design classes', () => {
  const current = state();
  const html = renderMarket(current);
  assert.match(html, /All in TSLA/);
  assert.match(html, /All in AMZN/);
  assert.match(html, /499,999 PASS/);
  assert.match(html, /99\.99/);
  assert.match(html, /0.5 AF-USDC\/PASS/);
  assert.match(html, /sketch-box/);
  assert.equal(poolPrice(current.snapshot!.markets.AMZN), '0.5');
  const trade = renderTrade(current, 'AMZN', {
    operation: 'SELL',
    asset: 'ETH',
    amount: '1',
    slippageBps: 50,
  });
  assert.match(trade, /ETH · Default/);
  assert.match(trade, /Receive/);
  assert.match(trade, /data-operation="SELL"/);
  assert.doesNotMatch(html + trade, /AF\.exchange|localStorage|Demo Wallet|mock starter/i);
});

test('NOT_DEPLOYED displays unknown actual balances and disables genuine operations', () => {
  const current = {
    ...state(),
    config: { ...config(), deployment: 'NOT_DEPLOYED' as const, manifest: null },
    snapshot: null,
    wallet: null,
    owner: null,
  };
  const html = renderTrade(current, 'TSLA', {
    operation: 'MINT',
    asset: 'ETH',
    amount: '10',
    slippageBps: 50,
  });
  assert.match(html, /NOT_DEPLOYED/);
  assert.match(html, /type="submit" disabled/);
  assert.match(renderAccount(current), /<strong>—<\/strong><span>ETH/);
  assert.match(renderClaim(current), /data-launch-claim disabled/);
  assert.doesNotMatch(renderAccount(current), /10,000|0xde00|Mock Wallet/);
});

test('the final Mint review explains atomic automatic launch and includes its real gas', () => {
  const current = state();
  const request = {
    owner: OWNER,
    strategyId: 'TSLA' as const,
    operation: 'MINT' as const,
    asset: 'AF_USDC' as const,
    amountRaw: '1000000000000000000',
    slippageBps: 50,
  };
  const html = renderQuote({ ...current, quote: quote(request), quoteRequest: request });
  assert.match(html, /This is the final Mint/);
  assert.match(html, /gas estimate includes launch/);
  assert.match(html, /250,000 gas/);
  assert.match(html, /0.5 AF-USDC/);
  assert.doesNotMatch(html, /1,000,000,000,000 ETH/);
});

test('insufficient ETH conversion liquidity blocks only the affected path', () => {
  const current = state();
  current.snapshot = {
    ...current.snapshot!,
    conversion: { ...current.snapshot!.conversion, ethSellAvailable: false },
  };
  assert.equal(actionable(current, 'AMZN', 'SELL', 'ETH'), false);
  assert.equal(actionable(current, 'AMZN', 'SELL', 'AF_USDC'), true);
  assert.equal(actionable(current, 'AMZN', 'BUY', 'ETH'), true);
  assert.match(
    renderTrade(current, 'AMZN', { operation: 'SELL', asset: 'ETH', amount: '1', slippageBps: 50 }),
    /Switch to AF-USDC/,
  );
});

test('a claim needs a funded chain reserve and a server verified account relationship', () => {
  const current = state();
  assert.equal(actionable(current, 'TSLA', 'CLAIM', 'AF_USDC'), true);
  current.wallet = { ...current.wallet!, accountId: null };
  assert.equal(actionable(current, 'TSLA', 'CLAIM', 'AF_USDC'), false);
  assert.match(renderClaim(current), /Verified account required/);
  current.wallet = wallet();
  current.snapshot = { ...current.snapshot!, claim: { ...current.snapshot!.claim, funded: false } };
  assert.equal(actionable(current, 'TSLA', 'CLAIM', 'AF_USDC'), false);
});

test('amount inputs preserve base units and reject silent precision truncation', () => {
  assert.equal(inputRaw('BUY', 'ETH', '0.000000000000000001'), '1');
  assert.equal(inputRaw('BUY', 'AF_USDC', '0.000001'), '1');
  assert.equal(inputRaw('SELL', 'ETH', '0.5'), '500000000000000000');
  assert.throws(() => inputRaw('BUY', 'AF_USDC', '0.0000001'), /AMOUNT_PRECISION/);
  assert.throws(() => inputRaw('MINT', 'ETH', '0'), /greater than zero/);
  assert.equal(rawAmount('9007199254740993000000', 18), '≈9,007.199254');
  assert.equal(rawAmount('1', 18, 8), '0.000000000000000001');
});

test('Vault readouts separate real strategy principal and PnL from PASS market prices', () => {
  const current = state();
  current.wallet = {
    ...wallet(),
    vaults: [
      {
        strategyId: 'AMZN',
        address: '0x3333333333333333333333333333333333333333',
        principalBasisRaw: '10000000',
        equityRaw: '9000000',
        cashRaw: '9000000',
        lockedPassRaw: '10000000000000000000',
        realizedPnlRaw: '-1000000',
        unrealizedPnlRaw: '0',
        valuationState: 'FRESH',
        withdrawableProfitRaw: '0',
        withdrawablePrincipalRaw: '9000000',
        status: 'OPEN',
        holdings: [],
      },
    ],
  };
  const html = renderVaults(current);
  assert.match(html, /-1 AF-USDC/);
  assert.match(html, /Principal basis/);
  assert.match(html, /data-launch-vault-order/);
  assert.match(html, /Losses do not automatically unlock PASS/);
  assert.match(html, /data-launch-create-vault="TSLA"/);
  current.wallet = {
    ...current.wallet!,
    vaults: current.wallet!.vaults.map((vault) => ({
      ...vault,
      equityRaw: null,
      unrealizedPnlRaw: null,
      valuationState: 'UNAVAILABLE',
    })),
  };
  const stale = renderVaults(current);
  assert.match(stale, /Reference price unavailable/);
  assert.match(stale, /9 AF-USDC/);
  assert.equal(actionable(current, 'AMZN', 'SELL', 'AF_USDC'), true);
});

/** Offline DOM boundary for router installation; no live wallet, login or chain request is used. */
function installationFixture(context: TestContext, originalMarketLayout = true) {
  const globals = ['document', 'window', 'location', 'EventSource'] as const;
  const descriptors = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const documentListeners = new Map<string, ((event: Event) => void)[]>();
  const windowListeners = new Map<string, (() => void)[]>();
  const add = <T>(listeners: Map<string, T[]>, type: string, listener: T) =>
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: {
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (type: string, listener: (event: Event) => void) =>
          add(documentListeners, type, listener),
      },
    },
    window: {
      configurable: true,
      value: {
        addEventListener: (type: string, listener: () => void) => add(windowListeners, type, listener),
        setInterval: () => 0,
      },
    },
    location: {
      configurable: true,
      value: { hash: '#/account/trades', origin: 'https://example.test' },
    },
    EventSource: { configurable: true, value: undefined },
  });
  context.after(() => {
    for (const listener of windowListeners.get('pagehide') ?? []) listener();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const dialogs: string[] = [];
  const originals = {
    market: () => 'ORIGINAL MARKET',
    trade: (id: string) => `ORIGINAL TRADE ${id}`,
    account: (tab: string) => `ORIGINAL ACCOUNT ${tab}`,
    rankings: () => 'ORIGINAL RANKINGS',
  };
  const host: LaunchProductHost = {
    originalMarketLayout,
    pages: { ...originals },
    app: { render: () => {}, openDialog: (html) => dialogs.push(html), closeDialog: () => {} },
  };
  const f = fixture();
  const client = new LaunchMarketClient({ api: f.api, provider: f.provider, now: () => NOW });
  const click = (attribute: string) => {
    const target = { closest: () => target, hasAttribute: (name: string) => name === attribute };
    for (const listener of documentListeners.get('click') ?? []) listener({ target } as unknown as Event);
  };
  return { host, originals, dialogs, click, client, ...f };
}

test('preserved home and Trade still route holdings, claims and legacy funds to chain-backed account pages', async (context) => {
  const f = installationFixture(context);
  assert.equal(await installLaunchMarket(f.host, f.provider, f.client), f.client);
  assert.equal(f.host.pages.market, f.originals.market);
  assert.equal(f.host.pages.trade, f.originals.trade);
  assert.equal(f.host.pages.rankings, f.originals.rankings);
  for (const tab of ['', 'passes', 'trades', 'other']) {
    const html = f.host.pages.account(tab);
    assert.match(html, /data-launch-account/);
    assert.match(html, /data-launch-connect/);
    assert.match(html, /href="#\/account\/trades" class="active" aria-current="page"/);
    assert.match(html, /href="#\/account\/claim"/);
    assert.match(html, /href="#\/account\/vaults"/);
    assert.doesNotMatch(html, /ORIGINAL ACCOUNT/);
  }
  assert.match(f.host.pages.account('claim'), /Free AF-USDC/);
  assert.match(f.host.pages.account('claim'), /href="#\/account\/claim" class="active" aria-current="page"/);
  for (const tab of ['funds', 'vaults']) {
    assert.match(f.host.pages.account(tab), /Your Vaults/);
    assert.match(f.host.pages.account(tab), /href="#\/account\/vaults" class="active" aria-current="page"/);
    assert.doesNotMatch(f.host.pages.account(tab), /ORIGINAL ACCOUNT/);
  }
  for (const tab of ['saved', 'notes', 'settings'])
    assert.equal(f.host.pages.account(tab), f.originals.account(tab));
  assert.equal(f.provider.calls.length, 0);
  f.state.wallet = { ...f.state.wallet, accountId: null };
  await f.client.connect();
  assert.match(f.host.pages.account('trades'), /data-launch-bind/);
  assert.match(f.host.pages.account('claim'), /data-launch-claim disabled/);
  assert.match(f.host.passMarket!.quoteHtml(), /href="#\/account\/trades">Link verified account/);
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

test('preserved-layout wallet help exposes Testnet setup and native gas funding without requesting a signature', async (context) => {
  const f = installationFixture(context);
  await installLaunchMarket(f.host, f.provider, f.client);
  f.click('data-launch-connect');
  const dialog = f.dialogs.at(-1)!;
  assert.match(dialog, /data-launch-wallet-browser/);
  assert.match(dialog, /chain ID 46630/);
  assert.match(dialog, /Native test ETH pays gas; AF-USDC does not pay gas/);
  assert.match(dialog, /https:\/\/docs\.robinhood\.com\/chain\/add-network-to-wallet\//);
  assert.match(dialog, /https:\/\/faucet\.testnet\.chain\.robinhood\.com\//);
  assert.equal((dialog.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
  assert.equal(f.provider.calls.length, 0);
});

test('original Trade surfaces escaped wallet notices and no empty or duplicate error feedback', async (context) => {
  const f = installationFixture(context);
  await installLaunchMarket(f.host, f.provider, f.client);
  assert.equal(f.host.passMarket!.quoteHtml(), '');
  const initial = f.client.state;
  Object.defineProperty(f.client, 'state', {
    configurable: true,
    get: () => ({ ...initial, notice: '<img src=x onerror=alert(1)>', error: 'DO_NOT_REPEAT' }),
  });
  const html = f.host.passMarket!.quoteHtml();
  assert.match(html, /class="launch-feedback" role="status"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|DO_NOT_REPEAT/);
});

test('undeployed preserved accounts expose real routes and connection while disabling claim and Vault writes', async (context) => {
  const f = installationFixture(context);
  f.state.config = { ...f.state.config, deployment: 'NOT_DEPLOYED', manifest: null };
  await installLaunchMarket(f.host, f.provider, f.client);
  for (const tab of ['trades', 'claim', 'vaults', 'funds']) {
    const html = f.host.pages.account(tab);
    assert.match(html, /NOT_DEPLOYED/);
    assert.match(html, /data-launch-connect/);
    assert.doesNotMatch(html, /ORIGINAL ACCOUNT|Mock Wallet|10,000/);
  }
  assert.match(f.host.pages.account('claim'), /data-launch-claim disabled/);
  assert.match(f.host.pages.account('funds'), /data-launch-create-vault="TSLA" disabled/);
  assert.equal(f.host.passMarket!.quoteHtml(), '');
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.provider.calls.length, 0);
});

test('missing chain mode preserves the full existing router, and replacement layout retains its trade renderer', async (context) => {
  const f = installationFixture(context, false);
  const missing = new LaunchMarketClient({
    api: async () => {
      throw new MarketApiError('NOT_FOUND', 404);
    },
  });
  assert.equal(await installLaunchMarket(f.host, undefined, missing), null);
  assert.deepEqual(f.host.pages, f.originals);
  assert.equal(f.host.passMarket, undefined);
  await installLaunchMarket(f.host, f.provider, f.client);
  assert.match(f.host.pages.trade('tsla'), /PUBLIC MINT/);
  assert.match(f.host.pages.account('claim'), /Free AF-USDC/);
  assert.equal(f.host.pages.account('settings'), f.originals.account('settings'));
});

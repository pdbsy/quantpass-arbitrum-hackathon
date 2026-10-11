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
import {
  config,
  snapshot,
  wallet,
  account,
  quote,
  fixture,
  location as chainLocation,
  NOW,
  OWNER,
  OTHER,
} from './helpers/launch-market-ui-fixture.ts';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
function state(): { -readonly [K in keyof LaunchClientState]: LaunchClientState[K] } {
  return {
    enabled: true,
    config: config(),
    snapshot: snapshot(),
    wallet: wallet(),
    account: account(),
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
  const click = (attribute: string, dataset: Record<string, string> = {}) => {
    const target = { dataset, closest: () => target, hasAttribute: (name: string) => name === attribute };
    for (const listener of documentListeners.get('click') ?? []) listener({ target } as unknown as Event);
  };
  const field = (type: 'input' | 'change', name: string, value: string, attribute?: string) => {
    const target = {
      name,
      value,
      hasAttribute: (key: string) => key === attribute,
      closest: (selector: string) =>
        selector === '[data-launch-order]'
          ? { dataset: { strategy: 'AMZN', operation: host.launchForms!.AMZN.operation } }
          : null,
    };
    for (const listener of documentListeners.get(type) ?? []) listener({ target } as unknown as Event);
  };
  const vaultField = (address: string, value: string) => {
    const target = {
      name: 'amount',
      value,
      closest: (selector: string) =>
        selector === '[data-launch-vault-order]' ? { dataset: { vault: address } } : null,
    };
    for (const listener of documentListeners.get('input') ?? []) listener({ target } as unknown as Event);
  };
  return { host, originals, dialogs, click, field, vaultField, client, ...f };
}

function openVault(address = '0x3333333333333333333333333333333333333333') {
  return {
    strategyId: 'AMZN' as const,
    address,
    principalBasisRaw: '10000',
    equityRaw: '10000',
    cashRaw: '10000',
    lockedPassRaw: '10000000000000000',
    realizedPnlRaw: '0',
    unrealizedPnlRaw: '0',
    valuationState: 'FRESH' as const,
    withdrawableProfitRaw: '0',
    withdrawablePrincipalRaw: '10000',
    status: 'OPEN' as const,
    holdings: [],
  };
}

test('Vault drafts survive refresh and failed reviews, but clear when identity or Vault generation changes', async (context) => {
  const f = installationFixture(context);
  const vault = openVault();
  f.state.wallet = { ...wallet(), vaults: [vault] };
  await installLaunchMarket(f.host, f.provider, f.client);
  await f.client.connect();
  f.vaultField(vault.address, '0.01');
  f.client.setError(new Error('QUOTE_EXPIRED'));
  assert.match(f.host.pages.account('vaults'), /value="0\.01" placeholder="10"/);
  f.state.wallet = { ...f.state.wallet, location: chainLocation(101) };
  await f.client.refresh();
  assert.match(f.host.pages.account('funds'), /value="0\.01" placeholder="10"/);
  assert.equal(f.host.launchForms!.AMZN.amount, '');
  f.state.wallet = {
    ...f.state.wallet,
    location: chainLocation(102),
    vaults: [{ ...vault, status: 'CLOSED' }, openVault(OTHER)],
  };
  await f.client.refresh();
  assert.match(f.host.pages.account('vaults'), /value="" placeholder="10"/);
  assert.doesNotMatch(f.host.pages.account('vaults'), /value="0\.01"/);
  f.vaultField(OTHER, '0.02');
  f.state.account = null;
  f.state.wallet = { ...f.state.wallet, accountId: null, location: chainLocation(103) };
  await f.client.refresh();
  assert.doesNotMatch(f.host.pages.account('vaults'), /value="0\.02"/);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0);
});

test('Vault drafts persist through approvals and pending transactions, then clear only the confirmed submitted draft', async (context) => {
  const f = installationFixture(context);
  const vault = openVault();
  f.state.wallet = { ...wallet(), vaults: [vault] };
  await installLaunchMarket(f.host, f.provider, f.client);
  await f.client.connect();
  const request = {
    owner: OWNER,
    strategyId: 'AMZN' as const,
    operation: 'DEPOSIT' as const,
    asset: 'AF_USDC' as const,
    amountRaw: '10000',
    slippageBps: 100,
  };
  const ready = {
    ...quote(request),
    estimatedOutRaw: '10000',
    minOutRaw: '10000',
    transaction: {
      to: vault.address,
      data: marketInterfaces.vault.encodeFunctionData('deposit', ['10000']),
      value: '0',
    },
  };
  f.vaultField(vault.address, '0.01');
  f.state.quote = {
    ...ready,
    simulation: 'APPROVAL_REQUIRED',
    gasEstimateRaw: null,
    allowance: { token: config().manifest!.usdc, spender: vault.address, amountRaw: '10000' },
  };
  await f.client.review(request);
  await f.client.confirm();
  assert.equal(f.client.state.transaction.approval, true);
  assert.match(f.host.pages.account('vaults'), /value="0\.01" placeholder="10"/);
  f.provider.receipt = {
    transactionHash: f.client.state.transaction.hash,
    blockNumber: '0x64',
    blockHash: chainLocation().blockHash,
    status: '0x1',
    from: OWNER,
  };
  await f.client.refreshTransaction();
  assert.equal(f.client.state.transaction.state, 'COMPLETED');
  assert.match(f.host.pages.account('vaults'), /value="0\.01" placeholder="10"/);
  f.state.quote = ready;
  await f.client.review(request);
  await f.client.confirm();
  assert.match(f.host.pages.account('vaults'), /value="0\.01" placeholder="10"/);
  f.state.operation = {
    ...f.state.operation,
    state: 'COMPLETED',
    confirmations: 3,
    location: chainLocation(),
  };
  await f.client.refreshTransaction();
  assert.match(f.host.pages.account('vaults'), /value="" placeholder="10"/);
  f.vaultField(vault.address, '0.01');
  f.state.operation = { ...f.state.operation, state: 'SUBMITTED', confirmations: 0, location: null };
  await f.client.review(request);
  await f.client.confirm();
  f.vaultField(vault.address, '0.02');
  f.state.operation = {
    ...f.state.operation,
    state: 'COMPLETED',
    confirmations: 3,
    location: chainLocation(),
  };
  await f.client.refreshTransaction();
  assert.match(f.host.pages.account('vaults'), /value="0\.02" placeholder="10"/);
});

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

test('order drafts preserve PASS quantities across currencies in the retained layout', async (context) => {
  for (const originalLayout of [true, false]) {
    const f = installationFixture(context, originalLayout);
    await installLaunchMarket(f.host, f.provider, f.client);
    location.hash = '#/trade/amzn';
    assert.equal(f.host.launchForms!.AMZN.amount, '');
    assert.equal(f.host.launchForms!.TSLA.amount, '');
    f.field('input', 'amount', '0.001');
    f.click('data-launch-side', { launchSide: 'SELL' });
    assert.equal(f.host.launchForms!.AMZN.amount, '');
    f.field('input', 'amount', '0.25');
    f.field('change', 'asset', 'AF_USDC', 'data-launch-asset');
    assert.equal(f.host.launchForms!.AMZN.amount, '0.25');
    f.click('data-launch-side', { launchSide: 'BUY' });
    assert.equal(f.host.launchForms!.AMZN.amount, '0.001');
    f.field('change', 'asset', 'AF_USDC', 'data-launch-asset');
    assert.equal(f.host.launchForms!.AMZN.amount, originalLayout ? '0.001' : '');
    f.field('input', 'amount', '5');
    f.field('change', 'asset', 'ETH', 'data-launch-asset');
    assert.equal(f.host.launchForms!.AMZN.amount, originalLayout ? '5' : '0.001');
    f.field('change', 'asset', 'AF_USDC', 'data-launch-asset');
    assert.equal(f.host.launchForms!.AMZN.amount, '5');
    assert.equal(f.provider.calls.length, 0);
  }
});

test('anonymous financial pages show Google login and explicit wallet linkage without asserting verification', () => {
  const current = { ...state(), account: null, wallet: { ...wallet(), accountId: null } };
  for (const html of [renderAccount(current), renderClaim(current), renderVaults(current)]) {
    assert.match(html, /href="\/login\/\?next=%2Falphaforge%2F">Sign in with Google/);
    assert.match(html, /Connect your wallet, then choose Link verified account/);
    assert.doesNotMatch(html, /data-launch-bind|Your Google account is verified/);
  }
  assert.match(renderClaim(current), /Claim status<\/dt><dd>Sign in to check/);
  assert.match(renderClaim(current), /data-launch-claim disabled/);
  const verified = { ...current, account: { ...account(), wallet: null } };
  assert.match(renderAccount(verified), /data-launch-bind/);
  assert.doesNotMatch(renderAccount(verified), /Sign in with Google ↗/);
});

test('claim UI shows completed and pending account claims before another review can be requested', () => {
  const current = state();
  for (const [status, label] of [
    ['COMPLETED', 'Claimed'],
    ['SUBMITTED', 'Pending chain confirmation'],
    ['INCLUDED', 'Pending chain confirmation'],
    ['REORGED', 'Recovery required'],
  ] as const) {
    current.account = { ...account(), claimStatus: status };
    assert.match(renderClaim(current), new RegExp('Claim status</dt><dd>' + label));
    assert.match(renderClaim(current), /data-launch-claim disabled/);
    assert.equal(actionable(current, 'TSLA', 'CLAIM', 'AF_USDC'), false);
  }
});

test('a closed Vault can create its next generation while an open Vault remains exclusive', () => {
  const current = state();
  const closed = {
    strategyId: 'AMZN' as const,
    address: '0x3333333333333333333333333333333333333333',
    principalBasisRaw: '0',
    equityRaw: '0',
    cashRaw: '0',
    lockedPassRaw: '0',
    realizedPnlRaw: '0',
    unrealizedPnlRaw: '0',
    valuationState: 'FRESH' as const,
    withdrawableProfitRaw: '0',
    withdrawablePrincipalRaw: '0',
    status: 'CLOSED' as const,
    holdings: [],
  };
  current.wallet = { ...wallet(), vaults: [closed] };
  assert.equal(actionable(current, 'AMZN', 'CREATE_VAULT', 'AF_USDC'), true);
  assert.match(renderVaults(current), /Your previous Vault is closed/);
  assert.match(renderVaults(current), /data-launch-create-vault="AMZN" >/);
  assert.doesNotMatch(renderVaults(current), /data-launch-vault-order/);
  current.wallet = { ...wallet(), vaults: [{ ...closed, status: 'OPEN' }] };
  assert.equal(actionable(current, 'AMZN', 'CREATE_VAULT', 'AF_USDC'), false);
  assert.doesNotMatch(renderVaults(current), /data-launch-create-vault="AMZN"/);
});

test('test-phase pages expose wallet ownership sessions without asserting verified email or requiring Google', () => {
  const current = {
    ...state(),
    config: { ...config(), emailVerificationRequired: false },
    account: null,
    wallet: { ...wallet(), accountId: null },
  };
  for (const html of [renderAccount(current), renderClaim(current), renderVaults(current)]) {
    assert.match(html, /Email verification is disabled for this test phase/);
    assert.match(html, /Start test session/);
    assert.match(html, /data-launch-bind/);
    assert.doesNotMatch(html, /Sign in with Google|Your Google account is verified/);
  }
  assert.match(renderClaim(current), /1,000 AF-USDC per test wallet/);
  assert.match(renderClaim(current), /Disabled for this test phase/);
  assert.match(renderClaim(current), /data-launch-claim disabled/);
  const signed = {
    ...current,
    account: { ...account(), emailVerified: false, identityKind: 'WALLET_TEST' as const },
    wallet: wallet(),
  };
  assert.equal(actionable(signed, 'TSLA', 'CLAIM', 'AF_USDC'), true);
  assert.equal(actionable(signed, 'AMZN', 'BUY', 'ETH'), true);
  assert.doesNotMatch(renderClaim(signed), /Verified account linked|Your Google account is verified/);
  assert.match(renderClaim(signed), /100 total successful claims/);
  assert.equal(
    actionable(
      { ...signed, config: { ...signed.config, emailVerificationRequired: true } },
      'AMZN',
      'BUY',
      'ETH',
    ),
    false,
  );
});

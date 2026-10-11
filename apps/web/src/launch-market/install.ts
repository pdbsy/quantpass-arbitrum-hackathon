import type { Eip1193Provider } from '../chain-wallet.ts';
import { LaunchMarketClient } from './client.ts';
import { MarketActivityClient, renderActivity } from './activity.ts';
import { actionable, escapeHtml, inputRaw } from './presentation.ts';
import type { LaunchClientState, MarketOperation, PaymentAsset, StrategyId } from './model.ts';
import {
  renderAccount,
  renderClaim,
  renderMarket,
  renderTrade,
  renderQuote,
  renderTransaction,
  renderVaults,
  type OrderForm,
} from './shell.ts';

export interface LaunchProductHost {
  originalMarketLayout?: boolean;
  launchState?: LaunchClientState;
  launchForms?: Record<StrategyId, OrderForm>;
  passMarket?: {
    actionable(strategy: StrategyId, operation: MarketOperation, asset: PaymentAsset): boolean;
    quoteHtml(): string;
    transactionHtml(): string;
    candles(
      id: string,
      range: string,
    ): readonly {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      quoteVolume: number;
    }[];
    metrics(id: string): Readonly<Record<string, number | null>>;
  };
  pages: {
    market: () => string;
    account: (tab: string) => string;
    trade: (id: string) => string;
    rankings?: () => string;
  };
  app: {
    render: (options?: { preserve?: boolean }) => void;
    openDialog: (html: string) => void;
    closeDialog: () => void;
  };
}

/** Installs into the existing product router only when the server explicitly selects chain market mode. */
export async function installLaunchMarket(
  host: LaunchProductHost,
  provider?: Eip1193Provider,
  client = new LaunchMarketClient({ ...(provider ? { provider } : {}) }),
  localAccount = host.pages.account,
): Promise<LaunchMarketClient | null> {
  if (!(await client.initialize())) return null;
  const activity = new MarketActivityClient({ enabled: client.state.config?.deployment === 'CONFIGURED' });
  const forms: Record<StrategyId, OrderForm> = {
    TSLA: {
      operation: client.state.snapshot?.markets.TSLA.state === 'LAUNCHED' ? 'BUY' : 'MINT',
      asset: 'ETH',
      amount: '',
      slippageBps: 100,
    },
    AMZN: { operation: 'BUY', asset: 'ETH', amount: '', slippageBps: 100 },
  };
  const amounts = new Map<string, string>();
  const vaultAmounts = new Map<string, string>();
  const vaultIdentity = (state: LaunchClientState) =>
    [
      state.owner?.toLowerCase(),
      state.account?.id,
      state.account?.wallet?.toLowerCase(),
      state.account?.identityKind,
      state.account?.emailVerified,
      state.wallet?.accountId,
      state.config?.emailVerificationRequired !== false,
    ].join('/');
  let draftIdentity = vaultIdentity(client.state);
  let renderedIdentity = draftIdentity;
  let vaultSubmission: { address: string; amount: string; hash: string | null } | null = null;
  const amountKey = (strategy: StrategyId, form: OrderForm) =>
    `${strategy}/${form.operation}/${form.operation === 'BUY' ? form.asset : 'PASS'}`;
  const changeForm = (strategy: StrategyId, patch: Partial<OrderForm>) => {
    const previous = forms[strategy];
    amounts.set(amountKey(strategy, previous), previous.amount);
    const next = { ...previous, ...patch };
    forms[strategy] = {
      ...next,
      amount: amounts.get(amountKey(strategy, next)) ?? '',
    };
  };
  if (!host.originalMarketLayout) {
    host.pages.market = () => renderMarket(client.state);
    host.pages.trade = (id) => {
      const strategy = id.toUpperCase();
      if (strategy !== 'TSLA' && strategy !== 'AMZN')
        return '<div class="wrap inner-page"><h1>Choose a strategy.</h1><p>This market includes All in TSLA and All in AMZN.</p><a class="text-link" href="#/market">Explore strategies ↗</a></div>';
      return `${renderTrade(client.state, strategy, forms[strategy])}${renderActivity(activity.state[strategy], client.state.config?.deployment === 'CONFIGURED', client.state.config?.manifest?.strategies[strategy].pass)}`;
    };
    host.pages.rankings = () =>
      `<div class="wrap inner-page"><span class="section-label">ONCHAIN TEST MARKET</span><h1>Market activity</h1><p>Strategy performance is separate from PASS market prices. Verified trade history will appear as chain events are indexed.</p>${renderMarket(client.state)}</div>`;
  }
  // Financial account routes must stay connected even when the original home/Trade design is retained.
  // Existing account links use passes/funds; keep those aliases on the same chain-backed pages.
  host.pages.account = (tab) => {
    if (tab === 'claim') return renderClaim(client.state);
    if (tab === 'vaults' || tab === 'funds')
      return renderVaults(client.state, Object.fromEntries(vaultAmounts));
    if (['saved', 'notes', 'settings'].includes(tab)) return localAccount(tab);
    return renderAccount(client.state);
  };
  host.launchState = client.state;
  host.launchForms = forms;
  host.passMarket = {
    actionable: (strategy, operation, asset) => actionable(client.state, strategy, operation, asset),
    quoteHtml: () => {
      const state = client.state;
      const notice =
        host.originalMarketLayout && state.notice
          ? `<p class="launch-feedback" role="status">${escapeHtml(state.notice)}</p>`
          : '';
      const accountLink =
        host.originalMarketLayout &&
        state.owner &&
        state.config?.deployment === 'CONFIGURED' &&
        !state.wallet?.accountId
          ? `<p><a class="text-link" href="#/account/trades">${state.config.emailVerificationRequired === false && !state.account?.emailVerified ? 'Start test session' : 'Link verified account'} ↗</a></p>`
          : '';
      return `${notice}${accountLink}${renderQuote(state)}`;
    },
    transactionHtml: () => renderTransaction(client.state),
    candles: (id, range) => {
      const strategy = id.toUpperCase();
      if (strategy !== 'TSLA' && strategy !== 'AMZN') return [];
      const seconds = { '24h': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 }[range];
      const rows = activity.state[strategy].candles;
      const latest = rows.at(-1)?.timestamp;
      // Numbers here are for chart coordinates only. Settlement remains integer base units.
      return rows
        .filter((row) => !seconds || latest === undefined || row.timestamp > latest - seconds)
        .map((row) => ({
          time: row.timestamp * 1000,
          open: Number(row.openRaw) / 10000,
          high: Number(row.highRaw) / 10000,
          low: Number(row.lowRaw) / 10000,
          close: Number(row.closeRaw) / 10000,
          volume: Number(row.volumeUsdcRaw) / 1000000,
          quoteVolume: Number(row.volumeUsdcRaw) / 10000,
        }));
    },
    metrics: (id) => {
      const strategy = id.toUpperCase();
      if (strategy !== 'TSLA' && strategy !== 'AMZN') return {};
      const market = client.state.snapshot?.markets[strategy];
      if (!market) return {};
      const pass = BigInt(market.reservePassRaw);
      const price =
        market.state === 'LAUNCHED' && pass > 0n
          ? Number((BigInt(market.reserveUsdcRaw) * 10n ** 18n) / pass) / 10000
          : Number(market.mintPriceUsdcRaw) / 10000;
      return {
        price,
        supply: Number(market.totalSupplyRaw) / 1e18,
        liquidity: market.state === 'LAUNCHED' ? (Number(market.reserveUsdcRaw) / 10000) * 2 : null,
        // The bounded chart response is not evidence of complete daily turnover or holder totals.
        volume: null,
        change: null,
        holders: null,
        marketCap: null,
      };
    },
  };
  const status = document.querySelector('.topline-status');
  if (status) status.textContent = 'Robinhood Chain Testnet · Test assets';
  const footer = document.querySelector('.footer-bottom > span');
  if (footer)
    footer.textContent =
      client.state.config?.deployment === 'CONFIGURED'
        ? 'On-chain test assets · Wallet-authorized settlement'
        : 'Testnet market · Asset contracts not deployed';
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('[data-nav="trade"]'))
    anchor.href = '#/trade/tsla';
  const render = () => {
    const active = document.activeElement as HTMLInputElement | null;
    const address = active?.closest?.<HTMLFormElement>('[data-launch-vault-order]')?.dataset.vault;
    const restore =
      active?.name === 'amount' &&
      address &&
      renderedIdentity === draftIdentity &&
      client.state.wallet?.vaults.some(
        (vault) => vault.status === 'OPEN' && vault.address.toLowerCase() === address,
      );
    const selection = restore
      ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
      : null;
    host.launchState = client.state;
    host.launchForms = forms;
    host.app.render({ preserve: true });
    renderedIdentity = draftIdentity;
    if (selection) {
      const input = document.querySelector<HTMLInputElement>(
        `[data-launch-vault-order][data-vault="${address}"] input[name="amount"]`,
      );
      input?.focus({ preventScroll: true });
      if (selection.start !== null && selection.end !== null)
        input?.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
    }
  };
  activity.subscribe(render);
  const activeTrade = () => {
    const route = location.hash.split('/');
    const id = route[1] === 'trade' ? route[2]?.toUpperCase() : null;
    void activity.setActive(id === 'TSLA' || id === 'AMZN' ? id : null);
  };
  activeTrade();
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      client.setError(error);
    }
  };
  let previousTslaState = client.state.snapshot?.markets.TSLA.state;
  client.subscribe((state) => {
    const identity = vaultIdentity(state);
    if (identity !== draftIdentity) {
      vaultAmounts.clear();
      vaultSubmission = null;
      draftIdentity = identity;
    }
    const openVaults = new Set(
      state.wallet?.vaults
        .filter((vault) => vault.status === 'OPEN')
        .map((vault) => vault.address.toLowerCase()),
    );
    for (const address of vaultAmounts.keys()) if (!openVaults.has(address)) vaultAmounts.delete(address);
    if (vaultSubmission && !openVaults.has(vaultSubmission.address)) vaultSubmission = null;
    const tx = state.transaction;
    const quote = state.quote;
    if (
      !vaultSubmission &&
      tx.state === 'AWAITING_WALLET' &&
      !tx.approval &&
      !tx.executor &&
      quote &&
      (quote.operation === 'DEPOSIT' || quote.operation === 'WITHDRAW')
    ) {
      const address = quote.transaction.to.toLowerCase();
      const amount = vaultAmounts.get(address);
      try {
        if (
          openVaults.has(address) &&
          amount &&
          inputRaw(quote.operation, 'AF_USDC', amount) === quote.amountInRaw
        )
          vaultSubmission = { address, amount, hash: null };
      } catch {
        // A new, unfinished draft must not be cleared by an earlier reviewed amount.
      }
    }
    if (vaultSubmission && !tx.approval && !tx.executor) {
      if (tx.hash && vaultSubmission.hash === null) vaultSubmission.hash = tx.hash;
      if (tx.state === 'COMPLETED' && tx.hash === vaultSubmission.hash) {
        if (vaultAmounts.get(vaultSubmission.address) === vaultSubmission.amount)
          vaultAmounts.delete(vaultSubmission.address);
        vaultSubmission = null;
      } else if (['REJECTED', 'REVERTED', 'EXPIRED', 'DROPPED'].includes(tx.state)) vaultSubmission = null;
    }
    const next = state.snapshot?.markets.TSLA.state;
    if (next === 'LAUNCHED' && previousTslaState !== 'LAUNCHED')
      changeForm('TSLA', { operation: 'BUY', asset: 'ETH' });
    if (next && next !== 'LAUNCHED' && previousTslaState === 'LAUNCHED')
      changeForm('TSLA', { operation: 'MINT', asset: 'ETH' });
    previousTslaState = next;
    render();
  });

  document.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-launch-connect],[data-launch-wallet-browser],[data-launch-refresh],[data-launch-bind],[data-launch-bind-confirm],[data-launch-side],[data-launch-clear],[data-launch-confirm],[data-launch-claim],[data-launch-create-vault],[data-launch-vault-close],[data-launch-executor-refresh],[data-launch-executor-revoke],[data-launch-executor-confirm]',
    );
    if (!target || target.hasAttribute('disabled')) return;
    if (target.hasAttribute('data-launch-connect')) {
      host.app.openDialog(
        '<span class="section-label">CONNECT YOUR WALLET</span><h2>Connect Wallet</h2><p>Choose your browser wallet to continue.</p><div class="wallet-options"><button class="primary-btn" data-launch-wallet-browser>Browser Wallet <span>Robinhood Chain Testnet</span></button></div><p class="small muted">On mobile, open this page in your wallet’s browser.</p><p class="small muted">Use Robinhood Chain Testnet (chain ID 46630). Native test ETH pays gas; AF-USDC does not pay gas.</p><p><a class="text-link" href="https://docs.robinhood.com/chain/add-network-to-wallet/" target="_blank" rel="noopener noreferrer">Set up the Testnet network ↗</a> <a class="text-link" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noopener noreferrer">Get test ETH from the official faucet ↗</a></p>',
      );
    } else if (target.hasAttribute('data-launch-wallet-browser')) {
      host.app.closeDialog();
      void run(() => client.connect());
    } else if (target.hasAttribute('data-launch-bind')) {
      const testSession =
        client.state.config?.emailVerificationRequired === false &&
        client.state.account?.emailVerified !== true;
      host.app.openDialog(
        testSession
          ? '<span class="section-label">WALLET TEST SESSION</span><h2>Prove wallet ownership.</h2><p>Email verification is disabled for this test phase. A message signature starts a test session with this wallet. It does not move assets or approve transactions.</p><button class="primary-btn" data-launch-bind-confirm>Review message in wallet ↗</button><button class="text-link" data-close>Cancel</button>'
          : '<span class="section-label">LINK YOUR VERIFIED ACCOUNT</span><h2>Link this wallet.</h2><p>A separate message signature links the connected wallet to your verified Google account. It does not move assets or authorize a contract transaction. Assets held by a previous wallet remain with that wallet.</p><button class="primary-btn" data-launch-bind-confirm>Review message in wallet ↗</button><button class="text-link" data-close>Cancel</button>',
      );
    } else if (target.hasAttribute('data-launch-bind-confirm')) {
      host.app.closeDialog();
      void run(() => client.bindWallet());
    } else if (target.hasAttribute('data-launch-refresh')) void run(() => client.refresh());
    else if (target.hasAttribute('data-launch-clear')) client.clearQuote();
    else if (target.hasAttribute('data-launch-confirm')) void run(() => client.confirm());
    else if (target.hasAttribute('data-launch-executor-confirm'))
      void run(() => client.confirmExecutorPermission());
    else if (
      target.hasAttribute('data-launch-executor-refresh') ||
      target.hasAttribute('data-launch-executor-revoke')
    ) {
      const strategy = target.dataset.launchExecutorRefresh ?? target.dataset.launchExecutorRevoke;
      if (strategy !== 'TSLA' && strategy !== 'AMZN') return;
      void run(() =>
        target.hasAttribute('data-launch-executor-revoke')
          ? client.reviewExecutorPermission(strategy, null)
          : client.refreshExecutor(strategy),
      );
    } else if (target.hasAttribute('data-launch-claim'))
      void run(() =>
        client.review({
          strategyId: 'TSLA',
          operation: 'CLAIM',
          asset: 'AF_USDC',
          amountRaw: '0',
          slippageBps: 100,
        }),
      );
    else if (
      target.hasAttribute('data-launch-create-vault') ||
      target.hasAttribute('data-launch-vault-close')
    ) {
      const strategyId = target.dataset.launchCreateVault ?? target.dataset.launchVaultClose;
      if (strategyId !== 'TSLA' && strategyId !== 'AMZN') return;
      void run(() =>
        client.review({
          strategyId,
          operation: target.hasAttribute('data-launch-create-vault') ? 'CREATE_VAULT' : 'CLOSE',
          asset: 'AF_USDC',
          amountRaw: '0',
          slippageBps: 100,
        }),
      );
    } else if (target.hasAttribute('data-launch-side')) {
      const strategy = location.hash.split('/')[2]?.toUpperCase();
      if (strategy !== 'TSLA' && strategy !== 'AMZN') return;
      const operation = target.dataset.launchSide as 'BUY' | 'SELL';
      changeForm(strategy, { operation, asset: 'ETH' });
      client.clearQuote();
      render();
    }
  });
  document.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const vaultForm = input.closest<HTMLFormElement>('[data-launch-vault-order]');
    const address = vaultForm?.dataset.vault?.toLowerCase();
    if (
      input.name === 'amount' &&
      address &&
      client.state.wallet?.vaults.some(
        (vault) => vault.status === 'OPEN' && vault.address.toLowerCase() === address,
      )
    )
      vaultAmounts.set(address, input.value);
    const form = input.closest<HTMLFormElement>('[data-launch-order]');
    const strategy = form?.dataset.strategy;
    if (input.name === 'amount' && (strategy === 'TSLA' || strategy === 'AMZN'))
      forms[strategy] = { ...forms[strategy], amount: input.value };
  });
  document.addEventListener('change', (event) => {
    const input = event.target as HTMLSelectElement;
    const form = input.closest<HTMLFormElement>('[data-launch-order]');
    const strategy = form?.dataset.strategy;
    if (strategy !== 'TSLA' && strategy !== 'AMZN') return;
    if (input.hasAttribute('data-launch-asset')) {
      const asset = input.value as PaymentAsset;
      changeForm(strategy, { asset });
    } else if (input.hasAttribute('data-launch-slippage'))
      forms[strategy] = { ...forms[strategy], slippageBps: Number(input.value) };
    else return;
    client.clearQuote();
    render();
  });
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (form.hasAttribute('data-launch-executor-recover')) {
      event.preventDefault();
      const hash = String(new FormData(form).get('hash'));
      void run(() => client.recoverExecutorTransaction(hash));
      return;
    }
    if (form.hasAttribute('data-launch-executor-order')) {
      event.preventDefault();
      const strategy = form.dataset.strategy;
      if (strategy !== 'TSLA' && strategy !== 'AMZN') return;
      const fields = new FormData(form);
      void run(async () => {
        const expiresAt = Math.floor(Date.parse(String(fields.get('expiresAt'))) / 1000);
        if (!Number.isSafeInteger(expiresAt)) throw new Error('INVALID_EXECUTOR_PERMISSION');
        await client.reviewExecutorPermission(strategy, {
          executor: String(fields.get('executor')),
          expiresAt: String(expiresAt),
          maxOrderUsdc: inputRaw('DEPOSIT', 'AF_USDC', String(fields.get('maxOrderUsdc'))),
          maxTotalBuyUsdc: inputRaw('DEPOSIT', 'AF_USDC', String(fields.get('maxTotalBuyUsdc'))),
          maxSlippageBps: Number(fields.get('maxSlippageBps')),
        });
      });
      return;
    }
    if (form.hasAttribute('data-launch-vault-order')) {
      event.preventDefault();
      const strategyId = form.dataset.strategy;
      const operation = (event as SubmitEvent).submitter?.getAttribute('value');
      if (
        (strategyId !== 'TSLA' && strategyId !== 'AMZN') ||
        (operation !== 'DEPOSIT' && operation !== 'WITHDRAW')
      )
        return;
      const amount = String(new FormData(form).get('amount') ?? '');
      void run(() =>
        client.review({
          strategyId,
          operation,
          asset: 'AF_USDC',
          amountRaw: inputRaw(operation, 'AF_USDC', amount),
          slippageBps: 100,
        }),
      );
      return;
    }
    if (!form.hasAttribute('data-launch-order')) return;
    event.preventDefault();
    const strategy = form.dataset.strategy;
    if (strategy !== 'TSLA' && strategy !== 'AMZN') return;
    const operation = form.dataset.operation as MarketOperation;
    const selected = forms[strategy];
    void run(async () =>
      client.review({
        strategyId: strategy,
        operation,
        asset: selected.asset,
        amountRaw: inputRaw(operation, selected.asset, selected.amount),
        slippageBps: selected.slippageBps,
      }),
    );
  });
  window.addEventListener('hashchange', () => {
    client.clearQuote();
    activeTrade();
  });

  let eventStream: EventSource | null = null;
  if (typeof EventSource !== 'undefined' && client.state.config?.deployment === 'CONFIGURED') {
    eventStream = new EventSource('/api/launch-market/events', { withCredentials: true });
    eventStream.onopen = () => {
      void run(() => client.refresh());
    };
    eventStream.onmessage = (event) => {
      void run(async () => {
        const update = JSON.parse(String(event.data));
        activity.requestRefresh(update.type === 'REORG');
        await client.stream(update);
      });
    };
  }
  const polling =
    client.state.config?.deployment === 'CONFIGURED'
      ? window.setInterval(() => {
          void run(() => client.refresh());
          activity.requestRefresh();
        }, 5000)
      : null;
  window.addEventListener(
    'pagehide',
    () => {
      if (polling !== null) clearInterval(polling);
      eventStream?.close();
      activity.dispose();
    },
    { once: true },
  );
  render();
  return client;
}

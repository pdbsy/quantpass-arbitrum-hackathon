import type { Eip1193Provider } from '../chain-wallet.ts';
import { LaunchMarketClient } from './client.ts';
import { inputRaw } from './presentation.ts';
import type { MarketOperation, PaymentAsset, StrategyId } from './model.ts';
import {
  renderAccount,
  renderClaim,
  renderMarket,
  renderTrade,
  renderVaults,
  type OrderForm,
} from './shell.ts';

export interface LaunchProductHost {
  homeHtml?: string;
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
  const forms: Record<StrategyId, OrderForm> = {
    TSLA: {
      operation: client.state.snapshot?.markets.TSLA.state === 'LAUNCHED' ? 'BUY' : 'MINT',
      asset: 'ETH',
      amount: client.state.snapshot?.markets.TSLA.state === 'LAUNCHED' ? '0.01' : '10',
      slippageBps: 50,
    },
    AMZN: { operation: 'BUY', asset: 'ETH', amount: '0.01', slippageBps: 50 },
  };
  host.pages.market = () => renderMarket(client.state);
  host.pages.trade = (id) => {
    const strategy = id.toUpperCase();
    if (strategy !== 'TSLA' && strategy !== 'AMZN')
      return '<div class="wrap inner-page"><h1>Choose a strategy.</h1><p>This market includes All in TSLA and All in AMZN.</p><a class="text-link" href="#/market">Explore strategies ↗</a></div>';
    return renderTrade(client.state, strategy, forms[strategy]);
  };
  host.pages.account = (tab) =>
    ['saved', 'notes', 'settings'].includes(tab)
      ? localAccount(tab)
      : tab === 'claim'
        ? renderClaim(client.state)
        : tab === 'vaults'
          ? renderVaults(client.state)
          : renderAccount(client.state);
  host.pages.rankings = () =>
    `<div class="wrap inner-page"><span class="section-label">ONCHAIN TEST MARKET</span><h1>Market activity</h1><p>Strategy performance is separate from PASS market prices. Verified trade history will appear as chain events are indexed.</p>${renderMarket(client.state)}</div>`;
  if (typeof host.homeHtml === 'string')
    host.homeHtml =
      '<section class="hero wrap"><div class="hero-copy"><div class="eyebrow">MAKE IDEAS. FORGE STRATEGIES.</div><h1>Two strategies.<br>One shared market.<br><span class="ink">All on chain.</span></h1><p>All in TSLA begins with a Fair Launch. All in AMZN trades in its existing pool. Hold PASS, fund your own Vault and settle with native test ETH or AF-USDC.</p><a class="primary-btn" href="#/market">Explore the market ↗</a><a class="text-link" href="#/account/claim">Free AF-USDC ↗</a></div></section>';
  const status = document.querySelector('.topline-status');
  if (status) status.textContent = 'Robinhood Chain Testnet · Test assets';
  const footer = document.querySelector('.footer-bottom > span');
  if (footer) footer.textContent = 'On-chain test assets · Wallet-authorized settlement';
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('[data-nav="trade"]'))
    anchor.href = '#/trade/tsla';
  const render = () => host.app.render({ preserve: true });
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      client.setError(error);
    }
  };
  let previousTslaState = client.state.snapshot?.markets.TSLA.state;
  client.subscribe((state) => {
    const next = state.snapshot?.markets.TSLA.state;
    if (next === 'LAUNCHED' && previousTslaState !== 'LAUNCHED')
      forms.TSLA = { operation: 'BUY', asset: 'ETH', amount: '0.01', slippageBps: 50 };
    if (next && next !== 'LAUNCHED' && previousTslaState === 'LAUNCHED')
      forms.TSLA = { operation: 'MINT', asset: 'ETH', amount: '10', slippageBps: 50 };
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
        '<span class="section-label">CONNECT YOUR WALLET</span><h2>Connect Wallet</h2><p>Choose your browser wallet to continue.</p><div class="wallet-options"><button class="primary-btn" data-launch-wallet-browser>Browser Wallet <span>Robinhood Chain Testnet</span></button></div><p class="small muted">On mobile, open this page in your wallet’s browser.</p>',
      );
    } else if (target.hasAttribute('data-launch-wallet-browser')) {
      host.app.closeDialog();
      void run(() => client.connect());
    } else if (target.hasAttribute('data-launch-bind')) {
      host.app.openDialog(
        '<span class="section-label">LINK YOUR VERIFIED ACCOUNT</span><h2>Link this wallet.</h2><p>A separate message signature links the connected wallet to your verified Google account. It does not move assets or authorize a contract transaction. Assets held by a previous wallet remain with that wallet.</p><button class="primary-btn" data-launch-bind-confirm>Review message in wallet ↗</button><button class="text-link" data-close>Cancel</button>',
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
          slippageBps: 50,
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
          slippageBps: 50,
        }),
      );
    } else if (target.hasAttribute('data-launch-side')) {
      const strategy = location.hash.split('/')[2]?.toUpperCase();
      if (strategy !== 'TSLA' && strategy !== 'AMZN') return;
      const operation = target.dataset.launchSide as 'BUY' | 'SELL';
      forms[strategy] = {
        ...forms[strategy],
        operation,
        asset: 'ETH',
        amount: operation === 'SELL' ? '10' : '0.01',
      };
      client.clearQuote();
      render();
    }
  });
  document.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
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
      const operation = form?.dataset.operation as MarketOperation;
      forms[strategy] = {
        ...forms[strategy],
        asset,
        amount: operation === 'BUY' ? (asset === 'ETH' ? '0.01' : '10') : forms[strategy].amount,
      };
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
          slippageBps: 50,
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
  });

  let eventStream: EventSource | null = null;
  if (typeof EventSource !== 'undefined' && client.state.config?.deployment === 'CONFIGURED') {
    eventStream = new EventSource('/api/launch-market/events', { withCredentials: true });
    eventStream.onopen = () => {
      void run(() => client.refresh());
    };
    eventStream.onmessage = (event) => {
      void run(() => client.stream(JSON.parse(String(event.data))));
    };
  }
  const polling = window.setInterval(() => {
    void run(() => client.refresh());
  }, 5000);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(polling);
      eventStream?.close();
    },
    { once: true },
  );
  render();
  return client;
}

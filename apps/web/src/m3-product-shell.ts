import { ROBINHOOD_CHAIN_TESTNET } from '../../../packages/robinhood-chain/src/network.ts';

export const M3_CANONICAL_STRATEGY_ID = 'trend' as const;

export const WALLET_STATUSES = [
  'DISCONNECTED',
  'CONNECTING',
  'CONNECTED',
  'CONNECTION_REJECTED',
  'ACCOUNT_CHANGED',
  'WALLET_DISCONNECTED',
] as const;

export const NETWORK_STATUSES = [
  'UNAVAILABLE',
  'CORRECT',
  'WRONG',
  'SWITCHING',
  'SWITCH_REJECTED',
  'UNSUPPORTED',
  'RPC_UNAVAILABLE',
] as const;

export const TRANSACTION_STATUSES = [
  'IDLE',
  'WALLET_APPROVAL_REQUIRED',
  'WALLET_PENDING',
  'SUBMITTED',
  'CONFIRMING',
  'CHAIN_CONFIRMED',
  'INDEXING',
  'READY',
  'FAILED',
] as const;

export type WalletStatus = (typeof WALLET_STATUSES)[number];
export type NetworkStatus = (typeof NETWORK_STATUSES)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export type ProductProvenance = 'FIXTURE' | 'LOCAL SIMULATION';

export interface WalletPresentation {
  readonly status: WalletStatus;
  readonly address?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface NetworkPresentation {
  readonly status: NetworkStatus;
  readonly chainId?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface TransactionPresentation {
  readonly status: TransactionStatus;
  readonly txHash?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface StrategyShellInput {
  readonly strategyId: string;
  readonly contentProvenance: ProductProvenance;
  readonly wallet?: WalletPresentation;
  readonly network?: NetworkPresentation;
  readonly transaction?: TransactionPresentation;
}

export interface AccountShellInput {
  readonly accountId?: string | null;
  readonly wallet?: WalletPresentation;
  readonly network?: NetworkPresentation;
  readonly transaction?: TransactionPresentation;
}

export interface M3ProductPages {
  readonly account: (tab: string) => string;
  readonly trade: (strategyId: string) => string;
}

export interface M3PageExtensionOptions {
  readonly accountId: () => string | null;
  readonly contentProvenance: (strategyId: string) => ProductProvenance;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

const walletMessages: Record<WalletStatus, string> = {
  DISCONNECTED: 'Disconnected. Connect a supported wallet to use Testnet capabilities.',
  CONNECTING: 'Connecting. Complete the request in your wallet.',
  CONNECTED: 'Connected.',
  CONNECTION_REJECTED: 'Connection rejected in the wallet.',
  ACCOUNT_CHANGED: 'Wallet account changed. AlphaForge must refresh wallet-owned state.',
  WALLET_DISCONNECTED: 'Wallet disconnected after connection. Pending product state may be stale.',
};

const networkMessages: Record<NetworkStatus, string> = {
  UNAVAILABLE: 'Network state is unavailable until the chain adapter is connected.',
  CORRECT: 'Connected to the required Robinhood Chain Testnet.',
  WRONG: 'Wrong network. Switch to Robinhood Chain Testnet before continuing.',
  SWITCHING: 'Waiting for the wallet to switch networks.',
  SWITCH_REJECTED: 'Network switch rejected in the wallet.',
  UNSUPPORTED: 'This wallet or network cannot use the required Testnet.',
  RPC_UNAVAILABLE: 'Robinhood Chain Testnet RPC is unavailable.',
};

const transactionMessages: Record<TransactionStatus, string> = {
  IDLE: 'No Testnet transaction is in progress.',
  WALLET_APPROVAL_REQUIRED: 'Review the action before requesting wallet approval.',
  WALLET_PENDING: 'Waiting for wallet confirmation.',
  SUBMITTED: 'Transaction submitted. Waiting for an RPC receipt.',
  CONFIRMING: 'Transaction is confirming on-chain.',
  CHAIN_CONFIRMED: 'Transaction confirmed on-chain. AlphaForge is syncing the latest state.',
  INDEXING: 'Receipt confirmed. Waiting for readback and the product projection.',
  READY: 'Transaction and readback complete. The AlphaForge product state is updated.',
  FAILED: 'Transaction did not reach a ready product state.',
};

export function renderWalletStatus(status: WalletStatus): string {
  return walletMessages[status];
}

export function renderNetworkStatus(status: NetworkStatus): string {
  return networkMessages[status];
}

export function renderTransactionStatus(status: TransactionStatus): string {
  return transactionMessages[status];
}

function errorDetails(value: { readonly errorCode?: string; readonly errorMessage?: string }): string {
  if (!value.errorCode && !value.errorMessage) return '';
  return `<p role="alert"><strong>${escapeHtml(value.errorCode ?? 'UNSPECIFIED_ERROR')}</strong>${
    value.errorMessage ? ` · ${escapeHtml(value.errorMessage)}` : ''
  }</p>`;
}

function walletCard(wallet: WalletPresentation): string {
  const shortAddress =
    wallet.address && wallet.address.length > 12
      ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
      : wallet.address;
  return `<article class="sketch-box"><span class="section-label">WALLET / TESTNET</span><h3>${escapeHtml(
    wallet.status,
  )}</h3><p>${escapeHtml(renderWalletStatus(wallet.status))}</p>${
    wallet.address
      ? `<p><strong>Wallet address</strong> · ${escapeHtml(wallet.address)} · ${escapeHtml(shortAddress)}</p>`
      : '<p>Wallet address · Unavailable</p>'
  }${errorDetails(wallet)}</article>`;
}

function networkCard(network: NetworkPresentation): string {
  const observedChain = network.chainId === undefined ? 'Unavailable' : escapeHtml(network.chainId);
  return `<article class="sketch-box"><span class="section-label">NETWORK / TESTNET</span><h3>${escapeHtml(
    network.status,
  )}</h3><p>${escapeHtml(renderNetworkStatus(network.status))}</p><p><strong>Required</strong> · ${escapeHtml(
    ROBINHOOD_CHAIN_TESTNET.name,
  )} · Chain ID ${escapeHtml(ROBINHOOD_CHAIN_TESTNET.chainId)}</p><p>Wallet chain ID · ${observedChain}</p>${errorDetails(
    network,
  )}</article>`;
}

function transactionCard(transaction: TransactionPresentation): string {
  const validHash = /^0x[0-9a-fA-F]{64}$/.test(transaction.txHash ?? '');
  const transactionEvidence = !transaction.txHash
    ? '<p>Transaction hash · Unavailable</p>'
    : validHash
      ? `<p><strong>Transaction hash</strong> · <a class="text-link" href="${escapeHtml(
          `${ROBINHOOD_CHAIN_TESTNET.explorerUrl}/tx/${transaction.txHash}`,
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(transaction.txHash)} ↗</a> · Chain ID ${escapeHtml(
          ROBINHOOD_CHAIN_TESTNET.chainId,
        )}</p>`
      : `<p><strong>Transaction hash</strong> · ${escapeHtml(transaction.txHash)}</p>`;
  return `<article class="sketch-box"><span class="section-label">TRANSACTION / TESTNET</span><h3>${escapeHtml(
    transaction.status,
  )}</h3><p>${escapeHtml(
    renderTransactionStatus(transaction.status),
  )}</p>${transactionEvidence}${errorDetails(transaction)}</article>`;
}

function disabledActions(): string {
  return `<div class="inline-actions" aria-label="Testnet asset actions">${[
    'Buy Pass',
    'Sell Pass',
    'Deposit',
    'Withdraw',
    'Approve',
  ]
    .map(
      (action) =>
        `<button class="outline-btn" disabled title="Requires reviewed Macbeth02 contract capability and Macbeth03 chain adapter">${action} · NOT IMPLEMENTED</button>`,
    )
    .join('')}</div>`;
}

const unavailableWallet: WalletPresentation = { status: 'DISCONNECTED' };
const unavailableNetwork: NetworkPresentation = { status: 'UNAVAILABLE' };
const idleTransaction: TransactionPresentation = { status: 'IDLE' };

function chainCards(
  wallet: WalletPresentation,
  network: NetworkPresentation,
  transaction: TransactionPresentation,
  assetBoundary: string,
): string {
  return `<div class="strategy-grid">${walletCard(wallet)}${networkCard(network)}${transactionCard(
    transaction,
  )}</div><article class="sketch-box"><span class="section-label">PASS + VAULT / TESTNET / NOT IMPLEMENTED</span><p>${escapeHtml(
    assetBoundary,
  )}</p>${disabledActions()}</article><p class="dialog-notice">Strategy Runtime, venue execution, positions, fills and strategy-generated P&amp;L are NOT IMPLEMENTED / FUTURE PHASE.</p>`;
}

export function renderM3StrategyShell(input: StrategyShellInput): string {
  const wallet = input.wallet ?? unavailableWallet;
  const network = input.network ?? unavailableNetwork;
  const transaction = input.transaction ?? idleTransaction;
  const canonical = input.strategyId === M3_CANONICAL_STRATEGY_ID;
  const historicalLocal = input.contentProvenance === 'LOCAL SIMULATION';
  const identityLabel = canonical
    ? 'CANONICAL STRATEGY ID'
    : historicalLocal
      ? 'HISTORICAL LOCAL IDENTITY'
      : 'FIXTURE STRATEGY ID';
  const identityMessage = canonical
    ? `${M3_CANONICAL_STRATEGY_ID} is the first M3 logical product strategy. Contract addresses and deployments attach through future reviewed metadata.`
    : historicalLocal
      ? `${input.strategyId} remains isolated from ${M3_CANONICAL_STRATEGY_ID}. No local balance or ownership is used as a Testnet holding.`
      : `${input.strategyId} remains a product fixture until an explicit canonical M3 assignment exists.`;
  const assetBoundary = canonical
    ? 'Chain ownership, balances, deployment evidence and supported writes are unavailable on this baseline.'
    : historicalLocal
      ? 'No local balance or ownership is used as a Testnet holding. No chain deployment mapping is assigned.'
      : 'No Testnet Pass or Vault deployment is assigned to this fixture strategy.';
  return `<section class="wrap section" aria-label="M3 product chain status"><span class="section-label">STRATEGY CONTENT / ${escapeHtml(
    input.contentProvenance,
  )}</span><h2>Strategy · ${escapeHtml(
    input.strategyId,
  )}</h2><p><strong>${identityLabel}</strong> · ${escapeHtml(identityMessage)}</p>${chainCards(
    wallet,
    network,
    transaction,
    assetBoundary,
  )}</section>`;
}

export function renderM3AccountShell(input: AccountShellInput): string {
  const wallet = input.wallet ?? unavailableWallet;
  const network = input.network ?? unavailableNetwork;
  const transaction = input.transaction ?? idleTransaction;
  return `<section class="wrap section" aria-label="M3 account chain status"><span class="section-label">ACCOUNT / LOCAL SIMULATION</span><h2>AlphaForge account · ${escapeHtml(
    input.accountId ?? 'No local session',
  )}</h2><p>Account and wallet are separate identities. Local Alice/Bob sessions do not authorize Testnet assets.</p>${chainCards(
    wallet,
    network,
    transaction,
    'Chain ownership, balances, deployment evidence and supported writes are unavailable on this baseline.',
  )}</section>`;
}

export function extendM3ProductPages(pages: M3ProductPages, options: M3PageExtensionOptions): M3ProductPages {
  return {
    account: (tab) => renderM3AccountShell({ accountId: options.accountId() }) + pages.account(tab),
    trade: (strategyId) =>
      renderM3StrategyShell({
        strategyId,
        contentProvenance: options.contentProvenance(strategyId),
      }) + pages.trade(strategyId),
  };
}

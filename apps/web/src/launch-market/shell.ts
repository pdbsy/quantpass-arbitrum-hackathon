import type { LaunchClientState, MarketOperation, PaymentAsset, StrategyId } from './model.ts';
import {
  actionable,
  escapeHtml as esc,
  inputUnit,
  outputUnit,
  poolPrice,
  progress,
  quoteIsFinalMint,
  rawAmount,
  signedAmount,
} from './presentation.ts';

export interface OrderForm {
  readonly operation: MarketOperation;
  readonly asset: PaymentAsset;
  readonly amount: string;
  readonly slippageBps: number;
}
const strategies: readonly StrategyId[] = ['TSLA', 'AMZN'];
const amount = rawAmount;
const row = (label: string, value: string): string =>
  `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
const actionName = (operation: MarketOperation): string =>
  ({
    MINT: 'Mint',
    BUY: 'Buy',
    SELL: 'Sell',
    CLAIM: 'Claim',
    DEPOSIT: 'Deposit',
    WITHDRAW: 'Withdraw',
    CLOSE: 'Close',
    CREATE_VAULT: 'Create Vault',
  })[operation];

function network(state: LaunchClientState): string {
  const configured = state.config?.deployment === 'CONFIGURED';
  return `<div class="launch-network"><span class="section-label">ROBINHOOD CHAIN TESTNET · TEST ASSETS</span><span class="fixture-tag">${configured ? 'ONCHAIN_TESTNET' : 'NOT_DEPLOYED'}</span></div>${!configured ? '<p class="dialog-notice">Contracts are not deployed. Mint, trading, claims and Vault funding become available after the reviewed deployment and reserves are ready.</p>' : ''}${state.error ? `<p class="form-error launch-feedback" role="alert">${esc(state.error)}</p>` : ''}${state.notice ? `<p class="launch-feedback" role="status">${esc(state.notice)}</p>` : ''}`;
}

function connection(state: LaunchClientState): string {
  const label = state.connecting
    ? 'Connecting…'
    : state.owner
      ? `${state.owner.slice(0, 6)}…${state.owner.slice(-4)}`
      : 'Connect Wallet';
  return `<div class="launch-wallet-actions"><button class="primary-btn wallet-connect" data-launch-connect ${state.connecting || state.busy ? 'disabled' : ''}><span class="wallet-status-dot${state.owner ? ' connected' : ''}" aria-hidden="true"></span>${esc(label)}</button>${state.owner && state.config?.deployment === 'CONFIGURED' && !state.wallet?.accountId ? '<button class="text-link" data-launch-bind>Link verified account ↗</button>' : ''}</div>`;
}

export function renderTransaction(state: LaunchClientState): string {
  const tx = state.transaction;
  if (tx.state === 'IDLE') return '';
  const stage = tx.executor
    ? 'Executor permission transaction'
    : tx.approval
      ? 'Token approval'
      : 'Transaction';
  const hash = tx.hash && /^0x[0-9a-fA-F]{64}$/.test(tx.hash) ? tx.hash : null;
  return `<section class="launch-transaction sketch-box" aria-live="polite"><div class="section-label">${stage}</div><strong>${esc(tx.state.replaceAll('_', ' '))}</strong><p>${tx.state === 'INCLUDED' || tx.state === 'CONFIRMED_L2' || tx.state === 'COMPLETED' ? `${tx.confirmations} / 3 L2 blocks, including the inclusion block. This is the application confirmation policy.` : tx.state === 'RECOVERY_REQUIRED' ? 'The wallet outcome or synchronization needs review. Refresh the evidence before starting another transaction.' : tx.state === 'SUBMITTED' ? 'Submitted. Waiting for a receipt and chain readback.' : tx.state === 'REORGED' ? 'The inclusion was reorganized. Balances and market state are being read again.' : tx.state === 'REVERTED' ? 'The transaction reverted. Contract asset transfers were rolled back.' : tx.state === 'AWAITING_WALLET' ? 'Review the transaction in your wallet.' : ''}</p>${hash ? `<a class="text-link launch-hash" href="https://explorer.testnet.chain.robinhood.com/tx/${hash}" target="_blank" rel="noopener noreferrer">${hash.slice(0, 12)}…${hash.slice(-8)} ↗</a>` : ''}${tx.executor && !tx.hash && tx.state === 'RECOVERY_REQUIRED' ? '<form data-launch-executor-recover><label for="executor-recovery-hash">Find the transaction in your original owner wallet and enter its hash.</label><input id="executor-recovery-hash" name="hash" type="text" autocomplete="off" placeholder="0x…" required><button class="outline-btn" type="submit">Verify existing transaction ↗</button><p class="small muted">The previous wallet request had an unknown outcome. This verifies its exact owner, Vault and calldata without sending a replacement.</p></form>' : ''}${tx.state === 'RECOVERY_REQUIRED' || tx.state === 'REORGED' ? '<button class="text-link" data-launch-refresh>Refresh transaction evidence ↗</button>' : ''}</section>`;
}

function stats(state: LaunchClientState, strategy: StrategyId): string {
  const market = state.snapshot?.markets[strategy];
  const minted = market?.state === 'LAUNCHED';
  if (strategy === 'TSLA')
    return `<dl class="order-quote launch-stats">${row('Total supply', `${amount(market?.totalSupplyRaw, 18)} PASS`)}${row('Public Mint', `${amount(market?.publicSupplyRaw, 18)} PASS`)}${row('Subscribed', `${amount(market?.soldRaw, 18)} PASS`)}${row('Remaining', `${amount(market?.remainingRaw, 18)} PASS`)}${row('Subscription progress', progress(market))}${row('Mint price', `${amount(market?.mintPriceUsdcRaw, 6)} AF-USDC/PASS`)}${row('LP reserve', `${amount(market?.lpPassRaw, 18)} PASS · ${amount(market?.lpUsdcRaw, 6)} AF-USDC`)}${minted ? row('Current AMM price', `${poolPrice(market)} AF-USDC/PASS`) : ''}</dl>`;
  return `<dl class="order-quote launch-stats">${row('Total supply', `${amount(market?.totalSupplyRaw, 18)} PASS`)}${row('Initial pool', `${amount(market?.lpPassRaw, 18)} PASS`)}${row('Initial AF-USDC reserve', `${amount(market?.lpUsdcRaw, 6)} AF-USDC`)}${row('Treasury wallet allocation', market ? '500,000 PASS' : '—')}${row('Current AMM price', `${poolPrice(market)} AF-USDC/PASS`)}${row('Pool PASS reserve', `${amount(market?.reservePassRaw, 18)} PASS`)}${row('Pool AF-USDC reserve', `${amount(market?.reserveUsdcRaw, 6)} AF-USDC`)}</dl>`;
}

export function renderMarket(state: LaunchClientState): string {
  return `<div class="wrap inner-page launch-market"><header class="page-intro catalogue-intro"><div><span class="section-label">THE STRATEGY MARKET</span><h1>Two ideas.<br><em>One shared market.</em></h1><p>Fixed supply PASS. Native test ETH or AF-USDC. Wallet-authorized settlement on Robinhood Chain Testnet.</p></div>${connection(state)}</header>${network(state)}<div class="strategy-grid launch-market-grid">${strategies.map((strategy) => `<article class="market-card sketch-box"><span class="section-label">${strategy === 'TSLA' ? 'FAIR LAUNCH' : 'SECONDARY MARKET'}</span><h2>All in ${strategy}</h2><span class="fixture-tag">${esc(state.snapshot?.markets[strategy].state === 'LAUNCHED' ? 'LIVE TRADING' : (state.snapshot?.markets[strategy].state ?? 'NOT_DEPLOYED'))}</span>${stats(state, strategy)}<a class="primary-btn" href="#/trade/${strategy.toLowerCase()}">${state.snapshot?.markets[strategy].state === 'LAUNCHED' ? 'Open trading' : strategy === 'TSLA' ? 'Explore Mint' : 'Explore strategy'} ↗</a></article>`).join('')}</div><section class="launch-fair-note sketch-box"><span class="section-label">TSLA · MINTING → SOLD OUT → AUTO LAUNCH → LIVE TRADING</span><h2>The final Mint opens the market.</h2><p>500,000 public PASS at 0.5 AF-USDC/PASS. Another 500,000 PASS and 250,000 AF-USDC are reserved before Mint opens. The final Mint atomically creates the AMM pool and opens trading. No second administrator signature is needed.</p><p class="small muted">If pool creation fails, the entire final Mint reverts. Subscription proceeds go to the configured collection wallet; LP funds are held separately.</p></section><a class="text-link" href="#/account/claim">Free AF-USDC ↗</a>${renderTransaction(state)}</div>`;
}

export function renderQuote(state: LaunchClientState): string {
  const q = state.quote;
  if (!q) return '';
  const output = outputUnit(q);
  const decimals = output === 'AF-USDC' ? 6 : 18;
  const reference = q.reference;
  const paidRaw =
    q.operation === 'MINT'
      ? q.asset === 'ETH'
        ? q.transaction.value
        : state.snapshot
          ? String(
              (BigInt(q.estimatedOutRaw) * BigInt(state.snapshot.markets.TSLA.mintPriceUsdcRaw) +
                10n ** 18n -
                1n) /
                10n ** 18n,
            )
          : ''
      : q.amountInRaw;
  const when = (time: number) => new Date(time * 1000).toLocaleString('en-US');
  return `<section class="launch-reviewed sketch-box" aria-label="Reviewed chain quote"><span class="section-label">REVIEW ${actionName(q.operation).toUpperCase()} · ${q.strategyId}</span><h2>${amount(q.estimatedOutRaw, decimals, output === 'ETH' ? 8 : 6)} ${output}</h2><dl class="order-quote">${row('Pay', `${amount(paidRaw, q.operation === 'SELL' || q.asset === 'ETH' ? 18 : 6, 18)} ${q.operation === 'SELL' ? 'PASS' : q.asset === 'ETH' ? 'ETH' : 'AF-USDC'}`)}${row('Minimum received', `${amount(q.minOutRaw, decimals, output === 'ETH' ? 18 : 6)} ${output}`)}${row('Price impact', `${q.priceImpactBps / 100}%`)}${row('AMM fee', `${amount(q.feeUsdcRaw, 6)} AF-USDC`)}${row('Conversion fee', `${amount(q.conversionFeeUsdcRaw, 6)} AF-USDC`)}${row('Reference ETH/USD', reference ? `${amount(reference.ethUsdPriceRaw, 6)} USD` : 'Not required')}${row('Rate updated', reference ? when(reference.observedAt) : '—')}${row('Quote expires', when(q.expiresAt))}${row('Estimated gas', q.gasEstimateRaw === null ? 'Available after token approval' : `${amount(q.gasEstimateRaw, 0)} gas`)}</dl>${quoteIsFinalMint(state, q) ? `<p class="dialog-notice">This is the final Mint. It also creates the pool with the reserved 500,000 PASS and 250,000 AF-USDC, then opens trading in the same transaction. ${q.gasEstimateRaw === null ? 'The launch gas estimate is available after approval.' : 'The gas estimate includes launch.'} If launch fails, your Mint rolls back.</p>` : ''}<p class="small muted">${q.allowance ? 'An exact token approval is required first. This is a separate wallet transaction. After it is confirmed, review a fresh quote for the asset operation.' : 'Your wallet shows the contract, assets and amounts. A returned transaction hash is pending until verified chain inclusion.'}</p><button class="primary-btn full" data-launch-confirm ${state.busy ? 'disabled' : ''}>${q.allowance ? 'Approve exact amount' : 'Confirm in wallet'} ↗</button><button class="text-link" data-launch-clear ${state.busy ? 'disabled' : ''}>Cancel quote</button></section>`;
}

export function renderTrade(state: LaunchClientState, strategy: StrategyId, form: OrderForm): string {
  const market = state.snapshot?.markets[strategy];
  const launched = market?.state === 'LAUNCHED';
  const mint = strategy === 'TSLA' && !launched;
  const operation = mint ? 'MINT' : form.operation === 'SELL' ? 'SELL' : 'BUY';
  const available = state.wallet?.passes[strategy];
  const ethUnavailable =
    form.asset === 'ETH' &&
    !!state.snapshot &&
    !(operation === 'SELL'
      ? state.snapshot.conversion.ethSellAvailable
      : operation === 'MINT'
        ? (state.snapshot.conversion.ethMintAvailable ?? state.snapshot.conversion.ethBuyAvailable)
        : state.snapshot.conversion.ethBuyAvailable);
  return `<div class="wrap terminal-page launch-market"><header class="terminal-heading"><div><span class="section-label">${mint ? 'FAIR LAUNCH · PUBLIC MINT' : 'SHARED AMM · LIVE TRADING'}</span><h1>All in ${strategy}</h1><p>${mint ? 'Mint completes. The market launches automatically.' : 'Buy or sell PASS through one AF-USDC pool.'}</p></div>${connection(state)}</header>${network(state)}<div class="launch-terminal"><section><article class="sketch-box"><span class="fixture-tag">${esc(launched ? 'LIVE TRADING' : (market?.state ?? 'NOT_DEPLOYED'))}</span>${stats(state, strategy)}${mint ? '<p class="launch-fair-note">MINTING → SOLD OUT → AUTO LAUNCH → LIVE TRADING<br><span class="small muted">The final Mint and launch settle atomically. A failed launch rolls back the entire Mint.</span></p>' : ''}</article><section class="position-slip"><h2>Your PASS</h2><dl class="order-quote">${row('Available PASS', amount(available?.availableRaw, 18))}${row('Locked PASS', amount(available?.lockedRaw, 18))}${row('Wallet ETH', amount(state.wallet?.ethBalanceRaw, 18, 8))}${row('Wallet AF-USDC', amount(state.wallet?.usdcBalanceRaw, 6))}</dl><a class="text-link" href="#/account/vaults">Use PASS in a Vault ↗</a></section><p class="small muted">PASS market prices are separate from the strategy’s stock holdings and investment PnL.</p></section><aside class="pass-trade-aside"><section class="order-card sketch-box"><div class="order-kicker"><span class="mono">${mint ? 'PUBLIC MINT' : 'PASS MARKET'}</span><span class="fixture-tag">TEST ASSETS</span></div><h2>${mint ? 'Mint TSLA PASS' : `${actionName(operation)} ${strategy} PASS`}</h2>${mint ? '' : `<div class="order-side"><button data-launch-side="BUY" aria-pressed="${operation === 'BUY'}">Buy</button><button data-launch-side="SELL" aria-pressed="${operation === 'SELL'}">Sell</button></div>`}<form data-launch-order data-strategy="${strategy}" data-operation="${operation}"><label for="launch-payment">${operation === 'SELL' ? 'Receive' : 'Pay with'}</label><select id="launch-payment" name="asset" data-launch-asset><option value="ETH" ${form.asset === 'ETH' ? 'selected' : ''}>ETH · Default</option><option value="AF_USDC" ${form.asset === 'AF_USDC' ? 'selected' : ''}>AF-USDC</option></select><label class="order-amount-label" for="launch-amount">${mint ? 'PASS to mint' : operation === 'SELL' ? 'PASS to sell' : 'Amount to spend'}</label><div class="pass-amount-wrap"><input id="launch-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" value="${esc(form.amount)}" required><span>${inputUnit(operation, form.asset)}</span></div><label for="launch-slippage">Maximum slippage</label><select id="launch-slippage" name="slippageBps" data-launch-slippage>${[50, 100, 300].map((bps) => `<option value="${bps}" ${form.slippageBps === bps ? 'selected' : ''}>${bps / 100}%</option>`).join('')}</select>${ethUnavailable ? '<p class="form-error">This ETH conversion path has insufficient liquidity. Switch to AF-USDC to continue.</p>' : ''}<button class="primary-btn full" type="submit" ${actionable(state, strategy, operation, form.asset) ? '' : 'disabled'}>Review ${actionName(operation).toLowerCase()} ↗</button></form>${!state.owner ? '<p class="small muted">Connect your browser wallet to read balances and request a quote.</p>' : ''}<p class="order-disclaimer">Amounts settle on chain. Approvals, if needed, are separate transactions. No asset balances are created in the browser.</p></section>${renderQuote(state)}</aside></div>${renderTransaction(state)}</div>`;
}

const accountNav = (selected: string): string =>
  `<nav class="wrap account-tabs" aria-label="Account sections">${[
    ['trades', 'Pass Holdings'],
    ['claim', 'Free AF-USDC'],
    ['vaults', 'Vaults'],
    ['saved', 'Saved strategies'],
    ['notes', 'My notes'],
    ['settings', 'Settings'],
  ]
    .map(
      ([id, name]) =>
        `<a href="#/account/${id}" ${id === selected ? 'class="active" aria-current="page"' : ''}>${name}</a>`,
    )
    .join('')}</nav>`;

export function renderAccount(state: LaunchClientState): string {
  return `${accountNav('trades')}<section class="wrap wallet-account launch-market" data-launch-account><header class="wallet-account-header"><div><span class="section-label">MY WORKSHOP</span><h1>My Account</h1></div>${connection(state)}</header>${network(state)}<div class="wallet-balance-grid"><article class="sketch-box wallet-eth"><span class="section-label">ETH balance</span><div class="wallet-amount"><strong>${amount(state.wallet?.ethBalanceRaw, 18, 8)}</strong><span>ETH</span></div><p class="small muted">Native test ETH in your wallet.</p></article><article class="sketch-box wallet-usdc"><span class="section-label">AF-USDC balance</span><div class="wallet-amount"><strong>${amount(state.wallet?.usdcBalanceRaw, 6)}</strong><span>AF-USDC</span></div><a class="text-link" href="#/account/claim">Free AF-USDC ↗</a></article></div><section class="wallet-passes"><header><h2>Pass holdings</h2><span class="small muted">Fixed supply · Strategy capacity</span></header>${strategies.map((id) => `<article class="wallet-pass-row sketch-box"><span class="wallet-pass-icon" aria-hidden="true">α</span><div class="wallet-pass-strategy"><h3>All in ${id}</h3><span class="small muted">Available ${amount(state.wallet?.passes[id].availableRaw, 18)} · Locked ${amount(state.wallet?.passes[id].lockedRaw, 18)}</span><p><a class="text-link" href="#/trade/${id.toLowerCase()}">Open strategy ↗</a> <a class="text-link" href="#/account/vaults">Use PASS ↗</a></p></div><div class="wallet-pass-quantity"><strong>${amount(state.wallet?.passes[id].balanceRaw, 18)}</strong> PASS</div></article>`).join('')}</section><button class="text-link" data-launch-refresh>Refresh chain balances ↗</button>${renderTransaction(state)}</section>`;
}

export function renderClaim(state: LaunchClientState): string {
  const claim = state.snapshot?.claim;
  return `${accountNav('claim')}<div class="wrap inner-page launch-market"><header class="terminal-heading"><div><span class="section-label">TEST ASSETS · VERIFIED ACCOUNTS</span><h1>Free AF-USDC</h1><p>1,000 AF-USDC per verified account · 100 total successful claims.</p></div>${connection(state)}</header>${network(state)}<section class="sketch-box launch-claim"><dl class="order-quote">${row('Claim amount', `${amount(claim?.amountUsdcRaw, 6)} AF-USDC`)}${row('Remaining claims', claim ? String(claim.remainingClaims) : '—')}${row('Email verification status', state.wallet ? (state.wallet.accountId ? 'Verified account linked' : 'Verified account required') : 'Connect wallet to check')}${row('Wallet connection', state.owner ? 'Connected' : 'Not connected')}${row('Claim reserve', claim ? (claim.funded ? 'Funded on chain' : 'Funding required') : 'Unavailable')}</dl><p class="small muted">One successful claim per verified account. Changing wallets or signing in again does not create another claim. Email login does not grant wallet transaction authority.</p><button class="primary-btn" data-launch-claim ${actionable(state, 'TSLA', 'CLAIM', 'AF_USDC') ? '' : 'disabled'}>Review claim ↗</button></section>${renderQuote(state)}${renderTransaction(state)}</div>`;
}

export function renderVaults(state: LaunchClientState): string {
  const vaults = state.wallet?.vaults ?? [];
  return `${accountNav('vaults')}<div class="wrap inner-page launch-market"><header class="terminal-heading"><div><span class="section-label">STRATEGY PRINCIPAL · 1 PASS = 1 AF-USDC CAPACITY</span><h1>Your Vaults</h1></div>${connection(state)}</header>${network(state)}<p>Vault deposits lock corresponding PASS. Profit withdrawals do not unlock PASS; principal withdrawals release the corresponding capacity. Losses do not automatically unlock PASS.</p>${vaults.map((vault) => `<article class="sketch-box launch-vault"><h2>All in ${vault.strategyId} Vault</h2><dl class="order-quote">${row('Principal basis', `${amount(vault.principalBasisRaw, 6)} AF-USDC`)}${row('Total equity', vault.equityRaw === null ? 'Reference price unavailable' : `${amount(vault.equityRaw, 6)} AF-USDC`)}${row('Available cash', `${amount(vault.cashRaw, 6)} AF-USDC`)}${row('Locked PASS', amount(vault.lockedPassRaw, 18))}${row('Available PASS', amount(state.wallet?.passes[vault.strategyId].availableRaw, 18))}${row('Unrealized PnL', vault.unrealizedPnlRaw === null ? 'Reference price unavailable' : `${signedAmount(vault.unrealizedPnlRaw)} AF-USDC`)}${row('Realized PnL', `${signedAmount(vault.realizedPnlRaw)} AF-USDC`)}${row('Withdrawable profit', `${amount(vault.withdrawableProfitRaw, 6)} AF-USDC`)}${row('Withdrawable principal', `${amount(vault.withdrawablePrincipalRaw, 6)} AF-USDC`)}${row('Vault status', vault.status)}</dl><h3>Stock holdings</h3>${vault.holdings.length ? `<dl class="order-quote">${vault.holdings.map((holding) => row(`${holding.token.slice(0, 6)}…${holding.token.slice(-4)}`, `${amount(holding.amountRaw, 18)} test stock units`)).join('')}</dl>` : '<p class="small muted">No tracked stock positions.</p>'}<p class="small muted">Fixed strategy test stock units are substitutes for testing, not real shares. Reference prices are for Testnet. PASS market value is excluded from strategy PnL.</p>${vault.status === 'OPEN' ? `${renderExecutor(state, vault.strategyId)}<form data-launch-vault-order data-strategy="${vault.strategyId}"><label for="vault-${vault.strategyId}">Amount · AF-USDC</label><input id="vault-${vault.strategyId}" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="10" required><div class="inline-actions"><button class="primary-btn" type="submit" name="operation" value="DEPOSIT" ${actionable(state, vault.strategyId, 'DEPOSIT', 'AF_USDC') ? '' : 'disabled'}>Review deposit ↗</button><button class="outline-btn" type="submit" name="operation" value="WITHDRAW" ${actionable(state, vault.strategyId, 'WITHDRAW', 'AF_USDC') ? '' : 'disabled'}>Review withdrawal ↗</button><button class="text-link" type="button" data-launch-vault-close="${vault.strategyId}" ${actionable(state, vault.strategyId, 'CLOSE', 'AF_USDC') && !vault.holdings.some((holding) => BigInt(holding.amountRaw) > 0n) ? '' : 'disabled'}>Review close ↗</button></div></form><p class="small muted">USDC and PASS approvals, if required, are separately confirmed before deposit. Close requires tracked strategy positions to be settled.</p>` : ''}</article>`).join('')}${strategies
    .filter((strategy) => !vaults.some((vault) => vault.strategyId === strategy))
    .map(
      (strategy) =>
        `<article class="sketch-box launch-vault"><h2>All in ${strategy} Vault</h2><p>Your wallet creates and owns its own Vault. The subscription collection wallet cannot operate it.</p><button class="primary-btn" data-launch-create-vault="${strategy}" ${actionable(state, strategy, 'CREATE_VAULT', 'AF_USDC') ? '' : 'disabled'}>Review create Vault ↗</button></article>`,
    )
    .join(
      '',
    )}<button class="text-link" data-launch-refresh>Refresh chain state ↗</button>${renderQuote(state)}${renderExecutorReview(state)}${renderTransaction(state)}</div>`;
}

export function renderExecutor(state: LaunchClientState, strategyId: StrategyId): string {
  const snapshot = state.executorSnapshots?.[strategyId];
  const grant = snapshot?.grant;
  const present = !!grant && !/^0x0{40}$/i.test(grant.executor);
  const enabled = actionable(state, strategyId, 'DEPOSIT', 'AF_USDC');
  return `<section class="launch-executor"><h3>Executor permission</h3><p class="small muted">You choose whether an executor can trade this Vault’s fixed All in ${strategyId} test strategy. Test stock units are substitutes for testing, not real shares. Creating or funding a Vault sends no strategy trade.</p>${snapshot ? `<dl class="order-quote">${row('Vault owner', snapshot.owner)}${row('Vault contract', snapshot.vault)}${row('Executor', present ? grant!.executor : 'No executor configured')}${row('Expires', present ? new Date(Number(grant!.expiresAt) * 1000).toISOString() : '—')}${row('Per-order limit', present ? `${amount(grant!.maxOrderUsdc, 6)} AF-USDC` : '—')}${row('Cumulative buy limit', present ? `${amount(grant!.maxTotalBuyUsdc, 6)} AF-USDC` : '—')}${row('Cumulative buys used', `${amount(snapshot.totalBuyUsdc, 6)} AF-USDC`)}${row('Maximum slippage', present ? `${grant!.maxSlippageBps / 100}% (${grant!.maxSlippageBps} bps)` : '—')}${row('Permission read at block', snapshot.blockNumber)}</dl>` : '<p class="small muted">Refresh to read the current on-chain executor permission.</p>'}<button class="text-link" data-launch-executor-refresh="${strategyId}" ${state.owner && !state.busy ? '' : 'disabled'}>Refresh executor permission ↗</button><details><summary>Configure an executor</summary><form data-launch-executor-order data-strategy="${strategyId}"><label for="executor-${strategyId}">Exact executor wallet address</label><input id="executor-${strategyId}" name="executor" type="text" autocomplete="off" placeholder="0x…" required><label for="executor-expiry-${strategyId}">Permission expiry · your local time</label><input id="executor-expiry-${strategyId}" name="expiresAt" type="datetime-local" required><label for="executor-order-${strategyId}">Per-order AF-USDC limit</label><input id="executor-order-${strategyId}" name="maxOrderUsdc" type="text" inputmode="decimal" autocomplete="off" required><label for="executor-total-${strategyId}">Cumulative buy AF-USDC limit</label><input id="executor-total-${strategyId}" name="maxTotalBuyUsdc" type="text" inputmode="decimal" autocomplete="off" required><label for="executor-slippage-${strategyId}">Maximum slippage · basis points (0–500)</label><input id="executor-slippage-${strategyId}" name="maxSlippageBps" type="number" min="0" max="500" step="1" required><p class="small muted">The maximum contract slippage is 5%. Reconfiguring resets cumulative buy usage. Executor transactions remain restricted to this strategy and these limits.</p><button type="submit" class="primary-btn" ${enabled ? '' : 'disabled'}>Review executor permission ↗</button></form></details><button class="outline-btn" data-launch-executor-revoke="${strategyId}" ${enabled ? '' : 'disabled'}>Review revoke permission ↗</button><p class="small muted">Revocation removes future executor authority after inclusion. It does not sell holdings or cancel already included trades.</p></section>`;
}

export function renderExecutorReview(state: LaunchClientState): string {
  const review = state.executorReview;
  if (!review) return '';
  const p = review.permission;
  return `<section class="launch-reviewed sketch-box" aria-label="Reviewed executor permission"><span class="section-label">OWNER WALLET · ${review.kind === 'CONFIGURE' ? 'CONFIGURE' : 'REVOKE'} EXECUTOR</span><h2>${review.snapshot.strategyId} Vault permission</h2><dl class="order-quote">${row('Owner signing wallet', review.snapshot.owner)}${row('Vault contract', review.snapshot.vault)}${row('Exact executor', p?.executor ?? review.snapshot.grant.executor)}${row('Permission expiry', p ? new Date(Number(p.expiresAt) * 1000).toISOString() : 'Authority removed')}${row('Per-order limit', p ? `${amount(p.maxOrderUsdc, 6)} AF-USDC` : 'Authority removed')}${row('Cumulative buy limit', p ? `${amount(p.maxTotalBuyUsdc, 6)} AF-USDC` : 'Authority removed')}${row('Maximum slippage', p ? `${p.maxSlippageBps / 100}% (${p.maxSlippageBps} bps)` : 'Authority removed')}${row('Native ETH transferred', '0 ETH')}${row('Estimated gas', `${amount(review.gasEstimateRaw, 0)} gas`)}</dl><p>${p ? 'This permission allows the exact executor above to trade the Vault’s test stock assets within these limits until expiry. Replacing a grant resets cumulative buy usage.' : 'This transaction removes the executor permission. It does not automatically sell any holding.'} Your owner wallet must confirm the contract transaction. No strategy trade is sent by this action.</p><button class="primary-btn" data-launch-executor-confirm ${state.busy ? 'disabled' : ''}>Confirm permission in owner wallet ↗</button><button class="text-link" data-launch-clear ${state.busy ? 'disabled' : ''}>Cancel review</button></section>`;
}

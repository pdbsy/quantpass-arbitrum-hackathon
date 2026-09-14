import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROBINHOOD_CHAIN_TESTNET } from '../packages/robinhood-chain/src/network.ts';
import {
  TRANSACTION_STATUSES,
  NETWORK_STATUSES,
  M3_CANONICAL_STRATEGY_ID,
  WALLET_STATUSES,
  extendM3ProductPages,
  renderM3AccountShell,
  renderM3StrategyShell,
  renderNetworkStatus,
  renderTransactionStatus,
  renderWalletStatus,
} from '../apps/web/src/m3-product-shell.ts';

test('page extension preserves product pages and prepends route-specific M3 shells', () => {
  let accountId: string | null = 'alice';
  const pages = extendM3ProductPages(
    {
      account: (tab) => `<div>original account ${tab}</div>`,
      trade: (strategyId) => `<div>original trade ${strategyId}</div>`,
    },
    {
      accountId: () => accountId,
      contentProvenance: (strategyId) => (strategyId === 'trend' ? 'FIXTURE' : 'LOCAL SIMULATION'),
    },
  );

  const fixture = pages.trade('trend');
  assert.ok(fixture.indexOf('M3 product chain status') < fixture.indexOf('original trade trend'));
  assert.match(fixture, /FIXTURE/);

  const local = pages.trade('core-flow-demo');
  assert.match(local, /LOCAL SIMULATION/);
  assert.match(local, /original trade core-flow-demo/);

  assert.match(pages.account('funds'), /AlphaForge account · alice/);
  accountId = 'bob';
  assert.match(pages.account('activity'), /AlphaForge account · bob/);
  assert.match(pages.account('activity'), /original account activity/);
});

test('strategy shell separates fixture content from unavailable Testnet capabilities', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
  });

  assert.match(html, /trend/);
  assert.match(html, /FIXTURE/);
  assert.match(html, /TESTNET/);
  assert.match(html, new RegExp(ROBINHOOD_CHAIN_TESTNET.name));
  assert.match(html, new RegExp(String(ROBINHOOD_CHAIN_TESTNET.chainId)));
  assert.doesNotMatch(html, /CHAIN CONFIRMED/);
  assert.equal(M3_CANONICAL_STRATEGY_ID, 'trend');
  assert.match(html, /CANONICAL STRATEGY ID/);

  for (const action of ['Buy Pass', 'Sell Pass', 'Deposit', 'Withdraw', 'Approve']) {
    assert.match(html, new RegExp(`<button[^>]+disabled[^>]*>${action} · NOT IMPLEMENTED</button>`));
  }
});

test('historical local strategy identities remain isolated from the canonical product strategy', () => {
  for (const strategyId of ['core-flow-demo', 'satellite-flow-demo']) {
    const html = renderM3StrategyShell({
      strategyId,
      contentProvenance: 'LOCAL SIMULATION',
    });
    assert.match(html, /HISTORICAL LOCAL IDENTITY/);
    assert.match(html, new RegExp(`${strategyId} remains isolated from trend`));
    assert.match(html, /No local balance or ownership is used as a Testnet holding/);
  }
});

test('local account identity remains separate from wallet identity', () => {
  const html = renderM3AccountShell({ accountId: 'alice' });

  assert.match(html, /AlphaForge account/);
  assert.match(html, /alice/);
  assert.match(html, /LOCAL SIMULATION/);
  assert.match(html, /Wallet/);
  assert.match(html, /DISCONNECTED/);
  assert.match(html, /Account and wallet are separate identities/);
});

test('every frozen wallet status has distinct human-readable output', () => {
  const messages = WALLET_STATUSES.map((status) => renderWalletStatus(status));

  assert.equal(new Set(messages).size, WALLET_STATUSES.length);
  assert.match(renderWalletStatus('CONNECTED'), /Connected/);
  assert.match(renderWalletStatus('CONNECTION_REJECTED'), /rejected/);
  assert.match(renderWalletStatus('ACCOUNT_CHANGED'), /changed/);
});

test('every required network status has distinct human-readable output', () => {
  const messages = NETWORK_STATUSES.map((status) => renderNetworkStatus(status));

  assert.equal(new Set(messages).size, NETWORK_STATUSES.length);
  assert.match(renderNetworkStatus('CORRECT'), /required Robinhood Chain Testnet/);
  assert.match(renderNetworkStatus('WRONG'), /Wrong network/);
  assert.match(renderNetworkStatus('SWITCH_REJECTED'), /rejected/);
  assert.match(renderNetworkStatus('RPC_UNAVAILABLE'), /RPC is unavailable/);
});

test('every frozen transaction status has distinct human-readable output', () => {
  const messages = TRANSACTION_STATUSES.map((status) => renderTransactionStatus(status));

  assert.equal(new Set(messages).size, TRANSACTION_STATUSES.length);
  assert.match(renderTransactionStatus('CHAIN_CONFIRMED'), /confirmed on-chain/i);
  assert.match(renderTransactionStatus('CHAIN_CONFIRMED'), /sync/i);
  assert.match(renderTransactionStatus('READY'), /product state is updated/i);
  assert.doesNotMatch(renderTransactionStatus('READY'), /waiting for readback/i);
});

test('presentation escapes route, account, address and error text', () => {
  const strategy = renderM3StrategyShell({
    strategyId: '<img src=x onerror=alert(1)>',
    contentProvenance: 'LOCAL SIMULATION',
    wallet: {
      status: 'CONNECTED',
      address: '<script>bad()</script>',
    },
    transaction: {
      status: 'FAILED',
      errorCode: '<b>REVERT</b>',
      errorMessage: '<svg onload=bad()>',
    },
  });
  const account = renderM3AccountShell({ accountId: '<iframe src=x>' });

  for (const html of [strategy, account]) {
    assert.doesNotMatch(html, /<img|<script|<svg|<iframe/);
  }
  assert.match(strategy, /&lt;img/);
  assert.match(strategy, /&lt;script/);
  assert.match(strategy, /&lt;b&gt;REVERT/);
  assert.match(account, /&lt;iframe/);
});

test('connected wallet shows full and short address and valid transaction evidence uses canonical explorer', () => {
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  const txHash = `0x${'ab'.repeat(32)}`;
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    wallet: { status: 'CONNECTED', address },
    network: { status: 'CORRECT', chainId: ROBINHOOD_CHAIN_TESTNET.chainId },
    transaction: { status: 'SUBMITTED', txHash },
  });

  assert.match(html, new RegExp(address));
  assert.match(html, /0x1234…5678/);
  assert.match(
    html,
    new RegExp(`${ROBINHOOD_CHAIN_TESTNET.explorerUrl}/tx/${txHash}`.replaceAll('/', '\\/')),
  );
  assert.match(html, /Chain ID 46630/);
});

test('invalid transaction hash is displayed as text without an explorer link', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    transaction: { status: 'FAILED', txHash: 'javascript:alert(1)' },
  });

  assert.match(html, /javascript:alert\(1\)/);
  assert.doesNotMatch(html, /href=/);
});

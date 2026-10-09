import assert from 'node:assert/strict';
import { test } from 'node:test';
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
import { config, snapshot, wallet, quote, OWNER } from './helpers/launch-market-ui-fixture.ts';
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

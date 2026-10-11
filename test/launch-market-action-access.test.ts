import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionAccess, actionControl } from '../apps/web/src/launch-market/action-access.ts';
import { actionable } from '../apps/web/src/launch-market/presentation.ts';
import { renderAccount, renderVaults } from '../apps/web/src/launch-market/shell.ts';
import { account, config, OWNER, snapshot, wallet } from './helpers/launch-market-ui-fixture.ts';
import type { LaunchClientState } from '../apps/web/src/launch-market/model.ts';

const state = (): LaunchClientState => ({
  enabled: true,
  config: { ...config(), emailVerificationRequired: false },
  owner: OWNER,
  wallet: { ...wallet(), accountId: null },
  account: null,
  snapshot: snapshot(),
  busy: false,
  connecting: false,
  quote: null,
  quoteRequest: null,
  error: null,
  notice: null,
  transaction: { state: 'IDLE', id: null, hash: null, confirmations: 0, approval: false, owner: null },
});

test('a connected wallet without a session gets an explicit ownership action, without enabling settlement', () => {
  const current = state();
  assert.equal(actionable(current, 'TSLA', 'MINT', 'AF_USDC'), false);
  const html = actionControl(current, 'TSLA', 'MINT', 'AF_USDC', 'Review Mint TSLA');
  assert.match(html, /type="button"[^>]+data-launch-bind/);
  assert.match(html, /No email verification is required/);
  assert.doesNotMatch(html, /type="submit"|disabled|data-launch-confirm/);
  const session = { ...account(), emailVerified: false, identityKind: 'WALLET_TEST' as const };
  const linked = { ...current, account: session, wallet: wallet() };
  assert.equal(actionAccess(linked, 'TSLA', 'MINT', 'AF_USDC').action, 'REVIEW');
  assert.match(actionControl(linked, 'TSLA', 'MINT', 'AF_USDC', 'Review Mint TSLA'), /type="submit"/);
});

test('missing wallet, expired session, pending transaction and verified-email mode show the appropriate next step', () => {
  const current = state();
  assert.equal(
    actionAccess({ ...current, owner: null, wallet: null }, 'TSLA', 'MINT', 'AF_USDC').action,
    'CONNECT',
  );
  assert.equal(
    actionAccess(
      { ...current, config: { ...current.config!, emailVerificationRequired: true } },
      'TSLA',
      'MINT',
      'AF_USDC',
    ).action,
    'LOGIN',
  );
  assert.equal(actionAccess({ ...current, busy: true }, 'TSLA', 'MINT', 'AF_USDC').action, 'WAIT');
  const pending = {
    ...current,
    transaction: { ...current.transaction, state: 'RECOVERY_REQUIRED' as const },
  };
  assert.equal(actionAccess(pending, 'TSLA', 'MINT', 'AF_USDC').action, 'WAIT');
  assert.match(
    actionControl(pending, 'TSLA', 'MINT', 'AF_USDC', 'Review Mint TSLA'),
    /Check your pending transaction/,
  );
});

test('My Account opens the selected strategy Vault with concrete capacity and settlement steps', () => {
  const current = state();
  const html = renderAccount(current);
  assert.match(html, /href="#\/account\/vaults\/tsla">Use PASS/);
  assert.match(html, /href="#\/account\/vaults\/amzn">Use PASS/);
  const page = renderVaults(current, {}, 'TSLA');
  assert.match(page, /All in TSLA Vault/);
  assert.doesNotMatch(page, /All in AMZN Vault/);
  assert.match(page, /10 PASS lets you deposit 10 AF-USDC/);
  assert.match(page, /data-launch-bind/);
  assert.match(page, /data-launch-create-vault="TSLA" disabled/);
});

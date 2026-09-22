import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asAddress, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
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
  onchainActionEnabled,
  transactionPresentationFromEvidence,
  transactionPresentationFromWalletSubmission,
  renderTransactionStatus,
  renderWalletStatus,
} from '../apps/web/src/m3-product-shell.ts';

const operationEvidenceDefaults = {
  receiptCanonical: true,
  chainStatus: 'INCLUDED' as const,
  l1Status: 'UNKNOWN' as const,
  finalityStatus: 'UNKNOWN' as const,
  indexerStatus: 'HEALTHY' as const,
  degradedReason: null,
};

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

  for (const action of ['Deposit', 'Withdraw', 'Approve']) {
    assert.match(html, new RegExp(`<button[^>]+disabled[^>]*>${action} · NOT IMPLEMENTED</button>`));
  }
  assert.match(html, /data-pass-transfer disabled>Transfer Pass/);
  assert.match(html, /Buy Pass · OUT OF PHASE ONE/);
  assert.match(html, /Sell Pass · OUT OF PHASE ONE/);
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
  assert.match(renderTransactionStatus('CHAIN_CONFIRMED'), /receipt succeeded on-chain/i);
  assert.match(renderTransactionStatus('CHAIN_CONFIRMED'), /reconciliation/i);
  assert.match(renderTransactionStatus('READY'), /product state is updated/i);
  assert.doesNotMatch(renderTransactionStatus('READY'), /waiting for readback/i);
});

test('Macbeth03 operation evidence maps receipt success and product readback separately', () => {
  const base = {
    receiptCanonical: true,
    chainStatus: 'INCLUDED' as const,
    l1Status: 'UNKNOWN' as const,
    finalityStatus: 'UNKNOWN' as const,
    indexerStatus: 'HEALTHY' as const,
    degradedReason: null,

    receipt: 'SUCCESS' as const,
    confirmations: 1,
    reconciliation: 'PENDING' as const,
    projection: 'PENDING' as const,
    productReady: false,
  };

  assert.deepEqual(transactionPresentationFromEvidence({ ...base, lifecycle: 'MINED' }), {
    status: 'CHAIN_CONFIRMED',
  });
  assert.deepEqual(
    transactionPresentationFromEvidence({
      ...base,
      lifecycle: 'CONFIRMED',
      chainStatus: 'SOFT_READY',
      confirmations: 3,
      reconciliation: 'MATCHED',
    }),
    { status: 'INDEXING' },
  );
  assert.deepEqual(
    transactionPresentationFromEvidence({
      ...base,
      lifecycle: 'CONFIRMED',
      chainStatus: 'SOFT_READY',
      confirmations: 3,
      reconciliation: 'MATCHED',
      projection: 'READY',
      productReady: true,
    }),
    { status: 'READY' },
  );
});

test('reorg, reconciliation failure and stale projection never map to READY', () => {
  const failures = [
    {
      ...operationEvidenceDefaults,
      lifecycle: 'REORGED' as const,
      receiptCanonical: false,
      chainStatus: 'REORGED' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'SUCCESS' as const,
      confirmations: 3,
      reconciliation: 'PENDING' as const,
      projection: 'STALE' as const,
      productReady: false,
    },
    {
      ...operationEvidenceDefaults,
      lifecycle: 'RECONCILIATION_FAILED' as const,
      receiptCanonical: true,
      chainStatus: 'FAILED' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'SUCCESS' as const,
      confirmations: 3,
      reconciliation: 'FAILED' as const,
      projection: 'PENDING' as const,
      productReady: false,
    },
    {
      ...operationEvidenceDefaults,
      lifecycle: 'CONFIRMED' as const,
      receiptCanonical: true,
      chainStatus: 'SOFT_READY' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'SUCCESS' as const,
      confirmations: 3,
      reconciliation: 'MATCHED' as const,
      projection: 'STALE' as const,
      productReady: false,
    },
  ];

  for (const evidence of failures) {
    const presentation = transactionPresentationFromEvidence(evidence);
    assert.equal(presentation.status, 'FAILED');
    assert.notEqual(presentation.status, 'READY');
  }
  assert.equal(transactionPresentationFromEvidence(failures[0]!).errorCode, 'REORGED');
  assert.equal(transactionPresentationFromEvidence(failures[1]!).errorCode, 'RECONCILIATION_FAILED');
  assert.equal(transactionPresentationFromEvidence(failures[2]!).errorCode, 'PROJECTION_STALE');
});

test('failure evidence takes precedence over a contradictory productReady flag', () => {
  const contradictoryFailures = [
    {
      ...operationEvidenceDefaults,
      lifecycle: 'REORGED' as const,
      receiptCanonical: false,
      chainStatus: 'REORGED' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'SUCCESS' as const,
      confirmations: 3,
      reconciliation: 'MATCHED' as const,
      projection: 'READY' as const,
      productReady: true,
    },
    {
      ...operationEvidenceDefaults,
      lifecycle: 'CONFIRMED' as const,
      receiptCanonical: true,
      chainStatus: 'SOFT_READY' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'REVERTED' as const,
      confirmations: 3,
      reconciliation: 'MATCHED' as const,
      projection: 'READY' as const,
      productReady: true,
    },
    {
      ...operationEvidenceDefaults,
      lifecycle: 'CONFIRMED' as const,
      receiptCanonical: true,
      chainStatus: 'SOFT_READY' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'SUCCESS' as const,
      confirmations: 3,
      reconciliation: 'FAILED' as const,
      projection: 'READY' as const,
      productReady: true,
    },
    {
      ...operationEvidenceDefaults,
      lifecycle: 'CONFIRMED' as const,
      receiptCanonical: true,
      chainStatus: 'SOFT_READY' as const,
      l1Status: 'UNKNOWN' as const,
      finalityStatus: 'UNKNOWN' as const,
      indexerStatus: 'HEALTHY' as const,
      degradedReason: null,
      receipt: 'SUCCESS' as const,
      confirmations: 3,
      reconciliation: 'MATCHED' as const,
      projection: 'STALE' as const,
      productReady: true,
    },
  ];

  for (const evidence of contradictoryFailures) {
    assert.equal(transactionPresentationFromEvidence(evidence).status, 'FAILED');
  }
});

test('wallet submission maps submitted evidence without claiming receipt success', () => {
  const txHash = asTransactionHash(`0x${'ab'.repeat(32)}`);
  assert.deepEqual(
    transactionPresentationFromWalletSubmission({
      operationId: 'deposit-01',
      chainId: ROBINHOOD_CHAIN_TESTNET.chainId,
      owner: asAddress('0x1111111111111111111111111111111111111111'),
      target: asAddress('0x2222222222222222222222222222222222222222'),
      state: 'SUBMITTED',
      txHash,
      submittedAt: '2026-09-19T09:00:00.000Z',
    }),
    { status: 'SUBMITTED', txHash },
  );
});

test('every ambiguous wallet outcome is non-retryable and never maps to ready', () => {
  const reasons = [
    'SESSION_CHANGED',
    'POST_SUBMISSION_CHECK_FAILED',
    'PROVIDER_RESULT_UNKNOWN',
    'LOCAL_EVIDENCE_INVALID',
  ] as const;

  for (const [index, reason] of reasons.entries()) {
    const presentation = transactionPresentationFromWalletSubmission({
      operationId: `deposit-${index}`,
      requestedChainId: ROBINHOOD_CHAIN_TESTNET.chainId,
      requestedOwner: asAddress('0x1111111111111111111111111111111111111111'),
      target: asAddress('0x2222222222222222222222222222222222222222'),
      state: 'SUBMISSION_AMBIGUOUS',
      txHash: index % 2 === 0 ? asTransactionHash(`0x${'cd'.repeat(32)}`) : null,
      observedAt: index === 3 ? null : '2026-09-19T09:00:00.000Z',
      reason,
      retryable: false,
    });
    assert.equal(presentation.status, 'SUBMISSION_AMBIGUOUS');
    assert.equal(presentation.errorCode, reason);
    assert.notEqual(presentation.status, 'READY');
  }
  assert.match(renderTransactionStatus('SUBMISSION_AMBIGUOUS'), /do not retry/i);
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

test('soft-ready chain state is shown without claiming finality', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain: {
      deployment: 'CONFIGURED',
      health: 'LIVE',
      readiness: 'SOFT_READY',
      owner: 'OWNER',
      writeMode: 'INJECTED_MOCK',
      exitPath: 'LIVE_RPC',
      supportedActions: ['deposit', 'withdraw', 'close'],
    },
  });

  assert.match(html, /SOFT READY/);
  assert.match(html, /three confirmations/i);
  assert.match(html, /L1 finality remains unknown/i);
  assert.doesNotMatch(html, /finalized/i);
  assert.match(html, /Mock provider reads are active/);
  assert.doesNotMatch(html, /Canonical chain reads are live/);
});

test('a newly connected owner cannot deposit without both Vault-only token allowances', () => {
  const onchain = {
    deployment: 'CONFIGURED' as const,
    health: 'LIVE' as const,
    readiness: 'SOFT_READY' as const,
    owner: 'OWNER' as const,
    writeMode: 'INJECTED_MOCK' as const,
    exitPath: 'SIMULATION' as const,
    supportedActions: ['deposit', 'withdraw', 'close'] as const,
    vaultAddress: '0x2222222222222222222222222222222222222222',
    depositAuthorization: {
      spender: '0x2222222222222222222222222222222222222222',
      afUsdcAllowanceBaseUnits: '0',
      passAllowanceBaseUnits: '0',
      approvalCapability: 'UNAVAILABLE' as const,
    },
  };
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain,
  });

  assert.equal(onchainActionEnabled(onchain, 'deposit'), false);
  assert.match(html, /AF-USDC allowance[\s\S]*0 base units/);
  assert.match(html, /Pass allowance[\s\S]*0 base units/);
  assert.match(html, /spender[\s\S]*0x2222222222222222222222222222222222222222/);
  assert.match(html, /two exact finite approvals/i);
  assert.match(html, /Approval flow is not implemented/i);
  assert.match(html, /infinite approval/i);
  assert.match(html, /data-chain-action="deposit"[^>]*disabled/);
  assert.equal(
    onchainActionEnabled(
      {
        ...onchain,
        depositAuthorization: {
          ...onchain.depositAuthorization,
          afUsdcAllowanceBaseUnits: '1',
          passAllowanceBaseUnits: '1',
        },
      },
      'deposit',
    ),
    false,
  );
});

test('configured approval capability opens Deposit review while keeping exact allowance enforcement', () => {
  const onchain = {
    deployment: 'CONFIGURED' as const,
    health: 'LIVE' as const,
    readiness: 'FINALITY_UNKNOWN' as const,
    owner: 'OWNER' as const,
    writeMode: 'LIVE_AUTHORIZED' as const,
    exitPath: 'SIMULATION' as const,
    supportedActions: ['deposit', 'withdraw', 'close'] as const,
    vaultAddress: '0x2222222222222222222222222222222222222222',
    depositAuthorization: {
      spender: '0x2222222222222222222222222222222222222222',
      afUsdcAllowanceBaseUnits: '0',
      passAllowanceBaseUnits: '0',
      approvalCapability: 'AVAILABLE' as const,
    },
  };
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain,
  });

  assert.equal(onchainActionEnabled(onchain, 'deposit'), true);
  assert.match(html, /Approve · USE DEPOSIT REVIEW/);
  assert.match(html, /approval flow is available from Deposit review/i);
  assert.doesNotMatch(html, /unlimited/i);
});

test('degraded indexer preserves owner withdraw and close through live RPC simulation', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain: {
      deployment: 'CONFIGURED',
      health: 'DEGRADED',
      readiness: 'FINALITY_UNKNOWN',
      owner: 'OWNER',
      writeMode: 'INJECTED_MOCK',
      exitPath: 'SIMULATION',
      supportedActions: ['deposit', 'withdraw', 'close'],
    },
  });

  assert.match(html, /INDEXER DEGRADED/);
  assert.match(html, /live RPC simulation/i);
  assert.match(html, /INJECTED MOCK/);
  assert.match(html, /no real rights or funds/i);
  assert.match(html, /<button[^>]*data-chain-action="withdraw"[^>]*>Withdraw<\/button>/);
  assert.match(html, /<button[^>]*data-chain-action="close"[^>]*>Close<\/button>/);
  assert.match(html, /<button[^>]*data-chain-action="deposit"[^>]*disabled[^>]*>Deposit<\/button>/);
});

test('closed Vault keeps only owner post-close rescue actions available', () => {
  const onchain = {
    deployment: 'CONFIGURED' as const,
    health: 'DEGRADED' as const,
    readiness: 'FINALITY_UNKNOWN' as const,
    owner: 'OWNER' as const,
    writeMode: 'LIVE_AUTHORIZED' as const,
    exitPath: 'SIMULATION' as const,
    supportedActions: ['rescue-token', 'rescue-native'] as const,
    vaultAddress: '0x2222222222222222222222222222222222222222',
    vaultClosed: true,
  };

  for (const action of ['deposit', 'withdraw', 'close'] as const)
    assert.equal(onchainActionEnabled(onchain, action), false, action);
  assert.equal(onchainActionEnabled(onchain, 'rescue-token' as never), true);
  assert.equal(onchainActionEnabled(onchain, 'rescue-native' as never), true);

  const html = renderM3StrategyShell({ strategyId: 'trend', contentProvenance: 'FIXTURE', onchain });
  assert.match(html, /VAULT CLOSED/);
  assert.match(html, /data-chain-action="rescue-token"/);
  assert.match(html, /data-chain-action="rescue-native"/);
  assert.match(html, /Rescue untracked token/);
  assert.match(html, /Rescue native/);
});

test('configured Pass capability offers transfer while paid sale remains outside Phase One', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain: {
      deployment: 'CONFIGURED',
      health: 'LIVE',
      readiness: 'FINALITY_UNKNOWN',
      owner: 'NON_OWNER',
      writeMode: 'DISABLED',
      exitPath: 'UNAVAILABLE',
      supportedActions: [],
      passAddress: '0x4444444444444444444444444444444444444444',
      passBalanceBaseUnits: '1',
      passTransferMode: 'LIVE_AUTHORIZED',
      passInitialSupplyBaseUnits: '10000000000000000000',
      passInitialRecipient: '0x1111111111111111111111111111111111111111',
    } as never,
  });

  assert.match(html, /0x4444444444444444444444444444444444444444/);
  assert.match(html, /0\.000000000000000001 Pass/);
  assert.match(html, /1 base unit/);
  assert.match(html, /Initial Pass allocation/);
  assert.match(html, /10\.000000000000000000 Pass/);
  assert.match(html, /0x1111111111111111111111111111111111111111/);
  assert.match(html, /<button[^>]*data-pass-transfer[^>]*>Transfer Pass<\/button>/);
  assert.match(html, /Buy Pass · OUT OF PHASE ONE/);
  assert.match(html, /Sell Pass · OUT OF PHASE ONE/);
  assert.doesNotMatch(html, /Buy Pass · NOT IMPLEMENTED/);
});

test('Vault selection renders two reviewed choices while preserving a shared Pass identity', () => {
  const vaultA = asAddress('0x2222222222222222222222222222222222222222');
  const vaultB = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const sharedPass = '0x4444444444444444444444444444444444444444';
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    vaultSelection: {
      selected: { chainId: 46_630, vaultAddress: vaultB },
      options: [
        { chainId: 46_630, vaultAddress: vaultA },
        { chainId: 46_630, vaultAddress: vaultB },
      ],
    },
    onchain: {
      deployment: 'CONFIGURED',
      health: 'LIVE',
      readiness: 'FINALITY_UNKNOWN',
      owner: 'OWNER',
      writeMode: 'INJECTED_MOCK',
      exitPath: 'SIMULATION',
      supportedActions: ['deposit', 'withdraw', 'close'],
      vaultAddress: vaultB,
      passAddress: sharedPass,
      passTransferMode: 'INJECTED_MOCK',
    },
  });

  assert.match(html, /data-chain-vault-select/);
  assert.match(html, new RegExp(`value="46630:${vaultA}"`));
  assert.match(html, new RegExp(`value="46630:${vaultB}" selected`));
  assert.match(html, /Reviewed deployment allowlist/);
  assert.match(html, new RegExp(sharedPass));
  assert.doesNotMatch(html, /Discover|Deploy new Vault/);
});

test('degraded indexer identifies a non-owner wallet without implying an owner exit path', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain: {
      deployment: 'CONFIGURED',
      health: 'DEGRADED',
      readiness: 'FINALITY_UNKNOWN',
      owner: 'NON_OWNER',
      writeMode: 'DISABLED',
      exitPath: 'UNAVAILABLE',
      supportedActions: ['withdraw', 'close'],
      vaultAddress: '0x2222222222222222222222222222222222222222',
    },
  });

  assert.match(html, /Current wallet is not the Vault owner; owner exits are unavailable/);
  assert.doesNotMatch(html, /Owner exit remains available/);
});

test('chain writes remain disabled without explicit write mode or wallet ownership', () => {
  for (const onchain of [
    {
      deployment: 'CONFIGURED' as const,
      health: 'LIVE' as const,
      readiness: 'SOFT_READY' as const,
      owner: 'OWNER' as const,
      writeMode: 'DISABLED' as const,
      exitPath: 'LIVE_RPC' as const,
      supportedActions: ['deposit', 'withdraw', 'close'] as const,
    },
    {
      deployment: 'CONFIGURED' as const,
      health: 'LIVE' as const,
      readiness: 'SOFT_READY' as const,
      owner: 'NON_OWNER' as const,
      writeMode: 'INJECTED_MOCK' as const,
      exitPath: 'LIVE_RPC' as const,
      supportedActions: ['deposit', 'withdraw', 'close'] as const,
    },
  ]) {
    const html = renderM3StrategyShell({
      strategyId: 'trend',
      contentProvenance: 'FIXTURE',
      onchain,
    });
    for (const action of ['deposit', 'withdraw', 'close']) {
      assert.match(html, new RegExp(`<button[^>]*data-chain-action="${action}"[^>]*disabled`));
    }
  }
});

test('reorged projection permits only owner exit actions backed by live simulation', () => {
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    onchain: {
      deployment: 'CONFIGURED',
      health: 'LIVE',
      readiness: 'REORGED',
      owner: 'OWNER',
      writeMode: 'INJECTED_MOCK',
      exitPath: 'SIMULATION',
      supportedActions: ['deposit', 'withdraw', 'close'],
    },
  });

  assert.match(html, /data-chain-action="deposit"[^>]*disabled/);
  assert.match(html, /data-chain-action="withdraw"[^>]*>Withdraw<\/button>/);
  assert.match(html, /data-chain-action="close"[^>]*>Close<\/button>/);
});

test('actual product page extension reads fresh onchain state on every render', () => {
  let health = 'LIVE' as 'LIVE' | 'DEGRADED';
  let walletAddress = '0x1111111111111111111111111111111111111111';
  const pages = extendM3ProductPages(
    {
      account: (tab) => `<div>account ${tab}</div>`,
      trade: (strategyId) => `<div>trade ${strategyId}</div>`,
    },
    {
      accountId: () => 'alice',
      contentProvenance: () => 'FIXTURE',
      chain: () => ({
        wallet: { status: 'CONNECTED', address: walletAddress },
        network: { status: 'CORRECT', chainId: ROBINHOOD_CHAIN_TESTNET.chainId },
        transaction: { status: 'INDEXING' },
        onchain: {
          deployment: 'CONFIGURED',
          health,
          readiness: 'SOFT_READY',
          owner: 'OWNER',
          writeMode: 'INJECTED_MOCK',
          exitPath: 'LIVE_RPC',
          supportedActions: ['deposit', 'withdraw', 'close'],
        },
      }),
    },
  );

  assert.doesNotMatch(pages.trade('trend'), /INDEXER DEGRADED/);
  assert.match(pages.trade('trend'), new RegExp(walletAddress));
  assert.match(pages.trade('trend'), /INDEXING/);
  health = 'DEGRADED';
  walletAddress = '0x2222222222222222222222222222222222222222';
  assert.match(pages.trade('trend'), /INDEXER DEGRADED/);
  assert.match(pages.account('funds'), new RegExp(walletAddress));
  assert.match(pages.account('funds'), /INJECTED MOCK/);
});

test('pending transaction evidence never promotes signature or confirmation to product readiness', () => {
  const base = {
    ...operationEvidenceDefaults,
    receipt: 'PENDING' as const,
    confirmations: 0,
    reconciliation: 'PENDING' as const,
    projection: 'PENDING' as const,
    productReady: false,
  };
  for (const [lifecycle, status] of [
    ['AWAITING_SIGNATURE', 'WALLET_APPROVAL_REQUIRED'],
    ['SUBMITTED', 'SUBMITTED'],
    ['MINED', 'CONFIRMING'],
  ] as const) {
    const presentation = transactionPresentationFromEvidence({ ...base, lifecycle });
    assert.equal(presentation.status, status);
    assert.equal(presentation.txHash, undefined);
    assert.notEqual(presentation.status, 'READY');
  }
});

test('message-only provider failures are escaped and explicitly lack an error code', () => {
  const html = renderM3AccountShell({
    wallet: { status: 'CONNECTION_REJECTED', errorMessage: '<script>fixture</script>' },
    transaction: { status: 'FAILED', errorMessage: 'transport & reconciliation unavailable' },
  });
  assert.equal((html.match(/UNSPECIFIED_ERROR/g) ?? []).length, 2);
  assert.match(html, /&lt;script&gt;fixture&lt;\/script&gt;/);
  assert.match(html, /transport &amp; reconciliation unavailable/);
  assert.doesNotMatch(html, /<script>/);
});

test('closed-state and owner exit capability restrict every action even if advertised by the backend', () => {
  const supportedActions = ['deposit', 'withdraw', 'close', 'rescue-token', 'rescue-native'] as const;
  const base = {
    deployment: 'CONFIGURED' as const,
    health: 'LIVE' as const,
    readiness: 'SOFT_READY' as const,
    owner: 'OWNER' as const,
    writeMode: 'INJECTED_MOCK' as const,
    supportedActions,
  };
  for (const vaultClosed of [false, true]) {
    for (const exitPath of ['LIVE_RPC', 'SIMULATION', 'UNAVAILABLE'] as const) {
      const onchain = { ...base, vaultClosed, exitPath };
      for (const action of supportedActions) {
        const rescue = action.startsWith('rescue-');
        const expected = rescue
          ? vaultClosed && exitPath !== 'UNAVAILABLE'
          : !vaultClosed && action !== 'deposit';
        assert.equal(onchainActionEnabled(onchain, action), expected, `${vaultClosed}/${exitPath}/${action}`);
      }
      const html = renderM3AccountShell({ onchain });
      assert.equal(
        html.includes('Owner-only post-close rescue remains available'),
        vaultClosed && exitPath !== 'UNAVAILABLE',
      );
    }
  }
  const degraded = renderM3AccountShell({
    onchain: { ...base, health: 'DEGRADED', exitPath: 'UNAVAILABLE' },
  });
  assert.doesNotMatch(degraded, /Owner-only post-close rescue remains available/);
  assert.match(degraded, /data-chain-action="withdraw"[^>]*disabled/);
});

test('unreviewed or cross-chain Vault selector metadata never becomes an actionable choice', () => {
  const vaultA = asAddress('0x2222222222222222222222222222222222222222');
  const vaultB = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const valid = { chainId: 46_630 as const, vaultAddress: vaultA };
  const options = [valid];
  const onchain = {
    deployment: 'CONFIGURED' as const,
    health: 'LIVE' as const,
    readiness: 'SOFT_READY' as const,
    owner: 'OWNER' as const,
    writeMode: 'INJECTED_MOCK' as const,
    exitPath: 'SIMULATION' as const,
    supportedActions: [] as const,
    passInitialSupplyBaseUnits: '1',
  };
  for (const selection of [
    { selected: { ...valid, chainId: 1 }, options },
    { selected: { ...valid, vaultAddress: 'bad-address' }, options },
    { selected: valid, options: [{ ...valid, chainId: 1 }] },
    { selected: valid, options: [{ ...valid, vaultAddress: 'bad-address' }] },
    { selected: { ...valid, vaultAddress: vaultB }, options },
  ]) {
    const html = renderM3AccountShell({ onchain, vaultSelection: selection as never });
    assert.doesNotMatch(html, /data-chain-vault-select/);
    assert.match(html, /Unavailable until reviewed deployment constructor values are configured/);
  }
  const pages = extendM3ProductPages(
    { account: () => '', trade: () => '' },
    {
      accountId: () => 'alice',
      contentProvenance: () => 'FIXTURE',
      chain: () => ({
        wallet: { status: 'CONNECTED' },
        network: { status: 'CORRECT' },
        transaction: { status: 'IDLE' },
        onchain,
        vaultSelection: { selected: valid, options },
      }),
    },
  );
  for (const html of [pages.account('funds'), pages.trade('trend')]) {
    assert.match(html, /data-chain-vault-select/);
    assert.match(html, new RegExp(`value="46630:${vaultA}" selected`));
  }
});

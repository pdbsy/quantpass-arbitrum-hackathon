import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createM3InjectedRuntimeFixture } from '../apps/web/src/m3-injected-runtime-fixture.ts';
import { asAddress } from '../packages/chain-adapter/src/types.ts';
import { encodeM3VaultCall } from '../packages/chain-adapter/src/vault-abi.ts';

test('injected runtime drives wrong-network, owner read, mock submit and recovery states', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  const runtime = fixture.runtime;

  assert.equal(runtime.snapshot.network.status, 'UNAVAILABLE');
  assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
  await assert.rejects(runtime.connect(), /WALLET_WRONG_CHAIN/);
  assert.equal(runtime.snapshot.network.status, 'WRONG');

  fixture.setCorrectNetwork();
  await runtime.connect();
  assert.equal(runtime.snapshot.wallet.status, 'CONNECTED');
  assert.equal(runtime.snapshot.network.status, 'CORRECT');
  assert.equal(runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(runtime.snapshot.onchain.writeMode, 'INJECTED_MOCK');
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.approvalCapability, 'AVAILABLE');
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.afUsdcAllowanceBaseUnits, '0');
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.passAllowanceBaseUnits, '0');
  assert.equal(runtime.snapshot.onchain.passBalanceBaseUnits, '2000000000000000000');

  const deposit = { kind: 'deposit' as const, usdcBaseUnits: '1000001' };
  const usdcApproval = await runtime.reviewDepositApprovals!(deposit);
  await runtime.confirmDepositApproval!(usdcApproval, 'af-usdc');
  const passApproval = await runtime.reviewDepositApprovals!(deposit);
  await runtime.confirmDepositApproval!(passApproval, 'pass');
  const depositReview = await runtime.reviewAction(deposit);
  await runtime.confirmAction(depositReview);

  const review = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1000001' });
  const submission = await runtime.confirmAction(review);
  assert.equal(submission.state, 'SUBMITTED');
  assert.equal(runtime.snapshot.transaction.status, 'SUBMITTED');
  const expectedWithdrawData = `0x2e1a7d4d${BigInt(1_000_001).toString(16).padStart(64, '0')}`;
  const actionCalls = fixture.providerRequests.filter(
    (request) =>
      request.method === 'eth_call' &&
      (request.params?.[0] as { readonly data?: unknown } | undefined)?.data === expectedWithdrawData,
  );
  const allowanceCalls = fixture.providerRequests.filter(
    (request) =>
      request.method === 'eth_call' &&
      String((request.params?.[0] as { readonly data?: unknown } | undefined)?.data).startsWith('0xdd62ed3e'),
  );
  const submissionRequest = fixture.providerRequests.find(
    (request) =>
      request.method === 'eth_sendTransaction' &&
      (request.params?.[0] as { readonly data?: unknown } | undefined)?.data === expectedWithdrawData,
  );
  // Review, confirmation, and the wallet's final pre-submit gate each simulate.
  assert.equal(actionCalls.length, 3);
  assert.equal(allowanceCalls.length, 8);
  assert.equal(
    (submissionRequest?.params?.[0] as { readonly data?: unknown } | undefined)?.data,
    expectedWithdrawData,
  );
  assert.equal(
    String((submissionRequest?.params?.[0] as { readonly data?: unknown } | undefined)?.data).startsWith(
      '0xb6b55f25',
    ),
    false,
  );

  await fixture.setSoftReady();
  assert.equal(runtime.snapshot.onchain.readiness, 'SOFT_READY');
  assert.equal(runtime.snapshot.transaction.status, 'READY');

  await runtime.connect();
  assert.equal(runtime.snapshot.transaction.status, 'READY');

  await fixture.setReorged();
  assert.equal(runtime.snapshot.onchain.readiness, 'REORGED');
  assert.equal(runtime.snapshot.transaction.status, 'FAILED');

  await fixture.setDegraded();
  assert.equal(runtime.snapshot.onchain.health, 'DEGRADED');
  assert.equal(runtime.snapshot.onchain.exitPath, 'SIMULATION');
  assert.equal(runtime.snapshot.transaction.status, 'INDEXING');
});

test('injected runtime exercises full-precision Pass transfer and post-close rescue', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  const transfer = await fixture.runtime.reviewPassTransfer!({
    recipient: asAddress('0x9999999999999999999999999999999999999999'),
    passBaseUnits: '1',
  });
  await fixture.runtime.confirmPassTransfer!(transfer);
  await fixture.runtime.refresh();
  assert.equal(fixture.runtime.snapshot.onchain.passBalanceBaseUnits, '1999999999999999999');

  await fixture.setClosed();
  assert.equal(fixture.runtime.snapshot.onchain.vaultClosed, true);
  const rescue = await fixture.runtime.reviewAction({ kind: 'rescue-native' });
  await fixture.runtime.confirmAction(rescue);
  assert.equal(fixture.runtime.snapshot.transaction.status, 'SUBMITTED');
});

test('injected runtime reviews bind the exact request and are single-use', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  const review = await fixture.runtime.reviewAction({ kind: 'close' });

  assert.deepEqual(review.request, { kind: 'close' });
  await fixture.runtime.confirmAction(review);
  await assert.rejects(fixture.runtime.confirmAction(review), /INVALID_PRODUCT_REVIEW/);
});

test('injected runtime controls exercise provider network and non-owner state through refresh', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();

  await fixture.setWrongNetwork();
  assert.equal(fixture.runtime.snapshot.network.status, 'WRONG');
  assert.equal(fixture.runtime.snapshot.onchain.writeMode, 'DISABLED');

  fixture.setCorrectNetwork();
  await fixture.runtime.refresh();
  await fixture.setNonOwner();
  assert.equal(fixture.runtime.snapshot.wallet.status, 'ACCOUNT_CHANGED');
  await fixture.runtime.connect();
  assert.equal(fixture.runtime.snapshot.onchain.owner, 'NON_OWNER');
  assert.equal(fixture.runtime.snapshot.onchain.writeMode, 'DISABLED');
});

test('injected runtime isolates two Vault owners and allowances while both selections share one Pass', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  const vaultA = asAddress('0x2222222222222222222222222222222222222222');
  const vaultB = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const sharedPass = asAddress('0x4444444444444444444444444444444444444444');
  assert.deepEqual(fixture.runtime.vaultSelection?.options, [
    { chainId: 46_630, vaultAddress: vaultA },
    { chainId: 46_630, vaultAddress: vaultB },
  ]);

  const deposit = { kind: 'deposit' as const, usdcBaseUnits: '1' };
  const firstUsdc = await fixture.runtime.reviewDepositApprovals!(deposit);
  await fixture.runtime.confirmDepositApproval!(firstUsdc, 'af-usdc');
  const firstPass = await fixture.runtime.reviewDepositApprovals!(deposit);
  await fixture.runtime.confirmDepositApproval!(firstPass, 'pass');
  const stale = await fixture.runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });

  await fixture.selectSecondVault();
  await fixture.setSecondOwner();
  await fixture.runtime.connect();
  assert.equal(fixture.runtime.snapshot.onchain.vaultAddress, vaultB);
  assert.equal(fixture.runtime.snapshot.onchain.passAddress, sharedPass);
  assert.equal(fixture.runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(fixture.runtime.snapshot.onchain.depositAuthorization?.spender, vaultB);
  assert.equal(fixture.runtime.snapshot.onchain.depositAuthorization?.afUsdcAllowanceBaseUnits, '0');
  assert.equal(fixture.runtime.snapshot.onchain.depositAuthorization?.passAllowanceBaseUnits, '0');
  await assert.rejects(fixture.runtime.confirmAction(stale), /M3_VAULT_SELECTION_CHANGED/);

  await fixture.setOwner();
  await fixture.selectFirstVault();
  assert.equal(fixture.runtime.snapshot.onchain.vaultAddress, vaultA);
  assert.equal(fixture.runtime.snapshot.onchain.passAddress, sharedPass);
  assert.equal(fixture.runtime.snapshot.onchain.depositAuthorization?.spender, vaultA);
  assert.equal(fixture.runtime.snapshot.onchain.depositAuthorization?.afUsdcAllowanceBaseUnits, '1');
  assert.equal(
    fixture.runtime.snapshot.onchain.depositAuthorization?.passAllowanceBaseUnits,
    '1000000000000',
  );
});

test('injected runtime prevents an unresolved duplicate but permits a new explicit exit after confirmation', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  const request = { kind: 'withdraw' as const, usdcBaseUnits: '1' };
  const first = await fixture.runtime.reviewAction(request);
  await fixture.runtime.confirmAction(first);
  const duplicate = await fixture.runtime.reviewAction(request);
  await assert.rejects(fixture.runtime.confirmAction(duplicate), /M3_SUBMISSION_RECOVERY_REQUIRED/);
  assert.equal(fixture.providerRequests.filter((row) => row.method === 'eth_sendTransaction').length, 1);
  await fixture.setSoftReady();
  assert.equal(fixture.runtime.snapshot.transaction.status, 'READY');
  await fixture.setDegraded();
  const next = await fixture.runtime.reviewAction(request);
  assert.notEqual(next.operationId, first.operationId);
  const submitted = await fixture.runtime.confirmAction(next);
  assert.equal(submitted.state, 'SUBMITTED');
  assert.equal(fixture.providerRequests.filter((row) => row.method === 'eth_sendTransaction').length, 2);
  assert.equal(fixture.runtime.snapshot.onchain.health, 'DEGRADED');
});

test('two reviewed transfers cannot overspend the DEV fixture balance after the first consumes it', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  const request = {
    recipient: asAddress('0x9999999999999999999999999999999999999999'),
    passBaseUnits: '2000000000000000000',
  };
  const first = await fixture.runtime.reviewPassTransfer!(request);
  const second = await fixture.runtime.reviewPassTransfer!({
    ...request,
    recipient: asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  });
  await fixture.runtime.confirmPassTransfer!(first);
  const rejected = await fixture.runtime.confirmPassTransfer!(second);
  assert.equal(rejected.state, 'SUBMISSION_AMBIGUOUS');
  assert.equal(rejected.txHash, null);
  await fixture.runtime.refresh();
  assert.equal(fixture.runtime.snapshot.onchain.passBalanceBaseUnits, '0');
  assert.equal(fixture.providerRequests.filter((row) => row.method === 'eth_sendTransaction').length, 2);
});

test('a degraded closed second Vault retains its own owner and locker during direct-read rescue', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.selectSecondVault();
  await fixture.setSecondOwner();
  await fixture.runtime.connect();
  await fixture.setClosed();
  await fixture.setDegraded();
  assert.equal(fixture.runtime.snapshot.onchain.vaultAddress, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(fixture.runtime.snapshot.onchain.vaultClosed, true);
  assert.equal(fixture.runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(fixture.runtime.snapshot.onchain.health, 'DEGRADED');
  const rescue = await fixture.runtime.reviewAction({ kind: 'rescue-native' });
  const sent = await fixture.runtime.confirmAction(rescue);
  assert.equal(sent.state, 'SUBMITTED');
  const sends = fixture.providerRequests.filter((row) => row.method === 'eth_sendTransaction');
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0]!.params?.[0], {
    from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    data: encodeM3VaultCall('rescueNative()', []),
    value: '0x0',
  });
});

test('disconnect at the public wallet-pending notification retains an uncertain transfer without a receipt', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  const balance = fixture.runtime.snapshot.onchain.passBalanceBaseUnits;
  const review = await fixture.runtime.reviewPassTransfer!({
    recipient: asAddress('0x9999999999999999999999999999999999999999'),
    passBaseUnits: '1',
  });
  let disconnected: Promise<void> | undefined;
  let triggered = false;
  const unsubscribe = fixture.runtime.subscribe(() => {
    if (!triggered && fixture.runtime.snapshot.transaction.status === 'WALLET_PENDING') {
      triggered = true;
      disconnected = fixture.setDisconnected();
    }
  });
  try {
    const result = await fixture.runtime.confirmPassTransfer!(review);
    await disconnected;
    assert.ok(disconnected, 'the public pending notification triggers the disconnect');
    assert.equal(result.state, 'SUBMISSION_AMBIGUOUS');
    assert.equal(result.txHash, null);
    assert.equal(fixture.runtime.snapshot.transaction.status, 'SUBMISSION_AMBIGUOUS');
    assert.equal(fixture.runtime.snapshot.transaction.txHash, undefined);
    assert.equal(fixture.runtime.snapshot.wallet.status, 'DISCONNECTED');
    assert.equal(fixture.providerRequests.filter((row) => row.method === 'eth_sendTransaction').length, 1);
    await fixture.setOwner();
    await fixture.runtime.connect();
    assert.equal(fixture.runtime.snapshot.onchain.passBalanceBaseUnits, balance);
  } finally {
    unsubscribe();
  }
});

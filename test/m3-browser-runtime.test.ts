import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asAddress, asBlockHash, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import type { ProductOperationEvidence } from '../packages/chain-adapter/src/reconciliation.ts';
import { encodeM3VaultCall } from '../packages/chain-adapter/src/vault-abi.ts';
import { createM3BrowserRuntime } from '../apps/web/src/m3-browser-runtime.ts';
import { keccak256Evm } from '../apps/web/src/evm-keccak.ts';
import type { Eip1193Provider, Eip1193Request } from '../apps/web/src/chain-wallet.ts';
import { onchainActionEnabled, renderM3StrategyShell } from '../apps/web/src/m3-product-shell.ts';
import type { M3VaultSnapshot } from '../apps/web/src/m3-vault-client.ts';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const VAULT = asAddress('0x2222222222222222222222222222222222222222');
const AF_USDC = asAddress('0x3333333333333333333333333333333333333333');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const TX_HASH = `0x${'ab'.repeat(32)}`;
const VAULT_CODE = asHexData('0x6000');
const PASS_CODE = asHexData('0x6001');

const addressResult = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
const uintResult = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

class ProviderFixture implements Eip1193Provider {
  readonly requests: Eip1193Request[] = [];
  chainId = 1;

  async request(input: Eip1193Request): Promise<unknown> {
    this.requests.push(input);
    if (input.method === 'eth_requestAccounts' || input.method === 'eth_accounts')
      return ['0x1111111111111111111111111111111111111111'];
    if (input.method === 'eth_chainId') return `0x${this.chainId.toString(16)}`;
    throw new Error('UNEXPECTED_PROVIDER_METHOD');
  }

  on(): void {}
  removeListener(): void {}
}

class ConfiguredProviderFixture extends ProviderFixture {
  override chainId = 46_630;
  account: string | null = OWNER;
  usdcAllowance = 0n;
  passAllowance = 0n;
  passBalance = 0n;
  closed = false;
  vaultCode = VAULT_CODE;
  passCode = PASS_CODE;

  override async request(input: Eip1193Request): Promise<unknown> {
    this.requests.push(input);
    if (input.method === 'eth_requestAccounts' || input.method === 'eth_accounts')
      return this.account ? [this.account] : [];
    if (input.method === 'eth_chainId') return `0x${this.chainId.toString(16)}`;
    if (input.method === 'eth_getBlockByNumber') return { number: '0x64', hash: vaultSnapshot.blockHash };
    if (input.method === 'eth_getCode') {
      const target = String(input.params?.[0]).toLowerCase();
      return target === PASS.toLowerCase() ? this.passCode : this.vaultCode;
    }
    if (input.method === 'eth_sendTransaction') return TX_HASH;
    if (input.method === 'eth_call') {
      const call = input.params?.[0] as { readonly data?: unknown; readonly to?: unknown } | undefined;
      if (call?.data === encodeM3VaultCall('afUsdc()', [])) return addressResult(AF_USDC);
      if (call?.data === encodeM3VaultCall('pass()', [])) return addressResult(PASS);
      if (call?.data === encodeM3VaultCall('owner()', [])) return addressResult(OWNER);
      if (call?.data === encodeM3VaultCall('closed()', [])) return uintResult(this.closed ? 1n : 0n);
      if (call?.data === encodeM3VaultCall('strategyCreator()', []))
        return addressResult(vaultSnapshot.state.strategyCreator);
      if (call?.data === encodeM3VaultCall('strategyId()', [])) return vaultSnapshot.state.strategyId;
      if (call?.data === encodeM3VaultCall('strategyRef()', [])) return vaultSnapshot.state.strategyRef;
      if (call?.data === encodeM3VaultCall('afEth()', [])) return addressResult(vaultSnapshot.state.afEth);
      if (call?.data === encodeM3VaultCall('afBtc()', [])) return addressResult(vaultSnapshot.state.afBtc);
      if (call?.data === encodeM3VaultCall('passLocker()', []))
        return addressResult(vaultSnapshot.state.passLocker);
      if (
        call?.data === encodeM3VaultCall('principalBasis()', []) ||
        call?.data === encodeM3VaultCall('trackedUsdcBalance()', []) ||
        call?.data === encodeM3VaultCall('realizedProfit()', []) ||
        call?.data === encodeM3VaultCall('withdrawableUsdc()', []) ||
        call?.data === encodeM3VaultCall('openTrackedPositionCount()', []) ||
        String(call?.data).startsWith(encodeM3VaultCall('trackedPosition(address)', [AF_USDC]).slice(0, 10))
      )
        return uintResult(0n);
      if (String(call?.data).startsWith('0xdd62ed3e'))
        return uintResult(call?.to === AF_USDC ? this.usdcAllowance : this.passAllowance);
      if (String(call?.data).startsWith('0x70a08231') && call?.to === PASS)
        return uintResult(this.passBalance);
      return '0x';
    }
    throw new Error('UNEXPECTED_PROVIDER_METHOD');
  }
}

const vaultSnapshot: M3VaultSnapshot = Object.freeze({
  chainId: 46_630,
  owner: OWNER,
  contract: VAULT,
  projectionKey: 'm3-vault',
  blockNumber: '100',
  blockHash: asBlockHash(`0x${'cd'.repeat(32)}`),
  state: Object.freeze({
    owner: OWNER,
    strategyCreator: asAddress('0x5555555555555555555555555555555555555555'),
    strategyId: asHexData(`0x${'01'.repeat(32)}`),
    strategyRef: asHexData(`0x${'02'.repeat(32)}`),
    pass: PASS,
    passStrategyId: asHexData(`0x${'01'.repeat(32)}`),
    afUsdc: AF_USDC,
    afEth: asAddress('0x6666666666666666666666666666666666666666'),
    afBtc: asAddress('0x7777777777777777777777777777777777777777'),
    passLocker: asAddress('0x8888888888888888888888888888888888888888'),
    principalBasis: '0',
    trackedUsdcBalance: '0',
    realizedProfit: '0',
    withdrawableUsdc: '0',
    trackedAfEth: '0',
    trackedAfBtc: '0',
    openTrackedPositionCount: '0',
    closed: false,
  }),
});

const deployment = {
  source: 'reviewed-deployment-manifest' as const,
  chainId: 46_630 as const,
  vaultAddress: VAULT,
  deploymentBlock: '1',
  abiVersion: 'm3-vault-db620d6',
  abiHash: asBlockHash('0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977'),
  manifestDigest: asBlockHash(`0x${'12'.repeat(32)}`),
  runtimeBytecodeHash: keccak256Evm(VAULT_CODE),
  strategyPassAddress: PASS,
  strategyPassDeploymentBlock: '2',
  strategyPassAbiHash: asBlockHash('0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f'),
  strategyPassRuntimeBytecodeHash: keccak256Evm(PASS_CODE),
};

test('production browser runtime is inert before connect and reports wrong chain without a deployment', async () => {
  const provider = new ProviderFixture();
  const runtime = createM3BrowserRuntime({ provider });

  assert.equal(provider.requests.length, 0);
  assert.equal(runtime.snapshot.onchain.deployment, 'UNAVAILABLE');
  assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
  const html = renderM3StrategyShell({
    strategyId: 'trend',
    contentProvenance: 'FIXTURE',
    ...runtime.snapshot,
  });
  assert.match(html, /NOT DEPLOYED/);
  for (const action of ['Buy Pass', 'Sell Pass', 'Deposit', 'Withdraw', 'Approve', 'Close']) {
    assert.match(html, new RegExp(`<button[^>]*disabled[^>]*>${action}`));
  }
  await assert.rejects(runtime.connect(), /WALLET_WRONG_CHAIN/);
  assert.equal(runtime.snapshot.wallet.status, 'DISCONNECTED');
  assert.equal(runtime.snapshot.network.status, 'WRONG');
  assert.equal(runtime.snapshot.network.chainId, 1);
});

test('production browser runtime connects the existing EIP-1193 wallet boundary but keeps writes closed', async () => {
  const provider = new ProviderFixture();
  provider.chainId = 46630;
  const runtime = createM3BrowserRuntime({ provider });

  await runtime.connect();
  assert.deepEqual(runtime.snapshot.wallet, {
    status: 'CONNECTED',
    address: '0x1111111111111111111111111111111111111111',
  });
  assert.deepEqual(runtime.snapshot.network, { status: 'CORRECT', chainId: 46630 });
  assert.equal(runtime.snapshot.onchain.deployment, 'UNAVAILABLE');
  await assert.rejects(
    runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
    /M3_DEPLOYMENT_NOT_CONFIGURED/,
  );
  assert.equal(
    provider.requests.some((request) => request.method === 'eth_sendTransaction'),
    false,
  );
});

test('production browser runtime fails closed when no injected wallet provider exists', async () => {
  const runtime = createM3BrowserRuntime({});

  await assert.rejects(runtime.connect(), /WALLET_PROVIDER_UNAVAILABLE/);
  assert.equal(runtime.snapshot.network.status, 'UNAVAILABLE');
  assert.equal(runtime.snapshot.onchain.deployment, 'UNAVAILABLE');
});

test('configured production runtime uses canonical Vault reads and exact finite two-token approvals', async () => {
  const provider = new ConfiguredProviderFixture();
  const registrations: Array<Record<string, unknown>> = [];
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async (input) => {
        registrations.push(input);
        return { state: 'SUBMITTED' };
      },
    },
    now: () => '2026-09-20T00:00:00.000Z',
  });

  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.deployment, 'CONFIGURED');
  assert.equal(runtime.snapshot.onchain.writeMode, 'LIVE_AUTHORIZED');
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.approvalCapability, 'AVAILABLE');
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'deposit'), true);
  assert.match(
    renderM3StrategyShell({
      strategyId: 'trend',
      contentProvenance: 'FIXTURE',
      ...runtime.snapshot,
    }),
    /Approve · USE DEPOSIT REVIEW/,
  );

  const request = { kind: 'deposit' as const, usdcBaseUnits: '1000001' };
  const approval = await runtime.reviewDepositApprovals!(request);
  assert.deepEqual(
    approval.requirements.map(({ kind, token, spender, requiredRaw, sufficient }) => ({
      kind,
      token,
      spender,
      requiredRaw,
      sufficient,
    })),
    [
      { kind: 'af-usdc', token: AF_USDC, spender: VAULT, requiredRaw: '1000001', sufficient: false },
      {
        kind: 'pass',
        token: PASS,
        spender: VAULT,
        requiredRaw: '1000001000000000000',
        sufficient: false,
      },
    ],
  );
  await runtime.confirmDepositApproval!(approval, 'af-usdc');
  const firstApproval = provider.requests.filter((item) => item.method === 'eth_sendTransaction').at(-1)
    ?.params?.[0] as { readonly to: string; readonly data: string };
  assert.equal(firstApproval.to, AF_USDC);
  assert.equal(
    firstApproval.data,
    `0x095ea7b3${VAULT.slice(2).padStart(64, '0')}${BigInt(1_000_001).toString(16).padStart(64, '0')}`,
  );

  const passApproval = await runtime.reviewDepositApprovals!(request);
  await runtime.confirmDepositApproval!(passApproval, 'pass');
  const secondApproval = provider.requests.filter((item) => item.method === 'eth_sendTransaction').at(-1)
    ?.params?.[0] as { readonly to: string; readonly data: string };
  assert.equal(secondApproval.to, PASS);
  assert.equal(
    secondApproval.data,
    `0x095ea7b3${VAULT.slice(2).padStart(64, '0')}${BigInt('1000001000000000000').toString(16).padStart(64, '0')}`,
  );

  provider.usdcAllowance = 1_000_001n;
  provider.passAllowance = 1_000_001_000_000_000_000n;
  const review = await runtime.reviewAction(request);
  assert.deepEqual(review.request, request);
  await runtime.confirmAction(review);
  const deposit = provider.requests.filter((item) => item.method === 'eth_sendTransaction').at(-1)
    ?.params?.[0] as { readonly to: string; readonly data: string };
  assert.equal(deposit.to, VAULT);
  assert.equal(deposit.data, encodeM3VaultCall('deposit(uint256)', [1_000_001n]));
  assert.deepEqual(registrations, [
    {
      operationId: review.operationId,
      chainId: 46_630,
      owner: OWNER,
      target: VAULT,
      calldata: encodeM3VaultCall('deposit(uint256)', [1_000_001n]),
      txHash: TX_HASH,
    },
  ]);
});

test('configured runtime preserves owner exits through provider reads when the index API is degraded', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => {
        throw new Error('INDEXER_UNAVAILABLE');
      },
    },
  });

  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.health, 'DEGRADED');
  assert.equal(runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'deposit'), false);
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'withdraw'), true);
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'close'), true);
  const review = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  assert.equal(review.request.kind, 'withdraw');
});

test('live exit rejects a Pass address outside the reviewed deployment without wallet submission', async () => {
  const provider = new ConfiguredProviderFixture();
  const request = provider.request.bind(provider);
  provider.request = (input) =>
    input.method === 'eth_call' &&
    (input.params?.[0] as { data?: unknown } | undefined)?.data === encodeM3VaultCall('pass()', [])
      ? Promise.resolve(addressResult(AF_USDC))
      : request(input);
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => {
        throw Error('INDEXER_UNAVAILABLE');
      },
    },
  });

  await assert.rejects(runtime.connect(), /M3_STRATEGY_PASS_MISMATCH/);
  assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
  assert.equal(
    provider.requests.some((item) => item.method === 'eth_sendTransaction'),
    false,
  );
});

test('configured runtime disables writes when the connected provider changes to a wrong network', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.writeMode, 'LIVE_AUTHORIZED');

  provider.chainId = 1;
  await runtime.refresh();
  assert.deepEqual(runtime.snapshot.network, { status: 'WRONG', chainId: 1 });
  assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
  assert.equal(runtime.snapshot.onchain.passTransferMode, 'DISABLED');
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'withdraw'), false);

  provider.chainId = 46_630;
  await runtime.refresh();
  assert.deepEqual(runtime.snapshot.network, { status: 'CORRECT', chainId: 46_630 });
  assert.equal(runtime.snapshot.onchain.writeMode, 'LIVE_AUTHORIZED');
});

test('configured runtime disables Pass transfer after wallet disconnect', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.passTransferMode, 'LIVE_AUTHORIZED');
  provider.account = null;
  await runtime.refresh();
  assert.equal(runtime.snapshot.wallet.status, 'DISCONNECTED');
  assert.equal(runtime.snapshot.onchain.passTransferMode, 'DISABLED');
});

test('configured runtimes create collision-resistant operation ids across browser reloads', async () => {
  const createRuntime = () => {
    const provider = new ConfiguredProviderFixture();
    return createM3BrowserRuntime({
      provider,
      deployment,
      vaultReader: { readSnapshot: async () => vaultSnapshot },
    });
  };
  const first = createRuntime();
  const second = createRuntime();
  await first.connect();
  await second.connect();

  const firstReview = await first.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  const secondReview = await second.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });

  assert.match(firstReview.operationId, /^m3-withdraw-[0-9a-f]{32}$/);
  assert.match(secondReview.operationId, /^m3-withdraw-[0-9a-f]{32}$/);
  assert.notEqual(firstReview.operationId, secondReview.operationId);
});

test('configured runtime reads registered operation evidence into transaction and readiness state', async () => {
  const provider = new ConfiguredProviderFixture();
  let evidence: ProductOperationEvidence = {
    lifecycle: 'MINED',
    receipt: 'SUCCESS',
    receiptCanonical: true,
    confirmations: 1,
    reconciliation: 'MATCHED',
    projection: 'PENDING',
    chainStatus: 'SOFT_READY',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'HEALTHY',
    degradedReason: null,
    productReady: false,
  };
  const evidenceReads: Array<{ operationId: string; owner: string }> = [];
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async () => ({ state: 'SUBMITTED' }),
      readOperationEvidence: async (operationId, owner) => {
        evidenceReads.push({ operationId, owner });
        return evidence;
      },
    },
  });
  await runtime.connect();
  const review = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  await runtime.confirmAction(review);

  await runtime.refresh();
  assert.deepEqual(evidenceReads, [{ operationId: review.operationId, owner: OWNER }]);
  assert.deepEqual(runtime.snapshot.transaction, { status: 'CHAIN_CONFIRMED', txHash: TX_HASH });
  assert.equal(runtime.snapshot.onchain.readiness, 'SOFT_READY');

  evidence = {
    ...evidence,
    lifecycle: 'REORGED',
    receipt: 'PENDING',
    receiptCanonical: false,
    reconciliation: 'PENDING',
    chainStatus: 'REORGED',
  };
  await runtime.refresh();
  assert.deepEqual(runtime.snapshot.transaction, {
    status: 'FAILED',
    txHash: TX_HASH,
    errorCode: 'REORGED',
  });
  assert.equal(runtime.snapshot.onchain.readiness, 'REORGED');
});

test('degraded registered evidence keeps owner exit actions while marking the indexer unhealthy', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async () => ({ state: 'SUBMITTED' }),
      readOperationEvidence: async () => ({
        lifecycle: 'SUBMITTED',
        receipt: 'PENDING',
        receiptCanonical: false,
        confirmations: 0,
        reconciliation: 'PENDING',
        projection: 'PENDING',
        chainStatus: 'PENDING',
        l1Status: 'UNKNOWN',
        finalityStatus: 'UNKNOWN',
        indexerStatus: 'DEGRADED',
        degradedReason: 'CHAIN_REORG_DEPTH_EXCEEDED',
        productReady: false,
      }),
    },
  });
  await runtime.connect();
  const review = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  await runtime.confirmAction(review);

  await runtime.refresh();

  assert.equal(runtime.snapshot.onchain.health, 'DEGRADED');
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'withdraw'), true);
  assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'close'), true);
  assert.equal(runtime.snapshot.transaction.status, 'SUBMITTED');
});

for (const source of ['canonical', 'live-exit'] as const) {
  test(`a closed Vault preserves exact owner rescue actions after ${source} refresh`, async () => {
    const provider = new ConfiguredProviderFixture();
    const registrations: Array<Record<string, unknown>> = [];
    const runtime = createM3BrowserRuntime({
      provider,
      deployment,
      vaultReader: {
        readSnapshot: async () => {
          if (source === 'live-exit') throw new Error('INDEXER_UNAVAILABLE');
          return { ...vaultSnapshot, state: { ...vaultSnapshot.state, closed: provider.closed } };
        },
        registerSubmission: async (input) => {
          registrations.push(input);
          return { state: 'SUBMITTED' };
        },
      },
    });
    await runtime.connect();
    assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'withdraw'), true);
    provider.closed = true;
    await runtime.refresh();
    for (const action of ['deposit', 'withdraw', 'close'] as const)
      assert.equal(onchainActionEnabled(runtime.snapshot.onchain, action), false, action);
    assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'rescue-token'), true);
    assert.equal(onchainActionEnabled(runtime.snapshot.onchain, 'rescue-native'), true);
    assert.equal(runtime.snapshot.onchain.writeMode, 'LIVE_AUTHORIZED');
    const html = renderM3StrategyShell({
      strategyId: 'trend',
      contentProvenance: 'FIXTURE',
      ...runtime.snapshot,
    });
    assert.match(html, /VAULT CLOSED/);
    assert.match(html, /Owner-only post-close rescue remains available/);

    const nativeReview = await runtime.reviewAction({ kind: 'rescue-native' });
    await runtime.confirmAction(nativeReview);
    const tokenReview = await runtime.reviewAction({ kind: 'rescue-token', token: AF_USDC });
    await runtime.confirmAction(tokenReview);
    const sent = provider.requests
      .filter((request) => request.method === 'eth_sendTransaction')
      .map((request) => request.params?.[0] as { readonly to: string; readonly data: string });
    assert.deepEqual(
      sent.map(({ to, data }) => ({ to, data })),
      [
        { to: VAULT, data: encodeM3VaultCall('rescueNative()', []) },
        { to: VAULT, data: encodeM3VaultCall('rescueUntrackedToken(address)', [AF_USDC]) },
      ],
    );
    assert.equal(registrations.length, 2);
    assert.equal(registrations[0]?.calldata, encodeM3VaultCall('rescueNative()', []));
    assert.equal(registrations[1]?.calldata, encodeM3VaultCall('rescueUntrackedToken(address)', [AF_USDC]));
    await assert.rejects(runtime.confirmAction(tokenReview), /INVALID_PRODUCT_REVIEW/);
  });
}

test('open Vault rejects rescue review without asking the wallet to send', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  await assert.rejects(runtime.reviewAction({ kind: 'rescue-native' }), /M3_RESCUE_REQUIRES_CLOSED_VAULT/);
  assert.equal(
    provider.requests.some((request) => request.method === 'eth_sendTransaction'),
    false,
  );
});

test('configured runtime transfers one raw Pass unit to the reviewed recipient exactly once', async () => {
  const provider = new ConfiguredProviderFixture();
  provider.passBalance = 1n;
  const registrations: Array<Record<string, unknown>> = [];
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async (input) => {
        registrations.push(input);
        return { state: 'SUBMITTED' };
      },
    },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.passAddress, PASS);
  assert.equal(runtime.snapshot.onchain.passBalanceBaseUnits, '1');
  assert.equal(typeof runtime.reviewPassTransfer, 'function');
  assert.equal(typeof runtime.confirmPassTransfer, 'function');

  const request = {
    recipient: asAddress('0x9999999999999999999999999999999999999999'),
    passBaseUnits: '1',
  };
  const review = await runtime.reviewPassTransfer!(request);
  assert.deepEqual(review.request, request);
  assert.equal(review.token, PASS);
  await runtime.confirmPassTransfer!(review);

  const transfer = provider.requests.filter((item) => item.method === 'eth_sendTransaction').at(-1)
    ?.params?.[0] as { readonly to: string; readonly data: string };
  assert.equal(transfer.to, PASS);
  assert.equal(
    transfer.data,
    `0xa9059cbb${request.recipient.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`,
  );
  assert.deepEqual(registrations, [
    {
      operationId: review.operationId,
      chainId: 46_630,
      owner: OWNER,
      target: PASS,
      calldata: transfer.data,
      txHash: TX_HASH,
    },
  ]);
  await assert.rejects(runtime.confirmPassTransfer!(review), /INVALID_PASS_TRANSFER_REVIEW/);
});

test('reviewed deployment metadata exposes initial Pass allocation without inventing a sale', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment: {
      ...deployment,
      passInitialSupplyBaseUnits: '10000000000000000000',
      passInitialRecipient: OWNER,
    },
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.passInitialSupplyBaseUnits, '10000000000000000000');
  assert.equal(runtime.snapshot.onchain.passInitialRecipient, OWNER);
  assert.throws(() =>
    createM3BrowserRuntime({
      provider,
      deployment: { ...deployment, passInitialSupplyBaseUnits: '1' },
    }),
  );
});

test('deployment validation rejects malformed identity and supply boundaries', () => {
  const missingStrategyPass = { ...deployment } as Record<string, unknown>;
  delete missingStrategyPass.strategyPassAddress;
  const invalidDeployments = [
    { ...deployment, source: 'unreviewed' },
    { ...deployment, chainId: 1 },
    { ...deployment, deploymentBlock: '0' },
    { ...deployment, deploymentBlock: '01' },
    { ...deployment, strategyPassDeploymentBlock: '0' },
    { ...deployment, abiVersion: 'm3-vault-other' },
    { ...deployment, abiHash: asBlockHash(`0x${'aa'.repeat(32)}`) },
    { ...deployment, strategyPassAbiHash: asBlockHash(`0x${'bb'.repeat(32)}`) },
    { ...deployment, strategyPassRuntimeBytecodeHash: 'invalid' },
    { ...deployment, passInitialSupplyBaseUnits: '0', passInitialRecipient: OWNER },
    { ...deployment, passInitialSupplyBaseUnits: `${1n << 256n}`, passInitialRecipient: OWNER },
    {
      ...deployment,
      passInitialSupplyBaseUnits: '1',
      passInitialRecipient: asAddress('0x0000000000000000000000000000000000000000'),
    },
    missingStrategyPass,
  ];
  for (const invalid of invalidDeployments)
    assert.throws(
      () => createM3BrowserRuntime({ deployment: invalid as typeof deployment }),
      /INVALID_M3_DEPLOYMENT_CONFIG/,
    );

  const defaultReaderRuntime = createM3BrowserRuntime({
    provider: new ConfiguredProviderFixture(),
    deployment,
  });
  assert.equal(defaultReaderRuntime.snapshot.onchain.deployment, 'CONFIGURED');
});

test('runtime status identity mismatch fails closed before canonical deposit approval', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readRuntimeStatus: async () => ({
        lastAttempt: 'SUCCEEDED' as const,
        errorCode: null,
        database: { status: 'HEALTHY' as const, schemaVersion: 6, integrity: 'OK' as const },
        deployment: {
          chainId: 46_630 as const,
          contract: asAddress('0x9999999999999999999999999999999999999999'),
          manifestDigest: deployment.manifestDigest,
          abiHash: deployment.abiHash,
          runtimeBytecodeHash: deployment.runtimeBytecodeHash,
          strategyPassAddress: deployment.strategyPassAddress,
          strategyPassAbiHash: deployment.strategyPassAbiHash,
          strategyPassRuntimeBytecodeHash: deployment.strategyPassRuntimeBytecodeHash,
        },
      }),
      readSnapshot: async () => vaultSnapshot,
    },
  });
  await runtime.connect();

  await assert.rejects(
    runtime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' }),
    /M3_RUNTIME_STATUS_MISMATCH/,
  );
});

test('matching runtime status permits a canonical approval review without submitting a transaction', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readRuntimeStatus: async () => ({
        lastAttempt: 'SUCCEEDED',
        errorCode: null,
        database: { status: 'HEALTHY', schemaVersion: 7, integrity: 'OK' },
        deployment: {
          chainId: deployment.chainId,
          contract: deployment.vaultAddress,
          strategyPassAddress: deployment.strategyPassAddress,
          manifestDigest: deployment.manifestDigest,
          abiHash: deployment.abiHash,
          runtimeBytecodeHash: deployment.runtimeBytecodeHash,
          strategyPassAbiHash: deployment.strategyPassAbiHash,
          strategyPassRuntimeBytecodeHash: deployment.strategyPassRuntimeBytecodeHash,
        },
      }),
      readSnapshot: async () => vaultSnapshot,
    },
  });

  await runtime.connect();
  const review = await runtime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' });
  assert.equal(review.owner, OWNER);
  assert.equal(runtime.snapshot.onchain.writeMode, 'LIVE_AUTHORIZED');
  assert.equal(
    provider.requests.some((item) => item.method === 'eth_sendTransaction'),
    false,
  );
});

test('operation ids fail closed when browser randomness is absent or malformed', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const runtime = createM3BrowserRuntime({
    provider: new ConfiguredProviderFixture(),
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    await assert.rejects(
      runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
      /M3_OPERATION_ID_UNAVAILABLE/,
    );
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => '?' },
      configurable: true,
    });
    await assert.rejects(
      runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
      /INVALID_OPERATION_ID/,
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete (globalThis as { crypto?: Crypto }).crypto;
  }
});

test('mock mode publishes state changes, supports close review and unsubscribes listeners', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
    transportProvenance: 'DEV_MOCK',
  });
  let publications = 0;
  const unsubscribe = runtime.subscribe(() => {
    publications += 1;
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.writeMode, 'INJECTED_MOCK');
  assert.equal(runtime.snapshot.onchain.passTransferMode, 'INJECTED_MOCK');
  assert.ok(publications > 0);
  const close = await runtime.reviewAction({ kind: 'close' });
  assert.equal(close.request.kind, 'close');
  unsubscribe();
  const before = publications;
  await runtime.refresh();
  assert.equal(publications, before);
});

test('runtime treats a connected non-owner as read-only and rejects owner actions', async () => {
  const provider = new ConfiguredProviderFixture();
  provider.account = asAddress('0x9999999999999999999999999999999999999999');
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.owner, 'NON_OWNER');
  assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
  assert.equal(runtime.snapshot.onchain.exitPath, 'UNAVAILABLE');
  await assert.rejects(
    runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
    /M3_VAULT_OWNER_REQUIRED/,
  );
});

test('closed state and live simulation failures block ordinary Vault actions', async () => {
  const closedProvider = new ConfiguredProviderFixture();
  closedProvider.closed = true;
  const closedRuntime = createM3BrowserRuntime({
    provider: closedProvider,
    deployment,
    vaultReader: {
      readSnapshot: async () => ({ ...vaultSnapshot, state: { ...vaultSnapshot.state, closed: true } }),
    },
  });
  await closedRuntime.connect();
  await assert.rejects(
    closedRuntime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
    /M3_VAULT_CLOSED/,
  );

  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  const request = provider.request.bind(provider);
  provider.request = (input) => {
    const call = input.params?.[0] as { data?: string } | undefined;
    if (input.method === 'eth_call' && call?.data === encodeM3VaultCall('withdraw(uint256)', [1n]))
      return Promise.reject(new Error('simulation detail'));
    return request(input);
  };
  await assert.rejects(
    runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
    /M3_LIVE_SIMULATION_FAILED/,
  );
});

test('action submission fails closed when registration or provider result is unavailable', async () => {
  const unregisteredProvider = new ConfiguredProviderFixture();
  const unregistered = createM3BrowserRuntime({
    provider: unregisteredProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await unregistered.connect();
  const unregisteredReview = await unregistered.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  const unregisteredResult = await unregistered.confirmAction(unregisteredReview);
  assert.equal(unregisteredResult.state, 'SUBMISSION_AMBIGUOUS');
  assert.equal(unregistered.snapshot.transaction.status, 'SUBMISSION_AMBIGUOUS');

  const provider = new ConfiguredProviderFixture();
  const request = provider.request.bind(provider);
  provider.request = (input) =>
    input.method === 'eth_sendTransaction' ? Promise.resolve('invalid-hash') : request(input);
  const ambiguous = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async () => ({ state: 'SUBMITTED' }),
    },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await ambiguous.connect();
  const review = await ambiguous.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  const result = await ambiguous.confirmAction(review);
  assert.equal(result.state, 'SUBMISSION_AMBIGUOUS');
  assert.equal(ambiguous.snapshot.transaction.status, 'SUBMISSION_AMBIGUOUS');
});

test('connected presentation omits malformed Pass balance and failed allowance reads', async () => {
  const provider = new ConfiguredProviderFixture();
  const request = provider.request.bind(provider);
  provider.request = (input) => {
    const call = input.params?.[0] as { data?: string; to?: string } | undefined;
    if (input.method === 'eth_call' && String(call?.data).startsWith('0x70a08231'))
      return Promise.resolve('0x01');
    if (input.method === 'eth_call' && String(call?.data).startsWith('0xdd62ed3e'))
      return Promise.reject(new Error('allowance detail'));
    return request(input);
  };
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.passBalanceBaseUnits, undefined);
  assert.equal(runtime.snapshot.onchain.depositAuthorization, undefined);
});

test('approval review enforces connection, canonical identity, finite need and single-use authority', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await assert.rejects(
    runtime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' }),
    /WALLET_CONNECTION_REQUIRED/,
  );
  await assert.rejects(
    runtime.confirmDepositApproval!({} as never, 'af-usdc'),
    /INVALID_DEPOSIT_APPROVAL_REVIEW/,
  );
  await runtime.connect();
  provider.usdcAllowance = 1n;
  provider.passAllowance = 1_000_000_000_000n;
  const sufficient = await runtime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' });
  await assert.rejects(
    runtime.confirmDepositApproval!(sufficient, 'af-usdc'),
    /DEPOSIT_APPROVAL_ALREADY_SUFFICIENT/,
  );

  provider.usdcAllowance = 0n;
  const action = await runtime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' });
  const request = provider.request.bind(provider);
  provider.request = (input) =>
    input.method === 'eth_sendTransaction' ? Promise.resolve('invalid-hash') : request(input);
  const ambiguous = await runtime.confirmDepositApproval!(action, 'af-usdc');
  assert.equal(ambiguous.state, 'SUBMISSION_AMBIGUOUS');

  await assert.rejects(
    runtime.reviewAction({ kind: 'deposit', usdcBaseUnits: '2' }),
    /DEPOSIT_APPROVAL_REQUIRED/,
  );

  const mismatch = createM3BrowserRuntime({
    provider: new ConfiguredProviderFixture(),
    deployment,
    vaultReader: { readSnapshot: async () => ({ ...vaultSnapshot, contract: AF_USDC }) },
  });
  await mismatch.connect();
  await assert.rejects(
    mismatch.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' }),
    /M3_VAULT_SNAPSHOT_MISMATCH/,
  );
});

test('connect failure presentation distinguishes rejection, disconnection and canonical read failure', async () => {
  const rejectedProvider = new ProviderFixture();
  rejectedProvider.chainId = 46_630;
  const rejectedRequest = rejectedProvider.request.bind(rejectedProvider);
  rejectedProvider.request = (input) =>
    input.method === 'eth_requestAccounts' ? Promise.reject({ code: 4001 }) : rejectedRequest(input);
  const rejected = createM3BrowserRuntime({ provider: rejectedProvider });
  await assert.rejects(rejected.connect(), /WALLET_REJECTED/);
  assert.equal(rejected.snapshot.wallet.status, 'CONNECTION_REJECTED');
  assert.equal(rejected.snapshot.network.status, 'CORRECT');

  const disconnectedProvider = new ProviderFixture();
  disconnectedProvider.chainId = 46_630;
  disconnectedProvider.request = async (input) => (input.method === 'eth_chainId' ? '0xb626' : []);
  const disconnected = createM3BrowserRuntime({ provider: disconnectedProvider });
  await assert.rejects(disconnected.connect(), /WALLET_DISCONNECTED/);
  assert.equal(disconnected.snapshot.network.status, 'UNAVAILABLE');

  const wrongProvider = new ProviderFixture();
  const wrongRequest = wrongProvider.request.bind(wrongProvider);
  wrongProvider.request = (input) =>
    input.method === 'eth_accounts' ? Promise.reject(new Error('observe detail')) : wrongRequest(input);
  const wrong = createM3BrowserRuntime({ provider: wrongProvider });
  await assert.rejects(wrong.connect(), /WALLET_WRONG_CHAIN/);
  assert.equal(wrong.snapshot.network.status, 'WRONG');

  const failedProvider = new ConfiguredProviderFixture();
  const failedRequest = failedProvider.request.bind(failedProvider);
  failedProvider.request = (input) =>
    input.method === 'eth_getBlockByNumber' ? Promise.reject(new Error('rpc detail')) : failedRequest(input);
  const failed = createM3BrowserRuntime({
    provider: failedProvider,
    deployment,
    vaultReader: {
      readSnapshot: async () => {
        throw new Error('index detail');
      },
    },
  });
  await assert.rejects(failed.connect(), /M3_LIVE_READ_FAILED/);
  assert.equal(failed.snapshot.network.status, 'CORRECT');
  assert.equal(failed.snapshot.wallet.status, 'DISCONNECTED');
});

test('refresh handles absent connection, account change and the no-deployment presentation', async () => {
  const absent = createM3BrowserRuntime({});
  await absent.refresh();
  assert.equal(absent.snapshot.wallet.status, 'DISCONNECTED');

  const provider = new ProviderFixture();
  provider.chainId = 46_630;
  const noDeployment = createM3BrowserRuntime({ provider });
  await noDeployment.connect();
  await noDeployment.refresh();
  assert.equal(noDeployment.snapshot.onchain.deployment, 'UNAVAILABLE');

  const configuredProvider = new ConfiguredProviderFixture();
  const configured = createM3BrowserRuntime({
    provider: configuredProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await configured.connect();
  configuredProvider.account = asAddress('0x9999999999999999999999999999999999999999');
  await configured.refresh();
  assert.equal(configured.snapshot.wallet.status, 'ACCOUNT_CHANGED');
  assert.equal(configured.snapshot.onchain.writeMode, 'DISABLED');
});

test('evidence read failures use live exit and degrade safely if live exit also fails', async () => {
  for (const liveFails of [false, true]) {
    const provider = new ConfiguredProviderFixture();
    const runtime = createM3BrowserRuntime({
      provider,
      deployment,
      vaultReader: {
        readSnapshot: async () => vaultSnapshot,
        registerSubmission: async () => ({ state: 'SUBMITTED' }),
        readOperationEvidence: async () => {
          throw new Error('evidence detail');
        },
      },
    });
    await runtime.connect();
    const review = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
    await runtime.confirmAction(review);
    if (liveFails) {
      const request = provider.request.bind(provider);
      provider.request = (input) =>
        input.method === 'eth_getBlockByNumber' ? Promise.reject(new Error('live detail')) : request(input);
    }
    await runtime.refresh();
    assert.equal(runtime.snapshot.onchain.health, 'DEGRADED');
    assert.equal(runtime.snapshot.transaction.status, 'SUBMITTED');
  }
});

test('Pass transfer rejects stale sessions, simulation failure and ambiguous submission', async () => {
  const unconfigured = createM3BrowserRuntime({ provider: new ConfiguredProviderFixture() });
  await assert.rejects(
    unconfigured.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' }),
    /M3_DEPLOYMENT_NOT_CONFIGURED/,
  );

  const staleProvider = new ConfiguredProviderFixture();
  const stale = createM3BrowserRuntime({
    provider: staleProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await stale.connect();
  staleProvider.account = asAddress('0x9999999999999999999999999999999999999999');
  await assert.rejects(
    stale.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' }),
    /WALLET_SESSION_CHANGED/,
  );

  const simulationProvider = new ConfiguredProviderFixture();
  const simulation = createM3BrowserRuntime({
    provider: simulationProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await simulation.connect();
  const simulationRequest = simulationProvider.request.bind(simulationProvider);
  simulationProvider.request = (input) => {
    const call = input.params?.[0] as { data?: string } | undefined;
    if (input.method === 'eth_call' && String(call?.data).startsWith('0xa9059cbb'))
      return Promise.reject(new Error('simulation detail'));
    return simulationRequest(input);
  };
  await assert.rejects(
    simulation.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' }),
    /M3_PASS_TRANSFER_SIMULATION_FAILED/,
  );

  const changedProvider = new ConfiguredProviderFixture();
  const changed = createM3BrowserRuntime({
    provider: changedProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await changed.connect();
  const changedRequest = changedProvider.request.bind(changedProvider);
  changedProvider.request = async (input) => {
    const result = await changedRequest(input);
    const call = input.params?.[0] as { data?: string } | undefined;
    if (input.method === 'eth_call' && String(call?.data).startsWith('0xa9059cbb'))
      changedProvider.account = asAddress('0x9999999999999999999999999999999999999999');
    return result;
  };
  await assert.rejects(
    changed.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' }),
    /WALLET_SESSION_CHANGED/,
  );

  const ambiguousProvider = new ConfiguredProviderFixture();
  const ambiguous = createM3BrowserRuntime({
    provider: ambiguousProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await ambiguous.connect();
  const transfer = await ambiguous.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' });
  const ambiguousRequest = ambiguousProvider.request.bind(ambiguousProvider);
  ambiguousProvider.request = (input) =>
    input.method === 'eth_sendTransaction' ? Promise.resolve('invalid-hash') : ambiguousRequest(input);
  const result = await ambiguous.confirmPassTransfer!(transfer);
  assert.equal(result.state, 'SUBMISSION_AMBIGUOUS');
  assert.equal(ambiguous.snapshot.transaction.status, 'SUBMISSION_AMBIGUOUS');
});

test('live-exit state rejects a request whose kind mutates into deposit before preparation', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => {
        throw new Error('index detail');
      },
    },
  });
  await runtime.connect();
  let kindReads = 0;
  const request = new Proxy(
    { kind: 'deposit' as const, usdcBaseUnits: '1' },
    {
      get(target, property, receiver) {
        if (property === 'kind') return kindReads++ === 0 ? 'withdraw' : 'deposit';
        return Reflect.get(target, property, receiver);
      },
    },
  );
  await assert.rejects(runtime.reviewAction(request), /M3_CANONICAL_PROJECTION_REQUIRED/);
});

test('account change records the simultaneously wrong network and confirm requires a configured flow', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await runtime.connect();
  provider.account = asAddress('0x9999999999999999999999999999999999999999');
  provider.chainId = 1;
  await runtime.refresh();
  assert.equal(runtime.snapshot.wallet.status, 'ACCOUNT_CHANGED');
  assert.equal(runtime.snapshot.network.status, 'WRONG');

  await assert.rejects(createM3BrowserRuntime({}).confirmAction({} as never), /M3_DEPLOYMENT_NOT_CONFIGURED/);
});

test('approval and Pass ambiguity retain a returned transaction hash', async () => {
  const approvalProvider = new ConfiguredProviderFixture();
  const approvalRuntime = createM3BrowserRuntime({
    provider: approvalProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await approvalRuntime.connect();
  const approval = await approvalRuntime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' });
  const approvalRequest = approvalProvider.request.bind(approvalProvider);
  approvalProvider.request = async (input) => {
    const result = await approvalRequest(input);
    if (input.method === 'eth_sendTransaction')
      approvalProvider.account = asAddress('0x9999999999999999999999999999999999999999');
    return result;
  };
  const approvalResult = await approvalRuntime.confirmDepositApproval!(approval, 'af-usdc');
  assert.equal(approvalResult.state, 'SUBMISSION_AMBIGUOUS');
  assert.deepEqual(approvalRuntime.snapshot.transaction, {
    status: 'SUBMISSION_AMBIGUOUS',
    txHash: TX_HASH,
    errorCode: 'POST_SUBMISSION_CHECK_FAILED',
  });

  const passProvider = new ConfiguredProviderFixture();
  const passRuntime = createM3BrowserRuntime({
    provider: passProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await passRuntime.connect();
  const transfer = await passRuntime.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' });
  const passRequest = passProvider.request.bind(passProvider);
  passProvider.request = async (input) => {
    const result = await passRequest(input);
    if (input.method === 'eth_sendTransaction')
      passProvider.account = asAddress('0x9999999999999999999999999999999999999999');
    return result;
  };
  const passResult = await passRuntime.confirmPassTransfer!(transfer);
  assert.equal(passResult.state, 'SUBMISSION_AMBIGUOUS');
  assert.deepEqual(passRuntime.snapshot.transaction, {
    status: 'SUBMISSION_AMBIGUOUS',
    txHash: TX_HASH,
    errorCode: 'POST_SUBMISSION_CHECK_FAILED',
  });
});

test('runtime code changes fail closed before Vault or Pass submission', async () => {
  const vaultProvider = new ConfiguredProviderFixture();
  const vaultRuntime = createM3BrowserRuntime({
    provider: vaultProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await vaultRuntime.connect();
  vaultProvider.vaultCode = asHexData('0x6002');
  await assert.rejects(
    vaultRuntime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
    /M3_RUNTIME_CODE_MISMATCH/,
  );

  const passProvider = new ConfiguredProviderFixture();
  const passRuntime = createM3BrowserRuntime({
    provider: passProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await passRuntime.connect();
  passProvider.passCode = asHexData('0x6002');
  await assert.rejects(
    passRuntime.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' }),
    /M3_RUNTIME_CODE_MISMATCH/,
  );

  const unavailableProvider = new ConfiguredProviderFixture();
  const unavailableRuntime = createM3BrowserRuntime({
    provider: unavailableProvider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
  });
  await unavailableRuntime.connect();
  const unavailableRequest = unavailableProvider.request.bind(unavailableProvider);
  unavailableProvider.request = (input) =>
    input.method === 'eth_getCode' ? Promise.reject(new Error('provider detail')) : unavailableRequest(input);
  await assert.rejects(
    unavailableRuntime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' }),
    /M3_RUNTIME_CODE_UNAVAILABLE/,
  );

  const changedAfterReviewProvider = new ConfiguredProviderFixture();
  const changedAfterReview = createM3BrowserRuntime({
    provider: changedAfterReviewProvider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async () => ({ state: 'SUBMITTED' }),
    },
  });
  await changedAfterReview.connect();
  const reviewed = await changedAfterReview.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  changedAfterReviewProvider.vaultCode = asHexData('0x6002');
  await assert.rejects(changedAfterReview.confirmAction(reviewed), /M3_RUNTIME_CODE_MISMATCH/);
});

test('configured runtime consumes canonical Pass identity and balance from the contract-qualified reader', async () => {
  const provider = new ConfiguredProviderFixture();
  provider.passBalance = 999n;
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      readPassSnapshot: async () => ({
        chainId: 46_630,
        owner: OWNER,
        contract: PASS,
        projectionKey: 'm3-strategy-pass',
        blockNumber: '101',
        blockHash: vaultSnapshot.blockHash,
        state: {
          owner: OWNER,
          pass: PASS,
          strategyId: vaultSnapshot.state.strategyId,
          decimals: 18,
          balanceRaw: '7',
        },
      }),
    },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.passBalanceBaseUnits, '7');
  assert.equal(runtime.snapshot.onchain.passTransferMode, 'LIVE_AUTHORIZED');

  const mismatched = createM3BrowserRuntime({
    provider: new ConfiguredProviderFixture(),
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      readPassSnapshot: async () => ({
        chainId: 46_630,
        owner: OWNER,
        contract: PASS,
        projectionKey: 'm3-strategy-pass',
        blockNumber: '101',
        blockHash: vaultSnapshot.blockHash,
        state: {
          owner: OWNER,
          pass: PASS,
          strategyId: asHexData(`0x${'09'.repeat(32)}`),
          decimals: 18,
          balanceRaw: '7',
        },
      }),
    },
  });
  await mismatched.connect();
  assert.equal(mismatched.snapshot.onchain.passBalanceBaseUnits, undefined);
  assert.equal(mismatched.snapshot.onchain.passTransferMode, 'DISABLED');
});

test('Pass submission without backend registration remains explicit and non-retryable', async () => {
  const provider = new ConfiguredProviderFixture();
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: { readSnapshot: async () => vaultSnapshot },
    now: () => '2026-09-20T00:00:00.000Z',
  });
  await runtime.connect();
  const review = await runtime.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' });
  const result = await runtime.confirmPassTransfer!(review);
  assert.equal(result.state, 'SUBMISSION_AMBIGUOUS');
  if (result.state !== 'SUBMISSION_AMBIGUOUS') assert.fail('expected ambiguous submission');
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.reason, 'LOCAL_EVIDENCE_INVALID');
  assert.equal(result.retryable, false);
});

for (const kind of ['vault', 'pass'] as const) {
  test(`known ${kind} hash survives registration outage and reload without another wallet send`, async () => {
    const provider = new ConfiguredProviderFixture();
    provider.usdcAllowance = 100_000_000n;
    provider.passAllowance = 100_000_000_000_000_000_000n;
    const saved = new Map<string, string>();
    const submissionStorage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    let available = false;
    const registrations: Array<Record<string, unknown>> = [];
    let reads = 0;
    const reader = {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async (input: Record<string, unknown>) => {
        registrations.push({ ...input });
        if (!available) throw new Error('LOCAL_API_OFFLINE');
        return { state: 'SUBMITTED' };
      },
      readOperationEvidence: async (): Promise<ProductOperationEvidence> => {
        reads++;
        return {
          lifecycle: 'SUBMITTED',
          receipt: 'PENDING',
          receiptCanonical: false,
          confirmations: 0,
          reconciliation: 'PENDING',
          projection: 'PENDING',
          chainStatus: 'PENDING',
          l1Status: 'UNKNOWN',
          finalityStatus: 'UNKNOWN',
          indexerStatus: 'HEALTHY',
          degradedReason: null,
          productReady: false,
        };
      },
    };
    let runtime = createM3BrowserRuntime({ provider, deployment, vaultReader: reader, submissionStorage });
    await runtime.connect();
    const result =
      kind === 'vault'
        ? await runtime.confirmAction(await runtime.reviewAction({ kind: 'deposit', usdcBaseUnits: '1' }))
        : await runtime.confirmPassTransfer!(
            await runtime.reviewPassTransfer!({ recipient: VAULT, passBaseUnits: '1' }),
          );
    assert.equal(result.state, 'SUBMISSION_AMBIGUOUS');
    assert.equal(result.txHash, TX_HASH);
    assert.equal(provider.requests.filter((x) => x.method === 'eth_sendTransaction').length, 1);
    assert.equal(saved.size, 1, 'known hash must be retained before awaiting registration');
    runtime = createM3BrowserRuntime({ provider, deployment, vaultReader: reader, submissionStorage });
    await runtime.connect();
    assert.equal(runtime.snapshot.transaction.status, 'SUBMISSION_AMBIGUOUS');
    assert.equal(runtime.snapshot.transaction.txHash, TX_HASH);
    available = true;
    await runtime.refresh();
    assert.ok(registrations.length >= 2);
    for (const input of registrations) assert.deepEqual(input, registrations[0]);
    assert.equal(registrations[0]!.owner, OWNER);
    assert.equal(registrations[0]!.target, kind === 'vault' ? VAULT : PASS);
    assert.equal(registrations[0]!.chainId, 46_630);
    assert.equal(registrations[0]!.txHash, TX_HASH);
    assert.equal(reads, 1);
    assert.equal(runtime.snapshot.transaction.status, 'SUBMITTED');
    assert.equal(provider.requests.filter((x) => x.method === 'eth_sendTransaction').length, 1);
  });
}

test('a known unresolved deposit cannot be resent and does not disable a distinct close review', async () => {
  const provider = new ConfiguredProviderFixture();
  provider.usdcAllowance = 100_000_000n;
  provider.passAllowance = 100_000_000_000_000_000_000n;
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async () => {
        throw new Error('LOCAL_API_OFFLINE');
      },
    },
  });
  await runtime.connect();
  const request = { kind: 'deposit' as const, usdcBaseUnits: '1' };
  await runtime.confirmAction(await runtime.reviewAction(request));
  const duplicate = await runtime.reviewAction(request);
  await assert.rejects(() => runtime.confirmAction(duplicate), /M3_SUBMISSION_RECOVERY_REQUIRED/);
  assert.equal(provider.requests.filter((item) => item.method === 'eth_sendTransaction').length, 1);
  await assert.doesNotReject(() => runtime.reviewAction({ kind: 'close' }));
});

test('unavailable durable storage fails before asking the wallet to send', async () => {
  for (const storage of [
    {
      getItem: () => null,
      setItem: () => {
        throw new Error('STORAGE_UNAVAILABLE');
      },
    },
    { getItem: () => null, setItem: () => {} },
  ]) {
    const provider = new ConfiguredProviderFixture();
    const runtime = createM3BrowserRuntime({
      provider,
      deployment,
      submissionStorage: storage,
      vaultReader: { readSnapshot: async () => vaultSnapshot, registerSubmission: async () => ({}) },
    });
    await runtime.connect();
    const review = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
    await assert.rejects(() => runtime.confirmAction(review));
    assert.equal(provider.requests.filter((item) => item.method === 'eth_sendTransaction').length, 0);
  }
});

test('every reviewed runtime identity binding independently blocks deposit approval on mismatch', async () => {
  for (const field of [
    'strategyPassAddress',
    'manifestDigest',
    'abiHash',
    'runtimeBytecodeHash',
    'strategyPassAbiHash',
    'strategyPassRuntimeBytecodeHash',
  ] as const) {
    const provider = new ConfiguredProviderFixture();
    const actual = {
      chainId: 46_630 as const,
      contract: VAULT,
      strategyPassAddress: PASS,
      manifestDigest: deployment.manifestDigest,
      abiHash: deployment.abiHash,
      runtimeBytecodeHash: deployment.runtimeBytecodeHash,
      strategyPassAbiHash: deployment.strategyPassAbiHash,
      strategyPassRuntimeBytecodeHash: deployment.strategyPassRuntimeBytecodeHash,
    };
    const altered = {
      ...actual,
      [field]: field === 'strategyPassAddress' ? AF_USDC : asBlockHash(`0x${'99'.repeat(32)}`),
    };
    const runtime = createM3BrowserRuntime({
      provider,
      deployment,
      vaultReader: {
        readSnapshot: async () => vaultSnapshot,
        readRuntimeStatus: async () => ({
          lastAttempt: 'SUCCEEDED',
          errorCode: null,
          database: { status: 'HEALTHY', schemaVersion: 7, integrity: 'OK' },
          deployment: altered,
        }),
      },
    });
    await runtime.connect();
    await assert.rejects(
      runtime.reviewDepositApprovals!({ kind: 'deposit', usdcBaseUnits: '1' }),
      /M3_RUNTIME_STATUS_MISMATCH/,
      field,
    );
    assert.equal(provider.requests.filter((request) => request.method === 'eth_sendTransaction').length, 0);
  }
});

test('zero and aliased deployed token addresses cannot establish a writable runtime', () => {
  const zero = asAddress(`0x${'0'.repeat(40)}`);
  for (const patch of [{ vaultAddress: zero }, { strategyPassAddress: zero }, { strategyPassAddress: VAULT }])
    assert.throws(
      () => createM3BrowserRuntime({ deployment: { ...deployment, ...patch } }),
      /INVALID_M3_DEPLOYMENT_CONFIG/,
    );
});

test('refresh discovers a journal hint written after connect by another local runtime without resending', async () => {
  const { M3SubmissionJournal } = await import('../apps/web/src/m3-submission-journal.ts');
  const provider = new ConfiguredProviderFixture();
  const values = new Map<string, string>();
  const submissionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const registrations: string[] = [];
  const runtime = createM3BrowserRuntime({
    provider,
    deployment,
    submissionStorage,
    vaultReader: {
      readSnapshot: async () => vaultSnapshot,
      registerSubmission: async (input) => {
        registrations.push(input.operationId);
        return {};
      },
    },
  });
  await runtime.connect();
  assert.equal(runtime.snapshot.transaction.status, 'IDLE');
  const journal = new M3SubmissionJournal(
    {
      chainId: deployment.chainId,
      manifestDigest: deployment.manifestDigest,
      vaultAddress: deployment.vaultAddress,
      strategyPassAddress: deployment.strategyPassAddress,
    },
    submissionStorage,
  );
  journal.record({
    operationId: 'second-tab-withdraw',
    chainId: deployment.chainId,
    owner: OWNER,
    target: VAULT,
    calldata: encodeM3VaultCall('withdraw(uint256)', [1n]),
    txHash: asTransactionHash(TX_HASH),
  });

  await runtime.refresh();
  assert.deepEqual(runtime.snapshot.transaction, { status: 'SUBMITTED', txHash: TX_HASH });
  assert.deepEqual(registrations, ['second-tab-withdraw']);
  assert.equal(provider.requests.filter((item) => item.method === 'eth_sendTransaction').length, 0);
});

for (const outcome of [
  'ready',
  'reverted',
  'pending',
  'registration-offline',
  'no-registration',
  'no-evidence',
] as const) {
  test(`recovery refresh preserves current transaction while older hint is ${outcome}`, async () => {
    const { M3SubmissionJournal } = await import('../apps/web/src/m3-submission-journal.ts');
    const provider = new ConfiguredProviderFixture();
    const values = new Map<string, string>();
    const submissionStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const journal = new M3SubmissionJournal(
      {
        chainId: 46630,
        manifestDigest: deployment.manifestDigest,
        vaultAddress: VAULT,
        strategyPassAddress: PASS,
      },
      submissionStorage,
    );
    const older = {
      operationId: 'older-recovery',
      chainId: 46630 as const,
      owner: OWNER,
      target: VAULT,
      calldata: encodeM3VaultCall('withdraw(uint256)', [1n]),
      txHash: asTransactionHash(`0x${'ba'.repeat(32)}`),
    };
    const current = {
      ...older,
      operationId: 'current-recovery',
      calldata: encodeM3VaultCall('close()', []),
      txHash: asTransactionHash(TX_HASH),
    };
    journal.record(older);
    journal.record(current);
    const registrations: string[] = [];
    const pending: ProductOperationEvidence = {
      lifecycle: 'SUBMITTED',
      receipt: 'PENDING',
      receiptCanonical: false,
      confirmations: 0,
      reconciliation: 'PENDING',
      projection: 'PENDING',
      chainStatus: 'PENDING',
      l1Status: 'UNKNOWN',
      finalityStatus: 'UNKNOWN',
      indexerStatus: 'HEALTHY',
      degradedReason: null,
      productReady: false,
    };
    const reader = {
      readSnapshot: async () => vaultSnapshot,
      ...(outcome === 'no-registration'
        ? {}
        : {
            registerSubmission: async (input: { operationId: string }) => {
              registrations.push(input.operationId);
              if (outcome === 'registration-offline' && input.operationId === older.operationId)
                throw Error('LOCAL_API_OFFLINE');
              return {};
            },
          }),
      ...(outcome === 'no-evidence'
        ? {}
        : {
            readOperationEvidence: async (id: string): Promise<ProductOperationEvidence> =>
              id === older.operationId && outcome === 'ready'
                ? { ...pending, lifecycle: 'CONFIRMED', receipt: 'SUCCESS', productReady: true }
                : id === older.operationId && outcome === 'reverted'
                  ? { ...pending, lifecycle: 'REVERTED', receipt: 'REVERTED' }
                  : pending,
          }),
    };
    const runtime = createM3BrowserRuntime({ provider, deployment, vaultReader: reader, submissionStorage });
    await runtime.connect();
    await runtime.refresh();
    await runtime.refresh();
    assert.equal(runtime.snapshot.transaction.txHash, TX_HASH);
    assert.equal(
      runtime.snapshot.transaction.status,
      outcome === 'no-registration' ? 'SUBMISSION_AMBIGUOUS' : 'SUBMITTED',
    );
    assert.deepEqual(
      journal.read(OWNER).map((x) => x.operationId),
      ['ready', 'reverted'].includes(outcome) ? ['current-recovery'] : ['older-recovery', 'current-recovery'],
    );
    assert.equal(
      provider.requests.filter((x) => x.method === 'eth_sendTransaction').length,
      0,
      'restoration must never resend a wallet transaction',
    );
    if (outcome !== 'no-registration')
      assert.equal(registrations.filter((id) => id === current.operationId).length, 1);
    if (outcome === 'pending' || outcome === 'no-evidence')
      assert.equal(registrations.filter((id) => id === older.operationId).length, 1);
  });
}

for (const method of ['connect', 'refresh'] as const) {
  for (const identity of ['chain', 'account'] as const) {
    test(`${method} cannot publish owner write access after ${identity} changes during a late snapshot`, async () => {
      const provider = new ConfiguredProviderFixture();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((r) => {
        enter = r;
      });
      const held = new Promise<void>((r) => {
        release = r;
      });
      let block = false;
      const runtime = createM3BrowserRuntime({
        provider,
        deployment,
        vaultReader: {
          readSnapshot: async () => {
            if (block) {
              enter();
              await held;
            }
            return vaultSnapshot;
          },
        },
      });
      if (method === 'refresh') await runtime.connect();
      block = true;
      const result = runtime[method]().catch(() => {});
      await entered;
      if (identity === 'chain') provider.chainId = 1;
      else provider.account = asAddress('0x9999999999999999999999999999999999999999');
      release();
      await result;
      assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
      assert.notEqual(runtime.snapshot.network.status, 'CORRECT');
      assert.equal(provider.requests.filter((x) => x.method === 'eth_sendTransaction').length, 0);
    });
  }
}

for (const event of ['chainChanged', 'accountsChanged', 'disconnect'] as const) {
  test(`transient ${event} during a snapshot invalidates the session even when final wallet identity returns`, async () => {
    const base = new ConfiguredProviderFixture();
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const provider = {
      request: (input: Eip1193Request) => base.request(input),
      on: (name: string, listener: (value: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
      },
      removeListener: (name: string, listener: (value: unknown) => void) => {
        listeners.get(name)?.delete(listener);
      },
    };
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const held = new Promise<void>((r) => {
      release = r;
    });
    const runtime = createM3BrowserRuntime({
      provider,
      deployment,
      vaultReader: {
        readSnapshot: async () => {
          enter();
          await held;
          return vaultSnapshot;
        },
      },
    });
    const operation = runtime.connect().catch(() => {});
    await entered;
    for (const listener of listeners.get(event) ?? []) listener(event === 'accountsChanged' ? [] : '0x1');
    release();
    await operation;
    assert.equal(runtime.snapshot.onchain.writeMode, 'DISABLED');
    assert.notEqual(runtime.snapshot.wallet.status, 'CONNECTED');
    assert.equal(
      [...listeners.values()].reduce((n, set) => n + set.size, 0),
      0,
      'temporary guards release their event listeners',
    );
  });
}

for (const lateFailure of [false, true]) {
  test(`superseded connect ${lateFailure ? 'failure' : 'success'} cannot overwrite the newer connection`, async () => {
    const provider = new ConfiguredProviderFixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const held = new Promise<void>((r) => {
      release = r;
    });
    let reads = 0;
    const runtime = createM3BrowserRuntime({
      provider,
      deployment,
      vaultReader: {
        readSnapshot: async () => {
          if (++reads === 1) {
            enter();
            await held;
            if (lateFailure) throw Error('LATE_READ_FAILURE');
          }
          return vaultSnapshot;
        },
      },
    });
    const first = runtime.connect().catch(() => {});
    await entered;
    await runtime.connect();
    const expected = runtime.snapshot;
    release();
    await first;
    assert.deepEqual(runtime.snapshot, expected);
    assert.equal(runtime.snapshot.wallet.status, 'CONNECTED');
    assert.equal(runtime.snapshot.onchain.writeMode, 'LIVE_AUTHORIZED');
    assert.equal(provider.requests.filter((x) => x.method === 'eth_sendTransaction').length, 0);
  });
}

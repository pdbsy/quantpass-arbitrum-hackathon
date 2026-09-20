import test from 'node:test';
import assert from 'node:assert/strict';
import {
  M3_VAULT_PROJECTION_KEY,
  M3VaultContractIntegration,
} from '../apps/server/src/m3-vault-integration.ts';
import {
  M3_PASS_PROJECTION_KEY,
  M3StrategyPassContractIntegration,
} from '../apps/server/src/m3-pass-integration.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import {
  deploymentManifestDigest,
  validateDeploymentManifest,
} from '../packages/chain-adapter/src/manifest.ts';
import type {
  ChainBlock,
  ChainCall,
  ChainCallBlock,
  ChainReceipt,
  ReadonlyRpc,
} from '../packages/chain-adapter/src/rpc.ts';
import type { CanonicalContractEvent } from '../packages/chain-adapter/src/reconciliation.ts';
import {
  encodeM3StrategyPassTransfer,
  M3_STRATEGY_PASS_ABI_HASH,
} from '../packages/chain-adapter/src/pass-abi.ts';
import {
  M3_VAULT_ABI_HASH,
  M3_VAULT_REVIEW_ABI,
  decodeM3VaultEvent,
  encodeM3VaultCall,
} from '../packages/chain-adapter/src/vault-abi.ts';
import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  type Address,
  type HexData,
} from '../packages/chain-adapter/src/types.ts';

const CHAIN_ID = 46_630;
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const CREATOR = asAddress('0x3333333333333333333333333333333333333333');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const USDC = asAddress('0x5555555555555555555555555555555555555555');
const ETH = asAddress('0x6666666666666666666666666666666666666666');
const BTC = asAddress('0x7777777777777777777777777777777777777777');
const LOCKER = asAddress('0x8888888888888888888888888888888888888888');
const RECIPIENT = asAddress('0x9999999999999999999999999999999999999999');
const TX = asTransactionHash(`0x${'aa'.repeat(32)}`);
const BLOCK_HASH = asBlockHash(`0x${'bb'.repeat(32)}`);
const PARENT_HASH = asBlockHash(`0x${'cc'.repeat(32)}`);
const STRATEGY_ID = asHexData(`0x${'11'.repeat(32)}`);
const STRATEGY_REF = asHexData(`0x${'22'.repeat(32)}`);
const block: ChainBlock = { number: 100n, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: 1n };

const manifestBody = {
  schemaVersion: 1,
  environment: 'robinhood-chain-testnet',
  chainId: CHAIN_ID,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: CONTRACT,
  deploymentBlock: '100',
  abiVersion: 'm3-vault-db620d6',
  abiHash: M3_VAULT_ABI_HASH,
  runtimeBytecodeHash: asBlockHash(`0x${'99'.repeat(32)}`),
  strategyPassAddress: PASS,
  strategyPassDeploymentBlock: '90',
  strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: asBlockHash(`0x${'88'.repeat(32)}`),
} as const;
const manifestDigest = deploymentManifestDigest(manifestBody);
const manifest = validateDeploymentManifest(
  { ...manifestBody, manifestDigest },
  { environment: 'robinhood-chain-testnet', chainId: CHAIN_ID, manifestDigest, contractAddress: CONTRACT },
);

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function addressWord(value: Address): HexData {
  return asHexData(`0x${value.slice(2).padStart(64, '0')}`);
}

class ViewRpc implements ReadonlyRpc {
  readonly calls: ChainCall[] = [];
  readonly callBlocks: ChainCallBlock[] = [];
  trackedUsdcBalance = 1_000_000n;
  principalBasis = 1_000_000n;
  closed = false;
  owner: Address = OWNER;
  openTrackedPositionCount = 0n;
  passStrategyId: HexData = STRATEGY_ID;
  passAddress: Address = PASS;

  async chainId() {
    return CHAIN_ID;
  }
  async block() {
    return block;
  }
  async receipt() {
    return null;
  }
  async logs() {
    return [];
  }
  async code() {
    return asHexData('0x6000');
  }
  async call(request: ChainCall, blockReference: ChainCallBlock): Promise<HexData> {
    this.calls.push(request);
    this.callBlocks.push(blockReference);
    const selector = request.data.slice(0, 10);
    if (request.to === this.passAddress && selector === '0x492f4e18') return this.passStrategyId;
    assert.equal(request.to, CONTRACT);
    const addresses: Record<string, Address> = {
      '0x8da5cb5b': this.owner,
      '0x499bb2ab': CREATOR,
      '0xa7a1ed72': this.passAddress,
      '0x8b5a851f': USDC,
      '0xf20173bc': ETH,
      '0xa8d937e9': BTC,
      '0xab88dc4b': LOCKER,
    };
    if (addresses[selector]) return addressWord(addresses[selector]);
    if (selector === '0x492f4e18') return STRATEGY_ID;
    if (selector === '0xc288f3de') return STRATEGY_REF;
    const values: Record<string, bigint> = {
      '0xad587035': this.principalBasis,
      '0x0510ca51': this.trackedUsdcBalance,
      '0x738b74f0': 0n,
      '0x442ad6a0': this.trackedUsdcBalance,
      '0x34dda870': this.openTrackedPositionCount,
      '0xb31ede63': 0n,
      '0x597e1fb5': this.closed ? 1n : 0n,
    };
    if (values[selector] !== undefined) return asHexData(`0x${word(values[selector])}`);
    throw new Error('unexpected call');
  }
}

function event(name: string, data: Readonly<Record<string, unknown>>): CanonicalContractEvent {
  return {
    chainId: CHAIN_ID,
    address: CONTRACT,
    blockNumber: block.number,
    blockHash: block.hash,
    transactionHash: TX,
    transactionIndex: 0,
    logIndex: 0,
    data: asHexData('0x'),
    topics: [],
    removed: false,
    eventSignature: asHexData(`0x${'00'.repeat(32)}`),
    eventName: name,
    normalizedData: data,
  };
}

function depositedEvent(owner = OWNER, amount = 1_000_000n, passRaw = amount * 1_000_000_000_000n) {
  const topic = M3_VAULT_REVIEW_ABI.eventTopics['Deposited(address,uint256,uint256,uint256,uint256)'];
  const raw = {
    address: CONTRACT,
    blockNumber: block.number,
    blockHash: block.hash,
    transactionHash: TX,
    transactionIndex: 0,
    logIndex: 0,
    data: asHexData(`0x${word(amount)}${word(passRaw)}${word(1_000_000n)}${word(1_000_000n)}`),
    topics: [topic, addressWord(owner)],
    removed: false,
  };
  return { ...raw, chainId: CHAIN_ID, ...decodeM3VaultEvent(raw)! };
}

function submitted(calldata: HexData) {
  return transitionOperation(
    createOperation({
      operationId: 'vault-deposit-1',
      chainId: CHAIN_ID,
      owner: OWNER,
      target: CONTRACT,
      calldata,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX, submittedAt: '2026-09-19T12:00:00.000Z' },
  );
}

function receipt(): ChainReceipt {
  return {
    transactionHash: TX,
    blockNumber: block.number,
    blockHash: block.hash,
    transactionIndex: 0,
    from: OWNER,
    to: CONTRACT,
    status: 'SUCCESS',
    logs: [],
  };
}

test('Vault integration rebuilds one canonical owner projection from exact contract views', async () => {
  const rpc = new ViewRpc();
  const integration = new M3VaultContractIntegration();
  const projections = await integration.rebuildProjections({ rpc, manifest, events: [], block });
  assert.equal(projections.length, 1);
  assert.equal(projections[0]?.owner, OWNER);
  assert.equal(projections[0]?.projectionKey, M3_VAULT_PROJECTION_KEY);
  assert.deepEqual(projections[0]?.state, {
    owner: OWNER,
    strategyCreator: CREATOR,
    strategyId: STRATEGY_ID,
    strategyRef: STRATEGY_REF,
    pass: PASS,
    passStrategyId: STRATEGY_ID,
    afUsdc: USDC,
    afEth: ETH,
    afBtc: BTC,
    passLocker: LOCKER,
    principalBasis: '1000000',
    trackedUsdcBalance: '1000000',
    realizedProfit: '0',
    withdrawableUsdc: '1000000',
    trackedAfEth: '0',
    trackedAfBtc: '0',
    openTrackedPositionCount: '0',
    closed: false,
  });
  assert.equal(rpc.calls.length, 18);
  assert.equal(rpc.calls.filter((call) => call.to === CONTRACT).length, 17);
  assert.equal(rpc.calls.filter((call) => call.to === PASS).length, 1);
  assert.deepEqual(
    rpc.callBlocks,
    Array.from({ length: 18 }, () => ({ blockHash: BLOCK_HASH, requireCanonical: true })),
  );
});

test('Vault integration rejects a Pass whose onchain strategy identity differs from the Vault', async () => {
  const rpc = new ViewRpc();
  rpc.passStrategyId = asHexData(`0x${'ff'.repeat(32)}`);
  await assert.rejects(
    () => new M3VaultContractIntegration().rebuildProjections({ rpc, manifest, events: [], block }),
    /M3_VAULT_STRATEGY_PASS_MISMATCH/,
  );
  const wrongAddress = new ViewRpc();
  wrongAddress.passAddress = CREATOR;
  await assert.rejects(
    () =>
      new M3VaultContractIntegration().rebuildProjections({ rpc: wrongAddress, manifest, events: [], block }),
    /M3_VAULT_STRATEGY_PASS_MISMATCH/,
  );
});

test('StrategyPass integration projects exact raw balances and reconciles one exact Transfer event', async () => {
  const passManifest = {
    ...manifest,
    contractName: 'StrategyPass',
    contractType: 'strategy-pass',
    contractAddress: PASS,
    deploymentBlock: manifest.strategyPassDeploymentBlock,
    abiVersion: 'm3-strategy-pass-2ad8162',
    abiHash: manifest.strategyPassAbiHash,
    runtimeBytecodeHash: manifest.strategyPassRuntimeBytecodeHash,
  } as typeof manifest;
  const balances = new Map<string, bigint>([
    [OWNER.toLowerCase(), 999n],
    [RECIPIENT.toLowerCase(), 1n],
  ]);
  const rpc: ReadonlyRpc = {
    chainId: async () => CHAIN_ID,
    block: async () => block,
    receipt: async () => null,
    logs: async () => [],
    code: async () => asHexData('0x6000'),
    call: async (request, reference) => {
      assert.deepEqual(reference, { blockHash: BLOCK_HASH, requireCanonical: true });
      assert.equal(request.to, PASS);
      const selector = request.data.slice(0, 10);
      if (selector === '0x492f4e18') return STRATEGY_ID;
      if (selector === '0x313ce567') return asHexData(`0x${word(18n)}`);
      if (selector === '0x70a08231')
        return asHexData(
          `0x${word(balances.get(asAddress(`0x${request.data.slice(-40)}`).toLowerCase()) ?? 0n)}`,
        );
      throw new Error('unexpected call');
    },
  };
  const transfer = event('Transfer', {
    from: OWNER,
    to: RECIPIENT,
    amountRaw: '1',
  });
  const passTransfer = { ...transfer, address: PASS };
  const integration = new M3StrategyPassContractIntegration();
  const projections = await integration.rebuildProjections({
    rpc,
    manifest: passManifest,
    events: [passTransfer],
    block,
  });
  assert.deepEqual(
    projections.map((projection) => projection.state),
    [
      { owner: OWNER, pass: PASS, strategyId: STRATEGY_ID, decimals: 18, balanceRaw: '999' },
      { owner: RECIPIENT, pass: PASS, strategyId: STRATEGY_ID, decimals: 18, balanceRaw: '1' },
    ],
  );
  assert.ok(projections.every((projection) => projection.projectionKey === M3_PASS_PROJECTION_KEY));
  const mint = {
    ...passTransfer,
    normalizedData: {
      from: asAddress('0x0000000000000000000000000000000000000000'),
      to: RECIPIENT,
      amountRaw: '1000',
    },
  };
  const mintProjections = await integration.rebuildProjections({
    rpc,
    manifest: passManifest,
    events: [event('Approval', {}), mint],
    block,
  });
  assert.deepEqual(
    mintProjections.map((projection) => projection.owner),
    [RECIPIENT],
  );

  const operation = transitionOperation(
    createOperation({
      operationId: 'pass-transfer-1',
      chainId: CHAIN_ID,
      owner: OWNER,
      target: PASS,
      calldata: encodeM3StrategyPassTransfer(RECIPIENT, 1n),
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX, submittedAt: '2026-09-20T00:00:00.000Z' },
  );
  const passReceipt = { ...receipt(), to: PASS };
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest: passManifest,
      operation,
      receipt: passReceipt,
      events: [passTransfer],
      block,
    }),
    { status: 'MATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest: passManifest,
      operation,
      receipt: passReceipt,
      events: [{ ...passTransfer, normalizedData: { ...passTransfer.normalizedData, amountRaw: '2' } }],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );
  for (const normalizedData of [
    { ...passTransfer.normalizedData, from: 1 },
    { ...passTransfer.normalizedData, from: 'invalid' },
    { ...passTransfer.normalizedData, to: 'invalid' },
    { ...passTransfer.normalizedData, amountRaw: 1 },
  ])
    assert.deepEqual(
      await integration.reconcileOperation({
        rpc,
        manifest: passManifest,
        operation,
        receipt: passReceipt,
        events: [{ ...passTransfer, normalizedData }],
        block,
      }),
      { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
    );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest: passManifest,
      operation: { ...operation, calldata: null },
      receipt: passReceipt,
      events: [passTransfer],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest: passManifest,
      operation,
      receipt: passReceipt,
      events: [passTransfer, { ...passTransfer, logIndex: 1 }],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest: passManifest,
      operation,
      receipt: passReceipt,
      events: [{ ...passTransfer, normalizedData: { ...passTransfer.normalizedData, from: CREATOR } }],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );

  const invalidMetadataRpc: ReadonlyRpc = {
    ...rpc,
    call: async (request, reference) =>
      request.data.slice(0, 10) === '0x313ce567' ? asHexData(`0x${word(6n)}`) : rpc.call(request, reference),
  };
  await assert.rejects(
    () =>
      integration.rebuildProjections({
        rpc: invalidMetadataRpc,
        manifest: passManifest,
        events: [passTransfer],
        block,
      }),
    /M3_STRATEGY_PASS_STATE_MISMATCH/,
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc: invalidMetadataRpc,
      manifest: passManifest,
      operation,
      receipt: passReceipt,
      events: [passTransfer],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' },
  );
});

test('deposit reconciliation binds calldata, owner, amount and canonical block contract identity', async () => {
  const rpc = new ViewRpc();
  const integration = new M3VaultContractIntegration();
  const operation = submitted(encodeM3VaultCall('deposit(uint256)', [1_000_000n]));
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation,
      receipt: receipt(),
      events: [depositedEvent()],
      block,
    }),
    { status: 'MATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation,
      receipt: receipt(),
      events: [depositedEvent(OWNER, 2n)],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation,
      receipt: receipt(),
      events: [depositedEvent(OWNER, 1_000_000n, 1n)],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation,
      receipt: receipt(),
      events: [depositedEvent(CREATOR)],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
  );

  rpc.passStrategyId = asHexData(`0x${'ff'.repeat(32)}`);
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation,
      receipt: receipt(),
      events: [depositedEvent()],
      block,
    }),
    { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' },
  );
});

test('earlier same-block deposit and withdraw reconcile from their events after a later close', async () => {
  const rpc = new ViewRpc();
  rpc.principalBasis = 0n;
  rpc.trackedUsdcBalance = 0n;
  rpc.closed = true;
  const integration = new M3VaultContractIntegration();
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation: submitted(encodeM3VaultCall('deposit(uint256)', [1_000_000n])),
      receipt: receipt(),
      events: [depositedEvent()],
      block,
    }),
    { status: 'MATCH' },
  );
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation: submitted(encodeM3VaultCall('withdraw(uint256)', [600n])),
      receipt: receipt(),
      events: [
        event('Withdrawn', {
          owner: OWNER,
          usdcAmount: '600',
          profitAmount: '100',
          principalAmount: '500',
          passRawUnlocked: '500000000000000',
          principalBasis: '500',
          trackedUsdcBalance: '500',
        }),
      ],
      block,
    }),
    { status: 'MATCH' },
  );
});

test('Vault integration fails closed when operation calldata is absent or not an owner mutation', async () => {
  const rpc = new ViewRpc();
  const integration = new M3VaultContractIntegration();
  for (const calldata of [null, encodeM3VaultCall('owner()', [])]) {
    const operation = submitted(encodeM3VaultCall('deposit(uint256)', [1_000_000n]));
    const candidate = { ...operation, calldata };
    assert.deepEqual(
      await integration.reconcileOperation({
        rpc,
        manifest,
        operation: candidate,
        receipt: receipt(),
        events: [depositedEvent()],
        block,
      }),
      { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
    );
  }
});

test('withdraw reconciliation enforces principal, profit and Pass accounting identities', async () => {
  const rpc = new ViewRpc();
  rpc.principalBasis = 500n;
  rpc.trackedUsdcBalance = 500n;
  const integration = new M3VaultContractIntegration();
  const operation = submitted(encodeM3VaultCall('withdraw(uint256)', [600n]));
  const base = {
    owner: OWNER,
    usdcAmount: '600',
    profitAmount: '100',
    principalAmount: '500',
    passRawUnlocked: '500000000000000',
    principalBasis: '500',
    trackedUsdcBalance: '500',
  };
  assert.deepEqual(
    await integration.reconcileOperation({
      rpc,
      manifest,
      operation,
      receipt: receipt(),
      events: [event('Withdrawn', base)],
      block,
    }),
    { status: 'MATCH' },
  );
  for (const malformed of [
    { ...base, profitAmount: '99' },
    { ...base, passRawUnlocked: '499999999999999' },
    { ...base, profitAmount: -1 },
    { ...base, principalAmount: '01' },
  ])
    assert.deepEqual(
      await integration.reconcileOperation({
        rpc,
        manifest,
        operation,
        receipt: receipt(),
        events: [event('Withdrawn', malformed)],
        block,
      }),
      { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
    );
});

test('Vault reconciliation rejects missing, duplicate and malformed owner event fields', async () => {
  const rpc = new ViewRpc();
  const integration = new M3VaultContractIntegration();
  const operation = submitted(encodeM3VaultCall('deposit(uint256)', [1_000_000n]));
  for (const events of [
    [],
    [depositedEvent(), { ...depositedEvent(), logIndex: 1 }],
    [event('Deposited', { owner: 1, usdcAmount: '1000000', passRaw: '1000000000000000000' })],
    [event('Deposited', { owner: 'invalid', usdcAmount: '1000000', passRaw: '1000000000000000000' })],
  ])
    assert.deepEqual(
      await integration.reconcileOperation({ rpc, manifest, operation, receipt: receipt(), events, block }),
      { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' },
    );
});

test('close and rescue reconciliation require exact owner events and closed contract state', async () => {
  const rpc = new ViewRpc();
  rpc.principalBasis = 0n;
  rpc.trackedUsdcBalance = 0n;
  rpc.closed = true;
  const integration = new M3VaultContractIntegration();
  for (const [calldata, canonicalEvent] of [
    [encodeM3VaultCall('close()', []), event('Closed', { owner: OWNER })],
    [
      encodeM3VaultCall('rescueUntrackedToken(address)', [USDC]),
      event('UntrackedTokenRescued', { owner: OWNER, token: USDC }),
    ],
    [encodeM3VaultCall('rescueNative()', []), event('NativeRescued', { owner: OWNER })],
  ] as const)
    assert.deepEqual(
      await integration.reconcileOperation({
        rpc,
        manifest,
        operation: submitted(calldata),
        receipt: receipt(),
        events: [canonicalEvent],
        block,
      }),
      { status: 'MATCH' },
    );
});

test('Vault reconciliation fails closed on owner, close-accounting and active-rescue state', async () => {
  const integration = new M3VaultContractIntegration();
  const reconcile = (rpc: ViewRpc, calldata: HexData, canonicalEvent: CanonicalContractEvent) =>
    integration.reconcileOperation({
      rpc,
      manifest,
      operation: submitted(calldata),
      receipt: receipt(),
      events: [canonicalEvent],
      block,
    });

  const wrongOwner = new ViewRpc();
  wrongOwner.owner = CREATOR;
  assert.deepEqual(
    await reconcile(wrongOwner, encodeM3VaultCall('deposit(uint256)', [1_000_000n]), depositedEvent()),
    { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' },
  );

  for (const change of [
    (rpc: ViewRpc) => (rpc.closed = false),
    (rpc: ViewRpc) => (rpc.principalBasis = 1n),
    (rpc: ViewRpc) => (rpc.trackedUsdcBalance = 1n),
    (rpc: ViewRpc) => (rpc.openTrackedPositionCount = 1n),
  ]) {
    const rpc = new ViewRpc();
    rpc.closed = true;
    rpc.principalBasis = 0n;
    rpc.trackedUsdcBalance = 0n;
    change(rpc);
    assert.deepEqual(
      await reconcile(rpc, encodeM3VaultCall('close()', []), event('Closed', { owner: OWNER })),
      { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' },
    );
  }

  for (const [calldata, canonicalEvent] of [
    [encodeM3VaultCall('rescueNative()', []), event('NativeRescued', { owner: OWNER })],
    [
      encodeM3VaultCall('rescueUntrackedToken(address)', [USDC]),
      event('UntrackedTokenRescued', { owner: OWNER, token: USDC }),
    ],
  ] as const)
    assert.deepEqual(await reconcile(new ViewRpc(), calldata, canonicalEvent), {
      status: 'MISMATCH',
      errorCode: 'CONTRACT_STATE_MISMATCH',
    });
});

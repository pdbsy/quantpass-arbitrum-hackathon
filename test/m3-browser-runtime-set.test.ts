import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  sameAddress,
  type Address,
} from '../packages/chain-adapter/src/types.ts';
import type { ProductOperationEvidence } from '../packages/chain-adapter/src/reconciliation.ts';
import { encodeM3VaultCall } from '../packages/chain-adapter/src/vault-abi.ts';
import type { Eip1193Provider, Eip1193Request } from '../apps/web/src/chain-wallet.ts';
import type { M3BrowserDeploymentConfig, M3VaultReader } from '../apps/web/src/m3-browser-runtime.ts';
import { createM3BrowserRuntimeSet } from '../apps/web/src/m3-browser-runtime-set.ts';
import type { M3VaultSnapshot } from '../apps/web/src/m3-vault-client.ts';
import { keccak256Evm } from '../apps/web/src/evm-keccak.ts';

const OWNER_A = asAddress('0x1111111111111111111111111111111111111111');
const OWNER_B = asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const VAULT_A = asAddress('0x2222222222222222222222222222222222222222');
const VAULT_B = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const AF_USDC = asAddress('0x3333333333333333333333333333333333333333');
const VAULT_CODE = asHexData('0x6000');
const PASS_CODE = asHexData('0x6001');
const STRATEGY_ID = asHexData(`0x${'11'.repeat(32)}`);
const BLOCK_HASH = asBlockHash(`0x${'cd'.repeat(32)}`);
const TX_HASH = asTransactionHash(`0x${'ab'.repeat(32)}`);

function deployment(vaultAddress: Address, seed: string): M3BrowserDeploymentConfig {
  return Object.freeze({
    source: 'reviewed-deployment-manifest',
    chainId: 46_630,
    vaultAddress,
    deploymentBlock: seed === '12' ? '1' : '2',
    abiVersion: 'm3-vault-db620d6',
    abiHash: asBlockHash('0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977'),
    manifestDigest: asBlockHash(`0x${seed.repeat(32)}`),
    runtimeBytecodeHash: keccak256Evm(VAULT_CODE),
    strategyPassAddress: PASS,
    strategyPassDeploymentBlock: '3',
    strategyPassAbiHash: asBlockHash('0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f'),
    strategyPassRuntimeBytecodeHash: keccak256Evm(PASS_CODE),
  });
}

const DEPLOYMENT_A = deployment(VAULT_A, '12');
const DEPLOYMENT_B = deployment(VAULT_B, '34');

function snapshot(vault: Address, owner: Address, locker: Address): M3VaultSnapshot {
  return Object.freeze({
    chainId: 46_630,
    owner,
    contract: vault,
    projectionKey: 'm3-vault',
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    state: Object.freeze({
      owner,
      strategyCreator: asAddress('0x5555555555555555555555555555555555555555'),
      strategyId: STRATEGY_ID,
      strategyRef: asHexData(`0x${'22'.repeat(32)}`),
      pass: PASS,
      passStrategyId: STRATEGY_ID,
      afUsdc: AF_USDC,
      afEth: asAddress('0x6666666666666666666666666666666666666666'),
      afBtc: asAddress('0x7777777777777777777777777777777777777777'),
      passLocker: locker,
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
}

const pendingEvidence: ProductOperationEvidence = Object.freeze({
  lifecycle: 'SUBMITTED',
  receipt: 'PENDING',
  receiptCanonical: false,
  confirmations: 0,
  reconciliation: 'PENDING',
  projection: 'PENDING',
  chainStatus: 'PENDING',
  l1Status: 'UNKNOWN',
  finalityStatus: 'UNKNOWN',
  indexerStatus: 'SYNCING',
  degradedReason: null,
  productReady: false,
});

class Reader implements M3VaultReader {
  readonly value: M3VaultSnapshot;
  operationId: string | null = null;
  readGate:
    | {
        readonly entered: () => void;
        readonly wait: Promise<void>;
      }
    | undefined;

  constructor(value: M3VaultSnapshot) {
    this.value = value;
  }

  async readSnapshot(owner: Address): Promise<M3VaultSnapshot> {
    const gate = this.readGate;
    this.readGate = undefined;
    if (gate) {
      gate.entered();
      await gate.wait;
    }
    if (!sameAddress(owner, this.value.owner)) throw new Error('OWNER_PROJECTION_NOT_FOUND');
    return this.value;
  }

  async registerSubmission(input: Parameters<NonNullable<M3VaultReader['registerSubmission']>>[0]) {
    this.operationId = input.operationId;
    return Object.freeze({ state: 'SUBMITTED' as const });
  }

  async readOperationEvidence(operationId: string, owner: Address): Promise<ProductOperationEvidence> {
    if (operationId !== this.operationId || !sameAddress(owner, this.value.owner))
      throw new Error('OPERATION_NOT_FOUND');
    return pendingEvidence;
  }
}

const addressResult = (address: Address) => `0x${address.slice(2).padStart(64, '0')}`;
const uintResult = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

class Provider implements Eip1193Provider {
  account = OWNER_A;
  readonly sentTargets: Address[] = [];

  on(): void {}
  removeListener(): void {}

  async request(input: Eip1193Request): Promise<unknown> {
    if (input.method === 'eth_requestAccounts' || input.method === 'eth_accounts') return [this.account];
    if (input.method === 'eth_chainId') return '0xb626';
    if (input.method === 'eth_getBlockByNumber') return { number: '0x64', hash: BLOCK_HASH };
    if (input.method === 'eth_getCode')
      return sameAddress(asAddress(String(input.params?.[0])), PASS) ? PASS_CODE : VAULT_CODE;
    if (input.method === 'eth_sendTransaction') {
      const call = input.params?.[0] as { readonly to?: unknown } | undefined;
      this.sentTargets.push(asAddress(String(call?.to)));
      return TX_HASH;
    }
    if (input.method === 'eth_call') {
      const call = input.params?.[0] as { readonly data?: unknown; readonly to?: unknown } | undefined;
      const data = String(call?.data ?? '');
      const target = asAddress(String(call?.to));
      if (data === encodeM3VaultCall('afUsdc()', [])) return addressResult(AF_USDC);
      if (data === encodeM3VaultCall('pass()', [])) return addressResult(PASS);
      if (data.startsWith('0xdd62ed3e')) {
        const spender = asAddress(`0x${data.slice(-40)}`);
        return uintResult(sameAddress(spender, VAULT_A) ? 11n : 22n);
      }
      if (data.startsWith('0x70a08231') && sameAddress(target, PASS)) return uintResult(100n);
      return '0x';
    }
    throw new Error('UNEXPECTED_PROVIDER_METHOD');
  }
}

function runtimeSet() {
  const provider = new Provider();
  const readers = new Map<Address, Reader>([
    [
      VAULT_A,
      new Reader(snapshot(VAULT_A, OWNER_A, asAddress('0x8888888888888888888888888888888888888888'))),
    ],
    [
      VAULT_B,
      new Reader(snapshot(VAULT_B, OWNER_B, asAddress('0x9999999999999999999999999999999999999999'))),
    ],
  ]);
  const runtime = createM3BrowserRuntimeSet({
    provider,
    deployments: [DEPLOYMENT_A, DEPLOYMENT_B],
    vaultReader: (item) => readers.get(item.vaultAddress)!,
    transportProvenance: 'DEV_MOCK',
    now: () => '2026-09-20T00:00:00.000Z',
  });
  return { provider, readers, runtime };
}

test('allowlisted runtime set accepts a shared StrategyPass and rejects unknown Vault selection', async () => {
  const { runtime } = runtimeSet();

  assert.deepEqual(runtime.vaultSelection, {
    selected: { chainId: 46_630, vaultAddress: VAULT_A },
    options: [
      { chainId: 46_630, vaultAddress: VAULT_A },
      { chainId: 46_630, vaultAddress: VAULT_B },
    ],
  });
  assert.equal(DEPLOYMENT_A.strategyPassAddress, DEPLOYMENT_B.strategyPassAddress);
  await assert.rejects(
    runtime.selectVault({
      chainId: 46_630,
      vaultAddress: asAddress('0xcccccccccccccccccccccccccccccccccccccccc'),
    }),
    /M3_VAULT_SELECTION_NOT_ALLOWLISTED/,
  );
});

test('allowlisted runtime set rejects empty and duplicate Vault identities', () => {
  assert.throws(() => createM3BrowserRuntimeSet({ deployments: [] }), /INVALID_M3_DEPLOYMENT_SET/);
  assert.throws(
    () =>
      createM3BrowserRuntimeSet({
        deployments: [DEPLOYMENT_A, { ...DEPLOYMENT_A }],
      }),
    /DUPLICATE_M3_VAULT_SELECTION/,
  );
});

test('Vault selection isolates owner sessions, allowances, operations and stale reviews with a shared Pass', async () => {
  const { provider, runtime } = runtimeSet();
  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(runtime.snapshot.onchain.vaultAddress, VAULT_A);
  assert.equal(runtime.snapshot.onchain.passAddress, PASS);
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.spender, VAULT_A);
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.afUsdcAllowanceBaseUnits, '11');

  const submittedA = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  await runtime.confirmAction(submittedA);
  const staleA = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '2' });

  provider.account = OWNER_B;
  await runtime.selectVault({ chainId: 46_630, vaultAddress: VAULT_B });
  assert.equal(runtime.snapshot.onchain.vaultAddress, VAULT_B);
  assert.equal(runtime.snapshot.onchain.passAddress, PASS);
  assert.equal(runtime.snapshot.onchain.owner, 'UNKNOWN');
  await assert.rejects(runtime.confirmAction(staleA), /M3_VAULT_SELECTION_CHANGED/);
  assert.deepEqual(provider.sentTargets, [VAULT_A]);

  await runtime.connect();
  assert.equal(runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.spender, VAULT_B);
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.afUsdcAllowanceBaseUnits, '22');
  const submittedB = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '3' });
  await runtime.confirmAction(submittedB);
  assert.deepEqual(provider.sentTargets, [VAULT_A, VAULT_B]);

  provider.account = OWNER_A;
  await runtime.selectVault({ chainId: 46_630, vaultAddress: VAULT_A });
  assert.equal(runtime.snapshot.onchain.owner, 'OWNER');
  assert.equal(runtime.snapshot.onchain.depositAuthorization?.spender, VAULT_A);
  assert.equal(runtime.snapshot.transaction.status, 'SUBMITTED');
});

test('Vault selection rejects a review whose simulation completes after the selected Vault changed', async () => {
  const { provider, readers, runtime } = runtimeSet();
  await runtime.connect();
  const reader = readers.get(VAULT_A)!;
  let entered!: () => void;
  let release!: () => void;
  const readEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  reader.readGate = { entered, wait };

  const reviewing = runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
  await readEntered;
  provider.account = OWNER_B;
  await runtime.selectVault({ chainId: 46_630, vaultAddress: VAULT_B });
  release();

  await assert.rejects(reviewing, /M3_VAULT_SELECTION_CHANGED/);
  assert.deepEqual(provider.sentTargets, []);
});

import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  sameAddress,
  type Address,
} from '../../../packages/chain-adapter/src/types.ts';
import type { ProductOperationEvidence } from '../../../packages/chain-adapter/src/reconciliation.ts';
import { encodeM3VaultCall } from '../../../packages/chain-adapter/src/vault-abi.ts';
import { type M3BrowserDeploymentConfig, type M3VaultReader } from './m3-browser-runtime.ts';
import { createM3BrowserRuntimeSet } from './m3-browser-runtime-set.ts';
import type { Eip1193Provider, Eip1193Request } from './chain-wallet.ts';
import type { M3SelectableProductRuntime } from './m3-product-runtime.ts';
import type { M3VaultSnapshot } from './m3-vault-client.ts';
import { keccak256Evm } from './evm-keccak.ts';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const SECOND_OWNER = asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const NON_OWNER = asAddress('0x9999999999999999999999999999999999999999');
const VAULT = asAddress('0x2222222222222222222222222222222222222222');
const SECOND_VAULT = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const AF_USDC = asAddress('0x3333333333333333333333333333333333333333');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const AF_ETH = asAddress('0x6666666666666666666666666666666666666666');
const AF_BTC = asAddress('0x7777777777777777777777777777777777777777');
const TX_HASH = asTransactionHash(`0x${'ab'.repeat(32)}`);
const BLOCK_HASH = asBlockHash(`0x${'cd'.repeat(32)}`);
const STRATEGY_ID = asHexData(`0x${'01'.repeat(32)}`);
const STRATEGY_REF = asHexData(`0x${'02'.repeat(32)}`);
const VAULT_CODE = asHexData('0x6000');
const PASS_CODE = asHexData('0x6001');

const deployment: M3BrowserDeploymentConfig = Object.freeze({
  source: 'reviewed-deployment-manifest',
  chainId: 46_630,
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
  passInitialSupplyBaseUnits: '2000000000000000000',
  passInitialRecipient: OWNER,
});

const secondDeployment: M3BrowserDeploymentConfig = Object.freeze({
  ...deployment,
  vaultAddress: SECOND_VAULT,
  deploymentBlock: '3',
  manifestDigest: asBlockHash(`0x${'34'.repeat(32)}`),
});

function createVaultSnapshot(vault: Address, owner: Address, passLocker: Address): M3VaultSnapshot {
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
      strategyRef: STRATEGY_REF,
      pass: PASS,
      passStrategyId: STRATEGY_ID,
      afUsdc: AF_USDC,
      afEth: AF_ETH,
      afBtc: AF_BTC,
      passLocker,
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

const vaultSnapshot = createVaultSnapshot(
  VAULT,
  OWNER,
  asAddress('0x8888888888888888888888888888888888888888'),
);
const secondVaultSnapshot = createVaultSnapshot(
  SECOND_VAULT,
  SECOND_OWNER,
  asAddress('0xdddddddddddddddddddddddddddddddddddddddd'),
);

const addressResult = (address: Address) => `0x${address.slice(2).padStart(64, '0')}`;
const uintResult = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

class DevProvider implements Eip1193Provider {
  readonly requests: Eip1193Request[] = [];
  chainId = 1;
  account = OWNER;
  readonly usdcAllowances = new Map<string, bigint>([
    [VAULT.toLowerCase(), 0n],
    [SECOND_VAULT.toLowerCase(), 0n],
  ]);
  readonly passAllowances = new Map<string, bigint>([
    [VAULT.toLowerCase(), 0n],
    [SECOND_VAULT.toLowerCase(), 0n],
  ]);
  readonly passBalances = new Map<string, bigint>([
    [OWNER.toLowerCase(), 2_000_000_000_000_000_000n],
    [SECOND_OWNER.toLowerCase(), 1_000_000_000_000_000_000n],
  ]);
  readonly closedVaults = new Set<string>();

  on(): void {}
  removeListener(): void {}

  async request(input: Eip1193Request): Promise<unknown> {
    this.requests.push(input);
    if (input.method === 'eth_requestAccounts' || input.method === 'eth_accounts') return [this.account];
    if (input.method === 'eth_chainId') return `0x${this.chainId.toString(16)}`;
    if (input.method === 'eth_getBlockByNumber') return { number: '0x64', hash: BLOCK_HASH };
    if (input.method === 'eth_getCode')
      return sameAddress(asAddress(String(input.params?.[0])), PASS) ? PASS_CODE : VAULT_CODE;
    if (input.method === 'eth_sendTransaction') {
      const transaction = input.params?.[0] as { readonly data?: unknown; readonly to?: unknown } | undefined;
      const data = String(transaction?.data ?? '');
      if (data.startsWith('0x095ea7b3') && data.length === 138) {
        const spender = asAddress(`0x${data.slice(34, 74)}`);
        if (![VAULT, SECOND_VAULT].some((vault) => sameAddress(spender, vault)))
          throw new Error('DEV_FIXTURE_INVALID_APPROVAL_SPENDER');
        const allowance = BigInt(`0x${data.slice(74)}`);
        const target = asAddress(String(transaction?.to));
        if (sameAddress(target, AF_USDC)) this.usdcAllowances.set(spender.toLowerCase(), allowance);
        else if (sameAddress(target, PASS)) this.passAllowances.set(spender.toLowerCase(), allowance);
      } else if (
        sameAddress(asAddress(String(transaction?.to)), PASS) &&
        data.startsWith('0xa9059cbb') &&
        data.length === 138
      ) {
        const transferAmount = BigInt(`0x${data.slice(74)}`);
        const key = this.account.toLowerCase();
        const balance = this.passBalances.get(key) ?? 0n;
        if (transferAmount > balance) throw new Error('DEV_FIXTURE_INSUFFICIENT_PASS_BALANCE');
        this.passBalances.set(key, balance - transferAmount);
      }
      return TX_HASH;
    }
    if (input.method === 'eth_call') {
      const call = input.params?.[0] as { readonly data?: unknown; readonly to?: unknown } | undefined;
      const data = String(call?.data ?? '');
      const target = asAddress(String(call?.to));
      const secondVault = sameAddress(target, SECOND_VAULT);
      if (data === encodeM3VaultCall('owner()', [])) return addressResult(secondVault ? SECOND_OWNER : OWNER);
      if (data === encodeM3VaultCall('strategyCreator()', []))
        return addressResult(vaultSnapshot.state.strategyCreator);
      if (data === encodeM3VaultCall('strategyId()', [])) return STRATEGY_ID;
      if (data === encodeM3VaultCall('strategyRef()', [])) return STRATEGY_REF;
      if (data === encodeM3VaultCall('pass()', [])) return addressResult(PASS);
      if (data === encodeM3VaultCall('afUsdc()', [])) return addressResult(AF_USDC);
      if (data === encodeM3VaultCall('afEth()', [])) return addressResult(AF_ETH);
      if (data === encodeM3VaultCall('afBtc()', [])) return addressResult(AF_BTC);
      if (data === encodeM3VaultCall('passLocker()', []))
        return addressResult(
          secondVault ? secondVaultSnapshot.state.passLocker : vaultSnapshot.state.passLocker,
        );
      if (data === encodeM3VaultCall('closed()', []))
        return uintResult(this.closedVaults.has(target.toLowerCase()) ? 1n : 0n);
      if (
        data === encodeM3VaultCall('principalBasis()', []) ||
        data === encodeM3VaultCall('trackedUsdcBalance()', []) ||
        data === encodeM3VaultCall('realizedProfit()', []) ||
        data === encodeM3VaultCall('withdrawableUsdc()', []) ||
        data === encodeM3VaultCall('openTrackedPositionCount()', []) ||
        data.startsWith(encodeM3VaultCall('trackedPosition(address)', [AF_ETH]).slice(0, 10))
      )
        return uintResult(0n);
      if (data.startsWith('0xdd62ed3e')) {
        const spender = asAddress(`0x${data.slice(-40)}`);
        const allowances = sameAddress(target, AF_USDC) ? this.usdcAllowances : this.passAllowances;
        return uintResult(allowances.get(spender.toLowerCase()) ?? 0n);
      }
      if (data.startsWith('0x70a08231') && sameAddress(target, PASS)) {
        const owner = asAddress(`0x${data.slice(-40)}`);
        return uintResult(this.passBalances.get(owner.toLowerCase()) ?? 0n);
      }
      return '0x';
    }
    throw new Error('DEV_FIXTURE_PROVIDER_METHOD_UNSUPPORTED');
  }
}

const pendingEvidence = (): ProductOperationEvidence => ({
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

class DevVaultReader implements M3VaultReader {
  readonly snapshot: M3VaultSnapshot;
  degraded = false;
  closed = false;
  evidence = pendingEvidence();
  operationId: string | null = null;
  owner: Address | null = null;

  constructor(snapshot: M3VaultSnapshot) {
    this.snapshot = snapshot;
  }

  async readSnapshot(owner: Address): Promise<M3VaultSnapshot> {
    if (this.degraded || !sameAddress(owner, this.snapshot.owner))
      throw new Error('DEV_FIXTURE_PROJECTION_UNAVAILABLE');
    return Object.freeze({
      ...this.snapshot,
      state: Object.freeze({ ...this.snapshot.state, closed: this.closed }),
    });
  }

  async registerSubmission(input: Parameters<NonNullable<M3VaultReader['registerSubmission']>>[0]) {
    this.operationId = input.operationId;
    this.owner = input.owner;
    this.evidence = pendingEvidence();
    return Object.freeze({ state: 'SUBMITTED' as const });
  }

  async readOperationEvidence(operationId: string, owner: Address): Promise<ProductOperationEvidence> {
    if (
      !this.operationId ||
      !this.owner ||
      operationId !== this.operationId ||
      !sameAddress(owner, this.owner)
    )
      throw new Error('DEV_FIXTURE_OPERATION_NOT_FOUND');
    return this.evidence;
  }
}

export interface M3InjectedRuntimeFixture {
  readonly runtime: M3SelectableProductRuntime;
  readonly providerRequests: readonly Eip1193Request[];
  setCorrectNetwork(): void;
  setWrongNetwork(): Promise<void>;
  setOwner(): Promise<void>;
  setSecondOwner(): Promise<void>;
  setNonOwner(): Promise<void>;
  selectFirstVault(): Promise<void>;
  selectSecondVault(): Promise<void>;
  setSoftReady(): Promise<void>;
  setReorged(): Promise<void>;
  setDegraded(): Promise<void>;
  setClosed(): Promise<void>;
}

export function createM3InjectedRuntimeFixture(): M3InjectedRuntimeFixture {
  const provider = new DevProvider();
  const reader = new DevVaultReader(vaultSnapshot);
  const secondReader = new DevVaultReader(secondVaultSnapshot);
  const readers = new Map<string, DevVaultReader>([
    [VAULT.toLowerCase(), reader],
    [SECOND_VAULT.toLowerCase(), secondReader],
  ]);
  const runtime = createM3BrowserRuntimeSet({
    provider,
    deployments: [deployment, secondDeployment],
    vaultReader: (item) => readers.get(item.vaultAddress.toLowerCase())!,
    transportProvenance: 'DEV_MOCK',
    now: () => '2026-09-20T00:00:00.000Z',
  });
  const currentReader = () => readers.get(runtime.vaultSelection.selected.vaultAddress.toLowerCase())!;
  return Object.freeze({
    runtime,
    providerRequests: provider.requests,
    setCorrectNetwork: () => {
      provider.chainId = 46_630;
    },
    setWrongNetwork: async () => {
      provider.chainId = 1;
      await runtime.refresh();
    },
    setOwner: async () => {
      provider.account = OWNER;
      await runtime.refresh();
    },
    setSecondOwner: async () => {
      provider.account = SECOND_OWNER;
      await runtime.refresh();
    },
    setNonOwner: async () => {
      provider.account = NON_OWNER;
      await runtime.refresh();
    },
    selectFirstVault: () => runtime.selectVault({ chainId: 46_630, vaultAddress: VAULT }),
    selectSecondVault: () => runtime.selectVault({ chainId: 46_630, vaultAddress: SECOND_VAULT }),
    setSoftReady: async () => {
      const selected = currentReader();
      selected.degraded = false;
      selected.evidence = {
        lifecycle: 'CONFIRMED',
        receipt: 'SUCCESS',
        receiptCanonical: true,
        confirmations: 3,
        reconciliation: 'MATCHED',
        projection: 'READY',
        chainStatus: 'SOFT_READY',
        l1Status: 'UNKNOWN',
        finalityStatus: 'UNKNOWN',
        indexerStatus: 'HEALTHY',
        degradedReason: null,
        productReady: true,
      };
      await runtime.refresh();
    },
    setReorged: async () => {
      const selected = currentReader();
      selected.degraded = false;
      selected.evidence = {
        ...pendingEvidence(),
        lifecycle: 'REORGED',
        chainStatus: 'REORGED',
      };
      await runtime.refresh();
    },
    setDegraded: async () => {
      const selected = currentReader();
      selected.degraded = true;
      selected.evidence = {
        lifecycle: 'CONFIRMED',
        receipt: 'SUCCESS',
        receiptCanonical: true,
        confirmations: 3,
        reconciliation: 'MATCHED',
        projection: 'PENDING',
        chainStatus: 'UNKNOWN',
        l1Status: 'UNKNOWN',
        finalityStatus: 'UNKNOWN',
        indexerStatus: 'DEGRADED',
        degradedReason: 'CHAIN_REORG_DEPTH_EXCEEDED',
        productReady: false,
      };
      await runtime.refresh();
    },
    setClosed: async () => {
      const selected = currentReader();
      provider.closedVaults.add(runtime.vaultSelection.selected.vaultAddress.toLowerCase());
      selected.closed = true;
      await runtime.refresh();
    },
  });
}

export function installM3InjectedRuntimeControls(fixture: M3InjectedRuntimeFixture): void {
  const main = document.querySelector('main');
  if (!main || document.querySelector('[data-m3-fixture-controls]')) return;
  const controls = document.createElement('section');
  controls.className = 'wrap dialog-notice';
  controls.setAttribute('data-m3-fixture-controls', '');
  controls.innerHTML =
    '<strong>DEV TRANSPORT MOCK / PRODUCTION RUNTIME / NO REAL RIGHTS OR FUNDS / NO BROADCAST</strong><div class="inline-actions"><button data-m3-fixture="network">Use correct network</button><button data-m3-fixture="wrong-network">Use wrong network</button><button data-m3-fixture="vault-a">Select Vault A</button><button data-m3-fixture="vault-b">Select Vault B</button><button data-m3-fixture="owner">Use owner A wallet</button><button data-m3-fixture="owner-b">Use owner B wallet</button><button data-m3-fixture="non-owner">Use non-owner wallet</button><button data-m3-fixture="soft-ready">Soft ready</button><button data-m3-fixture="reorg">Reorg</button><button data-m3-fixture="degraded">Indexer degraded</button><button data-m3-fixture="closed">Close Vault state</button></div>';
  controls.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-m3-fixture]');
    if (!button) return;
    if (button.dataset.m3Fixture === 'network') fixture.setCorrectNetwork();
    else if (button.dataset.m3Fixture === 'wrong-network') void fixture.setWrongNetwork();
    else if (button.dataset.m3Fixture === 'vault-a') void fixture.selectFirstVault();
    else if (button.dataset.m3Fixture === 'vault-b') void fixture.selectSecondVault();
    else if (button.dataset.m3Fixture === 'owner') void fixture.setOwner();
    else if (button.dataset.m3Fixture === 'owner-b') void fixture.setSecondOwner();
    else if (button.dataset.m3Fixture === 'non-owner') void fixture.setNonOwner();
    else if (button.dataset.m3Fixture === 'soft-ready') void fixture.setSoftReady();
    else if (button.dataset.m3Fixture === 'reorg') void fixture.setReorged();
    else if (button.dataset.m3Fixture === 'degraded') void fixture.setDegraded();
    else if (button.dataset.m3Fixture === 'closed') void fixture.setClosed();
  });
  main.before(controls);
}

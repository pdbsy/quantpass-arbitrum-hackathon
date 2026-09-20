import { ChainStore } from './chain-store.ts';
import { ChainSynchronizer } from './chain-sync.ts';
import type { ChainSyncResult } from './chain-sync.ts';
import { M3_VAULT_PROJECTION_KEY, M3VaultContractIntegration } from './m3-vault-integration.ts';
import { M3_PASS_PROJECTION_KEY, M3StrategyPassContractIntegration } from './m3-pass-integration.ts';
import {
  createOperation,
  transitionOperation,
  type ChainOperation,
} from '../../../packages/chain-adapter/src/lifecycle.ts';
import type { DeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import { validateDeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import { m3ChainSyncPolicy, type ChainSyncPolicy } from '../../../packages/chain-adapter/src/policy.ts';
import { JsonRpcClient, type ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import { keccak256 } from '../../../packages/chain-adapter/src/keccak.ts';
import {
  decodeM3StrategyPassCalldata,
  M3_STRATEGY_PASS_ABI_HASH,
} from '../../../packages/chain-adapter/src/pass-abi.ts';
import {
  decodeM3VaultCalldata,
  M3_VAULT_ABI_HASH,
  M3_VAULT_ABI_VERSION,
} from '../../../packages/chain-adapter/src/vault-abi.ts';
import {
  sameAddress,
  type Address,
  type BlockHash,
  type HexData,
  type TransactionHash,
} from '../../../packages/chain-adapter/src/types.ts';
import type { ChainEvidenceRoutesOptions } from './chain-routes.ts';

export interface ObservedWalletSubmission {
  readonly operationId: string;
  readonly chainId: number;
  readonly owner: Address;
  readonly target: Address;
  readonly calldata: HexData;
  readonly txHash: TransactionHash;
}

export interface M3ChainRuntimeDependencies {
  readonly createRpc?: (endpoints: readonly string[]) => ReadonlyRpc;
}

export interface M3RuntimeSyncResult extends ChainSyncResult {
  readonly trackedOperations: number;
  readonly trackingFailures: number;
}

export type M3ChainRuntimeDeployment =
  | { readonly deploymentStatus: 'NOT_DEPLOYED' }
  | {
      readonly deploymentStatus: 'DEPLOYED';
      readonly dbPath: string;
      readonly rpcEndpoints: readonly string[];
      readonly manifestDocument: unknown;
      readonly expectedManifestDigest: BlockHash;
      readonly expectedContractAddress: Address;
      readonly policy?: ChainSyncPolicy;
      readonly maxBlocksPerSync?: number;
      readonly now?: () => string;
    };

function assertM3VaultManifest(manifest: DeploymentManifest): void {
  if (
    manifest.contractName !== 'AlphaForgeVault' ||
    manifest.contractType !== 'vault' ||
    manifest.abiVersion !== M3_VAULT_ABI_VERSION ||
    manifest.abiHash.toLowerCase() !== M3_VAULT_ABI_HASH.toLowerCase() ||
    manifest.strategyPassAbiHash.toLowerCase() !== M3_STRATEGY_PASS_ABI_HASH.toLowerCase()
  )
    throw new Error('M3_VAULT_ABI_MISMATCH');
}

export class M3ChainRuntime {
  readonly store: ChainStore;
  readonly synchronizer: ChainSynchronizer;
  readonly passSynchronizer: ChainSynchronizer;
  readonly manifest: DeploymentManifest;
  readonly chainEvidence: ChainEvidenceRoutesOptions;
  #closed = false;
  #lastSyncAttempt: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' = 'NOT_RUN';
  readonly #now: () => string;
  readonly #maxBlocksPerSync: number;
  readonly #rpc: ReadonlyRpc;
  #deploymentVerified = false;
  #vaultOperationCursor: string | null = null;
  #passOperationCursor: string | null = null;

  constructor(options: {
    readonly dbPath: string;
    readonly rpc: ReadonlyRpc;
    readonly manifest: DeploymentManifest;
    readonly policy?: ChainSyncPolicy;
    readonly maxBlocksPerSync?: number;
    readonly now?: () => string;
  }) {
    assertM3VaultManifest(options.manifest);
    const policy = m3ChainSyncPolicy(options.policy);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#rpc = options.rpc;
    this.#maxBlocksPerSync = options.maxBlocksPerSync ?? 2_000;
    this.manifest = options.manifest;
    this.store = new ChainStore(options.dbPath);
    try {
      this.synchronizer = new ChainSynchronizer({
        rpc: options.rpc,
        store: this.store,
        manifest: options.manifest,
        integration: new M3VaultContractIntegration(),
        policy,
        ...(options.maxBlocksPerSync === undefined ? {} : { maxBlocksPerSync: options.maxBlocksPerSync }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      const passManifest = Object.freeze({
        ...options.manifest,
        contractName: 'StrategyPass',
        contractType: 'strategy-pass',
        contractAddress: options.manifest.strategyPassAddress,
        deploymentBlock: options.manifest.strategyPassDeploymentBlock,
        abiVersion: 'm3-strategy-pass-2ad8162',
        abiHash: options.manifest.strategyPassAbiHash,
        runtimeBytecodeHash: options.manifest.strategyPassRuntimeBytecodeHash,
      }) as DeploymentManifest;
      this.passSynchronizer = new ChainSynchronizer({
        rpc: options.rpc,
        store: this.store,
        manifest: passManifest,
        integration: new M3StrategyPassContractIntegration(),
        policy,
        ...(options.maxBlocksPerSync === undefined ? {} : { maxBlocksPerSync: options.maxBlocksPerSync }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    } catch (error) {
      this.store.close();
      throw error;
    }
    this.chainEvidence = Object.freeze({
      store: this.store,
      chainId: options.manifest.chainId,
      contract: options.manifest.contractAddress,
      projectionKey: M3_VAULT_PROJECTION_KEY,
      passContract: options.manifest.strategyPassAddress,
      passProjectionKey: M3_PASS_PROJECTION_KEY,
      syncStatus: () => ({
        lastAttempt: this.#lastSyncAttempt,
        errorCode: this.#lastSyncAttempt === 'FAILED' ? ('M3_INDEXER_SYNC_FAILED' as const) : null,
        database: this.store.health(),
        deployment: {
          chainId: this.manifest.chainId,
          contract: this.manifest.contractAddress,
          manifestDigest: this.manifest.manifestDigest,
          abiHash: this.manifest.abiHash,
          runtimeBytecodeHash: this.manifest.runtimeBytecodeHash,
          strategyPassAddress: this.manifest.strategyPassAddress,
          strategyPassAbiHash: this.manifest.strategyPassAbiHash,
          strategyPassRuntimeBytecodeHash: this.manifest.strategyPassRuntimeBytecodeHash,
        },
      }),
      recordSubmission: (input: ObservedWalletSubmission) => this.recordSubmission(input),
    });
  }

  recordSubmission(input: ObservedWalletSubmission): ChainOperation {
    if (
      input.chainId !== this.manifest.chainId ||
      !(
        (sameAddress(input.target, this.manifest.contractAddress) && decodeM3VaultCalldata(input.calldata)) ||
        (sameAddress(input.target, this.manifest.strategyPassAddress) &&
          decodeM3StrategyPassCalldata(input.calldata))
      )
    )
      throw new Error('INVALID_M3_WALLET_SUBMISSION');
    const existing = this.store.operation(input.operationId);
    if (existing) {
      if (
        existing.chainId !== input.chainId ||
        existing.txHash?.toLowerCase() !== input.txHash.toLowerCase() ||
        !sameAddress(existing.owner, input.owner) ||
        !sameAddress(existing.target, input.target) ||
        existing.calldata?.toLowerCase() !== input.calldata.toLowerCase()
      )
        throw new Error('OPERATION_IDENTITY_CONFLICT');
      return existing;
    }
    const transaction = this.store.operationByTransaction(input.chainId, input.txHash);
    if (transaction) throw new Error('OPERATION_IDENTITY_CONFLICT');
    const operation = transitionOperation(
      createOperation({
        operationId: input.operationId,
        chainId: input.chainId,
        owner: input.owner,
        target: input.target,
        calldata: input.calldata,
        state: 'AWAITING_SIGNATURE',
      }),
      { state: 'SUBMITTED', txHash: input.txHash, submittedAt: this.#now() },
    );
    this.store.saveOperation(operation);
    return operation;
  }

  async syncToHead(): Promise<M3RuntimeSyncResult> {
    try {
      const result = await this.#syncToHead();
      this.#lastSyncAttempt = 'SUCCEEDED';
      return result;
    } catch (error) {
      this.#lastSyncAttempt = 'FAILED';
      throw error;
    }
  }

  async #syncToHead(): Promise<M3RuntimeSyncResult> {
    if (!this.#deploymentVerified) {
      if ((await this.#rpc.chainId()) !== this.manifest.chainId)
        throw new Error('M3_DEPLOYMENT_CHAIN_MISMATCH');
      const code = await this.#rpc.code(this.manifest.contractAddress, 'latest');
      if (code === '0x' || keccak256(code).toLowerCase() !== this.manifest.runtimeBytecodeHash.toLowerCase())
        throw new Error('M3_DEPLOYMENT_CODE_MISMATCH');
      const passCode = await this.#rpc.code(this.manifest.strategyPassAddress, 'latest');
      if (
        passCode === '0x' ||
        keccak256(passCode).toLowerCase() !== this.manifest.strategyPassRuntimeBytecodeHash.toLowerCase()
      )
        throw new Error('M3_STRATEGY_PASS_CODE_MISMATCH');
      this.#deploymentVerified = true;
    }
    const head = await this.synchronizer.head();
    const syncContract = async (
      synchronizer: ChainSynchronizer,
      contract: Address,
      deploymentBlock: bigint,
    ) => {
      const checkpoint = this.store.checkpoint(this.manifest.chainId, contract);
      const start = checkpoint ? checkpoint.blockNumber + 1n : deploymentBlock;
      const boundedHead =
        start <= head.number
          ? start + BigInt(this.#maxBlocksPerSync) - 1n < head.number
            ? start + BigInt(this.#maxBlocksPerSync) - 1n
            : head.number
          : head.number;
      return Object.freeze({
        result: await synchronizer.syncTo(boundedHead, head.number),
        caughtUp: boundedHead >= head.number,
      });
    };
    const vaultSync = await syncContract(
      this.synchronizer,
      this.manifest.contractAddress,
      this.manifest.deploymentBlock,
    );
    const passSync = await syncContract(
      this.passSynchronizer,
      this.manifest.strategyPassAddress,
      this.manifest.strategyPassDeploymentBlock,
    );
    const result: ChainSyncResult = Object.freeze({
      scannedBlocks: Math.max(vaultSync.result.scannedBlocks, passSync.result.scannedBlocks),
      insertedEvents: vaultSync.result.insertedEvents + passSync.result.insertedEvents,
      reorgedBlocks: vaultSync.result.reorgedBlocks + passSync.result.reorgedBlocks,
    });
    if (!vaultSync.caughtUp || !passSync.caughtUp)
      return Object.freeze({ ...result, trackedOperations: 0, trackingFailures: 0 });
    const vaultOperations = this.store.trackableOperationIds(
      this.manifest.chainId,
      this.manifest.contractAddress,
      100,
      this.#vaultOperationCursor,
    );
    const passOperations = this.store.trackableOperationIds(
      this.manifest.chainId,
      this.manifest.strategyPassAddress,
      100,
      this.#passOperationCursor,
    );
    const operations: Array<
      Readonly<{ operationId: string; synchronizer: ChainSynchronizer; target: Address }>
    > = [];
    for (let index = 0; operations.length < 100; index++) {
      const vaultOperation = vaultOperations[index];
      const passOperation = passOperations[index];
      if (vaultOperation)
        operations.push({
          operationId: vaultOperation,
          synchronizer: this.synchronizer,
          target: this.manifest.contractAddress,
        });
      if (operations.length < 100 && passOperation)
        operations.push({
          operationId: passOperation,
          synchronizer: this.passSynchronizer,
          target: this.manifest.strategyPassAddress,
        });
      if (!vaultOperation && !passOperation) break;
    }
    let trackingFailures = 0;
    let lastVaultOperation: string | null = null;
    let lastPassOperation: string | null = null;
    for (const operation of operations) {
      try {
        await operation.synchronizer.trackOperation(operation.operationId, head);
      } catch {
        trackingFailures++;
      }
      if (sameAddress(operation.target, this.manifest.contractAddress))
        lastVaultOperation = operation.operationId;
      else lastPassOperation = operation.operationId;
    }
    if (lastVaultOperation) this.#vaultOperationCursor = lastVaultOperation;
    if (lastPassOperation) this.#passOperationCursor = lastPassOperation;
    return Object.freeze({ ...result, trackedOperations: operations.length, trackingFailures });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.store.close();
  }
}

export function composeM3ChainRuntime(
  input: M3ChainRuntimeDeployment,
  dependencies: M3ChainRuntimeDependencies = {},
): M3ChainRuntime | null {
  if (input.deploymentStatus === 'NOT_DEPLOYED') return null;
  const manifest = validateDeploymentManifest(input.manifestDocument, {
    environment: 'robinhood-chain-testnet',
    chainId: 46_630,
    manifestDigest: input.expectedManifestDigest,
    contractAddress: input.expectedContractAddress,
  });
  assertM3VaultManifest(manifest);
  const rpc = dependencies.createRpc
    ? dependencies.createRpc(input.rpcEndpoints)
    : new JsonRpcClient(input.rpcEndpoints);
  return new M3ChainRuntime({
    dbPath: input.dbPath,
    rpc,
    manifest,
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.maxBlocksPerSync === undefined ? {} : { maxBlocksPerSync: input.maxBlocksPerSync }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

import { verifiedOwnerRevert } from '../../../packages/testnet/src/failed-owner-transaction.ts';
import { randomUUID, createHash } from 'node:crypto';
import { ChainStore } from './chain-store.ts';
import { ChainSynchronizer } from './chain-sync.ts';
import { TradingVaultContractIntegration, TRADING_PROJECTION_KEY } from './trading-vault-integration.ts';
import type { DeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import type { ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import { m3ChainSyncPolicy } from '../../../packages/chain-adapter/src/policy.ts';
import { createOperation, transitionOperation } from '../../../packages/chain-adapter/src/lifecycle.ts';
import { asAddress, asHexData, asTransactionHash } from '../../../packages/chain-adapter/src/types.ts';
import type { TradingInventory } from '../../../packages/testnet/src/trading-inventory.ts';
import type { TradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import { readTradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import { ownerAction } from '../../../packages/testnet/src/owner-actions.ts';
import { walletAddress } from '../../../packages/testnet/src/wallet-auth.ts';
import { tradingPerformance } from '../../../packages/testnet/src/trading-performance.ts';
import { EvidenceJournal } from '../../../packages/testnet/src/evidence-journal.ts';

/** Read-only indexing and owner intent observation. This class contains no signer or broadcast transport. */
export class TradingChainRuntime {
  readonly store: ChainStore;
  readonly manifest: DeploymentManifest;
  readonly inventory: TradingInventory;
  readonly synchronizer: ChainSynchronizer;
  readonly rpc: ReadonlyRpc;
  readonly evidence: EvidenceJournal;
  #state: 'NOT_RUN' | 'SYNCING' | 'HEALTHY' | 'DEGRADED' = 'NOT_RUN';
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #operationCursor: string | null = null;
  #writesPaused = false;
  #writeEpoch = 0;
  constructor(options: {
    dbPath: string;
    evidencePath: string;
    manifest: DeploymentManifest;
    inventory: TradingInventory;
    rpc: ReadonlyRpc;
  }) {
    this.manifest = options.manifest;
    this.inventory = options.inventory;
    this.rpc = options.rpc;
    this.store = new ChainStore(options.dbPath);
    let evidence: EvidenceJournal | undefined;
    try {
      evidence = new EvidenceJournal(
        options.evidencePath,
        '0x' +
          createHash('sha256')
            .update(
              JSON.stringify({
                manifestDigest: options.manifest.manifestDigest,
                inventory: options.inventory,
              }),
            )
            .digest('hex'),
      );
      this.evidence = evidence;
      this.synchronizer = new ChainSynchronizer({
        store: this.store,
        rpc: options.rpc,
        manifest: options.manifest,
        integration: new TradingVaultContractIntegration(options.inventory),
        policy: m3ChainSyncPolicy(),
      });
    } catch (error) {
      try {
        this.store.close();
      } finally {
        evidence?.close();
      }
      throw error;
    }
  }
  pauseWrites() {
    if (this.#writesPaused || this.#closed) throw new Error('TRADING_WRITES_PAUSED');
    this.#writesPaused = true;
    ++this.#writeEpoch;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.#writesPaused = false;
        ++this.#writeEpoch;
      }
    };
  }
  private assertWritable() {
    if (this.#writesPaused || this.#closed) throw new Error('TRADING_WRITES_PAUSED');
  }
  status() {
    return this.#state;
  }
  syncToHead(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error('TRADING_RUNTIME_CLOSED'));
    const next = this.#tail.then(async () => {
      this.#state = 'SYNCING';
      try {
        const head = await this.synchronizer.head();
        // Qualify the deployed identities before historical indexing or publication.
        await readTradingSnapshot(this.rpc, this.manifest, this.inventory, head);
        const checkpoint = this.store.checkpoint(46630, this.manifest.contractAddress);
        const start = checkpoint ? checkpoint.blockNumber + 1n : this.manifest.deploymentBlock;
        const target = start + 1999n < head.number ? start + 1999n : head.number;
        await this.synchronizer.syncTo(target, head.number);
        if (target < head.number) {
          this.#state = 'SYNCING';
          return;
        }
        for (const id of this.store.trackableOperationIds(
          46630,
          this.manifest.contractAddress,
          100,
          this.#operationCursor,
        )) {
          await this.synchronizer.trackOperation(id, head);
          this.#operationCursor = id;
        }
        this.#state = 'HEALTHY';
        const view = this.ownedView(this.inventory.owner);
        if (view.snapshot)
          this.evidence.append(
            view.snapshot,
            this.store.canonicalEvents(46630, this.manifest.contractAddress),
            Date.now(),
          );
      } catch (error) {
        this.#state = 'DEGRADED';
        throw new Error('TRADING_SYNC_FAILED', { cause: error });
      }
    });
    this.#tail = next.catch(() => {});
    return next;
  }
  ownedView(address: string) {
    if (walletAddress(address) !== this.inventory.owner) throw new Error('TRADING_OWNER_REQUIRED');
    if (this.#closed || this.#state !== 'HEALTHY')
      return { status: this.#state, snapshot: null, performance: null };
    const projection = this.store.projection(
      46630,
      asAddress(this.inventory.owner),
      this.manifest.contractAddress,
      TRADING_PROJECTION_KEY,
    );
    if (!projection) return { status: 'SYNCING', snapshot: null, performance: null };
    const snapshot = projection.state as unknown as TradingSnapshot;
    if (
      snapshot.owner !== this.inventory.owner ||
      snapshot.vault !== this.manifest.contractAddress ||
      snapshot.manifestDigest !== this.manifest.manifestDigest
    )
      throw new Error('TRADING_PROJECTION_IDENTITY');
    const performance = tradingPerformance(
      this.store.canonicalEvents(46630, this.manifest.contractAddress),
      snapshot.vaultEquity,
    );
    for (const stock of snapshot.stocks) {
      const book = performance.positions.find((p) => p.stock === stock.token);
      if ((book?.quantityRaw ?? '0') !== stock.position)
        throw new Error('TRADING_PERFORMANCE_RECONCILIATION');
    }
    return { status: 'HEALTHY', snapshot, performance };
  }
  prepareOwnerAction(address: string, input: unknown) {
    this.assertWritable();
    const view = this.ownedView(address),
      snapshot = view.snapshot;
    if (!snapshot) throw new Error('TRADING_NOT_READY');
    const transaction = ownerAction(
      {
        owner: this.inventory.owner,
        vault: this.manifest.contractAddress,
        pass: this.manifest.strategyPassAddress,
        usdc: this.inventory.usdc,
        blockTimestamp: snapshot.blockTimestamp,
        stocks: this.inventory.stocks.map((s) => s.token),
        stateVersion: snapshot.stateVersion,
      },
      input,
    );
    const tracked = transaction.to === this.manifest.contractAddress;
    const operationId = randomUUID();
    if (tracked)
      this.store.saveOperation(
        createOperation({
          operationId,
          chainId: 46630,
          owner: asAddress(address),
          target: this.manifest.contractAddress,
          calldata: asHexData(transaction.data),
          state: 'AWAITING_SIGNATURE',
        }),
      );
    return Object.freeze({
      operationId: tracked ? operationId : null,
      transaction,
      manifestDigest: this.manifest.manifestDigest,
      snapshotHash: snapshot.blockHash,
      requiresOwnerWallet: true,
    });
  }
  async observeOwnerSubmission(address: string, id: string, hash: string) {
    this.assertWritable();
    const epoch = this.#writeEpoch;
    if (walletAddress(address) !== this.inventory.owner) throw new Error('TRADING_OWNER_REQUIRED');
    const operation = this.store.operation(id),
      txHash = asTransactionHash(hash);
    if (
      !operation ||
      operation.owner.toLowerCase() !== this.inventory.owner ||
      operation.target !== this.manifest.contractAddress
    )
      throw new Error('TRADING_OPERATION_REQUIRED');
    if (operation.txHash) {
      if (operation.txHash !== txHash) throw new Error('TRADING_SUBMISSION_CONFLICT');
      return this.operationView(address, id);
    }
    if (!this.rpc.transaction) throw new Error('TRADING_TRANSACTION_LOOKUP_REQUIRED');
    const tx = await this.rpc.transaction(txHash);
    this.assertWritable();
    if (epoch !== this.#writeEpoch) throw new Error('TRADING_WRITES_PAUSED');
    if (
      tx &&
      (tx.chainId !== 46630 ||
        tx.from.toLowerCase() !== this.inventory.owner ||
        tx.to?.toLowerCase() !== this.manifest.contractAddress ||
        tx.data.toLowerCase() !== operation.calldata?.toLowerCase() ||
        tx.value !== 0n)
    )
      throw new Error('TRADING_TRANSACTION_MISMATCH');
    this.store.saveOperation(
      transitionOperation(operation, { state: 'SUBMITTED', txHash, submittedAt: new Date().toISOString() }),
    );
    return this.operationView(address, id);
  }
  operationView(address: string, id: string) {
    if (walletAddress(address) !== this.inventory.owner) throw new Error('TRADING_OWNER_REQUIRED');
    const op = this.store.operation(id);
    if (!op || op.owner.toLowerCase() !== this.inventory.owner) throw new Error('TRADING_OPERATION_REQUIRED');
    return Object.freeze({
      ...op,
      blockNumber: op.blockNumber === null ? null : String(op.blockNumber),
      finality: 'L2_SOFT_CONFIRMATIONS_ONLY',
      l1Finality: 'UNKNOWN',
      productReady: op.state === 'CONFIRMED' && op.canonical && op.reconciled && this.#state === 'HEALTHY',
    });
  }
  async verifiedFailure(address: string, id: string) {
    this.operationView(address, id);
    if (this.#state !== 'HEALTHY') return false;
    return verifiedOwnerRevert(this.rpc, this.store.operation(id)!);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#tail;
    try {
      this.store.close();
    } finally {
      this.evidence.close();
    }
  }
}

import { asAddress, sameAddress, type Address } from '../../../packages/chain-adapter/src/types.ts';
import type { WalletSubmission } from './chain-wallet.ts';
import {
  createM3BrowserRuntime,
  type M3BrowserDeploymentConfig,
  type M3BrowserRuntimeOptions,
  type M3VaultReader,
} from './m3-browser-runtime.ts';
import type {
  M3DepositApprovalKind,
  M3DepositApprovalReview,
  M3PassTransferRequest,
  M3PassTransferReview,
  M3ProductActionRequest,
  M3ProductActionReview,
  M3ProductRuntime,
  M3SelectableProductRuntime,
  M3VaultSelection,
  M3VaultSelectionState,
} from './m3-product-runtime.ts';

export interface M3BrowserRuntimeSetOptions extends Omit<
  M3BrowserRuntimeOptions,
  'deployment' | 'vaultReader'
> {
  readonly deployments: readonly M3BrowserDeploymentConfig[];
  readonly vaultReader?: (deployment: M3BrowserDeploymentConfig) => M3VaultReader;
}

interface RuntimeEntry {
  readonly selection: M3VaultSelection;
  readonly runtime: M3ProductRuntime;
}

interface ReviewBinding {
  readonly runtime: M3ProductRuntime;
  readonly generation: number;
}

function selectionKey(chainId: number, vaultAddress: Address): string {
  return `${chainId}:${vaultAddress.toLowerCase()}`;
}

class M3BrowserRuntimeSet implements M3SelectableProductRuntime {
  readonly #entries: readonly RuntimeEntry[];
  readonly #listeners = new Set<() => void>();
  readonly #reviews = new WeakMap<object, ReviewBinding>();
  #selected: RuntimeEntry;
  #generation = 0;

  constructor(options: M3BrowserRuntimeSetOptions) {
    if (options.deployments.length === 0) throw new Error('INVALID_M3_DEPLOYMENT_SET');
    const keys = new Set<string>();
    const entries = options.deployments.map((deployment) => {
      const vaultAddress = asAddress(deployment.vaultAddress);
      const selection = Object.freeze({ chainId: deployment.chainId, vaultAddress });
      const key = selectionKey(selection.chainId, selection.vaultAddress);
      if (keys.has(key)) throw new Error('DUPLICATE_M3_VAULT_SELECTION');
      keys.add(key);
      const reader = options.vaultReader?.(deployment);
      const runtime = createM3BrowserRuntime({
        ...(options.provider ? { provider: options.provider } : {}),
        deployment,
        ...(reader ? { vaultReader: reader } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.transportProvenance ? { transportProvenance: options.transportProvenance } : {}),
      });
      return Object.freeze({ selection, runtime });
    });
    this.#entries = Object.freeze(entries);
    this.#selected = entries[0]!;
    for (const entry of entries)
      entry.runtime.subscribe(() => {
        if (entry === this.#selected) this.#publish();
      });
  }

  get snapshot() {
    return Object.freeze({
      ...this.#selected.runtime.snapshot,
      vaultSelection: this.vaultSelection,
    });
  }

  get vaultSelection(): M3VaultSelectionState {
    return Object.freeze({
      selected: this.#selected.selection,
      options: Object.freeze(this.#entries.map((entry) => entry.selection)),
    });
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }

  #bind<T extends object>(review: T, binding: ReviewBinding): T {
    if (binding.generation !== this.#generation || binding.runtime !== this.#selected.runtime)
      throw new Error('M3_VAULT_SELECTION_CHANGED');
    this.#reviews.set(review, binding);
    return review;
  }

  #consume<T extends object>(review: T, invalidCode: string): M3ProductRuntime {
    const binding = this.#reviews.get(review);
    this.#reviews.delete(review);
    if (!binding) throw new Error(invalidCode);
    if (binding.generation !== this.#generation || binding.runtime !== this.#selected.runtime)
      throw new Error('M3_VAULT_SELECTION_CHANGED');
    return binding.runtime;
  }

  async selectVault(selection: M3VaultSelection): Promise<void> {
    const vaultAddress = asAddress(selection.vaultAddress);
    const next = this.#entries.find(
      (entry) =>
        entry.selection.chainId === selection.chainId &&
        sameAddress(entry.selection.vaultAddress, vaultAddress),
    );
    if (!next) throw new Error('M3_VAULT_SELECTION_NOT_ALLOWLISTED');
    if (next !== this.#selected) {
      this.#selected = next;
      this.#generation += 1;
    }
    await next.runtime.refresh();
    this.#publish();
  }

  connect(): Promise<void> {
    return this.#selected.runtime.connect();
  }

  refresh(): Promise<void> {
    return this.#selected.runtime.refresh();
  }

  async reviewAction(request: M3ProductActionRequest): Promise<M3ProductActionReview> {
    const binding = { runtime: this.#selected.runtime, generation: this.#generation };
    return this.#bind(await binding.runtime.reviewAction(request), binding);
  }

  async confirmAction(review: M3ProductActionReview): Promise<WalletSubmission> {
    return this.#consume(review, 'INVALID_PRODUCT_REVIEW').confirmAction(review);
  }

  async reviewPassTransfer(request: M3PassTransferRequest): Promise<M3PassTransferReview> {
    const binding = { runtime: this.#selected.runtime, generation: this.#generation };
    if (!binding.runtime.reviewPassTransfer) throw new Error('PASS_TRANSFER_UNAVAILABLE');
    return this.#bind(await binding.runtime.reviewPassTransfer(request), binding);
  }

  async confirmPassTransfer(review: M3PassTransferReview): Promise<WalletSubmission> {
    const runtime = this.#consume(review, 'INVALID_PASS_TRANSFER_REVIEW');
    if (!runtime.confirmPassTransfer) throw new Error('PASS_TRANSFER_UNAVAILABLE');
    return runtime.confirmPassTransfer(review);
  }

  async reviewDepositApprovals(
    request: Extract<M3ProductActionRequest, { readonly kind: 'deposit' }>,
  ): Promise<M3DepositApprovalReview> {
    const binding = { runtime: this.#selected.runtime, generation: this.#generation };
    if (!binding.runtime.reviewDepositApprovals) throw new Error('DEPOSIT_APPROVAL_UNAVAILABLE');
    return this.#bind(await binding.runtime.reviewDepositApprovals(request), binding);
  }

  async confirmDepositApproval(
    review: M3DepositApprovalReview,
    kind: M3DepositApprovalKind,
  ): Promise<WalletSubmission> {
    const runtime = this.#consume(review, 'INVALID_DEPOSIT_APPROVAL_REVIEW');
    if (!runtime.confirmDepositApproval) throw new Error('DEPOSIT_APPROVAL_UNAVAILABLE');
    return runtime.confirmDepositApproval(review, kind);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export function createM3BrowserRuntimeSet(options: M3BrowserRuntimeSetOptions): M3SelectableProductRuntime {
  return new M3BrowserRuntimeSet(options);
}

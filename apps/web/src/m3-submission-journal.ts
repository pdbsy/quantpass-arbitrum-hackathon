import {
  asAddress,
  asHexData,
  asTransactionHash,
  sameAddress,
  type Address,
  type HexData,
  type TransactionHash,
} from '../../../packages/chain-adapter/src/types.ts';
import { decodeM3VaultCalldata } from '../../../packages/chain-adapter/src/vault-abi.ts';
import { decodeM3StrategyPassCalldata } from '../../../packages/chain-adapter/src/pass-abi.ts';

export interface SubmissionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface PendingWalletSubmission {
  readonly operationId: string;
  readonly chainId: 46_630;
  readonly owner: Address;
  readonly target: Address;
  readonly calldata: HexData;
  readonly txHash: TransactionHash;
}
interface Context {
  readonly chainId: 46_630;
  readonly manifestDigest: string;
  readonly vaultAddress: Address;
  readonly strategyPassAddress: Address;
}

// A local recovery hint never authorizes a wallet request or supplies chain evidence.
export class M3SubmissionJournal {
  readonly #context: Context;
  readonly #storage: SubmissionStorage;
  constructor(context: Context, storage?: SubmissionStorage) {
    this.#context = context;
    const memory = new Map<string, string>();
    this.#storage =
      storage ??
      (typeof window === 'undefined'
        ? {
            getItem: (key) => memory.get(key) ?? null,
            setItem: (key, value) => {
              memory.set(key, value);
            },
          }
        : window.localStorage);
  }
  #key(owner: Address): string {
    return `alphaforge.m3.submissions.v1:${this.#context.chainId}:${this.#context.vaultAddress.toLowerCase()}:${this.#context.manifestDigest.toLowerCase()}:${owner.toLowerCase()}`;
  }
  read(owner: Address): readonly PendingWalletSubmission[] {
    const raw = this.#storage.getItem(this.#key(owner));
    if (raw === null) return [];
    if (raw.length > 65_536) throw new Error('M3_SUBMISSION_RECOVERY_INVALID');
    try {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values) || values.length > 32) throw new Error();
      const ids = new Set<string>();
      return values.map((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const row = value as Record<string, unknown>;
        if (
          Object.keys(row).sort().join(',') !== 'calldata,chainId,operationId,owner,target,txHash' ||
          typeof row.operationId !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.operationId) ||
          ids.has(row.operationId) ||
          row.chainId !== this.#context.chainId ||
          typeof row.owner !== 'string' ||
          typeof row.target !== 'string' ||
          typeof row.calldata !== 'string' ||
          typeof row.txHash !== 'string'
        )
          throw new Error();
        const parsed = Object.freeze({
          operationId: row.operationId,
          chainId: this.#context.chainId,
          owner: asAddress(row.owner),
          target: asAddress(row.target),
          calldata: asHexData(row.calldata),
          txHash: asTransactionHash(row.txHash),
        });
        if (
          !sameAddress(parsed.owner, owner) ||
          parsed.calldata.length > 138 ||
          !(
            (sameAddress(parsed.target, this.#context.vaultAddress) &&
              decodeM3VaultCalldata(parsed.calldata)) ||
            (sameAddress(parsed.target, this.#context.strategyPassAddress) &&
              decodeM3StrategyPassCalldata(parsed.calldata))
          )
        )
          throw new Error();
        ids.add(parsed.operationId);
        return parsed;
      });
    } catch {
      throw new Error('M3_SUBMISSION_RECOVERY_INVALID');
    }
  }
  assertWritable(owner: Address, target: Address, calldata: HexData): void {
    const pending = this.read(owner);
    if (
      pending.some(
        (item) => sameAddress(item.target, target) && item.calldata.toLowerCase() === calldata.toLowerCase(),
      )
    )
      throw new Error('M3_SUBMISSION_RECOVERY_REQUIRED');
    if (pending.length >= 32) throw new Error('M3_SUBMISSION_RECOVERY_FULL');
    const bytes = JSON.stringify(pending);
    this.#storage.setItem(this.#key(owner), bytes);
    if (this.#storage.getItem(this.#key(owner)) !== bytes)
      throw new Error('M3_SUBMISSION_RECOVERY_UNAVAILABLE');
  }
  record(input: PendingWalletSubmission): void {
    const previous = this.read(input.owner);
    const existing = previous.find((item) => item.operationId === input.operationId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(input))
      throw new Error('M3_SUBMISSION_RECOVERY_INVALID');
    const entries = existing ? previous : [...previous, input];
    if (entries.length > 32) throw new Error('M3_SUBMISSION_RECOVERY_FULL');
    const bytes = JSON.stringify(entries);
    this.#storage.setItem(this.#key(input.owner), bytes);
    if (this.#storage.getItem(this.#key(input.owner)) !== bytes)
      throw new Error('M3_SUBMISSION_RECOVERY_UNAVAILABLE');
  }
  remove(input: PendingWalletSubmission): void {
    const retained = this.read(input.owner).filter((item) => item.operationId !== input.operationId);
    this.#storage.setItem(this.#key(input.owner), JSON.stringify(retained));
  }
}

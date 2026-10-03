import { walletAddress } from '../../../packages/testnet/src/address.ts';

export type TestnetReadPhase = 'DISCONNECTED' | 'LOADING' | 'READY' | 'EMPTY' | 'STALE';
export const testnetIdentityReadError = (error: string | null) =>
  error === 'TESTNET_ACCOUNT_IDENTITY_CHANGED' ||
  error === 'TESTNET_ACCOUNT_IDENTITY_INVALID' ||
  error === 'WALLET_LOGIN_REQUIRED';
const readOwner = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    return walletAddress(value);
  } catch {
    return null;
  }
};
export interface TestnetAccountSnapshot<T> {
  owner: string | null;
  phase: TestnetReadPhase;
  vaults: T[];
  error: string | null;
}
/** Read-only state; a superseded request cannot restore another owner's UI. */
export class TestnetAccountReader<T = { id: string }> {
  #state: TestnetAccountSnapshot<T> = { owner: null, phase: 'DISCONNECTED', vaults: [], error: null };
  #generation = 0;
  #listeners = new Set<(state: TestnetAccountSnapshot<T>) => void>();
  readonly read: () => Promise<unknown>;
  constructor(read: () => Promise<unknown>) {
    this.read = read;
  }
  get snapshot() {
    return structuredClone(this.#state);
  }
  subscribe(listener: (state: TestnetAccountSnapshot<T>) => void) {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #publish(patch: Partial<TestnetAccountSnapshot<T>>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.snapshot);
  }
  connect(owner: string | null) {
    ++this.#generation;
    this.#publish({ owner, vaults: [], error: null, phase: owner ? 'LOADING' : 'DISCONNECTED' });
  }
  async refresh(): Promise<boolean> {
    if (!this.#state.owner) return false;
    const connectedOwner = readOwner(this.#state.owner);
    const generation = ++this.#generation;
    this.#publish({ phase: this.#state.vaults.length ? this.#state.phase : 'LOADING', error: null });
    try {
      const result = (await this.read()) as { owner?: unknown; chainId?: unknown; vaults?: unknown };
      if (generation !== this.#generation) return false;
      const responseOwner = readOwner(result?.owner);
      if (!connectedOwner || !responseOwner) throw new Error('TESTNET_ACCOUNT_IDENTITY_INVALID');
      if (responseOwner !== connectedOwner) throw new Error('TESTNET_ACCOUNT_IDENTITY_CHANGED');
      if (result.chainId !== 46630 || !Array.isArray(result.vaults)) throw new Error('TESTNET_READ_INVALID');
      for (const value of result.vaults) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('TESTNET_ACCOUNT_IDENTITY_INVALID');
        const snapshot = (value as { snapshot?: unknown }).snapshot;
        // Unavailable projections are still bound by the same-request owner envelope.
        if (snapshot === null) continue;
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
          throw new Error('TESTNET_ACCOUNT_IDENTITY_INVALID');
        const snapshotOwner = readOwner((snapshot as { owner?: unknown }).owner);
        if (!snapshotOwner) throw new Error('TESTNET_ACCOUNT_IDENTITY_INVALID');
        if (snapshotOwner !== connectedOwner) throw new Error('TESTNET_ACCOUNT_IDENTITY_CHANGED');
      }
      this.#publish({
        vaults: result.vaults as T[],
        phase: result.vaults.length ? 'READY' : 'EMPTY',
        error: null,
      });
      return true;
    } catch (error) {
      if (generation !== this.#generation) return false;
      const reason = error instanceof Error ? error.message : 'TESTNET_READ_UNAVAILABLE';
      if (testnetIdentityReadError(reason)) {
        ++this.#generation;
        this.#publish({ owner: null, phase: 'DISCONNECTED', vaults: [], error: reason });
        return false;
      }
      this.#publish({
        phase: this.#state.vaults.length ? 'STALE' : 'DISCONNECTED',
        error: reason,
      });
      return false;
    }
  }
}
export interface TestnetIntent {
  operationId: string | null;
  hash: string | null;
  kind: string;
}
export function parseTestnetIntent(raw: string): TestnetIntent {
  try {
    const value = JSON.parse(raw) as TestnetIntent;
    const kinds = [
      'APPROVE_USDC',
      'APPROVE_PASS',
      'DEPOSIT',
      'ALLOCATE',
      'DEALLOCATE',
      'WITHDRAW',
      'AUTHORIZE',
      'BOUNDS',
      'STOP',
      'REVOKE',
      'CLOSE',
      'RECOVERY_SELL',
      'RESCUE_TOKEN',
      'RESCUE_NATIVE',
    ];
    if (
      !value ||
      !kinds.includes(value.kind) ||
      !(
        (typeof value.operationId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.operationId)) ||
        (value.operationId === null && value.kind.startsWith('APPROVE_'))
      ) ||
      !(value.hash === null || (typeof value.hash === 'string' && /^0x[0-9a-f]{64}$/.test(value.hash)))
    )
      throw new Error();
    return { operationId: value.operationId, hash: value.hash, kind: value.kind };
  } catch {
    throw new Error('INTENT_STORAGE_INVALID');
  }
}
export function testnetOperationMessage(state: string | undefined, ready = false): string {
  if (ready) return '已完成链上与个人账户核验；仅 L2 软确认，L1 最终性仍未知。';
  if (state === 'REVERTED') return '链上调用已回退；等待规范区块确认与资金状态复核。';
  if (state === 'REORGED') return '交易区块发生重组；保留原记录并暂停新提交。';
  if (state === 'REJECTED') return '本次请求已明确拒绝，未确认资金变更。';
  if (state === 'UNKNOWN' || !state) return '提交结果未知或尚待核对；不要再次发送，请核验已有交易哈希。';
  return `交易状态 ${state}：尚未完成个人账户核验，不可视为已成交。`;
}

/** Schedule the next read after completion; slow reads cannot starve their own error state. */
export function pollTestnetAccount<T>(reader: TestnetAccountReader<T>, intervalMs = 5000) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    await reader.refresh();
    if (!cancelled)
      timer = setTimeout(() => {
        void poll();
      }, intervalMs);
  };
  timer = setTimeout(() => {
    void poll();
  }, intervalMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

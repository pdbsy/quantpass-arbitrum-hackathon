import { api, ApiError, type Audit } from './api.ts';
import type { STRATEGIES } from '../../server/src/app.ts';
import type { Command, VaultState } from '../../../packages/domain/src/vault.ts';
import { unsigned } from '../../../packages/domain/src/money.ts';

// The controller consumes the adapter's legacy-compatible projection, not the
// server's evolving full view. Canonical-only fields remain in ProductAdapter.
export type ClientVault = Pick<
  VaultState,
  | 'id'
  | 'ownerId'
  | 'strategyId'
  | 'scope'
  | 'passes'
  | 'status'
  | 'revision'
  | 'idle'
  | 'activeCash'
  | 'positionCost'
  | 'positionValue'
  | 'feeLiability'
  | 'withdrawalsPaid'
  | 'orders'
  | 'pendingWithdrawals'
> & { balances: Record<string, string> };
type Vault = ClientVault;

class LocalClientError extends Error {}

export type LedgerAudit = Audit & { command_id: string };
export type ApiRequest = <T>(path: string, body?: unknown) => Promise<T>;
export type ClientStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type Identity = 'alice' | 'bob';
export type Strategy = (typeof STRATEGIES)[number];
export type ClientPhase = 'LOADING' | 'EMPTY' | 'READY' | 'ERROR' | 'PENDING' | 'STALE' | 'DISCONNECTED';
export type CommandType = Command['type'];
type Fields<C, T> = C extends { type: CommandType }
  ? T extends C['type']
    ? Omit<C, 'id' | 'expectedRevision' | 'type'>
    : never
  : never;
export type CommandFields<T extends CommandType> = Fields<Command, T>;
export interface CommandReview {
  readonly ownerId: Identity;
  readonly vaultId: string;
  readonly expectedRevision: number;
  readonly generation: number;
}
export interface PendingCommand {
  readonly owner: Identity;
  readonly vaultId: string;
  readonly command: Command;
  readonly rejection?: { readonly code: string; readonly status: number };
}
export interface ProductSnapshot {
  readonly phase: ClientPhase;
  readonly user: Identity | null;
  readonly strategies: readonly Strategy[];
  readonly vaults: readonly Vault[];
  readonly selectedVaultId: string | null;
  readonly audit: readonly LedgerAudit[];
  readonly pending: PendingCommand | null;
  readonly error: string | null;
  readonly notice: string | null;
}

// Reuse the previous UI's key and envelope. No unresolved request is deleted during migration.
export const PENDING_COMMAND_KEY = 'quantpass.local.pending-command.v1';
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const commandFields: Record<CommandType, readonly string[]> = {
  deposit: ['amount'],
  allocate: ['amount'],
  deallocate: ['amount'],
  requestWithdrawal: ['amount'],
  confirmWithdrawal: ['withdrawalId'],
  cancelWithdrawal: ['withdrawalId'],
  start: [],
  stop: [],
  reserveBuy: ['orderId', 'amount'],
  cancelOrder: ['orderId'],
  fillBuy: ['orderId'],
  markPosition: ['value'],
  settlePosition: ['proceeds'],
  payFees: ['amount'],
};
function identity(value: unknown): value is Identity {
  return value === 'alice' || value === 'bob';
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}
function validateCommand(value: Command): void {
  if (!value || !Object.hasOwn(commandFields, value.type)) throw new LocalClientError('INVALID_COMMAND_TYPE');
  const keys = ['id', 'expectedRevision', 'type', ...commandFields[value.type]];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key)))
    throw new LocalClientError('INVALID_COMMAND_FIELDS');
  if (
    !validId(value.id) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    value.expectedRevision > 10000
  )
    throw new LocalClientError('INVALID_COMMAND_FIELDS');
  for (const key of commandFields[value.type]) {
    const field = (value as unknown as Record<string, string>)[key]!;
    if (['amount', 'value', 'proceeds'].includes(key)) {
      try {
        unsigned(field);
      } catch (error) {
        throw new LocalClientError(error instanceof Error ? error.message : 'INVALID_AMOUNT');
      }
    } else if (!validId(field)) throw new LocalClientError('INVALID_COMMAND_FIELDS');
  }
}

export class ProductClient {
  private readonly request: ApiRequest;
  private readonly storage: ClientStorage;
  private readonly listeners = new Set<(snapshot: ProductSnapshot) => void>();
  private state: ProductSnapshot = {
    phase: 'LOADING',
    user: null,
    strategies: [],
    vaults: [],
    selectedVaultId: null,
    audit: [],
    pending: null,
    error: null,
    notice: null,
  };
  private generation = 0;
  private busy = false;
  private needsRefresh = true;
  private rejectionRefreshed = false;

  constructor(options: { request?: ApiRequest; storage?: ClientStorage } = {}) {
    // api supplies same-origin credentials and a bounded 10-second AbortSignal timeout.
    this.request = options.request ?? api;
    this.storage = options.storage ?? localStorage;
  }
  get snapshot(): ProductSnapshot {
    return structuredClone(this.state);
  }
  subscribe(listener: (snapshot: ProductSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<ProductSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }
  private withStorage<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw new LocalClientError(error instanceof Error ? error.message : 'STORAGE_FAILED', { cause: error });
    }
  }
  private readPending(): PendingCommand | null {
    const raw = this.withStorage(() => this.storage.getItem(PENDING_COMMAND_KEY));
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as PendingCommand;
      if (!value || !identity(value.owner) || !validId(value.vaultId)) throw new LocalClientError();
      validateCommand(value.command);
      if (
        value.rejection &&
        (typeof value.rejection.code !== 'string' ||
          !Number.isInteger(value.rejection.status) ||
          value.rejection.status < 400 ||
          value.rejection.status >= 500 ||
          value.rejection.status === 401)
      )
        throw new LocalClientError();
      return value;
    } catch {
      throw new LocalClientError('PENDING_STORAGE_INVALID');
    }
  }
  private visiblePending(pending: PendingCommand | null): PendingCommand | null {
    return pending?.owner === this.state.user ? pending : null;
  }
  private clearPrivate(): void {
    this.update({
      user: null,
      strategies: [],
      vaults: [],
      selectedVaultId: null,
      audit: [],
      pending: null,
      notice: null,
    });
  }
  private fail(error: unknown): void {
    this.needsRefresh = true;
    const code = error instanceof Error ? error.message : 'REQUEST_FAILED';
    if (error instanceof ApiError && error.status === 401) {
      this.generation++;
      this.clearPrivate();
    }
    const disconnected =
      error instanceof ApiError
        ? error.status === 401 || error.status >= 500
        : !(error instanceof LocalClientError);
    this.update({
      phase:
        error instanceof ApiError && error.status === 409 ? 'STALE' : disconnected ? 'DISCONNECTED' : 'ERROR',
      error: code,
      notice: null,
    });
  }
  private async exclusive(action: () => Promise<void>): Promise<void> {
    if (this.busy) throw new LocalClientError('BUSY');
    this.busy = true;
    // Invalidate outstanding reads and reviews before a write can start.
    this.generation++;
    try {
      await action();
    } finally {
      this.busy = false;
    }
  }
  private validateVault(vault: Vault, owner: Identity, id?: string): void {
    if (
      !vault ||
      vault.ownerId !== owner ||
      (id !== undefined && vault.id !== id) ||
      !validId(vault.id) ||
      vault.scope !== 'TEST_ONLY' ||
      !Number.isSafeInteger(vault.revision) ||
      vault.revision < 0
    )
      throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
  }
  private async load(expectedOwner?: Identity): Promise<void> {
    const generation = ++this.generation;
    this.needsRefresh = true;
    this.update({ phase: 'LOADING', error: null, notice: null });
    try {
      const session = await this.request<{ user: string }>('/session');
      if (generation !== this.generation) return;
      if (!identity(session.user)) throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
      const owner = session.user;
      if (this.state.user !== null && this.state.user !== owner) this.clearPrivate();
      if (expectedOwner !== undefined && owner !== expectedOwner)
        throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
      // Legacy array endpoints are intentionally isolated here. Pagination requires an API adapter update.
      const [strategies, vaults] = await Promise.all([
        this.request<Strategy[]>('/strategies'),
        this.request<Vault[]>('/vaults'),
      ]);
      if (generation !== this.generation) return;
      if (!Array.isArray(strategies) || !Array.isArray(vaults))
        throw new ApiError('INVALID_CATALOGUE_RESPONSE', 502);
      for (const vault of vaults) this.validateVault(vault, owner);
      const pending = this.readPending();
      const preferred = this.state.selectedVaultId ?? (pending?.owner === owner ? pending.vaultId : null);
      const selected = vaults.find((vault) => vault.id === preferred) ?? vaults[0];
      const [detail, audit] = selected
        ? await Promise.all([
            this.request<Vault>(`/vaults/${selected.id}`),
            this.request<LedgerAudit[]>(`/vaults/${selected.id}/audit`),
          ])
        : [null, []];
      if (generation !== this.generation) return;
      if (detail && selected) {
        this.validateVault(detail, owner, selected.id);
        if (detail.strategyId !== selected.strategyId || detail.revision < selected.revision)
          throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
        vaults[vaults.findIndex((vault) => vault.id === selected.id)] = detail;
      }
      if (
        !Array.isArray(audit) ||
        audit.some((event) => !validId(event.command_id) || !Number.isSafeInteger(event.revision))
      )
        throw new ApiError('INVALID_AUDIT_RESPONSE', 502);
      this.needsRefresh = false;
      this.rejectionRefreshed = !!pending?.rejection && pending.owner === owner;
      this.update({
        user: owner,
        strategies,
        vaults,
        selectedVaultId: selected?.id ?? null,
        audit,
        pending: pending?.owner === owner ? pending : null,
        phase:
          pending?.owner === owner
            ? pending.rejection
              ? 'STALE'
              : 'PENDING'
            : vaults.length
              ? 'READY'
              : 'EMPTY',
        error: pending?.owner === owner ? (pending.rejection?.code ?? null) : null,
        notice:
          pending && pending.owner !== owner
            ? 'Another identity has an unresolved request on this device.'
            : null,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
      throw error;
    }
  }
  async refresh(): Promise<void> {
    if (this.busy) throw new LocalClientError('BUSY');
    await this.load();
  }
  async selectIdentity(user: Identity): Promise<void> {
    await this.exclusive(async () => {
      this.needsRefresh = true;
      this.clearPrivate();
      this.update({ phase: 'LOADING', error: null });
      try {
        if (!identity(user)) throw new LocalClientError('INVALID_IDENTITY');
        const session = await this.request<{ user: string }>('/demo/session', { user });
        if (session.user !== user) throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
        await this.load(user);
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
  async selectVault(id: string): Promise<void> {
    if (this.busy) throw new LocalClientError('BUSY');
    if (!this.state.vaults.some((vault) => vault.id === id && vault.ownerId === this.state.user))
      throw new LocalClientError('VAULT_NOT_FOUND');
    this.update({ selectedVaultId: id, audit: [] });
    await this.load();
  }
  prepare(): CommandReview {
    const pending = this.readPending();
    if (pending) throw new LocalClientError('CONFIRM_PENDING_REQUEST_FIRST');
    if (this.busy) throw new LocalClientError('BUSY');
    if (this.needsRefresh) throw new LocalClientError('REFRESH_REQUIRED');
    const vault = this.state.vaults.find((value) => value.id === this.state.selectedVaultId);
    if (!this.state.user || !vault || vault.ownerId !== this.state.user)
      throw new LocalClientError('VAULT_REQUIRED');
    return {
      ownerId: this.state.user,
      vaultId: vault.id,
      expectedRevision: vault.revision,
      generation: this.generation,
    };
  }
  async claim(strategyId: string): Promise<void> {
    await this.exclusive(async () => {
      try {
        if (this.readPending()) throw new LocalClientError('CONFIRM_PENDING_REQUEST_FIRST');
        const owner = this.state.user;
        if (!owner || this.needsRefresh) throw new LocalClientError('REFRESH_REQUIRED');
        if (!this.state.strategies.some((strategy) => strategy.id === strategyId))
          throw new LocalClientError('UNKNOWN_STRATEGY');
        this.update({ phase: 'PENDING', notice: null, error: null });
        const vault = await this.request<Vault>('/vaults', { strategyId });
        this.validateVault(vault, owner);
        if (vault.strategyId !== strategyId) throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
        this.update({ selectedVaultId: vault.id });
        await this.load(owner);
        this.update({ notice: 'Test Pass access confirmed. Passes are not deposited funds.' });
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
  async command<T extends CommandType>(
    type: T,
    fields: CommandFields<T>,
    review: CommandReview,
  ): Promise<void> {
    if (this.busy) throw new LocalClientError('BUSY');
    const current = this.prepare();
    if (
      !review ||
      review.ownerId !== current.ownerId ||
      review.vaultId !== current.vaultId ||
      review.expectedRevision !== current.expectedRevision ||
      review.generation !== current.generation
    )
      throw new LocalClientError('REVIEW_REQUIRED');
    await this.exclusive(async () => {
      try {
        if (Object.keys(fields).some((key) => ['type', 'id', 'expectedRevision'].includes(key)))
          throw new LocalClientError('INVALID_COMMAND_FIELDS');
        const command = {
          id: crypto.randomUUID(),
          expectedRevision: review.expectedRevision,
          type,
          ...fields,
        } as Command;
        validateCommand(command);
        const pending: PendingCommand = { owner: review.ownerId, vaultId: review.vaultId, command };
        this.withStorage(() => this.storage.setItem(PENDING_COMMAND_KEY, JSON.stringify(pending)));
        this.update({ pending, phase: 'PENDING', error: null, notice: null });
        await this.send(pending);
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
  async retry(): Promise<void> {
    await this.exclusive(async () => {
      const pending = this.readPending();
      if (!pending) throw new LocalClientError('NO_PENDING_REQUEST');
      if (pending.owner !== this.state.user) throw new LocalClientError('PENDING_OWNER_MISMATCH');
      if (pending.vaultId !== this.state.selectedVaultId)
        throw new LocalClientError('PENDING_VAULT_MISMATCH');
      if (pending.rejection) throw new LocalClientError('REVIEW_REQUIRED');
      this.update({ pending, phase: 'PENDING', error: null, notice: null });
      try {
        await this.load(pending.owner);
        const event = this.state.audit.find((row) => row.command_id === pending.command.id);
        if (event) {
          const vault = this.state.vaults.find((value) => value.id === pending.vaultId);
          if (
            !vault ||
            event.actor_id !==
              ([
                'reserveBuy',
                'fillBuy',
                'markPosition',
                'settlePosition',
                'confirmWithdrawal',
                'payFees',
              ].includes(pending.command.type)
                ? 'local-simulator'
                : pending.owner) ||
            event.command_type !== pending.command.type ||
            event.revision <= pending.command.expectedRevision ||
            vault.revision < event.revision
          )
            throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
          this.confirm(pending, vault, true);
        } else {
          // The legacy audit is bounded to 100 rows. An older receipt can still be
          // reconciled safely by the backend using this exact original envelope.
          await this.send(pending);
        }
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
  private async send(pending: PendingCommand): Promise<void> {
    let result: { vault: Vault; replayed: boolean };
    try {
      result = await this.request(`/vaults/${pending.vaultId}/commands`, pending.command);
    } catch (error) {
      // Only a definitive rejection of the command itself can release it for re-review.
      // Readback errors, 401, 5xx and transport loss keep the original request uncertain.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 401 &&
        error.status !== 429
      ) {
        const rejected = { ...pending, rejection: { code: error.message, status: error.status } };
        this.rejectionRefreshed = false;
        this.withStorage(() => this.storage.setItem(PENDING_COMMAND_KEY, JSON.stringify(rejected)));
        this.update({ pending: this.visiblePending(rejected) });
      }
      throw error;
    }
    this.validateVault(result.vault, pending.owner, pending.vaultId);
    if (result.vault.revision <= pending.command.expectedRevision)
      throw new ApiError('RESPONSE_CONTEXT_MISMATCH', 502);
    await this.load(pending.owner);
    const verified = this.state.vaults.find((vault) => vault.id === pending.vaultId);
    if (!verified || verified.revision < result.vault.revision) throw new ApiError('READBACK_STALE', 502);
    this.confirm(pending, verified, result.replayed);
  }
  private confirm(pending: PendingCommand, verified: Vault, replayed: boolean): void {
    this.withStorage(() => this.storage.removeItem(PENDING_COMMAND_KEY));
    this.update({
      pending: null,
      phase: 'READY',
      error: null,
      notice: replayed
        ? 'Original request confirmed; no duplicate ledger entry.'
        : pending.command.type === 'stop' && verified.status === 'stopping'
          ? 'Stop requested; waiting for orders or positions to settle.'
          : `Command confirmed at ledger revision ${verified.revision}.`,
    });
  }
  async dismissRejected(): Promise<void> {
    await this.exclusive(async () => {
      const pending = this.readPending();
      if (!pending || !pending.rejection) throw new LocalClientError('UNRESOLVED_REQUEST');
      if (pending.owner !== this.state.user || pending.vaultId !== this.state.selectedVaultId)
        throw new LocalClientError('PENDING_OWNER_MISMATCH');
      if (!this.rejectionRefreshed || this.needsRefresh) throw new LocalClientError('REFRESH_REQUIRED');
      try {
        this.withStorage(() => this.storage.removeItem(PENDING_COMMAND_KEY));
        this.needsRefresh = true;
        this.rejectionRefreshed = false;
        this.update({
          pending: null,
          phase: 'STALE',
          error: null,
          notice: 'Rejected request dismissed. Refresh and review before creating a new command.',
        });
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
}

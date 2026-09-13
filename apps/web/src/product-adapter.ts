import { signed, unsigned } from '../../../packages/domain/src/money.ts';
import { api, ApiError } from './api.ts';
import {
  ProductClient,
  type ApiRequest,
  type ClientStorage,
  type Identity,
  type ProductSnapshot,
  type LedgerAudit,
  type ClientVault as Vault,
} from './product-client.ts';
export interface Asset {
  assetId: string;
  decimals: number;
}
export interface StrategySummary {
  strategyId: string;
  name: string;
  description: string;
  scope: string;
  testPasses: string;
  asset?: Asset;
  catalogVersion?: string;
}
export interface Association {
  ownerId: string;
  strategyId: string;
  vaultId: string | null;
  status: string;
}
export interface StrategyDetail extends StrategySummary {
  capabilities?: { execution: string; claim: string; arbitraryStrategies: boolean; realFunds: boolean };
  accountStrategy?: Association | null;
}
export interface AccountSummary {
  ownerId: string;
  strategies: readonly Association[];
  passBalances: readonly { strategyId: string; total: string; allowance: string }[];
}
export interface PendingOperation {
  operationId: string;
  kind: 'order' | 'withdrawal';
  status: 'pending';
  amount: string;
}
export interface ProductVault {
  vaultId: string;
  ownerId: string;
  strategyId: string;
  scope: string;
  status: string;
  revision: number;
  asset?: Asset;
  passBalance: { strategyId: string; total: string; allowance: string };
  balances: Record<string, string | Asset | undefined>;
  pendingOperations: readonly PendingOperation[];
}
export interface AuditEvent {
  commandId: string;
  commandType: string;
  actorId: string;
  revision: number;
  recordedAt: string;
  [key: string]: unknown;
}
export interface CanonicalSnapshot extends Omit<ProductSnapshot, 'strategies' | 'vaults' | 'audit'> {
  strategies: readonly StrategySummary[];
  vaults: readonly ProductVault[];
  audit: readonly AuditEvent[];
  account: AccountSummary | null;
  details: readonly StrategyDetail[];
}
const invalid = (code = 'INVALID_PRODUCT_RESPONSE'): never => {
  throw new ApiError(code, 502);
};
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : invalid();
const string = (v: unknown): string => (typeof v === 'string' ? v : invalid());
const money = (v: unknown, allowSigned = false): string => {
  if (typeof v !== 'string') return invalid();
  try {
    (allowSigned ? signed : unsigned)(v);
    return v;
  } catch {
    return invalid();
  }
};
const requiredBalances = [
  'idle',
  'activeCash',
  'positionCost',
  'positionValue',
  'feeLiability',
  'withdrawalsPaid',
  'reserved',
  'pending',
  'unrealized',
  'activeGross',
  'activeNet',
  'equity',
  'allowance',
];
function canonicalVault(value: unknown, owner: string): ProductVault {
  const v = object(value),
    b = object(v.balances),
    pass = object(v.passBalance);
  if (v.ownerId !== owner || v.scope !== 'TEST_ONLY' || pass.strategyId !== v.strategyId)
    invalid('RESPONSE_CONTEXT_MISMATCH');
  string(v.vaultId);
  string(v.strategyId);
  money(pass.total);
  money(pass.allowance);
  if (
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    !['stopped', 'running', 'stopping'].includes(String(v.status))
  )
    invalid();
  const asset = object(b.asset);
  if (asset.decimals !== 6 || asset.assetId !== 'TEST_ONLY_USDT_UNIT') invalid();
  for (const k of [...requiredBalances, 'deposits', 'realizedPnl', 'feesAccrued', 'feesPaid'])
    money(b[k], k === 'unrealized' || k === 'realizedPnl');
  if (!Array.isArray(v.pendingOperations)) invalid();
  const ids = new Set();
  for (const operation of v.pendingOperations as unknown[]) {
    const op = object(operation);
    string(op.operationId);
    money(op.amount);
    if (
      !['order', 'withdrawal'].includes(String(op.kind)) ||
      op.status !== 'pending' ||
      ids.has(`${op.kind}:${op.operationId}`)
    )
      invalid();
    ids.add(`${op.kind}:${op.operationId}`);
  }
  return structuredClone(value) as ProductVault;
}
export function fromCanonicalVault(value: unknown, owner: string): Vault {
  const v = canonicalVault(value, owner),
    b = v.balances;
  return {
    id: v.vaultId,
    ownerId: v.ownerId,
    strategyId: v.strategyId,
    scope: 'TEST_ONLY',
    passes: v.passBalance.total,
    status: v.status as Vault['status'],
    revision: v.revision,
    idle: money(b.idle),
    activeCash: money(b.activeCash),
    positionCost: money(b.positionCost),
    positionValue: money(b.positionValue),
    feeLiability: money(b.feeLiability),
    withdrawalsPaid: money(b.withdrawalsPaid),
    orders: Object.fromEntries(
      v.pendingOperations.filter((o) => o.kind === 'order').map((o) => [o.operationId, o.amount]),
    ),
    pendingWithdrawals: Object.fromEntries(
      v.pendingOperations.filter((o) => o.kind === 'withdrawal').map((o) => [o.operationId, o.amount]),
    ),
    balances: Object.fromEntries(
      requiredBalances
        .filter(
          (k) =>
            ![
              'idle',
              'activeCash',
              'positionCost',
              'positionValue',
              'feeLiability',
              'withdrawalsPaid',
            ].includes(k),
        )
        .map((k) => [k, money(b[k], k === 'unrealized')]),
    ),
  };
}
export function fromLegacyVault(v: Vault): ProductVault {
  return {
    vaultId: v.id,
    ownerId: v.ownerId,
    strategyId: v.strategyId,
    scope: v.scope,
    status: v.status,
    revision: v.revision,
    passBalance: { strategyId: v.strategyId, total: v.passes, allowance: v.balances.allowance! },
    balances: {
      ...v.balances,
      idle: v.idle,
      activeCash: v.activeCash,
      positionCost: v.positionCost,
      positionValue: v.positionValue,
      feeLiability: v.feeLiability,
      withdrawalsPaid: v.withdrawalsPaid,
    },
    pendingOperations: [
      ...Object.entries(v.orders).map(([operationId, amount]) => ({
        operationId,
        amount,
        kind: 'order' as const,
        status: 'pending' as const,
      })),
      ...Object.entries(v.pendingWithdrawals).map(([operationId, amount]) => ({
        operationId,
        amount,
        kind: 'withdrawal' as const,
        status: 'pending' as const,
      })),
    ],
  };
}
interface Projection {
  owner: Identity;
  mode: 'v1' | 'legacy';
  strategies: StrategySummary[];
  vaults: Map<string, ProductVault>;
  account: AccountSummary | null;
  details: StrategyDetail[];
  audit: Map<string, AuditEvent>;
}
const auditKey = (owner: string, vault: string, command: string) => JSON.stringify([owner, vault, command]);
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function vaultState(v: ProductVault): string {
  return stable({
    vaultId: v.vaultId,
    ownerId: v.ownerId,
    strategyId: v.strategyId,
    scope: v.scope,
    status: v.status,
    revision: v.revision,
    passBalance: v.passBalance,
    balances: v.balances,
    pendingOperations: [...v.pendingOperations].sort((a, b) =>
      `${a.kind}:${a.operationId}`.localeCompare(`${b.kind}:${b.operationId}`),
    ),
  });
}
export class ProductAdapter {
  readonly client: ProductClient;
  private projection: Projection | null = null;
  private readonly transport: ApiRequest;
  private readonly now: () => number;
  private blockedUntil = 0;
  private readonly storage: ClientStorage;
  private readonly retryKey = 'quantpass.local.retry-after.v1';
  constructor(options: { request?: ApiRequest; storage?: ClientStorage; now?: () => number } = {}) {
    this.transport = options.request ?? api;
    this.now = options.now ?? Date.now;
    this.storage = options.storage ?? {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
    };
    this.client = new ProductClient({
      request: this.request,
      storage: this.storage,
      beginRead: (current) => this.beginRead(current),
    });
    this.client.subscribe((snapshot) => {
      if (snapshot.user === null) this.projection = null;
    });
  }
  get mode(): 'unknown' | 'v1' | 'legacy' {
    return this.projection?.mode ?? 'unknown';
  }
  private readRetryDeadline(): void {
    let deadline: string | null;
    try {
      deadline = this.storage.getItem(this.retryKey);
    } catch {
      throw new ApiError('RETRY_AFTER_STORAGE_UNAVAILABLE', 503);
    }
    if (deadline === null) return;
    if (!/^(0|[1-9][0-9]*)$/.test(deadline) || !Number.isSafeInteger(Number(deadline)))
      throw new ApiError('INVALID_RETRY_AFTER_STORAGE', 503);
    this.blockedUntil = Math.max(this.blockedUntil, Number(deadline));
  }
  get retryAfterSeconds(): number {
    return Math.max(0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }
  get snapshot(): CanonicalSnapshot {
    const s = this.client.snapshot;
    const p = this.projection?.owner === s.user ? this.projection : null;
    return structuredClone({
      ...s,
      strategies: s.strategies.map(
        (v) => p?.strategies.find((x) => x.strategyId === v.id) ?? { ...v, strategyId: v.id },
      ),
      vaults: s.vaults.map((v) => p?.vaults.get(v.id) ?? fromLegacyVault(v)),
      audit: s.audit.map(
        (e) =>
          p?.audit.get(auditKey(s.user!, s.selectedVaultId!, e.command_id)) ?? {
            commandId: e.command_id,
            commandType: e.command_type,
            actorId: e.actor_id,
            revision: e.revision,
            recordedAt: e.recorded_at,
          },
      ),
      account: p?.account ?? null,
      details: p?.details ?? [],
    });
  }
  private async send<T>(path: string, body?: unknown, current: () => boolean = () => true): Promise<T> {
    if (!current()) invalid('STALE_READ');
    this.readRetryDeadline();
    if (this.retryAfterSeconds) throw new ApiError('RATE_LIMITED', 429, String(this.retryAfterSeconds));
    try {
      const result = await this.transport<T>(path, body);
      if (!current()) invalid('STALE_READ');
      return result;
    } catch (error) {
      // Cooldown is server-wide operational state, separate from owner projection.
      // A discarded generation cannot alter it, and a shorter reply cannot shorten it.
      if (current() && error instanceof ApiError && error.status === 429) {
        const raw = error.retryAfter;
        const delay = raw && /^\d+$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - this.now() : 0;
        if (Number.isFinite(delay) && delay > 0) {
          this.blockedUntil = Math.max(this.blockedUntil, this.now() + delay);
          this.storage.setItem(this.retryKey, String(this.blockedUntil));
        }
      }
      throw error;
    }
  }
  private async catalogue(
    current: () => boolean,
  ): Promise<{ mode: 'v1' | 'legacy'; strategies: StrategySummary[] }> {
    if (this.mode === 'legacy') return { mode: 'legacy', strategies: [] };
    const values: StrategySummary[] = [],
      seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 1000; page++) {
      let raw: unknown;
      try {
        raw = await this.send(
          `/v1/strategies?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
          undefined,
          current,
        );
      } catch (error) {
        if (page === 0 && this.mode === 'unknown' && error instanceof ApiError && error.status === 404)
          return { mode: 'legacy', strategies: [] };
        throw error;
      }
      const value = object(raw);
      if (!Array.isArray(value.items) || !(value.nextCursor === null || typeof value.nextCursor === 'string'))
        invalid('INVALID_PAGINATION_RESPONSE');
      values.push(...(value.items as unknown[]).map((item) => this.strategy(item)));
      if (values.length > 100000) invalid('INVALID_PAGINATION_RESPONSE');
      if (value.nextCursor === null) {
        if (new Set(values.map((v) => v.strategyId)).size !== values.length)
          invalid('RESPONSE_CONTEXT_MISMATCH');
        return { mode: 'v1', strategies: values };
      }
      cursor = string(value.nextCursor);
      if (!cursor || seen.has(cursor)) invalid('INVALID_PAGINATION_RESPONSE');
      seen.add(cursor);
    }
    return invalid('INVALID_PAGINATION_RESPONSE');
  }
  private strategy(value: unknown): StrategySummary {
    const s = object(value);
    string(s.strategyId);
    string(s.name);
    string(s.description);
    money(s.testPasses);
    if (s.scope !== 'TEST_ONLY') invalid();
    return structuredClone(value) as StrategySummary;
  }
  private canonical(raw: unknown, owner: Identity, strategies: StrategySummary[]): Projection {
    const value = object(raw),
      account = object(value.account);
    if (
      value.schemaVersion !== 1 ||
      value.scope !== 'TEST_ONLY' ||
      value.ownerId !== owner ||
      account.ownerId !== owner ||
      !Array.isArray(value.vaults) ||
      !Array.isArray(value.details) ||
      !Array.isArray(value.audit) ||
      !Array.isArray(account.strategies) ||
      !Array.isArray(account.passBalances) ||
      !Array.isArray(account.vaults)
    )
      invalid('RESPONSE_CONTEXT_MISMATCH');
    const vaults = new Map<string, ProductVault>();
    for (const item of value.vaults as unknown[]) {
      const vault = canonicalVault(item, owner);
      if (vaults.has(vault.vaultId) || !strategies.some((s) => s.strategyId === vault.strategyId))
        invalid('RESPONSE_CONTEXT_MISMATCH');
      vaults.set(vault.vaultId, vault);
    }
    const revisions = object(value.revisions);
    if (
      Object.keys(revisions).length !== vaults.size ||
      [...vaults].some(([id, v]) => revisions[id] !== v.revision)
    )
      invalid('RESPONSE_CONTEXT_MISMATCH');
    const accountVaults = (account.vaults as unknown[]).map((v) => canonicalVault(v, owner));
    if (
      accountVaults.length !== vaults.size ||
      new Set(accountVaults.map((v) => v.vaultId)).size !== vaults.size ||
      accountVaults.some(
        (v) => !vaults.has(v.vaultId) || vaultState(v) !== vaultState(vaults.get(v.vaultId)!),
      )
    )
      invalid('RESPONSE_CONTEXT_MISMATCH');
    const relations = new Map<string, Record<string, unknown>>();
    for (const item of account.strategies as unknown[]) {
      const a = object(item),
        strategy = string(a.strategyId);
      const vault = [...vaults.values()].find((v) => v.strategyId === strategy);
      if (
        a.ownerId !== owner ||
        relations.has(strategy) ||
        a.vaultId !== (vault?.vaultId ?? null) ||
        a.status !== (vault?.status ?? 'not_started')
      )
        invalid('RESPONSE_CONTEXT_MISMATCH');
      relations.set(strategy, a);
    }
    for (const pass of account.passBalances as unknown[]) {
      const p = object(pass);
      string(p.strategyId);
      money(p.total);
      money(p.allowance);
      const vault = [...vaults.values()].find((v) => v.strategyId === p.strategyId);
      if (
        p.total !== (vault?.passBalance.total ?? '0') ||
        p.allowance !== (vault?.passBalance.allowance ?? '0')
      )
        invalid('RESPONSE_CONTEXT_MISMATCH');
    }
    const all = [...vaults.values()];
    if (
      relations.size !== strategies.length ||
      strategies.some((s) => !relations.has(s.strategyId)) ||
      (account.passBalances as unknown[]).length !== strategies.length ||
      new Set((account.passBalances as Record<string, unknown>[]).map((p) => p.strategyId)).size !==
        strategies.length ||
      new Set(all.map((v) => v.strategyId)).size !== all.length ||
      account.scope !== 'TEST_ONLY' ||
      object(account.identity).id !== owner ||
      object(account.identity).mode !== 'DEMO' ||
      account.vaultCount !== vaults.size ||
      account.passes !== all.reduce((sum, v) => sum + BigInt(v.passBalance.total), 0n).toString() ||
      account.idle !== all.reduce((sum, v) => sum + BigInt(String(v.balances.idle)), 0n).toString()
    )
      invalid('RESPONSE_CONTEXT_MISMATCH');
    const totals = object(account.balances);
    for (const key of [
      'reserved',
      'pending',
      'unrealized',
      'activeGross',
      'activeNet',
      'equity',
      'allowance',
    ])
      if (totals[key] !== all.reduce((sum, v) => sum + BigInt(String(v.balances[key])), 0n).toString())
        invalid('RESPONSE_CONTEXT_MISMATCH');
    const status = all.some((v) => v.status === 'stopping')
      ? 'stopping'
      : all.some((v) => v.status === 'running')
        ? 'running'
        : all.length
          ? 'stopped'
          : null;
    if (account.status !== status) invalid('RESPONSE_CONTEXT_MISMATCH');
    const details = (value.details as unknown[]).map((item) => {
      const d = object(item),
        summary = this.strategy(d);
      if (!strategies.some((s) => s.strategyId === summary.strategyId)) invalid('RESPONSE_CONTEXT_MISMATCH');
      const a = relations.get(summary.strategyId);
      if (!a || (d.accountStrategy === null ? a.vaultId !== null : stable(d.accountStrategy) !== stable(a)))
        invalid('RESPONSE_CONTEXT_MISMATCH');
      return structuredClone(d) as unknown as StrategyDetail;
    });
    if (
      details.length !== strategies.length ||
      new Set(details.map((d) => d.strategyId)).size !== strategies.length
    )
      invalid('RESPONSE_CONTEXT_MISMATCH');
    const audit = new Map<string, AuditEvent>();
    for (const item of value.audit as unknown[]) {
      const e = object(item),
        vault = vaults.get(string(e.vaultId));
      const key = auditKey(owner, string(e.vaultId), string(e.commandId));
      const executor = [
        'reserveBuy',
        'fillBuy',
        'markPosition',
        'settlePosition',
        'confirmWithdrawal',
        'payFees',
      ].includes(string(e.commandType));
      string(e.recordedAt);
      if (
        !vault ||
        e.ownerId !== owner ||
        e.actorId !== (executor ? 'local-simulator' : owner) ||
        !Number.isSafeInteger(e.revision) ||
        Number(e.revision) < 1 ||
        Number(e.revision) > vault.revision ||
        audit.has(key)
      )
        invalid('RESPONSE_CONTEXT_MISMATCH');
      audit.set(key, structuredClone(e) as AuditEvent);
    }
    return {
      owner,
      mode: 'v1',
      strategies,
      vaults,
      account: structuredClone(account) as unknown as AccountSummary,
      details,
      audit,
    };
  }
  private beginRead(isCurrent: () => boolean) {
    let closed = false,
      owner: Identity | null = null,
      staged: Projection | null = null;
    let loading: Promise<Projection> | null = null;
    const current = () => !closed && isCurrent();
    const load = () =>
      (loading ??= (async () => {
        if (!owner) return invalid('RESPONSE_CONTEXT_MISMATCH');
        const catalogue = await this.catalogue(current);
        if (catalogue.mode === 'legacy')
          return (staged = {
            owner,
            mode: 'legacy',
            strategies: [],
            vaults: new Map(),
            account: null,
            details: [],
            audit: new Map(),
          });
        const value = await this.send('/v1/product-snapshot', undefined, current);
        return (staged = this.canonical(value, owner, catalogue.strategies));
      })());
    const request: ApiRequest = async <T>(path: string, body?: unknown): Promise<T> => {
      if (body !== undefined) invalid('READ_TRANSACTION_WRITE');
      if (path === '/session') {
        const value = await this.send<{ user: Identity }>(path, undefined, current);
        if (value.user !== 'alice' && value.user !== 'bob') invalid('RESPONSE_CONTEXT_MISMATCH');
        owner = value.user;
        return value as T;
      }
      const p = await load();
      if (p.mode === 'legacy') return this.send<T>(path, undefined, current);
      if (path === '/strategies') return p.strategies.map((v) => ({ ...v, id: v.strategyId })) as T;
      if (path === '/vaults') return [...p.vaults.values()].map((v) => fromCanonicalVault(v, p.owner)) as T;
      const match = path.match(/^\/vaults\/([a-zA-Z0-9_-]+)(\/audit)?$/);
      if (!match || !p.vaults.has(match[1]!)) return invalid('RESPONSE_CONTEXT_MISMATCH');
      if (!match[2]) return fromCanonicalVault(p.vaults.get(match[1]!)!, p.owner) as T;
      return [...p.audit.values()]
        .filter((e) => e.vaultId === match[1])
        .map((e): LedgerAudit => ({
          command_id: e.commandId,
          command_type: e.commandType,
          actor_id: e.actorId,
          revision: e.revision,
          recorded_at: e.recordedAt,
        })) as T;
    };
    return {
      request,
      commit: () => {
        if (!current() || !staged) invalid('STALE_READ');
        const next = staged!;
        if (this.projection?.owner === next.owner) {
          for (const [id, value] of next.vaults) {
            const previous = this.projection.vaults.get(id);
            if (
              previous &&
              (value.revision < previous.revision ||
                (value.revision === previous.revision && vaultState(value) !== vaultState(previous)))
            )
              invalid('RESPONSE_CONTEXT_MISMATCH');
          }
          for (const [key, value] of next.audit) {
            const previous = this.projection.audit.get(key);
            if (previous && stable(value) !== stable(previous)) invalid('RESPONSE_CONTEXT_MISMATCH');
          }
        }
        this.projection = next;
        closed = true;
      },
      discard: () => {
        closed = true;
      },
    };
  }
  readonly request: ApiRequest = async <T>(path: string, body?: unknown): Promise<T> => {
    if (path === '/session' || path === '/demo/session') return this.send<T>(path, body);
    const mode = this.mode === 'unknown' ? (await this.catalogue(() => true)).mode : this.mode;
    if (mode === 'legacy') return this.send<T>(path, body);
    const raw = await this.send<unknown>(`/v1${path}`, body);
    const owner = this.client.snapshot.user;
    if (!owner) return invalid('RESPONSE_CONTEXT_MISMATCH');
    if (path.endsWith('/commands')) {
      const result = object(raw);
      if (typeof result.replayed !== 'boolean') invalid();
      return { vault: fromCanonicalVault(result.vault, owner), replayed: result.replayed } as T;
    }
    return fromCanonicalVault(raw, owner) as T;
  };
}

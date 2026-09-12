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
export class ProductAdapter {
  readonly client: ProductClient;
  mode: 'unknown' | 'v1' | 'legacy' = 'unknown';
  private readonly transport: ApiRequest;
  private readonly now: () => number;
  private detection: Promise<void> | null = null;
  private owner: Identity | null = null;
  private vaults = new Map<string, ProductVault>();
  private strategies: StrategySummary[] = [];
  private account: AccountSummary | null = null;
  private details: StrategyDetail[] = [];
  private audit = new Map<string, AuditEvent>();
  private blockedUntil = 0;
  private readonly storage: ClientStorage;
  private readonly retryKey = 'quantpass.local.retry-after.v1';
  constructor(options: { request?: ApiRequest; storage?: ClientStorage; now?: () => number } = {}) {
    this.transport = options.request ?? api;
    this.now = options.now ?? Date.now;
    // Resolve browser storage only during an operation, so the shell/status can mount
    // even when accessing window.localStorage itself is denied.
    this.storage = options.storage ?? {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
    };
    this.client = new ProductClient({ request: this.request, storage: this.storage });
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
    // Never shorten a known cooldown. A later refresh rereads recovered storage.
    this.blockedUntil = Math.max(this.blockedUntil, Number(deadline));
  }

  get retryAfterSeconds(): number {
    return Math.max(0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }
  get snapshot(): CanonicalSnapshot {
    const s = this.client.snapshot,
      owned = s.user === this.owner;
    return structuredClone({
      ...s,
      strategies: s.strategies.map(
        (v) => this.strategies.find((x) => x.strategyId === v.id) ?? { ...v, strategyId: v.id },
      ),
      vaults: s.vaults.map((v) =>
        owned ? (this.vaults.get(v.id) ?? fromLegacyVault(v)) : fromLegacyVault(v),
      ),
      audit: s.audit.map(
        (e) =>
          this.audit.get(e.command_id) ?? {
            commandId: e.command_id,
            commandType: e.command_type,
            actorId: e.actor_id,
            revision: e.revision,
            recordedAt: e.recorded_at,
          },
      ),
      account: owned ? structuredClone(this.account) : null,
      details: owned ? structuredClone(this.details) : [],
    });
  }
  private async send<T>(path: string, body?: unknown): Promise<T> {
    this.readRetryDeadline();
    if (this.retryAfterSeconds) throw new ApiError('RATE_LIMITED', 429, String(this.retryAfterSeconds));
    try {
      return await this.transport<T>(path, body);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const raw = error.retryAfter;
        const delay = raw && /^\d+$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - this.now() : 0;
        if (Number.isFinite(delay) && delay > 0) {
          this.blockedUntil = this.now() + delay;
          this.storage.setItem(this.retryKey, String(this.blockedUntil));
        }
      }
      throw error;
    }
  }
  private async pages(path: string, first?: unknown): Promise<unknown[]> {
    const results: unknown[] = [],
      seen = new Set<string>();
    let cursor: string | null = null;
    for (let count = 0; count < 1000; count++) {
      const value = object(
        count === 0 && first !== undefined
          ? first
          : await this.send(
              `${path}?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
            ),
      );
      if (!Array.isArray(value.items) || !(value.nextCursor === null || typeof value.nextCursor === 'string'))
        invalid('INVALID_PAGINATION_RESPONSE');
      results.push(...(value.items as unknown[]));
      if (results.length > 100000) invalid('INVALID_PAGINATION_RESPONSE');
      if (value.nextCursor === null) return results;
      cursor = string(value.nextCursor);
      if (!cursor || seen.has(cursor)) invalid('INVALID_PAGINATION_RESPONSE');
      seen.add(cursor);
    }
    return invalid('INVALID_PAGINATION_RESPONSE');
  }
  private async detect(): Promise<void> {
    if (this.mode !== 'unknown') return;
    this.detection ??= (async () => {
      let first: unknown;
      try {
        first = await this.send('/v1/strategies?limit=100');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          this.mode = 'legacy';
          return;
        }
        throw error;
      }
      const values = await this.pages('/v1/strategies', first);
      this.strategies = values.map((v) => this.strategy(v));
      this.mode = 'v1';
    })();
    try {
      await this.detection;
    } finally {
      this.detection = null;
    }
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
  private normalize(value: unknown): Vault {
    if (!this.owner) invalid('RESPONSE_CONTEXT_MISMATCH');
    const v = canonicalVault(value, this.owner!);
    this.vaults.set(v.vaultId, v);
    return fromCanonicalVault(v, this.owner!);
  }
  private async loadAccount(): Promise<void> {
    const value = object(await this.send('/v1/account'));
    if (
      value.ownerId !== this.owner ||
      !Array.isArray(value.strategies) ||
      !Array.isArray(value.passBalances)
    )
      invalid('RESPONSE_CONTEXT_MISMATCH');
    for (const assoc of value.strategies as unknown[]) {
      if (object(assoc).ownerId !== this.owner) invalid('RESPONSE_CONTEXT_MISMATCH');
    }
    // Account's complete relationship/pass projections are authoritative; consume its optional vault pagination too.
    const allVaults: unknown[] = [...(Array.isArray(value.vaults) ? value.vaults : [])];
    let cursor = object(value.pagination ?? { nextCursor: null }).nextCursor;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor) || seen.size >= 1000)
        invalid('INVALID_PAGINATION_RESPONSE');
      seen.add(cursor as string);
      const next = object(
        await this.send(`/v1/account?limit=100&cursor=${encodeURIComponent(cursor as string)}`),
      );
      if (next.ownerId !== this.owner || !Array.isArray(next.vaults)) invalid('RESPONSE_CONTEXT_MISMATCH');
      allVaults.push(...(next.vaults as unknown[]));
      cursor = object(next.pagination).nextCursor;
    }
    for (const v of allVaults) canonicalVault(v, this.owner!);
    this.account = structuredClone({ ...value, vaults: allVaults }) as unknown as AccountSummary;
    this.details = await Promise.all(
      this.strategies.map(async (s) => {
        const d = object(await this.send(`/v1/strategies/${encodeURIComponent(s.strategyId)}`));
        this.strategy(d);
        if (d.strategyId !== s.strategyId) invalid('RESPONSE_CONTEXT_MISMATCH');
        if (d.accountStrategy !== null) {
          const a = object(d.accountStrategy);
          if (a.ownerId !== this.owner || a.strategyId !== s.strategyId) invalid('RESPONSE_CONTEXT_MISMATCH');
        }
        return structuredClone(d) as unknown as StrategyDetail;
      }),
    );
  }
  readonly request: ApiRequest = async <T>(path: string, body?: unknown): Promise<T> => {
    if (path === '/session' || path === '/demo/session') {
      if (path === '/demo/session') {
        this.owner = null;
        this.vaults.clear();
        this.account = null;
        this.details = [];
        this.audit.clear();
      }
      const result = await this.send<{ user: Identity }>(path, body);
      if (result.user !== this.owner) {
        this.vaults.clear();
        this.account = null;
        this.details = [];
        this.audit.clear();
      }
      this.owner = result.user;
      return result as T;
    }
    await this.detect();
    if (this.mode === 'legacy') return this.send<T>(path, body);
    if (path === '/strategies') {
      this.strategies = (await this.pages('/v1/strategies')).map((v) => this.strategy(v));
      return this.strategies.map((v) => ({ ...v, id: v.strategyId })) as T;
    }
    if (path === '/vaults' && body === undefined) {
      const list = await this.pages('/v1/vaults');
      await this.loadAccount();
      return list.map((v) => this.normalize(v)) as T;
    }
    if (path.endsWith('/audit')) {
      const vaultId = path.split('/')[2];
      const ownedVault = this.vaults.get(vaultId ?? '');
      if (!ownedVault || ownedVault.ownerId !== this.owner) invalid('RESPONSE_CONTEXT_MISMATCH');
      const rows = await this.pages(`/v1${path}`);
      return rows.map((value) => {
        const e = object(value);
        if (e.ownerId !== undefined && e.ownerId !== this.owner) invalid('RESPONSE_CONTEXT_MISMATCH');
        if (e.vaultId !== undefined && e.vaultId !== vaultId) invalid('RESPONSE_CONTEXT_MISMATCH');
        const row: LedgerAudit = {
          command_id: string(e.commandId),
          command_type: string(e.commandType),
          actor_id: string(e.actorId),
          revision: Number(e.revision),
          recorded_at: string(e.recordedAt),
        };
        const executor = [
          'reserveBuy',
          'fillBuy',
          'markPosition',
          'settlePosition',
          'confirmWithdrawal',
          'payFees',
        ].includes(row.command_type);
        const expectedActor = executor ? 'local-simulator' : this.owner;
        if (row.actor_id !== expectedActor || !Number.isSafeInteger(row.revision) || row.revision < 1)
          invalid('RESPONSE_CONTEXT_MISMATCH');
        this.audit.set(row.command_id, structuredClone(e) as AuditEvent);
        return row;
      }) as T;
    }
    const result = await this.send<unknown>(`/v1${path}`, body);
    if (path.endsWith('/commands')) {
      const r = object(result);
      if (typeof r.replayed !== 'boolean') invalid();
      return { vault: this.normalize(r.vault), replayed: r.replayed } as T;
    }
    return this.normalize(result) as T;
  };
}

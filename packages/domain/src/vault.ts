import { unsigned, signed, TEST_CASH } from './money.ts';

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'DomainError';
  }
}
function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DomainError(code);
}
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
function validId(value: string) {
  ensure(typeof value === 'string' && idPattern.test(value), 'INVALID_ID');
}
const zero = '0';

export interface Actor {
  readonly id: string;
  readonly role: 'owner' | 'executor';
}
export interface VaultState {
  readonly scope: 'TEST_ONLY';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly ownerId: string;
  readonly executorId: string;
  readonly strategyId: string;
  readonly passes: string;
  readonly revision: number;
  readonly status: 'stopped' | 'running' | 'stopping';
  readonly idle: string;
  readonly activeCash: string;
  readonly positionCost: string;
  readonly positionValue: string;
  readonly feeLiability: string;
  readonly deposits: string;
  readonly withdrawalsPaid: string;
  readonly realizedPnl: string;
  readonly feesAccrued: string;
  readonly feesPaid: string;
  readonly orders: Readonly<Record<string, string>>;
  readonly pendingWithdrawals: Readonly<Record<string, string>>;
  readonly receipts: Readonly<Record<string, { readonly fingerprint: string; readonly revision: number }>>;
  readonly events: readonly {
    readonly revision: number;
    readonly commandId: string;
    readonly type: Command['type'];
    readonly actorId: string;
  }[];
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type WorkingState = Mutable<Omit<VaultState, 'orders' | 'pendingWithdrawals' | 'receipts' | 'events'>> & {
  orders: Record<string, string>;
  pendingWithdrawals: Record<string, string>;
  receipts: Record<string, { fingerprint: string; revision: number }>;
  events: { revision: number; commandId: string; type: Command['type']; actorId: string }[];
};
export type Command = { readonly id: string; readonly expectedRevision: number } & (
  | { readonly type: 'deposit' | 'allocate' | 'deallocate' | 'requestWithdrawal'; readonly amount: string }
  | { readonly type: 'confirmWithdrawal' | 'cancelWithdrawal'; readonly withdrawalId: string }
  | { readonly type: 'start' | 'stop' }
  | { readonly type: 'reserveBuy'; readonly orderId: string; readonly amount: string }
  | { readonly type: 'cancelOrder' | 'fillBuy'; readonly orderId: string }
  | { readonly type: 'markPosition'; readonly value: string }
  | { readonly type: 'settlePosition'; readonly proceeds: string }
  | { readonly type: 'payFees'; readonly amount: string }
);
export interface SettlementPolicy {
  readonly scope: 'TEST_ONLY';
  readonly id: string;
  assess(
    input: Readonly<{
      proceeds: bigint;
      cost: bigint;
      cash: bigint;
      existingFeeLiability: bigint;
      allowance: bigint;
    }>,
  ): Readonly<{ fee: bigint; excessToIdle: bigint }>;
}

function sum(map: Readonly<Record<string, string>>) {
  return Object.values(map).reduce((a, b) => a + unsigned(b), 0n);
}
export function balances(state: VaultState) {
  const reserved = sum(state.orders),
    pending = sum(state.pendingWithdrawals);
  const unrealized = unsigned(state.positionValue) - unsigned(state.positionCost);
  const activeGross = unsigned(state.activeCash) + reserved + unsigned(state.positionValue);
  const activeNet = activeGross - unsigned(state.feeLiability);
  const equity = unsigned(state.idle) + activeNet + pending;
  const allowance = unsigned(state.passes) * 10n ** BigInt(TEST_CASH.decimals);
  return { reserved, pending, unrealized, activeGross, activeNet, equity, allowance };
}
export function assertInvariant(state: VaultState): void {
  ensure(state.scope === 'TEST_ONLY' && state.schemaVersion === 1, 'UNSUPPORTED_SCOPE');
  for (const field of ['id', 'ownerId', 'executorId', 'strategyId'] as const) validId(state[field]);
  ensure(['stopped', 'running', 'stopping'].includes(state.status), 'INVALID_STATUS');
  ensure(Number.isSafeInteger(state.revision) && state.revision >= 0, 'INVALID_REVISION');
  for (const field of [
    'passes',
    'idle',
    'activeCash',
    'positionCost',
    'positionValue',
    'feeLiability',
    'deposits',
    'withdrawalsPaid',
    'feesAccrued',
    'feesPaid',
  ] as const)
    unsigned(state[field]);
  signed(state.realizedPnl);
  for (const map of [state.orders, state.pendingWithdrawals])
    for (const [id, amount] of Object.entries(map)) {
      validId(id);
      ensure(unsigned(amount) > 0n, 'EMPTY_RESERVATION');
    }
  const b = balances(state);
  unsigned(b.allowance.toString());
  ensure(b.activeNet >= 0n, 'NEGATIVE_ACTIVE_EQUITY');
  ensure(unsigned(state.feeLiability) <= unsigned(state.activeCash), 'UNFUNDED_FEE_LIABILITY');
  ensure(
    unsigned(state.feesAccrued) === unsigned(state.feesPaid) + unsigned(state.feeLiability),
    'FEE_CONSERVATION',
  );
  ensure(
    b.equity ===
      unsigned(state.deposits) -
        unsigned(state.withdrawalsPaid) +
        signed(state.realizedPnl) +
        b.unrealized -
        unsigned(state.feesAccrued),
    'EQUITY_CONSERVATION',
  );
  ensure(
    state.events.length === state.revision && Object.keys(state.receipts).length === state.revision,
    'HISTORY_MISMATCH',
  );
  for (const [index, event] of state.events.entries()) {
    ensure(
      event.revision === index + 1 && state.receipts[event.commandId]?.revision === event.revision,
      'HISTORY_MISMATCH',
    );
  }
}

function freeze(state: WorkingState): VaultState {
  Object.freeze(state.orders);
  Object.freeze(state.pendingWithdrawals);
  for (const receipt of Object.values(state.receipts)) Object.freeze(receipt);
  for (const event of state.events) Object.freeze(event);
  Object.freeze(state.receipts);
  Object.freeze(state.events);
  return Object.freeze(state);
}
export function createVault(input: {
  id: string;
  ownerId: string;
  executorId: string;
  strategyId: string;
  passes: string;
  scope: 'TEST_ONLY';
}): VaultState {
  const state: WorkingState = {
    ...input,
    schemaVersion: 1,
    revision: 0,
    status: 'stopped',
    idle: zero,
    activeCash: zero,
    positionCost: zero,
    positionValue: zero,
    feeLiability: zero,
    deposits: zero,
    withdrawalsPaid: zero,
    realizedPnl: zero,
    feesAccrued: zero,
    feesPaid: zero,
    orders: {},
    pendingWithdrawals: {},
    receipts: {},
    events: [],
  };
  assertInvariant(state);
  return freeze(state);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}

// Pure transition. Persistence, authentication and transaction locks belong to adapters, not this function.
export function execute(
  state: VaultState,
  actor: Actor,
  command: Command,
  policy?: SettlementPolicy,
): VaultState {
  assertInvariant(state);
  validId(command.id);
  const executorTypes: readonly string[] = [
    'reserveBuy',
    'fillBuy',
    'markPosition',
    'settlePosition',
    'confirmWithdrawal',
    'payFees',
  ];
  const ownerTypes: readonly string[] = [
    'deposit',
    'allocate',
    'deallocate',
    'requestWithdrawal',
    'cancelWithdrawal',
    'start',
    'stop',
    'cancelOrder',
  ];
  ensure(executorTypes.includes(command.type) || ownerTypes.includes(command.type), 'UNKNOWN_COMMAND');
  const ownerAction = ownerTypes.includes(command.type);
  ensure(
    ownerAction
      ? actor.role === 'owner' && actor.id === state.ownerId
      : actor.role === 'executor' && actor.id === state.executorId,
    'FORBIDDEN',
  );
  const fingerprint = canonical({
    actor,
    command,
    policyId: command.type === 'settlePosition' ? (policy?.id ?? null) : null,
  });
  const previous = Object.hasOwn(state.receipts, command.id) ? state.receipts[command.id] : undefined;
  if (previous) {
    ensure(previous.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT');
    return state;
  }
  ensure(
    Number.isSafeInteger(command.expectedRevision) && command.expectedRevision === state.revision,
    'REVISION_CONFLICT',
  );
  ensure(state.revision < 10_000, 'TEST_HISTORY_LIMIT');
  const next = structuredClone(state) as WorkingState;
  const amount = 'amount' in command ? unsigned(command.amount) : 0n;
  if ('amount' in command) ensure(amount > 0n, 'NON_POSITIVE_AMOUNT');
  const b = balances(state);
  const available = unsigned(state.activeCash) - unsigned(state.feeLiability);
  switch (command.type) {
    case 'deposit':
      next.idle = (unsigned(next.idle) + amount).toString();
      next.deposits = (unsigned(next.deposits) + amount).toString();
      break;
    case 'allocate':
      ensure(amount <= unsigned(next.idle), 'INSUFFICIENT_IDLE');
      ensure(b.activeNet + amount <= b.allowance, 'ALLOWANCE_EXCEEDED');
      next.idle = (unsigned(next.idle) - amount).toString();
      next.activeCash = (unsigned(next.activeCash) + amount).toString();
      break;
    case 'deallocate':
      ensure(amount <= available, 'INSUFFICIENT_ACTIVE_CASH');
      next.activeCash = (unsigned(next.activeCash) - amount).toString();
      next.idle = (unsigned(next.idle) + amount).toString();
      break;
    case 'requestWithdrawal':
      ensure(amount <= unsigned(next.idle), 'INSUFFICIENT_IDLE');
      next.idle = (unsigned(next.idle) - amount).toString();
      next.pendingWithdrawals[command.id] = amount.toString();
      break;
    case 'confirmWithdrawal':
    case 'cancelWithdrawal': {
      validId(command.withdrawalId);
      ensure(Object.hasOwn(next.pendingWithdrawals, command.withdrawalId), 'WITHDRAWAL_NOT_PENDING');
      const owed = unsigned(next.pendingWithdrawals[command.withdrawalId]!);
      delete next.pendingWithdrawals[command.withdrawalId];
      if (command.type === 'confirmWithdrawal')
        next.withdrawalsPaid = (unsigned(next.withdrawalsPaid) + owed).toString();
      else next.idle = (unsigned(next.idle) + owed).toString();
      break;
    }
    case 'start':
      ensure(b.activeNet > 0n, 'NO_ACTIVE_FUNDS');
      ensure(state.status === 'stopped', 'INVALID_STATUS');
      next.status = 'running';
      break;
    case 'stop':
      next.status =
        unsigned(next.positionCost) > 0n || Object.keys(next.orders).length ? 'stopping' : 'stopped';
      break;
    case 'reserveBuy':
      validId(command.orderId);
      ensure(next.status === 'running', 'NOT_RUNNING');
      ensure(!Object.hasOwn(next.orders, command.orderId), 'DUPLICATE_ORDER');
      ensure(amount <= available, 'INSUFFICIENT_ACTIVE_CASH');
      next.activeCash = (unsigned(next.activeCash) - amount).toString();
      next.orders[command.orderId] = amount.toString();
      break;
    case 'cancelOrder':
    case 'fillBuy': {
      validId(command.orderId);
      ensure(Object.hasOwn(next.orders, command.orderId), 'ORDER_NOT_PENDING');
      const reserved = unsigned(next.orders[command.orderId]!);
      delete next.orders[command.orderId];
      if (command.type === 'cancelOrder') next.activeCash = (unsigned(next.activeCash) + reserved).toString();
      else {
        next.positionCost = (unsigned(next.positionCost) + reserved).toString();
        next.positionValue = (unsigned(next.positionValue) + reserved).toString();
      }
      break;
    }
    case 'markPosition':
      ensure(unsigned(next.positionCost) > 0n, 'NO_POSITION');
      next.positionValue = unsigned(command.value).toString();
      break;
    case 'settlePosition': {
      ensure(unsigned(next.positionCost) > 0n, 'NO_POSITION');
      ensure(Object.keys(next.orders).length === 0, 'PENDING_ORDERS');
      ensure(policy?.scope === 'TEST_ONLY', 'SETTLEMENT_POLICY_REQUIRED');
      validId(policy.id);
      const proceeds = unsigned(command.proceeds),
        cost = unsigned(next.positionCost),
        cash = unsigned(next.activeCash);
      const result = policy.assess(
        Object.freeze({
          proceeds,
          cost,
          cash,
          existingFeeLiability: unsigned(next.feeLiability),
          allowance: b.allowance,
        }),
      );
      const fee = unsigned(result.fee.toString()),
        excess = unsigned(result.excessToIdle.toString());
      ensure(fee <= (proceeds > cost ? proceeds - cost : 0n), 'INVALID_TEST_FEE');
      const cashAfter = cash + proceeds,
        liabilityAfter = unsigned(next.feeLiability) + fee;
      ensure(excess <= cashAfter - liabilityAfter, 'INVALID_EXCESS_ALLOCATION');
      next.activeCash = (cashAfter - excess).toString();
      next.idle = (unsigned(next.idle) + excess).toString();
      next.feeLiability = liabilityAfter.toString();
      next.feesAccrued = (unsigned(next.feesAccrued) + fee).toString();
      next.realizedPnl = (signed(next.realizedPnl) + proceeds - cost).toString();
      next.positionCost = zero;
      next.positionValue = zero;
      break;
    }
    case 'payFees':
      ensure(amount <= unsigned(next.feeLiability), 'EXCESS_FEE_PAYMENT');
      next.feeLiability = (unsigned(next.feeLiability) - amount).toString();
      next.activeCash = (unsigned(next.activeCash) - amount).toString();
      next.feesPaid = (unsigned(next.feesPaid) + amount).toString();
      break;
  }
  if (
    next.status === 'stopping' &&
    unsigned(next.positionCost) === 0n &&
    Object.keys(next.orders).length === 0
  )
    next.status = 'stopped';
  next.revision++;
  next.receipts[command.id] = { fingerprint, revision: next.revision };
  next.events.push({ revision: next.revision, commandId: command.id, type: command.type, actorId: actor.id });
  assertInvariant(next);
  return freeze(next);
}

export function restoreVault(serialized: string): VaultState {
  const candidate = JSON.parse(serialized) as WorkingState;
  assertInvariant(candidate);
  return freeze(candidate);
}

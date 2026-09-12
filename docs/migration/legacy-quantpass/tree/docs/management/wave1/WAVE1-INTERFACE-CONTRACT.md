# AlphaForge Wave 1 Interface Contract

Status: **FROZEN**
Owner: Macbeth01 (`AF-M01`)
Contract version: `1`
Scope: `TEST_ONLY`

This document is the minimum shared contract for `AF-BE01`, `AF-UI01`, `AF-CHAIN01`, and `AF-QA01`. It preserves the current domain semantics and fixes only the names and behavior needed to integrate Wave 1. A worker that needs to change this contract must publish a `QUESTION` or `SHARED FILE CHANGE REQUEST` before implementation.

## 1. Invariants

- Every response in this wave is test-only and carries `scope: "TEST_ONLY"` where the response type includes scope.
- `ownerId` is the authenticated account identifier. Public interfaces must not introduce a second ambiguous `owner` field.
- `strategyId` identifies a strategy. `vaultId` identifies a vault and maps to the current domain `VaultState.id`.
- The relationship is `ownerId -> strategyId -> vaultId`. Wave 1 permits at most one current vault for an `(ownerId, strategyId)` pair.
- Every object lookup is authorized against the authenticated `ownerId`. A client-supplied owner identifier cannot grant access.
- Existing domain commands and transitions remain authoritative. Adapters may rename fields at an external boundary, but must not duplicate transition logic.
- Schema changes during Wave 1 are additive. Renaming, deleting, changing units, or widening an enum requires an AF-M01 contract decision.

## 2. Scalar types and money

```ts
type Scope = "TEST_ONLY";
type Identifier = string; // /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
type MoneyString = string; // /^(0|[1-9][0-9]{0,77})$/; unsigned atomic units
type SignedMoneyString = string; // /^(0|-?[1-9][0-9]{0,77})$/
type PassString = string; // same lexical form as MoneyString; whole Pass units
type Revision = number; // non-negative safe integer

type Asset = {
  assetId: "TEST_ONLY_USDT_UNIT";
  decimals: 6;
};
```

All cash, value, cost, liability, fee, and withdrawal amounts are base-10 strings in atomic units of `TEST_ONLY_USDT_UNIT`. They must never cross an API boundary as a JavaScript number or floating-point value. Signed PnL fields use `SignedMoneyString`; other money fields are unsigned.

`PassString` counts whole Pass units. In the current test model, one Pass authorizes one USDT of running allowance, so `allowance = passes * 10^6` atomic units. A Pass is an allowance unit, not a cash balance or market price.

## 3. Resource types

These shapes are the canonical Wave 1 JSON names. Optional fields are not part of the minimum contract.

```ts
type StrategySummary = {
  schemaVersion: 1;
  scope: Scope;
  strategyId: Identifier;
  name: string;
  description: string;
  testPasses: PassString;
};

type StrategyDetail = StrategySummary & {
  accountStrategy: AccountStrategy | null;
};

type AccountSummary = {
  schemaVersion: 1;
  scope: Scope;
  ownerId: Identifier;
  strategies: AccountStrategy[];
  passBalances: PassBalance[];
};

type AccountStrategyStatus = "not_started" | "stopped" | "running" | "stopping";

type AccountStrategy = {
  ownerId: Identifier;
  strategyId: Identifier;
  vaultId: Identifier | null;
  status: AccountStrategyStatus;
};

type PassBalance = {
  strategyId: Identifier;
  total: PassString;
  allowance: MoneyString;
};

type VaultStatus = "stopped" | "running" | "stopping";

type VaultBalances = {
  asset: Asset;
  idle: MoneyString;
  activeCash: MoneyString;
  positionCost: MoneyString;
  positionValue: MoneyString;
  feeLiability: MoneyString;
  deposits: MoneyString;
  withdrawalsPaid: MoneyString;
  realizedPnl: SignedMoneyString;
  feesAccrued: MoneyString;
  feesPaid: MoneyString;
  reserved: MoneyString;
  pending: MoneyString;
  unrealized: SignedMoneyString;
  activeGross: MoneyString;
  activeNet: MoneyString;
  equity: MoneyString;
  allowance: MoneyString;
};

type Vault = {
  schemaVersion: 1;
  scope: Scope;
  vaultId: Identifier;
  ownerId: Identifier;
  strategyId: Identifier;
  status: VaultStatus;
  revision: Revision;
  passBalance: PassBalance;
  balances: VaultBalances;
  pendingOperations: PendingOperation[];
};

type PendingOperationStatus = "pending" | "completed" | "cancelled" | "failed";

type PendingOperation = {
  operationId: Identifier;
  kind: "order" | "withdrawal";
  status: PendingOperationStatus;
  amount: MoneyString;
};

type AuditEvent = {
  revision: Revision;
  commandId: Identifier;
  commandType: string;
  actorId: Identifier;
  recordedAt: string; // RFC 3339 UTC timestamp
};
```

For Wave 1, live `pendingOperations` contains operations with `status: "pending"`. Terminal states are retained in audit history rather than kept in the live collection. The wider status enum fixes the vocabulary for adapters that expose a terminal operation during reconciliation.

## 4. Pagination

```ts
type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

type PageRequest = {
  cursor?: string;
  limit?: number; // integer 1..100; default 50
};
```

Cursors are opaque. Clients must not parse or construct them. A paginated audit list is ordered by descending revision and then descending recorded time. Repeating an unchanged request with the same cursor returns the same logical page. Invalid or expired cursors return `INVALID_REQUEST`.

## 5. Errors

The Wave 1 error envelope stays compatible with the current server:

```ts
type APIErrorCode =
  | "HOST_REJECTED"
  | "ORIGIN_REJECTED"
  | "CROSS_SITE_REJECTED"
  | "DEMO_HEADER_REQUIRED"
  | "RATE_LIMITED"
  | "SESSION_REQUIRED"
  | "SESSION_LIMIT"
  | "FORBIDDEN"
  | "VAULT_NOT_FOUND"
  | "UNKNOWN_STRATEGY"
  | "INVALID_REQUEST"
  | "INVALID_ID"
  | "UNKNOWN_COMMAND"
  | "NON_POSITIVE_AMOUNT"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "TEST_HISTORY_LIMIT"
  | "ALLOWANCE_EXCEEDED"
  | "INSUFFICIENT_IDLE"
  | "INSUFFICIENT_ACTIVE_CASH"
  | "WITHDRAWAL_NOT_PENDING"
  | "NO_ACTIVE_FUNDS"
  | "INVALID_STATUS"
  | "NOT_RUNNING"
  | "DUPLICATE_ORDER"
  | "ORDER_NOT_PENDING"
  | "NO_POSITION"
  | "PENDING_ORDERS"
  | "SETTLEMENT_POLICY_REQUIRED"
  | "INVALID_TEST_FEE"
  | "INVALID_EXCESS_ALLOCATION"
  | "EXCESS_FEE_PAYMENT"
  | "LOCAL_OPERATION_FAILED";

type APIError = {
  error: APIErrorCode;
};
```

The closed list includes every error currently intended to cross the HTTP boundary. Invariant, persistence, configuration, and database-corruption codes are internal and must map to `LOCAL_OPERATION_FAILED`. A new public state-conflict code requires an AF-M01 contract decision. Internal exception text, stack traces, secrets, and upstream payloads must not enter the response.

| HTTP | Code | Client behavior |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Correct the request; do not retry unchanged. |
| 401 | `SESSION_REQUIRED` | Re-establish the local session, then read state. |
| 403 | request-boundary or `FORBIDDEN` code | Stop; do not retry unchanged. |
| 404 | `VAULT_NOT_FOUND` | Refresh the account/strategy relation. |
| 409 | `REVISION_CONFLICT` | Read the latest vault, re-evaluate intent, then submit a new command ID. |
| 409 | `IDEMPOTENCY_CONFLICT` | Stop; the command ID was reused with a different payload. |
| 409 | other domain conflict code | Refresh state or change input; do not blind-retry. |
| 429 | `RATE_LIMITED` | Retry after the server delay when supplied. |
| 500 | `LOCAL_OPERATION_FAILED` | Treat outcome as uncertain; read vault and audit before an exact retry. |

## 6. Mutations, revision, and retry

Every mutation uses the existing domain command envelope:

```ts
type CommandEnvelope<TCommand extends string, TPayload extends object> = {
  id: Identifier; // commandId at the API/documentation boundary
  expectedRevision: Revision;
  type: TCommand;
} & TPayload;
```

- The server owns revision increments. A successful new command advances the vault revision exactly once.
- Retrying the exact same command ID with the exact same canonical payload is idempotent and returns the recorded result with `replayed: true`.
- Reusing a command ID with any changed field returns `IDEMPOTENCY_CONFLICT`.
- A stale `expectedRevision` returns `REVISION_CONFLICT` without changing state.
- After a network timeout or `5xx`, the client reads the vault and audit first. If the command is absent, it may retry the exact same envelope and ID.
- After `REVISION_CONFLICT`, the client reads current state and creates a new command ID only if the original user intent is still valid.

## 7. Endpoint and adapter mapping

AF-BE01 may add account and detail endpoints, but must keep existing routes working for Wave 1. Canonical resource names are mapped at the HTTP boundary:

| Existing source | Canonical field/type |
| --- | --- |
| strategy `id` | `strategyId` |
| `VaultState.id` / current view `id` | `vaultId` |
| `VaultState.passes` | `PassBalance.total` |
| existing vault money fields | `VaultBalances` |
| `orders` and `pendingWithdrawals` records | `PendingOperation[]` |
| audit `command_id`, `command_type`, `actor_id`, `recorded_at` | camel-case `AuditEvent` fields |
| no vault for owner/strategy | `AccountStrategy.status = "not_started"`, `vaultId = null` |

The UI consumes these canonical names through one adapter boundary. It must preserve the existing information architecture and visual language. It must not infer financial values from display strings or duplicate domain calculations.

AF-CHAIN01 may define an ABI and adapter that represents the frozen identifiers, integer units, statuses, commands, and audit semantics. Network, deployment address, custody, token standard, total supply, buffer policy, venue, and production fee choices remain explicitly outside this contract.

## 8. Verification matrix

Each implementation PR records its exact reviewed SHA and the relevant evidence:

| Contract property | Required evidence |
| --- | --- |
| Identifier and ownership relation | unit/integration tests for authenticated object scoping and one vault per owner/strategy |
| Money and Pass units | boundary tests proving string serialization, six decimals, and no float conversion |
| Status vocabulary | tests for absence (`not_started`) and existing vault transitions |
| Error envelope | endpoint tests for status/code pairs without internal details |
| Idempotency and retry | exact replay, changed-payload conflict, stale revision, and uncertain-outcome readback tests |
| Pagination | order, limit bounds, cursor continuation, and invalid cursor tests |
| UI compatibility | browser evidence against the canonical adapter with no redesign |
| Chain boundary | deterministic local tests only; no deployment, keys, or funds |
| Integrated regression | AF-QA01 runs at exact candidate SHAs and reports PASSED/FAILED/NOT RUN/BLOCKED |

## 9. Change control

A proposed breaking change must state the affected types, endpoints, migration behavior, compatibility risk, test plan, and owner. Macbeth01 records the decision in the AF-M01 PR before any worker implements it. GitHub PRs remain the source of truth; Agent Forum notices provide coordination only and never authorize merge or deployment.

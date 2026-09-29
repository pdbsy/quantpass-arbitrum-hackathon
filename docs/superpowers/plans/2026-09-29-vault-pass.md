# AlphaForge Vault Pass plan

User-confirmed rules: deposit principal locks 1 Pass per settlement unit; profit-first withdrawal releases Pass only for principal; no principal withdrawal with positions; Bot cash withdrawal to idle does not release Pass; flat full exit releases residual locks after losses. Local/mock only, single Macbeth01, no publication or merge authority inferred.

## Implementation

1. Add optional versioned `passLock` accounting to local Vault, preserving legacy schema/receipts. `enablePassLocking` explicitly adopts an existing stopped Vault only if no paid/pending withdrawal, no orders/positions/fees, and original deposits fit owned Pass capacity. New callers may request `passPolicy: principal-v1`; old callers retain historical behavior.
2. Pure domain tests before implementation: exact fractional deposit locks, atomic insufficient-Pass rejection, profit-first pending withdrawal reservations, cancellation, confirmation idempotency, principal denial with positions, confirmation revalidation after new positions, loss exit releasing all, closed-Vault denial, legacy restoration and unsafe adoption rejection.
3. Add typed `closeVault` owner command. Require stopped, no positions/orders/pending withdrawals/fee liability. Pay all idle and active cash, zero principal and mark passLock closed. Keep closed history and receipts. API projection exposes total/free/locked Pass, principal, available withdrawal and pending profit/principal split.
4. Fastify/SQLite tests verify opt-in creation, restart, owner isolation, duplicate confirmations, and Bot cash funding/checkpoints preserving Pass locks. Register tests in package and collector. Existing contract ABI and Solidity remain unchanged.
5. Quant UI shows Pass balances, configurable deposit/withdrawal amounts, pending withdrawal confirm/cancel, and full exit. Existing unknown outcomes retry original request. Legacy mode is labelled and adoption is explicit; no fabricated historical freeze. Browser check real local endpoints and mobile width.
6. Run targeted tests then complete full checks, source C → manifest R → snapshots S → final check. Same-worker review is not independent approval. Preserve old branch/database and pending public-push authorization.

## Interfaces and acceptance examples

`passLock: {version: 1, principal: string, closed: boolean, withdrawals: Record<string,{principal:string,profit:string}>}` uses settlement micro-units, converted exactly to explicitly named Pass raw fields at 18 decimals for projection; capacity fields stay at 6 decimals. `passes` stays whole owned units for compatibility. Deposit 100.000001 freezes 100.000001 Pass exactly. 1000 principal plus 100 realized profit: request 150 reserves profit 100/principal 50; cancel changes neither principal nor locked Pass; confirmed payment leaves principal 950. A 100 loss with no exposure followed by close returns 900 and releases all 1000 Pass.

Pending withdrawals reserve their profit/principal split once. New orders may make a principal confirmation temporarily invalid; cancellation remains possible. Neither mark-to-market gains nor Bot-to-idle transfers unlock Pass. Pending withdrawal funds remain included in equity until confirmed.

User supplied the authoritative onchain definition during implementation. The local model is strictly TEST_ONLY and does not constitute deployed custody. Audit the existing immutable-owner Solidity, raw conversion, position/dust boundaries and owner-confirmed browser paths; record absent deployment and factory UX honestly.

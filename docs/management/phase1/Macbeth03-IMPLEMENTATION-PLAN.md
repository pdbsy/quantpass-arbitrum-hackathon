# M3 Phase 1 Chain Recovery Implementation Plan

> **For agentic workers:** Execute this plan inline with the `executing-plans` workflow. Every behavior change follows RED, GREEN, refactor, and focused verification. No subagent is authorized for this task.

**Goal:** Close the evidence-backed Phase 1 gaps in deployment identity verification, chain projection recovery, and multi-Vault isolation while preserving the merged transaction, reorg, and owner-exit behavior.

**Architecture:** Keep each Vault indexed by its immutable chain and contract identity in SQLite. Verify a deployment manifest against the frozen ABI digest and independently read and hash live runtime bytecode before any block, log, or projection is accepted. Expose multiple configured Vault runtimes through one chain route registry without making product accounts or demo sessions authoritative. Add online SQLite backup and health inspection so a projection database can be restored and rebuilt without changing chain truth.

**Tech Stack:** TypeScript 6, Node.js 24.21.0, node:sqlite, Fastify 5, EIP-1193/JSON-RPC, Node test runner.

**Spec:** `docs/management/specs/PHASE1-CLOSEOUT-2026-09-20.md` at registration source `48cccb8743d2e77ec8001187c00e95044a3d2f40`; `docs/protocol/M3-VAULT-ABI-HANDOFF.md`; `docs/management/phase1/Macbeth03-TASK.md` at the same registration source.

## Global Constraints

- Base is `18f5352070910a867b9729b031aa2e3951785e01`; final candidate branch is `macbeth03/m3-phase1-recovery-final`. The original `macbeth03/m3-phase1-recovery` source ref remains preserved.
- Runtime remains Local / Mock / NOT_DEPLOYED. No external RPC write, signing, broadcast, deployment, secret, purchase, or merge.
- AF-USDC uses 6 decimals, Pass uses 18 decimals, `softReadyDepth = 3`, and `reorgSearchLimit = 128`.
- Runtime bytecode and ABI hashes use Keccak-256 as frozen by `docs/protocol/M3-VAULT-ABI-HANDOFF.md`.
- A failed deployment identity check must persist no new chain evidence and must leave product projection reads unavailable.
- The generic product health endpoint remains available during indexer failure; chain runtime status must expose the chain/database failure without private RPC or filesystem details.
- Strategy execution, paid Pass sales, Buy/Sell, pricing, fees, AMMs, matching, and risk-permit execution remain out of scope.
- Files stay within `packages/chain-adapter/**`, `apps/server/**`, `test/chain-*.test.ts`, new `docs/chain/PHASE1-*`, and own `docs/management/phase1/Macbeth03-*`.

---

### Task 1: Exact manifest, ABI, and live bytecode identity

**Files:**

- Create: `packages/chain-adapter/src/keccak.ts`
- Modify: `packages/chain-adapter/src/index.ts`
- Modify: `packages/chain-adapter/src/manifest.ts`
- Modify: `packages/chain-adapter/src/rpc.ts`
- Modify: `packages/chain-adapter/src/vault-abi.ts`
- Modify: `apps/server/src/m3-chain-runtime.ts`
- Test: `test/chain-rpc-manifest.test.ts`
- Test: `test/chain-runtime.test.ts`
- Test fixtures: manifest objects in `test/chain-api.test.ts`, `test/chain-startup.test.ts`, `test/chain-sync.test.ts`, and `test/chain-vault-integration.test.ts`

**Interfaces:**

- Produces `keccak256(data: HexData): BlockHash`, validated against the empty-string, `abc`, and 135/136/137/272-byte rate-boundary Ethereum Keccak-256 vectors.
- Extends `DeploymentManifestDocument` with mandatory `abiHash` and binds it into `manifestDigest`.
- Produces `M3_VAULT_ABI_HASH = 0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977`.
- Adds `ReadonlyRpc.code(address, block)` using allowlisted `eth_getCode`.
- Before the first sync, verifies chain ID, nonempty code at the exact Vault address, and Keccak-256 runtime hash; mismatch throws a fixed public-safe code and persists no checkpoint/projection.

- [x] Write Keccak vector, `eth_getCode`, mandatory ABI hash, zero contract address, and runtime mismatch tests.
- [x] Run `node --test test/chain-rpc-manifest.test.ts test/chain-runtime.test.ts` and confirm failures are caused by the missing APIs/validation.
- [x] Implement the minimal Keccak, manifest/RPC, and runtime identity code.
- [x] Run the focused tests and the complete chain test set; keep startup connectivity degradation behavior intact.
- [x] Commit this independently reviewable identity batch (`e2e7d97`).

### Task 2: Projection database backup, restore, migration, and health

**Files:**

- Modify: `apps/server/src/chain-store.ts`
- Modify: `apps/server/src/m3-chain-runtime.ts`
- Modify: `apps/server/src/chain-routes.ts`
- Test: `test/chain-store.test.ts`
- Test: `test/chain-api.test.ts`

**Interfaces:**

- Adds `ChainStore.backupTo(target: string): Promise<string>` using SQLite online backup, exclusive destination creation, and no overwrite.
- Adds `ChainStore.health()` returning only `{ status, schemaVersion, integrity }` with fixed values; SQL/file details remain internal.
- Extends `/api/v1/chain/runtime-status` with database health and configured deployment identity while keeping indexer failure separate from generic product availability.
- Restoring a backup means opening it through `ChainStore`, which runs supported migrations, validates schema/integrity, and preserves checkpoints, projections, operations, and idempotency.

- [x] Write a failing online backup/reopen/no-overwrite test and a failing runtime-status database-health test.
- [x] Run `node --test test/chain-store.test.ts test/chain-api.test.ts` and confirm expected RED failures.
- [x] Implement minimal backup and health methods plus the safe status projection.
- [x] Run focused tests and migration tests, including version-one and version-three fixtures.
- [x] Commit this independently reviewable recovery batch (`9886ffc`).

### Task 3: Multi-Vault, multi-wallet, and multi-strategy isolation

**Files:**

- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/chain-routes.ts`
- Modify: `apps/server/src/m3-chain-runtime.ts`
- Test: `test/chain-api.test.ts`
- Test: `test/chain-store.test.ts`
- Test: `test/chain-vault-integration.test.ts`

**Interfaces:**

- `buildM3App` accepts a validated nonempty set of distinct `M3ChainRuntime` instances while retaining `buildApp`'s existing one-runtime call shape and historical provenance hash. The production `startM3Server` path accepts one deployment or an isolated deployment set, synchronizes every runtime, and rejects shared SQLite paths.
- Adds contract-qualified read `GET /api/v1/chain/vaults/:contract/:owner`; the legacy owner-only route remains valid only for a one-runtime server.
- Routes submissions by exact chain and target contract; unknown or duplicate runtime identities fail closed.
- Confirms projection keys include chain, immutable Vault contract, owner wallet, and `m3-vault`; strategy identity remains a state field verified against the Vault and Strategy Pass at the same canonical block.

- [x] Write failing tests for two Vaults with different owners/strategies in the same database and contract-qualified API reads/submissions.
- [x] Run `node --test test/chain-api.test.ts test/chain-store.test.ts test/chain-vault-integration.test.ts` and confirm expected RED failures.
- [x] Implement the minimal runtime registry and exact dispatch rules.
- [x] Run focused tests and the complete chain test set; verify no cross-Vault reads, writes, closures, or sync health leakage.
- [x] Commit this independently reviewable isolation batch (`bec0f2d`).

### Task 4: Recovery matrix, UI/API handoff, and non-broadcast smoke procedure

**Files:**

- Create: `docs/chain/PHASE1-RECOVERY-GAP-MATRIX.md`
- Create: `docs/chain/PHASE1-DATABASE-RECOVERY.md`
- Create: `docs/chain/PHASE1-TESTNET-SMOKE.md`
- Create: `docs/chain/PHASE1-MACBETH04-API-HANDOFF.md`
- Create: `docs/management/phase1/Macbeth03-WORKER-REPORT.md`

**Interfaces:**

- Maps every assigned identity, lifecycle, failure, reorg, isolation, and recovery scenario to an exact test/evidence reference or `BLOCKED`/`NOT_RUN` disposition.
- Documents Pass initial allocation as constructor-time deployment input, ordinary 18-decimal `transfer`, exact Vault selection by chain/contract/strategy, finite token approvals, and post-close rescue actions for Macbeth04 without implementing sales or Buy/Sell.
- Defines `SUBMISSION_AMBIGUOUS` as a browser-only pending recovery condition: no backend operation is created without a txHash and no automatic resend occurs.
- Defines a smoke run that stops before signing/broadcast unless separately authorized and records chain, manifest, ABI/runtime hashes, wallet, target, spender, calldata, simulation, and expected event/view evidence.

- [x] Write the four operational documents from code/test evidence and mark real Testnet actions `NOT_RUN`.
- [x] Run format, typecheck, lint, full tests, secrets/privacy checks, and the environment admission check with the fixed toolchain.
- [x] Review the complete diff for scope, stale claims, accidental external-write paths, and sensitive data.
- [x] Commit source/docs, push the task branch, update Draft PR #23, and report the exact candidate SHA and results to Macbeth01.

### Task 5: Manifest-bound StrategyPass transfer

**Files:**

- Create: `packages/chain-adapter/src/pass-abi.ts`
- Create: `apps/server/src/m3-pass-integration.ts`
- Modify: `packages/chain-adapter/src/index.ts`
- Modify: `packages/chain-adapter/src/manifest.ts`
- Modify: `apps/server/src/m3-chain-runtime.ts`
- Modify: `apps/server/src/chain-routes.ts`
- Test: `test/chain-rpc-manifest.test.ts`
- Test: `test/chain-vault-abi.test.ts`
- Test: `test/chain-vault-integration.test.ts`
- Test: `test/chain-runtime.test.ts`
- Test: `test/chain-api.test.ts`

**Interfaces:**

- Binds StrategyPass address, deployment block, ABI Keccak-256, and deployed runtime Keccak-256 into the trusted Vault manifest.
- Uses Macbeth02 source `2ad816200e7edfbfad96d765b4a696bc8b838c2d` (evidence head `a13052993b6f408b7be835ecd6f4b13ef6df367d`) and StrategyPass ABI Keccak-256 `0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f`.
- Produces exact `transfer(address,uint256)` encoding/decoding with selector `0xa9059cbb`, nonzero recipient, positive uint256 raw amount, and no `10^12` divisibility restriction.
- Indexes canonical StrategyPass `Transfer` events, reconciles sender/recipient/amount and 18-decimal strategy identity, and exposes contract-qualified owner balance projections.
- Accepts wallet submission only when target equals the manifest-bound StrategyPass; arbitrary ERC-20 targets and calldata remain invalid.

- [x] Write failing manifest, transfer codec, target-binding, event reconciliation, and projection recovery tests.
- [x] Run the focused tests and confirm failures are caused by the absent StrategyPass adapter/runtime.
- [x] Implement the minimal pass ABI, second contract synchronizer, runtime identity checks, and routes.
- [x] Run focused tests, the complete chain suite, typecheck, lint, and format checks.
- [x] Commit the StrategyPass transfer batch and update the handoff/gap documents from HANDOFF_READY to implemented local evidence.

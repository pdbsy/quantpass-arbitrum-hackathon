# Macbeth03 M3 Phase 1 Recovery Report

Status date: 2026-09-20
Task: `M3-03-PHASE1-RECOVERY`
Base: `18f5352070910a867b9729b031aa2e3951785e01`
Branch: `macbeth03/m3-phase1-recovery-final`
Runtime boundary: Local / Mock / NOT_DEPLOYED

## Delivered

- Deployment identity now binds the exact Vault and StrategyPass addresses, deployment blocks, ABI hashes, deployed runtime bytecode hashes, and manifest digest. Runtime checks chain ID and both live code hashes before indexing.
- SQLite projection recovery includes online no-overwrite backup, fixed health output, supported migrations, bounded catch-up, canonical reorg recovery, and fail-closed reads.
- Multiple Vault runtimes remain isolated by chain, contract, wallet, strategy, checkpoint, projection, operation target, and SQLite file. The real `startM3Server` path composes and synchronizes the deployment set while the historical `app.ts` provenance hash is preserved through the additive `m3-app.ts` layer.
- Multiple Owner/Vault runtimes may share the same StrategyPass when its deployment block, ABI hash, and runtime bytecode hash agree. The Vault with the lexically first address is the sole Pass synchronization, projection-storage, operation, and route owner; every Vault still verifies the same live Pass and strategy identity while keeping its Owner, PassLocker, accounting, and exit history separate.
- StrategyPass transfer is pinned to Macbeth02 source `2ad816200e7edfbfad96d765b4a696bc8b838c2d`, evidence head `a13052993b6f408b7be835ecd6f4b13ef6df367d`, and ABI Keccak-256 `0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f`.
- The Pass adapter accepts only manifest-bound `transfer(address,uint256)` with a nonzero recipient and a positive uint256 raw amount. It preserves full 18-decimal precision, including one raw unit.
- A separate StrategyPass synchronizer indexes canonical `Transfer` events, reconciles sender/recipient/amount, verifies decimals and strategy identity, reads actual canonical balances, and serves `GET /api/v1/chain/passes/:contract/:owner`.
- Shared-Pass regression coverage proves deterministic ownership independent of deployment-list order, two-holder balance routes, per-Vault close-operation routing, conflicting shared identity rejection, and fail-closed reads after owner-runtime synchronization degradation.
- Operational documents cover the recovery matrix, database restore, Macbeth04 API handoff, and a smoke procedure that stops before signing or broadcast.
- A three-sample local recovery drill measures online backup, reopen/health, and 128-block catch-up separately. The recorded fixture result is explicitly not a Testnet or production SLA.
- Keccak regression coverage includes the 135/136/137/272-byte sponge-rate boundaries independently supplied by Macbeth01.

## Verification

- Fixed toolchain: Node `24.21.0`, npm `11.19.1`, Git `2.50.1`.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run format:check`: PASS.
- `npm test`: PASS, 643/643 after the critical authorization/accounting gap tests.
- `npm run secrets:check`: PASS.
- `npm run privacy:check`: PASS.
- `npm run env:check`: exit 0; local/mock admission, workspace warning for the intentional task diff, contracts `NOT_RUN`.

The first local full-suite runner measurement on source head `28ff3d4b5c6e70ff0c6ea1b11ad0fea4283887fd`, before the final critical-branch gap tests, was:

| Module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| `apps/server/src/chain-routes.ts` | 314/314 (100.00%) | 75/77 (97.40%) | 17/17 (100.00%) |
| `apps/server/src/chain-store.ts` | 1538/1663 (92.48%) | 332/395 (84.05%) | 52/52 (100.00%) |
| `apps/server/src/chain-sync.ts` | 461/464 (99.35%) | 139/150 (92.67%) | 24/24 (100.00%) |
| `apps/server/src/m3-app.ts` | 42/42 (100.00%) | 21/22 (95.45%) | 3/3 (100.00%) |
| `apps/server/src/m3-chain-runtime.ts` | 398/401 (99.25%) | 115/117 (98.29%) | 17/17 (100.00%) |
| `apps/server/src/m3-pass-integration.ts` | 159/159 (100.00%) | 37/37 (100.00%) | 9/9 (100.00%) |
| `apps/server/src/m3-startup.ts` | 171/186 (91.94%) | 66/74 (89.19%) | 16/19 (84.21%) |
| `apps/server/src/m3-vault-integration.ts` | 245/245 (100.00%) | 59/59 (100.00%) | 10/10 (100.00%) |
| `packages/chain-adapter/src/keccak.ts` | 89/89 (100.00%) | 18/18 (100.00%) | 3/3 (100.00%) |
| `packages/chain-adapter/src/manifest.ts` | 167/167 (100.00%) | 37/37 (100.00%) | 5/5 (100.00%) |
| `packages/chain-adapter/src/pass-abi.ts` | 78/78 (100.00%) | 26/26 (100.00%) | 7/7 (100.00%) |
| `packages/chain-adapter/src/rpc.ts` | 393/400 (98.25%) | 131/140 (93.57%) | 23/23 (100.00%) |
| `packages/chain-adapter/src/vault-abi.ts` | 282/282 (100.00%) | 88/88 (100.00%) | 19/19 (100.00%) |

That first local measurement totaled 96.59% lines, 92.26% branches, and 98.56% functions. Macbeth05's independent run on the same `28ff3d4` source measured 96.59% lines, 92.11% branches, and 98.56% functions (raw LCOV SHA-256 `99989cc423ebc590e22fca9c53f5071a26f25e577d2bfbc9e25817cb8e422e2e`). Both source results are retained; the 0.15 percentage-point branch difference is not normalized away.

After Macbeth05 enumerated the remaining authorization/accounting zero-hit records, the added tests exercise failed-runtime evidence reads, operation disappearance between route match and snapshot read, malformed RPC block/log/topic/quantity evidence, bounded retry exhaustion, duplicate event identity, operation identity rebinding, checkpoint and projection commit races, every operation-evidence lifecycle mapping, incomplete sync, unavailable reorg ancestry, projection recovery and supersession, wrong block numbers, stale completion, replaced checkpoints, non-canonical receipts, terminal-operation early returns, and the maximum-safe-height range overflow.

The resulting local runner evidence is 643/643 tests with 97.37% lines, 95.39% branches, and 98.56% functions across the same 13 files. Relevant branch results are `chain-routes.ts` 100.00%, `chain-store.ts` 88.81%, `chain-sync.ts` 99.39%, and `rpc.ts` 99.34%. Every concrete zero-hit record in Macbeth05's frozen authorization/accounting list is now exercised locally. Two raw instrumentation records remain outside that list: the unconditional `finally` entry in `ChainSynchronizer.syncTo`, and the closing brace after `JsonRpcClient.#request`'s retry loop. The first has no source condition and always releases the serialized turn; the second precedes a fallback that cannot be reached because every final-attempt path returns or throws. Neither is removed or counted as covered. Independent Macbeth05 rerun remains required before final acceptance.

The focused report is not an overall repository coverage claim. Remaining `chain-store` branches are primarily schema-corruption, impossible concurrent mutation, migration, and rollback failure paths; they remain visible rather than being deleted or presented as covered. New tests exercise actual amount/precision, target/chain identity, receipt/finality, close/rescue settlement state, stale checkpoint, sync range, unknown log, malformed projection, and corrupt persisted JSON behavior.

Earlier local raw LCOV SHA-256: `673bc4634643ad5ac8ce819eb1254692a90070f242bffe06cc141a1983375c88`.

Post-gap local raw evidence:

- Full test/coverage log SHA-256: `40572353708adbc324748785ac2f8bd851b3a12876219788e74be28f849ea9e8`.
- Raw LCOV SHA-256: `85266fd59cfa22e11492dc2c096ad8c5e1ac9a926b1fa717f272e4b7ae535da5`.
- Raw zero-branch summary SHA-256: `128e8df6bd70c1d8228a077431b96dbb0f0e1d5cdb27c693868ea7813ca94199`.

## External-state boundary

No deployment, initialization, external RPC write, wallet signature, transaction broadcast, mainnet enablement, or merge was performed. Concrete Testnet addresses, deployment blocks, constructor values, and deployed runtime hashes remain required before the prepared smoke procedure can advance past its authorization gate.

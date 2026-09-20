# Macbeth03 M3 Phase 1 Recovery Report

Status date: 2026-09-20
Task: `M3-03-PHASE1-RECOVERY`
Base: `18f5352070910a867b9729b031aa2e3951785e01`
Branch: `macbeth03/m3-phase1-recovery`
Runtime boundary: Local / Mock / NOT_DEPLOYED

## Delivered

- Deployment identity now binds the exact Vault and StrategyPass addresses, deployment blocks, ABI hashes, deployed runtime bytecode hashes, and manifest digest. Runtime checks chain ID and both live code hashes before indexing.
- SQLite projection recovery includes online no-overwrite backup, fixed health output, supported migrations, bounded catch-up, canonical reorg recovery, and fail-closed reads.
- Multiple Vault runtimes remain isolated by chain, contract, wallet, strategy, checkpoint, projection, and operation target. The historical `app.ts` provenance hash is preserved through the additive `m3-app.ts` composition layer.
- StrategyPass transfer is pinned to Macbeth02 source `2ad816200e7edfbfad96d765b4a696bc8b838c2d`, evidence head `a13052993b6f408b7be835ecd6f4b13ef6df367d`, and ABI Keccak-256 `0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f`.
- The Pass adapter accepts only manifest-bound `transfer(address,uint256)` with a nonzero recipient and a positive uint256 raw amount. It preserves full 18-decimal precision, including one raw unit.
- A separate StrategyPass synchronizer indexes canonical `Transfer` events, reconciles sender/recipient/amount, verifies decimals and strategy identity, reads actual canonical balances, and serves `GET /api/v1/chain/passes/:contract/:owner`.
- Operational documents cover the recovery matrix, database restore, Macbeth04 API handoff, and a smoke procedure that stops before signing or broadcast.

## Verification

- Fixed toolchain: Node `24.21.0`, npm `11.19.1`, Git `2.50.1`.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run format:check`: PASS.
- `npm test`: PASS, 613/613.
- `npm run secrets:check`: PASS.
- `npm run privacy:check`: PASS.
- `npm run env:check`: exit 0; local/mock admission, workspace warning for the intentional task diff, contracts `NOT_RUN`.

Focused Node LCOV after the Macbeth05 gap report:

| Module | Branches |
| --- | ---: |
| `apps/server/src/m3-pass-integration.ts` | 37/37 (100.00%) |
| `packages/chain-adapter/src/pass-abi.ts` | 26/26 (100.00%) |
| `apps/server/src/m3-vault-integration.ts` | 59/59 (100.00%) after removing two proven unreachable catches behind validated string/decimal guards |
| `packages/chain-adapter/src/rpc.ts` | 131/140 (93.57%) |
| `packages/chain-adapter/src/vault-abi.ts` | 78/86 (90.70%) |
| `apps/server/src/chain-sync.ts` | 137/150 (91.33%) |
| `apps/server/src/chain-store.ts` | 315/381 (82.68%) |

The focused report is not an overall repository coverage claim. Remaining `chain-store` branches are primarily schema-corruption, impossible concurrent mutation, migration, and rollback failure paths; they remain visible rather than being deleted or presented as covered. New tests exercise actual amount/precision, target/chain identity, receipt/finality, close/rescue settlement state, stale checkpoint, sync range, unknown log, malformed projection, and corrupt persisted JSON behavior.

Focused LCOV SHA-256: `213074562b0432bf0df164fbd0223b8bec03a7266f2ea438ae4d39f024911d86`.

## External-state boundary

No deployment, initialization, external RPC write, wallet signature, transaction broadcast, mainnet enablement, or merge was performed. Concrete Testnet addresses, deployment blocks, constructor values, and deployed runtime hashes remain required before the prepared smoke procedure can advance past its authorization gate.

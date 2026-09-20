# Macbeth02 Phase One Contract Evidence Index

- Producer: `Macbeth02`
- Task: `M3-02-PHASE1-CONTRACTS`
- Worker source: `a13052993b6f408b7be835ecd6f4b13ef6df367d`
- Manager source bound by contract-tree equality: `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`
- Contract tree: `0fa7e3e471f32a6d6b742e42540add6e047b536a`
- Evidence boundary: `LOCAL / MOCK / NOT_DEPLOYED`

Additive entrypoint correction after `bbf54cc`: see `Macbeth02-ENTRYPOINT-CLOSURE.md`.
Production, Solidity tests, deployment artifacts and compiler inputs remain equivalent; the gate
shell script and its new Python regression are a separate, explicitly verified delta. The previous
complete-tree binding above applies to the historical source checkpoints, not this additive fix.

## Requirement-to-evidence map

| Requirement | Authority / implementation | Focused tests or verifier | Evidence status |
| --- | --- | --- | --- |
| Fixed supply, nonzero Strategy ID, unrestricted fractional Pass transfer | `contracts/src/StrategyPass.sol:6-22` | `StrategyPass.t.sol`; `StrategyPass.invariant.t.sol` | Executed at PR24 source checkpoint and independently by 05; source-equivalent at manager candidate |
| Explicit immutable Owner, separate Creator, no deployer/factory custody | `AlphaForgeVault.sol:21-29,37-77` | `AlphaForgeVault.custody.t.sol` explicit-owner/factory/role tests; `Phase1DeploymentRehearsal.t.sol:105` | Executed at PR24 checkpoint; unchanged source |
| Pass 18 / AF-USDC 6 decimals and exact `10^12` conversion | `AlphaForgeVault.sol:19,64-67,188-196` | custody conversion, minimum-unit, overflow, wrong-decimal and ordinary-transfer tests | Executed at PR24 checkpoint; core coverage 100% |
| Deposit and per-Vault Pass lock | `AlphaForgeVault.sol:82-98,224-242`; `PassLocker.sol:24-52` | custody deposit cases; `PassLocker.t.sol` controller, deficit, direct-transfer and zero-amount cases | Executed at PR24 checkpoint; core coverage 100% |
| Profit-first/principal/loss withdrawal semantics | `AlphaForgeVault.sol:100-136,198-208` | `AlphaForgeVault.accounting.t.sol` profit, mixed, principal, loss and position cases | Executed at PR24 checkpoint; core coverage 100% |
| Full close and release | `AlphaForgeVault.sol:138-155`; `PassLocker.sol:54-69` | accounting loss-close/position cases; Locker unlock/release cases | Executed at PR24 checkpoint; core coverage 100% |
| Untracked dust and post-close Owner rescue | `AlphaForgeVault.sol:157-185,210-222` | `AlphaForgeVault.rescue.t.sol`; custody dust cases; boundary empty-rescue cases | Executed at PR24 checkpoint; core coverage 100% |
| Short transfer, failed transfer, reentrancy and rollback | `AlphaForgeVault.sol:224-258`; `PassLocker.sol:43-81` | rescue short/failed/reentrant cases; Locker malicious/deficit cases; accounting invariants | Executed at PR24 checkpoint; core coverage 100% |
| Frozen selectors, topics, errors and published ABI | `contracts/deployment/abi/AlphaForgeVault.abi.json`; `check_vault_artifact.py` | `AlphaForgeVault.interface.t.sol`; fresh local compiler/ABI equality | Fresh compiler-bound comparison passed at manager-equivalent contract tree |
| Constructors, bytecode, immutable offsets and full artifact inventory | `phase1-contract-artifacts.json`; `build_phase1_contract_manifest.py` | 24 Python mutation/verifier tests at PR24; fresh schema-2 manifest `--check` | Fresh compiler-bound comparison passed; named immutable mapping remains deliberately unclaimed |
| Locked local VM deployment and owner lifecycle | `Phase1DeploymentRehearsal.t.sol` | two offline Forge EVM rehearsal tests through `check-phase1-contracts.sh` | Executed at PR24 and independently by 05; not repeated because rehearsal source/config are object-identical |

## Compiler and deployment inventory

The schema-2 artifact manifest remains `LOCAL_COMPILED_NOT_DEPLOYED` with
`externalWritePerformed: false`. The minimum candidate has five explicit constructor deployments:

1. AF-USDC, AF-ETH and AF-BTC, each with `(uint256 fixedSupply_, address recipient_)`.
2. StrategyPass with
   `(string name_, string symbol_, bytes32 strategyId_, uint256 fixedSupply_, address recipient_)`.
3. AlphaForgeVault with
   `(address owner_, address strategyCreator_, bytes32 strategyId_, bytes32 strategyRef_, address pass_, address afUsdc_, address afEth_, address afBtc_)`.

The Vault then constructs `PassLocker(address vault_, address owner_, address pass_)` internally;
a separately deployed Locker cannot replace that lifecycle. Minimum-candidate immutable evidence is
13 compiler-reference groups / 64 locations: Vault 9/49, Locker 3/14 and Pass 1/1. The complete
eight-contract compiled inventory is 20 groups / 86 locations. All locations have exact start and
length values, while compiler reference IDs remain intentionally not mapped to source field names.

| Contract | ABI Keccak-256 | Creation bytecode Keccak-256 | Compiler runtime-template Keccak-256 |
| --- | --- | --- | --- |
| `AlphaForgeVault` | `0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977` | `0x377b3ad4ed5a804d202d3461c2a6dc59045762351ce74086f7870a2def71b190` | `0x84ba496c3b70467dda328768dc78e53820a94db9e19127b7d63f4b167f0c4908` |
| `PassLocker` | `0x3cd4ab8da2123200b3e4b931cb94a5cc11b5662360c4ed70d6643f173ff53b21` | `0xacc5aca165af774f0292aa7249567376e434e09712983be29dcfa33b0b9d2d68` | `0x3a23133c185856bb68e825ae1ecac929de131bdcbaf2154c3c7e4e24098bc494` |
| `StrategyPass` | `0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f` | `0x0fe405ceaf14c653995f488031f5e5efd3e9e11ecb946792ddb4f24d5d365541` | `0x1ecd66286e0c94cb5f8d98308f59f086103b5c95f2b07dc524bc5e2919b1435e` |

Runtime-template hashes include compiler immutable placeholders and are not deployed-runtime hashes.
No address, transaction, block, receipt or deployed runtime is inferred from them.

## Current local artifacts

| Artifact | Purpose | SHA-256 |
| --- | --- | --- |
| `evidence/Macbeth02-3a78e34-contract-equivalence.log` | Git object/subtree binding and documentation-delta classification | `6538e1b11766129860e967a7f90b645a8b4270ccb2b702503b9aa0bf74aa7893` |
| `evidence/Macbeth02-3a78e34-compiler-equality.log` | Offline forced compile plus published ABI and schema-2 manifest equality | `afb841d1a008b16d0e8d97fc6256d9ac60d8c8225cd4f69d4a060610671e86a3` |
| `evidence/Macbeth02-a130-coverage-scope.log` | File-level classification of the retained independent LCOV without rerunning coverage | `6d323c24090fc86f0291f6862fc0f7d4473cf19da438ee112bd1e7a594401f62` |
| `evidence/Macbeth02-final-validation.log` | Staged scope, metadata/privacy, evidence-index and final equivalence checks | `1de1af6ea593a447d2e9d2ed8e6128c058d0f9c051886e3001fe766bef43a2b2` |
| `evidence/Macbeth02-entrypoint-cwd-regression.log` | Additive entrypoint red/green regression and real pinned 2/2 deployment rehearsal; task-root paths redacted, raw hashes retained | `25b200f8219c655352cb390fbde9ffc2ca2fcfdf20c418e20f3025a887f112f0` |

The hashes above bind the final reviewed evidence bytes before the local commit.

## Historical and independent checkpoint artifacts

The manager candidate contains Macbeth05's exact-source independent record for PR24:

| Artifact described by Macbeth05 | SHA-256 |
| --- | --- |
| `pr24-independent-contract-gate.log` | `ce21fa201e92aa7751e95a95e091d2930356b7af197eed6c70c32017b9f400dd` |
| `pr24-independent-coverage.log` | `25216f3495f82aa343f6fb0c64bd91bcace356857a7f5337074d834df7218eab` |
| `pr24-independent-coverage.lcov` | `ab68b1355c159d195c72ef262246b7ad7ffcc5fcee0b127fa31b2141ffa95115` |
| task-local `slither.json` | `6075497f3ba5e1b4cbd5302241e78e7ad61e5b81e371a86ed2bdeff356557046` |

These hashes document independently executed source-checkpoint evidence. They are not copied into
this worktree, relabelled as this turn's execution, or treated as hosted/remote evidence.

## Management collector four-`NOT_RUN` index

`tools/management-dashboard/checks.mjs:75-102` explicitly registers the following four entries as
unavailable; `runCheck` returns `NOT_RUN`, null exit code and reason
`NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` at lines 195-216.

| Collector ID | Separate real entry | What that entry covers | Collector status |
| --- | --- | --- | --- |
| `foundry` | `bash contracts/script/check-phase1-contracts.sh` → `check-m3-vault.sh` → `check-local.sh` | locked tool/archive verification, format, offline build, all Solidity tests and manifest/ABI gates | `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` |
| `fuzz` | same `forge test --offline` entry; `foundry.toml` fixes 256 runs and seed `0x04` | fuzz properties executed within the complete Forge suite | `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` |
| `invariant` | same `forge test --offline` entry; `foundry.toml` fixes 64 runs, depth 32 and fail-on-revert | StrategyPass and Vault stateful invariant suites | `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` |
| `slither` | `check-local.sh` strict `slither ... --fail-pedantic --json -` step | pinned Slither `0.11.3`, compiled first-party sources, dependencies excluded from finding scope, any finding fails | `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` |

The independent contract entry reports PASS at the PR24 source checkpoint, while all four collector
records remain `NOT_RUN`. This index links the two evidence systems without pretending that the
collector executed the external entrypoint.

## Coverage denominators

| Scope | Lines | Statements | Branches | Functions | Meaning |
| --- | ---: | ---: | ---: | ---: | --- |
| Frozen core: Vault + Locker + Pass | 100% | 100% | 100% | 100% | Critical authorization/accounting contract scope |
| Complete compiled report | 95.53% | 95.12% | 73.42% | 95.54% | Includes optional compiled contracts and test support code |

The complete compiled values are retained as originally measured. They are not averaged with
Node/browser coverage and do not close the separate overall Phase One coverage item.

The broader production misses are `AlphaForgeSwapAdapter.sol` at 41/45 lines and 5/8 branches and
`AlphaForgeTestVenue.sol` at 74/76 lines and 10/16 branches. Both belong to compiled inventory that
is excluded from the minimum Phase One deployment candidate with deferred strategy execution.
Remaining misses come from invariant handlers, harnesses and malicious/mock support code. They stay
visible in the broad denominator; no new frozen-core behavior defect was identified.

## Explicit `NOT_RUN` and blocked boundaries

- GitHub Actions/Checks execution and status queries: paused by the user; not performed.
- Final external security assessment and eligible independent approval: not supplied by this task.
- Robinhood Chain Testnet deployment, wallet signing, broadcast, receipts, addresses, deployed
  runtime hashes and finality: `NOT_RUN / NOT_DEPLOYED`.
- Merge: not authorized.

# Phase 1 findings and blockers

These records apply to base `18f5352070910a867b9729b031aa2e3951785e01`. A later candidate requires independent retest. Severity describes product or release impact; blocker class states what cannot close while the record remains open.

## M3-05-P1-001 — Coverage targets are not met or completely measured

| Field         | Value                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Status        | `OPEN`                                                                                                                 |
| Severity      | `MEDIUM`                                                                                                               |
| Requirements  | `P1-COVERAGE-01`, `P1-COVERAGE-02`                                                                                     |
| Blocker class | `MILESTONE_COMPLETION_BLOCKER`                                                                                         |
| Owners        | Macbeth02 for contracts, Macbeth03 for adapter/API, Macbeth04 for product; Macbeth01 coordinates the unified candidate |
| Fix SHA       | Pending                                                                                                                |
| Retest        | Pending exact final candidate                                                                                          |

Reproduction: run all 591 top-level tests under Node built-in coverage with the recorded first-party includes, and run `forge coverage` with the locked contract toolchain.

Expected: actual overall automated coverage is at least 90% with a complete stated denominator, and critical authorization/accounting branches are 100% covered.

Actual: Node reports 91.67% lines, 84.67% branches, and 94.30% functions for loaded test files, but only 77 of 98 extension-based candidate files appear. A separate real-workflow collection probe increased representation to 78 / 98 and proved npm/Node child-process union collection. Follow-up established that 98 is not an executable denominator: `reconciliation.ts` is type-only, while the tracked prototype HTML contains the omitted product script emitted as `user-ui.js`. The admitted tools still cannot derive comparable runtime ranges for all unexecuted and production-browser source. Actual combined JS/TS overall coverage therefore remains `NOT_MEASURED`; [Complete Coverage Collection Method](COVERAGE-COLLECTION-METHOD.md) records the corrected classification. Critical JS/TS branches include values from 52.69% to 98.77%. First-party Solidity totals 95.24% lines and 66.23% branches; AlphaForgeVault has 65.12% branch coverage and PassLocker 77.78%. The earlier 99/22 checkpoint was an off-by-one inventory error caused by retaining one `.d.ts` declaration in a list whose stated method excluded declarations; [Coverage Gaps](COVERAGE-GAPS.md) preserves both corrections and the evidence.

Impact: the base cannot demonstrate the project quality bar and leaves authorization, accounting, RPC, ABI, recovery, and allowance branches unexercised.

Latest published checkpoint: PR #26 head `67b7d48e7e393133b1b231aa4dc20d1319665278`
passes all 617 Node tests, but an independent full-suite collection over 13 explicitly included
critical Chain/API sources reports 96.44% lines, 88.98% branches and 98.52% functions. The missing
branches include runtime wrong-chain and StrategyPass-code mismatch handling, manifest identity,
unknown or duplicate routing, unavailable projection/evidence, ABI/event rejection, recovery,
reorg and store cases. This is below the frozen 100% critical-branch requirement, so the finding
remains `OPEN`; the two reconciliation integration modules at 100% do not establish the wider
critical control-path result. Combined JS/TS overall coverage also remains `NOT_MEASURED` under the
six-class method.

Final PR #26 worker checkpoint `28ff3d4b5c6e70ff0c6ea1b11ad0fea4283887fd` passes 627/627
tests and improves the same 13-source population to 96.59% lines, 92.11% branches and 98.56%
functions in Macbeth05's independent run. Wrong-chain, StrategyPass-code mismatch, manifest
identity and Vault ABI/event-cardinality branches are now covered. Critical gaps remain in
operation-evidence unavailability, reorg/projection recovery, canonical checkpoint and lease races,
event/operation identity conflicts, operation-state evidence mapping and malformed RPC evidence.
The 13-file average cannot substitute for the frozen critical-branch 100% requirement, and combined
JS/TS overall coverage remains `NOT_MEASURED`; the finding remains `OPEN`.

Final remediation checkpoint `a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`, tree
`bf9726cd560c51a7c60e320e1bdfe45501c9a91b`, passes 643/643 tests and improves the same population
to 97.37% lines, 95.39% branches and 98.56% functions. Every concrete frozen critical zero-hit from
`28ff3d4...` is now covered. The only residual records adjacent to that subset are
`chain-sync.ts:242`, a nonsemantic V8 branch record on a `finally` brace whose body executes, and
`rpc.ts:325`, a loop-close record whose following fallback is unreachable because the final retry
must return or throw. Macbeth05 therefore records the critical Chain/API subset as
`PASS_AT_PR26_SOURCE_CHECKPOINT` without changing the raw 95.39% branch figure. The finding stays
`OPEN` because combined JS/TS overall coverage remains `NOT_MEASURED` and the separate contract,
Chain/API and product checkpoints have not been rerun on one exact unified candidate.

Local integration candidate `639ffd8f85a89ee9266112c6d80e90e9428381a2`, tree
`7a6b8cc6ae06d8424674669727b06cf0f923c4ba`, contains the unchanged PR #24 contract source, PR #26
Chain/API source and PR #27 product source. Macbeth05 independently reran its complete 705-test
list and the 13-source critical collection. All tests pass; the critical collection reports 97.37%
lines, 95.40% branches and 98.56% functions, with the same two nonsemantic or unreachable V8
records described above. This establishes `PASS_AT_639_LOCAL_CANDIDATE` for the frozen concrete
critical subset. The finding remains `OPEN` because combined JS/TS overall coverage is still
`NOT_MEASURED` and the candidate lacks final C/R/S and hosted evidence.

Refreshed candidate `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`, tree
`6f1a21845a99e16a0ba171612cd97e9bf3439294`, retains the same functional source and passes the
complete 711-test list. Its independently rerun 13-source collection reports 97.37% lines, 95.40%
branches and 98.56% functions; every frozen concrete critical branch remains covered. C/R/S,
management identity and source hygiene now pass. `M3-05-P1-001` remains `OPEN` only for the overall
JS/TS denominator: the new canonical AST counter has a valid small same-source Node/browser probe,
but full syntax, subprocess and incomplete-process qualification is still pending, so overall
coverage remains `NOT_MEASURED`.

## M3-05-P1-002 — Phase 1 has no usable Pass transfer product operation

| Field         | Value                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Status        | `PASS_AT_3A78_LOCAL_CANDIDATE / OPEN_FOR_FINAL_ACCEPTANCE`                                                                |
| Severity      | `MEDIUM`                                                                                                                  |
| Requirements  | `P1-SCOPE-01`, `P1-PRODUCT-01`                                                                                            |
| Blocker class | `MILESTONE_COMPLETION_BLOCKER`                                                                                            |
| Owners        | Macbeth04 product flow with Macbeth03 adapter/interface and Macbeth02 contract/interface alignment; Macbeth01 coordinates |
| Fix SHA       | `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`                                                                                |
| Retest        | Independent local candidate pass; hosted and final governance evidence pending                                            |

Reproduction: inspect the supported onchain action union and open the actual `/trade/trend` product entrypoint in production and the explicitly marked local fixture.

Expected: Phase 1 exposes a usable Pass transfer operation while paid Buy/Sell remains unavailable.

Actual: the contract provides standard ERC20 transfer and tests prove fractional 18-decimal transfer, but the product action surface contains only Deposit, Withdraw, and Close. Buy/Sell is correctly unavailable and there is no separate Pass transfer action.

Impact: ordinary contract capability cannot substitute for the required user product operation; the frozen Phase 1 scope is incomplete. Macbeth01 selected the full product-operation option and rejected a low-level-only acceptance path.

Closure candidate: PR #27 head `332549c07239c41c1f1c3735cc1e5e8f247d3d6b` adds the exact
18-decimal Pass transfer product operation, fixed-recipient review, single-use submission,
contract-qualified read/registration paths and post-close rescue. Its targeted 125-test product
group passes. The finding remains `OPEN` until those changes are present in the exact unified
candidate and the real final browser journey passes; the checked-in PR #27 browser evidence names
older product and Chain/API source identities.

Latest closure checkpoint: PR #27 head `ffe7d08b0aa4fc2a71e01418033ced942526bfdf`, tree
`544c9204dbaf2425acb9cac4cbdf01526d7ad7b3`, retains the product code from `bb8b628...` and passes
Macbeth05's independent 86/86 focused multi-Vault group, 137/137 critical-product group and local
real-browser journey. The browser proved one-raw-unit transfer, exact balance delta, reviewed
allowlisted selection, two independent Owners and spenders, per-Vault allowance isolation, shared
Pass identity, review clearing on selection, and wrong-network write shutdown. The finding remains
`OPEN` only until the same product source is present and rerun in the exact unified candidate.

Macbeth05 independently verified that exact product source within local integration candidate
`639ffd8f85a89ee9266112c6d80e90e9428381a2`. The complete suite passes 705/705. The real
`DEV_MOCK` browser journey proves a one-raw-unit Pass transfer and exact balance delta, separate
Vault Owners and spenders, per-Vault allowance isolation, review invalidation on Vault selection,
and complete wrong-network write shutdown. This finding is functionally resolved at that local
candidate, while final acceptance stays open until the candidate is bound to regenerated C/R/S and
hosted evidence.

Candidate `3a78e34...` changes no product source from that browser-validated candidate, passes
711/711 tests and now carries valid C/R/S and management evidence. The finding is therefore
`PASS_AT_3A78_LOCAL_CANDIDATE`; the overall milestone remains open only for the separate coverage
and external acceptance conditions.

## Integration and external blockers

| ID           | State     | Basis                                                                                                                               | Owner / closure condition                                                                                    |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| M3-05-P1-B03 | `BLOCKED` | Historical final security review remains service-limited; ordinary functional QA and the local Slither pass are different evidence. | Authorized qualifying service result for the exact candidate, or explicit closeout retaining the limitation. |
| M3-05-P1-B04 | `BLOCKED` | Real Robinhood Chain Testnet writes, deployment, signing, and broadcast are outside this task's authorization.                      | Separate applicable authorization and transaction/readback evidence.                                         |
| M3-05-P1-B05 | `NOT_RUN` | Hosted required checks and independent review are separate from Macbeth05's local evidence.                                         | Macbeth06/provider results and eligible independent approval on the exact candidate.                         |

`M3-05-P1-B01` and `M3-05-P1-B02` are resolved at `3a78e34...`: candidate-bound C/R/S and the
management dashboard pass, and the base-to-candidate `git diff --check` output is empty. The exact
local Gitleaks gate also passes. That gate preserves the raw historical FAIL and dispositions only
the exact approved one-row immutable occurrence; its current-tree scan remains independent.

## Resolved execution blocker

`M3-05-P1-X01` initially blocked the unchanged contract gate because the official index could not supply the locked Slither wheel set after the fixed compiler download had also timed out. It is `RESOLVED_FOR_LOCAL_REPRODUCTION`: all 47 wheel bytes and metadata were independently verified against the immutable lock, force-installed offline into this task's isolated venv, and the original gate subsequently passed. The earlier official-source/index failures remain recorded and no version, hash, index configuration, script, or security-service restriction was changed.

`M3-05-P1-B06` was reopened after the original temporary toolchain disappeared and is now
`RESOLVED_FOR_PR24_SOURCE_CHECKPOINT`. The original bootstrap independently restored Forge,
OpenZeppelin and all 47 hash-locked wheels. The fixed solc endpoint timed out twice, so Macbeth05
copied the approved public artifact bytes from a known local task environment into its own isolated
directory. Source and copy had distinct inodes, both were 35,738,976 bytes with SHA-256
`f5a243d6b2dd8fba307e36c5fefa2d8eb3ae74ba81036d1c17c971b5d346ade9`, and the copy was read-only.
The unchanged gate and coverage then passed independently. An exact unified candidate still
requires a fresh verification and rerun.

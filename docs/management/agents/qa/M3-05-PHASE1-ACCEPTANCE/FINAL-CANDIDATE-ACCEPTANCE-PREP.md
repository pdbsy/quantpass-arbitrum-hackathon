# Final candidate acceptance preparation

Recorded: 2026-09-20 (Asia/Shanghai)

Task: `M3-05-PHASE1-ACCEPTANCE`

Status: `LOCAL_CANDIDATE_RERUN_COMPLETE / FINAL_EVIDENCE_BLOCKED`

This record maps the currently published Phase One contract, Chain/API and product sources to the
frozen QA requirements. It defines the commands, real journeys, inputs and decision rules that
Macbeth05 will use after Macbeth01 freezes one exact unified candidate. The published worker heads
below are source checkpoints only. Results from different commits are not combined into a final
candidate PASS.

## Published source checkpoints

| Area                      | Published identity                                                                          | QA interpretation                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract implementation   | `2ad816200e7edfbfad96d765b4a696bc8b838c2d`, tree `ea7be39d0b40b3d6421cf2d7c680a7ca251b8aae` | PR #24 implementation source. Worker evidence head `a13052993b6f408b7be835ecd6f4b13ef6df367d`, tree `0db6b922fa8c33219793f4d758e39d46665905d0`. Independent locked-toolchain gate and coverage pass at this checkpoint.                                                                                                                     |
| Earlier Chain/API handoff | `500914b900d61ea5b26c32ab5cc39c4b0d829c3c`, tree `f5257183b1b114295e565f1799b736a124797f72` | Source consumed by the product worker. Superseded for final integration by the later PR #26 head.                                                                                                                                                                                                                                           |
| Latest Chain/API head     | `a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`, tree `bf9726cd560c51a7c60e320e1bdfe45501c9a91b` | PR #26 final remediation checkpoint. The independent full suite passes 643/643 and the same 13-source population reports 97.37% lines, 95.39% branches and 98.56% functions. Every concrete frozen critical zero-hit from the preceding checkpoint is covered; two residual V8 branch records are source-proved nonsemantic or unreachable. |
| Latest product head       | `ffe7d08b0aa4fc2a71e01418033ced942526bfdf`, tree `544c9204dbaf2425acb9cac4cbdf01526d7ad7b3` | PR #27 final evidence checkpoint. Product code is unchanged from `bb8b628efa092e9f83669ee62263e4910a7f1418`. Independent 86-test focused and 137-test critical-product groups pass, and the local real-browser multi-Vault journey passes. It remains a separate worker source rather than the unified candidate.                           |

## Local unified candidate checkpoint

Macbeth01 supplied a readable local worktree for candidate
`639ffd8f85a89ee9266112c6d80e90e9428381a2`, tree
`7a6b8cc6ae06d8424674669727b06cf0f923c4ba`. Macbeth05 cloned it with `--no-local --no-hardlinks`
into `/private/tmp/AlphaForge-M3-05-INTEGRATION-639FFD8`, checked out the exact SHA detached, and
installed 193 packages with `npm ci --ignore-scripts`. The candidate contains PR #26
`a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`, PR #27
`ffe7d08b0aa4fc2a71e01418033ced942526bfdf`, and prior QA source `c27c869...`.

Path-scoped source comparison produces no diff for `contracts/**` against PR #24 evidence head
`a130529...`, no diff for the critical Chain/API source and test population against PR #26
`a4d73bb...`, and no diff for the product source and critical product tests against PR #27
`ffe7d08...`. This permits the unchanged contract result to be inherited as source-equivalent while
the complete Node suite, critical coverage, identity, static/build gates and real browser journey
were rerun on the exact candidate.

The candidate passes 705/705 Node tests, typecheck, lint, format, secrets, privacy, web build, and
canonical identity verification for 64 records. The 13-source critical collection reports 97.37%
lines, 95.40% branches and 98.56% functions. The frozen concrete critical subset has no new
zero-hit; its only adjacent residual V8 records remain `chain-sync.ts:242`, the `finally` closing
brace whose body executes, and `rpc.ts:325`, the retry-loop closing brace before an unreachable
fallback. The real local `DEV_MOCK` journey passes multi-Vault Owner/spender/allowance isolation,
one-raw-unit Pass transfer with exact balance delta, pending-review invalidation on Vault switch,
and wrong-network disablement of Deposit, Withdraw, Close and Pass transfer. Buy/Sell remain outside
Phase One, strategy execution remains deferred, and browser warning/error logs are empty.

This is `LOCAL_UNIFIED_CANDIDATE_FUNCTIONAL_PASS`, not final acceptance. `management:check` fails
`RECORDED_GIT_BRANCH_MISMATCH` because no new candidate-bound C/R/S evidence exists. The exact
base-to-candidate `git diff --check` also fails because
`docs/protocol/PHASE1-TESTNET-DEPLOYMENT-PLAN.md` lines 3-4 contain trailing whitespace. Overall
JS/TS coverage remains `NOT_MEASURED`; hosted required checks, independent approval, the restricted
security-review result and authorized Testnet evidence also remain absent.

## Recovery and evidence boundary

The original `/private/tmp/AlphaForge-M3-05-PHASE1-ACCEPTANCE` checkout and all previously
referenced temporary evidence directories disappeared before this follow-up. Historical hashes in
the versioned records remain the only record of those historical artifacts. They are not claimed
as locally present or reconstructed.

Macbeth05 recovered a clean task worktree from the published QA branch at `a35f19b...` and created
new detached read-only worktrees for PR #24, PR #26 and PR #27. Each received its own
`node_modules` through `npm ci --ignore-scripts --prefer-offline`; no dependency directory or
SQLite data is shared. New files under `/private/tmp/AlphaForge-M3-05-RECOVERED-EVIDENCE` are
explicitly follow-up evidence, not replacements for the deleted historical bytes.

## Critical authorization and accounting map

| Frozen property                                                    | Contract evidence path at PR #24                                   | Chain/API or product evidence path at latest published source                                                                              | Final-candidate requirement                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Explicit immutable nonzero Owner; deployer/creator gain no custody | `AlphaForgeVault.custody.t.sol`, `Phase1DeploymentRehearsal.t.sol` | manifest-bound runtime and owner-qualified routes in `chain-runtime.test.ts`, `chain-api.test.ts`                                          | Independent contract gate plus owner/non-owner browser journey; every authorization branch covered                        |
| Nonzero, matching identities and immutable code/ABI                | constructor boundary tests and frozen interface/manifest gate      | `chain-rpc-manifest.test.ts`, `chain-runtime.test.ts`, `chain-vault-abi.test.ts`; product runtime-code and contract-qualified reader tests | Wrong chain, wrong code, wrong Pass strategy, malformed manifest/ABI and address conflict all fail closed                 |
| Exact six-decimal AF-USDC to eighteen-decimal Pass conversion      | custody conversion and fuzz tests                                  | exact raw calldata/event/view reconciliation; product amount and allowance tests                                                           | One AF-USDC base unit maps to `10^12` Pass raw units; inexact, zero, signed and overflow values reject                    |
| Initial allocation and ordinary 18-decimal Pass transfer           | `StrategyPass.t.sol` and fixed-supply invariant                    | `chain-startup.test.ts` and `chain-runtime.test.ts`; PR #27 one-raw-unit browser/runtime transfer                                          | Initial supply is truthful and non-sale; one raw Pass unit reaches the fixed reviewed recipient with no capacity rounding |
| Profit-first withdrawal                                            | `AlphaForgeVault.accounting.t.sol`                                 | `chain-vault-integration.test.ts` accounting identity checks                                                                               | Profit is consumed before principal and Pass unlock follows principal only                                                |
| Loss never automatically unlocks Pass                              | accounting tests and invariant                                     | reconciliation rejects inconsistent principal, profit or Pass deltas                                                                       | Loss, reorg, stale or malformed evidence cannot create unlocked capacity or READY state                                   |
| Exact transfer delta and atomic rollback                           | rescue/abnormal-token tests                                        | calldata, events, receipt, canonical views and operation identity reconciliation                                                           | Short/fee/reverting token behavior rolls back transfers, accounting and unlocks                                           |
| Terminal close and owner-only post-close rescue                    | accounting, rescue and invariant tests                             | close/rescue reconciliation plus PR #27 closed-state product actions                                                                       | Active rescue rejects; close clears obligations; only Owner can rescue actual unreserved token/native balance             |
| Confirmation depth 3 and reorg search limit 128                    | outside contract runtime                                           | ChainStore/synchronizer/startup tests and recovery drill                                                                                   | No READY before three confirmations; reorg recovery is bounded at 128 and deeper uncertainty fails closed                 |
| Multiple Vaults remain isolated and explicitly selected            | one Vault per deployment rehearsal                                 | `chain-api.test.ts` and `chain-startup.test.ts` multi-runtime cases                                                                        | Contract-qualified routes isolate Vault, owner, StrategyPass, database and evidence; ambiguous owner-only route must fail |
| Paid sale and strategy execution remain absent                     | contract delivery boundary                                         | product presentation and action union                                                                                                      | Buy/Sell stay unavailable and no strategy execution, pricing, liquidity or arbitrary target authority appears             |

Macbeth05 independently reproduced the PR #24 result: the three core contracts reach 100% lines,
statements, branches and functions; 134 Solidity and 24 Python tests pass; Slither reports no
detector. This closes the PR #24 source-checkpoint question but remains subject to an exact unified
candidate rerun.

## Exact final-candidate command set

Run from a clean isolated checkout after Macbeth01 supplies the exact SHA, tree and source
composition. Preserve complete stdout/stderr, exit status and SHA-256 for every artifact.

```bash
git status --short --branch
git rev-parse HEAD
git show -s --format=%T HEAD
node --version
npm --version
npm ci --ignore-scripts --prefer-offline
npm run verify:agent-identity
npm run env:check
git diff --check 18f5352070910a867b9729b031aa2e3951785e01..HEAD
npm run check
npm run build:web
```

The admitted versions remain Node `24.21.0` and npm `11.19.1`. Any version or lockfile drift stops
the run for review. `npm run check` must finish completely; a management C/R/S mismatch or other
late failure is a failed gate, even when earlier tests pass.

Run the latest Chain/API critical regression group explicitly:

```bash
node --test \
  test/chain-api.test.ts \
  test/chain-rpc-manifest.test.ts \
  test/chain-runtime.test.ts \
  test/chain-startup.test.ts \
  test/chain-store.test.ts \
  test/chain-sync.test.ts \
  test/chain-vault-abi.test.ts \
  test/chain-vault-integration.test.ts
node --test --test-name-pattern="local recovery drill measures" test/chain-store.test.ts
```

Run the latest product regression group explicitly:

```bash
node --test \
  test/m3-browser-runtime.test.ts \
  test/m3-chain-action-flow.test.ts \
  test/m3-injected-runtime.test.ts \
  test/m3-product-runtime.test.ts \
  test/m3-product-ui.test.ts \
  test/ui-chain-wallet.test.ts \
  test/ui-evm-keccak.test.ts \
  test/ui-m3-vault-actions.test.ts \
  test/ui-m3-vault-allowance.test.ts \
  test/ui-m3-vault-client.test.ts \
  test/ui-m3-vault-live-reader.test.ts
```

Run the unchanged contract gate from the repository root, then coverage from `contracts/` with the
same independently verified offline toolchain:

```bash
bash contracts/script/check-phase1-contracts.sh
cd contracts
forge coverage --offline --report summary --report lcov \
  --report-file ../.checks/af-chain01/evidence/phase1-final-candidate.lcov
```

The actual invocation must retain the clean `env -i`, pinned Forge `1.5.1`, pinned solc
`0.8.31+commit.fd3a2265`, task-local Slither venv, `SVM_HOME`, `FOUNDRY_DIR` and tool paths enforced
by the locked scripts. A system or newly downloaded substitute is not acceptable evidence.

### Exact PR #26 critical-source coverage command

The recovered runner at source `67b7d48...` reads `package.json`, requires the test script to be an
unmodified `node --test` file list, then invokes the same list with:

```text
node --experimental-test-coverage
  --test-coverage-include=apps/server/src/chain-routes.ts
  --test-coverage-include=apps/server/src/chain-store.ts
  --test-coverage-include=apps/server/src/chain-sync.ts
  --test-coverage-include=apps/server/src/m3-app.ts
  --test-coverage-include=apps/server/src/m3-chain-runtime.ts
  --test-coverage-include=apps/server/src/m3-pass-integration.ts
  --test-coverage-include=apps/server/src/m3-startup.ts
  --test-coverage-include=apps/server/src/m3-vault-integration.ts
  --test-coverage-include=packages/chain-adapter/src/keccak.ts
  --test-coverage-include=packages/chain-adapter/src/manifest.ts
  --test-coverage-include=packages/chain-adapter/src/pass-abi.ts
  --test-coverage-include=packages/chain-adapter/src/rpc.ts
  --test-coverage-include=packages/chain-adapter/src/vault-abi.ts
  --test-reporter=spec --test-reporter-destination=<candidate-evidence>/critical.log
  --test-reporter=lcov --test-reporter-destination=<candidate-evidence>/critical.lcov
  <every test file token from the exact candidate package.json test script>
```

The executable runner SHA-256 is
`9e7e074bcd5777854eda9f2ae52af3ba170dca755c70952ef502f5487648006c`. A later candidate must
regenerate this command from its own reviewed `package.json`; silently omitting a test file or
critical source invalidates comparison.

The zero-hit branch records at `67b7d48...` were:

```text
apps/server/src/chain-routes.ts: 69,73,75,78,81,83,88,94,134,245,250,275,293
apps/server/src/chain-store.ts: 166,202,227,232,266,275,278,333,417,426,454,491,505,516,
  535,536,537,539,550,566,638,640,685,697,700,706,724,732,768,772,801,807,809,863,
  865,873,912,933,1040,1057,1086,1141,1158,1164,1326,1330,1354,1356,1406,1423,1427,
  1436,1458,1463,1552,1556,1563,1566,1567,1568,1586,1596,1658
apps/server/src/chain-sync.ts: 61,126,216,219,242,284,331,359,375,401,402
apps/server/src/m3-app.ts: 12,14,20
apps/server/src/m3-chain-runtime.ts: 136,219,228,343
apps/server/src/m3-startup.ts: 49,91,92,95,96,99,102,103,104,115,147,152,153,159,177
packages/chain-adapter/src/manifest.ts: 93,144,146
packages/chain-adapter/src/rpc.ts: 171,177,195,199,213,229,302,325,338
packages/chain-adapter/src/vault-abi.ts: 112,187,231,245,254,259,268,277
```

`m3-pass-integration.ts`, `m3-vault-integration.ts`, `keccak.ts` and `pass-abi.ts` had no zero-hit
branch record. High-priority real behaviors behind the gaps include wrong-chain and StrategyPass
code mismatch startup, manifest expected-digest and address identity, empty/duplicate/ambiguous
runtime routing, unavailable projection or operation evidence, lease-superseded and non-canonical
recovery, malformed RPC responses and known-event topic cardinality. Tests must trigger observable
public behavior through existing fakes and lifecycle hooks. Branches proved unreachable by valid
public state should be documented with source evidence instead of forced through database or
private-state corruption.

At final PR #26 worker head `28ff3d4...`, 627/627 tests pass and the same source population reports
96.59% lines, 92.11% branches and 98.56% functions. Wrong-chain, StrategyPass-code mismatch,
manifest identity and Vault ABI/event-cardinality branches are now covered. Remaining frozen
critical gaps still include unavailable or missing operation evidence; reorg ancestor and
projection rebuild failures; wrong canonical block, lease and checkpoint races; event and operation
identity conflicts; non-canonical projections; operation-state evidence mapping; and malformed RPC
evidence. The final-head log SHA-256 is
`1238723a86d93a2192df7d06af5e84237c6d148512ebf27738ec670762db1918`, LCOV SHA-256 is
`99989cc423ebc590e22fca9c53f5071a26f25e577d2bfbc9e25817cb8e422e2e`, and zero-branch JSON SHA-256
is `c4cdbeaadc7db5f8ecf14cb0b4a23947e1d762c4af2b2a239f55887e195abbb2`.

The final-head critical classification is based on whether a branch can change authority,
canonical accounting, readiness or deterministic recovery:

| Critical population still requiring a hit or source-level unreachable proof | Final-head zero-hit positions                                                        | Reason                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Operation evidence availability                                             | `chain-routes.ts:245,250`                                                            | A failed runtime or missing projection evidence must not produce authority or readiness.                                         |
| Bounded synchronization and reorg recovery                                  | `chain-sync.ts:61,126,216,219,284,331,359,375`                                       | These branches enforce the 128-block bound, canonical ancestry, projection rebuild and lease/checkpoint consistency.             |
| Operation reconciliation state                                              | `chain-sync.ts:401,402`; `chain-store.ts:166,202,1463,1473,1552,1556,1563,1566-1568` | Confirmed, rejected, reorged, replaced and reconciliation-failed states must map deterministically and never create false READY. |
| Canonical store identity and concurrency                                    | `chain-store.ts:873,1012,1086,1326,1330,1354`                                        | Conflicting events/operations, lost leases and non-canonical projection blocks must fail closed.                                 |
| Untrusted RPC evidence                                                      | `rpc.ts:171,177,195,199,213,229,302`                                                 | Malformed block, receipt, log or call results and exhausted retries must not enter accounting state.                             |

The optional `webRoot` spread in `m3-app.ts`, optional policy/constructor-cleanup branches in
`m3-chain-runtime.ts`, and default timer/listen/cleanup branches in `m3-startup.ts` are not part of
the frozen authorization/accounting 100% subset. They remain in the wider reliability and overall
coverage population. Database migration, backup, health and corrupt-row branches likewise remain
visible in overall/recovery reporting; they are not silently removed from the denominator. This
classification narrows the critical claim by behavior, not by whichever branches happen to pass.

## Complete coverage collection

The final collection follows [Complete Coverage Collection Method](COVERAGE-COLLECTION-METHOD.md).
Use one new candidate-specific raw directory and set `NODE_V8_COVERAGE` before running the complete
gate and every accepted real Node lifecycle. Merge only artifacts whose SHA/tree, Node version and
worktree identity match. Run the pinned Node `TestCoverage` summarizer with `NODE_V8_COVERAGE`
removed from the summarizer environment, apply the recorded eight first-party include globs and
exclude declarations.

Reconcile every first-party source into exactly one of:

1. `MEASURED_NODE_SOURCE`;
2. `NOT_EXECUTED_NODE_SOURCE`;
3. `NOT_MEASURED_BROWSER_SOURCE`;
4. `MIXED_NODE_BROWSER_SOURCE`;
5. `NO_EXECUTABLE_CODE`;
6. `MEASURED_SOLIDITY_SOURCE`.

The extension inventory is a discovery aid rather than an executable denominator. Type-only
`reconciliation.ts` remains `NO_EXECUTABLE_CODE`; the tracked inline prototype script emitted as
`user-ui.js` remains first-party browser source. Builds and import-only probes do not count as
runtime coverage. Browser bundle byte coverage cannot be merged with source coverage without an
admitted source map and mapper.

## Real CLI journeys

All journeys stay local/mock and inherit the same candidate-specific Node coverage directory.

1. Start `npm run m3:server` with the committed `NOT_DEPLOYED` configuration. Require loopback-only
   binding, successful `/api/health` and static product delivery, truthful
   `/api/v1/chain/runtime-status`, disabled chain writes, and graceful `SIGTERM` with the port and
   SQLite handles released. No deployment, signing, broadcast or external RPC is permitted.
2. Exercise the existing multi-Vault builder through `test/chain-startup.test.ts`. Require two
   isolated runtime databases, explicit contract-qualified route selection, independent Vault and
   StrategyPass identities, and rejection of empty, inactive or shared database sets. No new test
   is authored by Macbeth05 for this preparation.
3. Run `npm run demo:backup` only against a new disposable local demo database and destination.
   Verify SQLite integrity, schema, expected records, mode `0600`, independent reopen, source
   preservation and refusal to overwrite an existing target. Never copy a live WAL file or restore
   over the only copy.
4. Run the named 128-block recovery drill. Require projections unavailable during catch-up,
   canonical checkpoint verification, bounded recovery through 128 blocks and fail-closed behavior
   beyond the supported ancestor search.

## Real browser journeys

First open the production build without the fixture. It must show `NOT_DEPLOYED`, disconnected or
unavailable network state, disabled writes, unavailable Buy/Sell and deferred strategy execution.
Require no browser warning/error, no horizontal overflow at the agreed desktop and mobile
viewports, and no claim of Testnet execution.

Then run the explicitly marked local fixture on the actual product route with chain `46630`:

1. prove wrong-chain, disconnect, account-change and non-owner states disable every owner write;
2. select a concrete Vault and require every read, submission registration and evidence lookup to
   use contract-qualified routes; with multiple Vaults, the ambiguous owner-only route must not be
   silently selected or retried;
3. verify the fixed Owner, Vault, StrategyPass, strategy identity, runtime hashes, deployment
   blocks, initial allocation and exact six/eighteen-decimal presentation;
4. review exact finite AF-USDC and Pass allowances with the selected Vault as spender;
5. transfer exactly one raw Pass unit to the fixed reviewed recipient, confirm only once, show
   `SUBMITTED` without claiming success, register the returned hash, read back evidence, and verify
   the exact balance delta after refresh;
6. prove stale review, double click, simulation failure, missing/conflicting backend registration,
   malformed response and ambiguous submission never auto-retry or become READY;
7. exercise confirmation depth 3, reorg, unavailable projection/evidence and degraded indexer;
   preserve only live-simulated Owner exit paths;
8. close the Vault, prove ordinary actions remain disabled, then review owner-only token and native
   rescue; an open Vault or non-owner must not reach wallet submission;
9. confirm paid Buy/Sell and strategy execution remain absent.

Any later real Testnet journey remains `NOT_RUN` until separately authorized deployment addresses,
manifest, RPC, wallet and signing/broadcast scope exist.

## Current inputs and evidence still missing

Candidate `3a78e34...` now has a clean source-hygiene result and candidate-bound C/R/S; the earlier
missing-candidate and missing-C/R/S prerequisites are resolved. Remaining inputs are:

- a tracked, reproducible and admitted overall Istanbul coverage entry satisfying
  [Coverage Method Admission Review](COVERAGE-METHOD-ADMISSION-REVIEW.md), followed by gap
  remediation and Macbeth05's exact-candidate replay;
- integration of Macbeth04 fix `aa6c764...` for the delayed wallet-operation/Vault-selection race
  into a new exact candidate, followed by the already defined focused Macbeth05 candidate replay;
- native Windows diagnostic and stable rerun evidence for the unexplained test-file process failure;
- Testnet deployment, addresses, manifest, RPC and explicit write authorization;
- the final independent security disposition, which the bounded `639ffd8...3a78e34...` scan and
  ordinary functional QA do not replace;
- hosted required-check results after the user explicitly resumes hosted execution/status reads,
  plus an eligible independent review and applicable merge authorization.

## Decision rules

A final `PASS` requires all of the following on one exact clean candidate:

- complete C/R/S identity and every required local and hosted gate passes;
- actual overall automated coverage is at least 90% over a complete, homogeneous and auditable
  source denominator; loaded-file percentages and `NOT_MEASURED` values do not satisfy the target;
- critical authorization and accounting branch coverage is 100% for both the contract core and
  applicable Chain/API/product control paths;
- the independent contract gate reports 134 Solidity tests, 24 Python tests and 100% line,
  statement, branch and function coverage for `AlphaForgeVault`, `PassLocker` and `StrategyPass`;
- all required CLI and browser journeys pass and their evidence is bound to the exact candidate;
- no unresolved required `BLOCKED`, `NOT_RUN` or `NOT_MEASURED` item remains.

Local integration candidate `639ffd8...` consolidates the unchanged PR #24 contract source, PR #26
Chain/API source and PR #27 product source. Macbeth05 independently reran the complete 705-test
suite, critical collection, identity, static/build gates and real multi-Vault browser journey at
that exact SHA; those functional results pass. The raw critical branch denominator is retained at
95.40% and is not rewritten as 100%, while source inspection establishes that the two adjacent
residual records are nonsemantic or unreachable. Combined JS/TS overall coverage remains
`NOT_MEASURED`. The candidate also lacks new C/R/S, fails the base-to-candidate diff check, and has
no exact-candidate hosted, independent-review, restricted-security-service or Testnet-write
evidence. Those conditions keep final acceptance open.

## Refreshed candidate disposition

For `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`, tree
`6f1a21845a99e16a0ba171612cd97e9bf3439294`, the former C/R/S and source-hygiene blockers are
closed. Candidate evidence C is `cb6ecd7ce7d8d230a03f87c64065df8b3aa66793`; review evidence R is
`41e36815ca5f07a1a825cf7ea55fae4bbf63e2ab`. The exact environment gate, 71-record identity gate,
management dashboard, complete `npm run check`, base-to-candidate diff check, focused security
regression and local Gitleaks 8.30.1 gate all pass. The complete check executes 711/711 tests.

Contract, Chain/API and product functional sources are byte-identical to `639ffd8...`. The PR #24
contract result and the `639ffd8...` real browser journey therefore remain applicable by source
equivalence. Macbeth05 reran the exact critical Chain/API collection on `3a78e34...`; all 711 tests
pass and every frozen concrete critical branch remains covered.

The final local decision is
`LOCAL_UNIFIED_CANDIDATE_GATE_PASS / FINAL_COVERAGE_AND_EXTERNAL_EVIDENCE_BLOCKED`. Closure still
requires a candidate-bound admitted overall JS/TS coverage report at or above 90%, exact-candidate
hosted required checks, eligible independent approval, disposition of the historical restricted
security-service limitation, and separately authorized Testnet evidence. A canonical coverage
counter probe is promising but does not yet satisfy the overall measurement requirement.

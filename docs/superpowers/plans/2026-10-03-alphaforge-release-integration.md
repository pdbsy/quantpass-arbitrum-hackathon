# AlphaForge Release Integration Implementation Plan

> **For agentic workers:** Execute inline with executing-plans. The current user authorizes exactly W1–W5 and prohibits child workers, helpers and reviewers. The manager assigns review to an existing worker.

**Goal:** Independently review and integrate W1–W4 without rewriting authorship, validate one fixed software candidate and prepare a reviewable Luis/Dots deployment package.

**Architecture:** Maintain a full-history isolated checkout and retain exact baseline, worker and candidate refs. W5 owns root scripts, CI wiring and shared evidence; application fixes return to their owners through the manager. Software, Linux/container, deployed watch-only, wallet and live-chain results are separate gates.

**Tech Stack:** Existing Node 24.21.0/npm 11.19.1, TypeScript, Fastify, SQLite, Vite, Node tests, existing qualified native contract tools and W3's reviewed Linux container implementation.

**Spec:** `docs/release/2026-10-03/source-spec.md` and `docs/release/2026-10-03/w5-brief.md` are retained copies of the assigned specification and W5 brief.

## Global Constraints

- Origin `https://github.com/pdbsy/quantpass-arbitrum-hackathon.git`; complete history; base `3cb9caa810e34d8ff9f9a6c68b5ef674f489689e`; tree `66edd0027fd2ae564a3a485e6ea5c5bc577fea5c`.
- Branch `codex/alphaforge-release-integration-20261003`; independent dependencies, SQLite, browser state, logs and fnm multishell state.
- No sixth worker, child worker, helper, reviewer or Darwin. No original, manager or peer checkout edits.
- Coordination writes are limited to `task-5-report.md` and W5 handoff files; unresolved blockers may be sent to the authorized manager chat.
- No master merge, publication, live deployment, real credentials, signing, broadcast or mainnet activation.
- No required check removal, floating tool/dependency upgrade, force push, history rewrite or generated PASS editing.
- One app container and one retained business-data volume; two process identities/private directories; bounded sanitized status sharing; default no signing and fail closed.
- Retained data and backups total at most 8,000,000,000 bytes; this is not a RAM requirement.
- The 24-hour sustained run is `WAIVED_BY_USER`; short functional/lifecycle/persistence/backup/recovery checks remain mandatory.
- The prior Sites source, prototype source and historical Testnet snapshot are distinct. Prior counts and MCP connectivity are context, never current candidate PASS.
- Keep owner EOA scope, protocol/storage IDs, unit conversion and slippage pause decisions. Mainnet remains disabled/unconfigured.

## File responsibilities

| Paths | Responsibility |
| --- | --- |
| `docs/release/2026-10-03/source-spec.md`, `w5-brief.md` | Retain source requirements and authority. |
| `docs/superpowers/plans/2026-10-03-alphaforge-release-integration.md` | Source-backed implementation and checkpoints. |
| `docs/release/2026-10-03/acceptance.md` | Distinct gates, readiness levels, evidence rules and unresolved inputs. |
| `docs/release/2026-10-03/reviews.md` | Exact heads, two-stage findings, fixes and W5 independent review. |
| `docs/release/2026-10-03/luis-dots-handoff.md` | Concrete deployment/runbook contract and rollback constraints. |
| `planning/release-workers-20261003.json` | This round's proposed task labels, fixed base, branch ownership and no invented approvals. Historical Macbeth registry is retained. |
| `package.json`, `tools/management-dashboard/checks.mjs` | Register reviewed worker tests/scripts in both normal and evidence command sets. |
| `tools/check-release-history.mjs`, existing `test/agent-integration-identity.test.mjs` | Read-only exact base/four-worker-head ancestry check with real Git merge/partial/unrelated/shallow regression fixtures. |
| `.github/workflows/ci.yml`, `tools/ci/workflow-contract.mjs`, `tools/check-supply-chain.mjs`, `planning/development-environment.json` | Wire necessary reviewed Linux/container qualification while preserving all existing jobs, exact Actions and strict workflow admission. |
| `planning/roadmap.json` and approved builder outputs | Register scoped release work without closing historical governance risk. |
| `.checks/management/latest.json`, `docs/management/dashboard/data/*.json` | Generate only by existing C → R → S builders with isolated transition commits. |
| `work/evidence/` outside checkout | Original command logs, hashes, environment/runtime failures and final inventory. |
| `outputs/` outside checkout | Final user-facing bundle and fixed-head report. |

### Task 1: Establish the isolated source and qualified tools

**Interfaces:** Consume fixed origin/base/tree; produce full-history checkout, baseline ref and actual tool/admission logs.

- [x] Clone complete remote history and retain the initial sandbox DNS failure.
- [x] Verify base/tree; create the assigned branch and `refs/evidence/release-base`.
- [x] Read own AGENTS, development specification/status, package scripts, Testnet handoff/prep and latest mock feedback/manifest.
- [x] Configure repository-local author identity using the existing source author's Git identity, not a fabricated worker identity.
- [x] Activate the already installed fnm runtime with task-local XDG state; retain the initial missing-fnm-activation failure.
- [x] Run `node tools/check-environment.mjs` and preserve its actual report.
- [x] Run `npm ci --ignore-scripts` using an isolated cache; do not alter the lock or npm settings.
- [x] Save Git/fnm/Node/npm/OS/arch/lock provenance and verify no hidden index or shared writable paths.

### Task 2: Register the release and map acceptance before integration

**Interfaces:** Consume existing package, governance, planning, workflow and dashboard contracts; produce task labels, check map and review matrix with pending work explicitly `NOT_RUN`.

- [x] Record W1 product, W2 runtime, W3 container, W4 isolated acceptance and W5 integration task IDs/branches in a separate release assignment source.
- [x] Do not relabel or replace the historical six-worker registry or claim cryptographic identity/independent approval from task metadata.
- [x] Map `npm run check`, all nine engineering CI jobs, dependency audit, native contract gate, optional browser checks, C/R/S builders and worker requests.
- [x] Record Linux application checks, native Linux contract qualification and Docker runtime validation as three distinct obligations.
- [x] Create acceptance, reviews and operator runbook documents; separate software/package, deployed watch-only, wallet and live execution levels.
- [x] Register scoped release planning entries without modifying historical PASS, risk acceptance or `GOV-001`/`SUPPLY-001` status. Generate affected planning/governance views through their builders.
- [x] Self-check this plan against every specification section and scan for unresolved placeholder instructions.
- [x] Commit the reviewable planning/docs checkpoint locally.

### Task 3: Review exact worker deliveries

**Interfaces:** Consume report/base/head/tree/commit/files/tests/root requests; produce exact review verdicts and preserved head refs. Application fixes are never made by W5.

- [x] Read each final worker report. Verify recorded base and immutable Git head/tree in the owner's checkout; a mutable branch name alone is insufficient.
- [x] Fetch each owner branch into `refs/remotes/wN/<branch>` using local Git transport and retain `refs/evidence/release-wN` at the reviewed exact head.
- [x] Run `git merge-base --is-ancestor <base> <head>` and `git diff --stat <base> <head>`, then read every affected runtime/test/config path.
- [x] Stage-one review: verify assigned ownership, mock/production boundaries, default no signing, per-owner auth, honest status, immutable identities and required feature acceptance.
- [x] Stage-two review: inspect failure paths, races, restart/unknown nonce persistence, schema/reorg behavior, permissions/sanitization, resource budgets and tests for actual behavior.
- [x] For findings record priority, exact commit/file/line, user/runtime impact, reproduction, owner, expected fix and retest. Send only unresolved blockers through the manager.
- [x] An unfinished report or unresolved important finding stays unaccepted. Do not convert a worker's self-review into independent approval.

### Task 4: Preserve history and wire root commands/CI

**Interfaces:** Consume accepted exact commits and root requests; produce a clean named integration source C and complete test/CI registration.

Independent root preparation adds `npm run release:history` = `node tools/check-release-history.mjs`. Its exported `verifyReleaseHistory({root, base, head, sources})` accepts exact 40-character commit IDs and ordered `{worker: W1..W4, head}` records, requires distinct non-baseline heads/full history and checks base → each worker → candidate ancestry. It returns `EXACT_SOURCE_HISTORY_VERIFIED` with `independentApproval: false`. The CLI consumes the existing exact base and four retained worker refs, makes no writes/network calls and blocks until all are integrated. Tests first failed on the absent verifier and duplicate-head acceptance, then passed after the minimal implementation.

Run the scoped root cycle with `node --test --test-name-pattern='release history' test/agent-integration-identity.test.mjs`; then run the complete existing integration-identity file. The tests are already present in the normal root and management unit registries.

- [x] Merge exact accepted refs with `git merge --no-ff <reviewed-head>`; preserve every original worker commit/author and baseline ref.
- [x] Resolve only W5-owned metadata/root conflicts; report application conflicts to the manager for owner resolution.
- [x] Add W3/W4 exact finite entry commands and normal/evidence test registration after independently reading their command implementations.
- [x] For changed root behavior first add negative regression cases to the applicable existing root-tool/CI tests; run them and preserve the expected failure before implementation.
- [x] Keep all existing required job names/events/permissions and pinned Actions. Extend workflow policy/admission alongside any new Linux/container job; no bypass or wildcard privilege exception.
- [x] Run focused root/CI/planning/governance/supply tests and root quality checks; preserve each original failed run. Actual final worker-script execution is covered by Task 5.
- [ ] Commit final integration source, verify branch/HEAD/tree/lock/clean state and save fixed candidate identity before acceptance.

### Task 5: Validate the fixed candidate and build honest evidence

**Interfaces:** Consume source C and reviewed command set; produce original full-check/raw logs, report R, snapshot S and fixed acceptance inventory.

- [ ] Run a fresh full `npm run check` on the fixed integration source; its old dashboard may be stale and that initial result is retained, not rewritten.
- [ ] Run W4 release API/browser acceptance on the same candidate with independent mock owners/db/clock/wallet/RPC and visibly MOCK UI. Record unique tests and overlapping focused runs separately.
- [ ] Run W3 container configuration/build/runtime/admission/native-contract commands where execution is available. Missing Docker/Linux/native tools stay `BLOCKED`/`NOT_RUN`; macOS eligibility never becomes Linux qualification.
- [ ] Run short stop/restart/persistence/unknown-order/reorg/backup/independent restore tests and actual contract checks if qualified tools exist.
- [ ] Run full `npm run management:checks` from clean source C; preserve collector original logs and `NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` contract entries.
- [ ] Commit only `.checks/management/latest.json` as R. Run `npm run management:build`; commit only its two generated JSON files as S. Keep the exact source ref.
- [ ] Run fresh `npm run check` on S; prove tree/lock unchanged after execution and retain before/after identity. Code changes require a new source/acceptance cycle.
- [ ] Hash raw logs and actual artifacts; distinguish actual image digest from unbuilt image status and example config digests from protected operational config digests.
- [ ] Preserve first failures, timeouts, skips, unavailable gates, user waiver and all unverified historical claims; never add overlapping totals.

### Task 6: Complete Luis/Dots handoff and independent review

**Interfaces:** Consume fixed source/report/snapshot refs and observed gate results; produce immutable operator bundle, W5 review request and final report.

- [ ] Complete image/source/lock/build/config/evidence inventory, one-container/one-volume operator sequence, private identities/status permissions and loopback/TLS proxy contract.
- [ ] Document authenticated read-only MCP routes/discovery/session contract and current/stale/unavailable versus archived semantics from W2's actual implementation.
- [ ] Provide bounded offline preflight, watch-only and host smoke commands; all real deployment/wallet/signing/broadcast operations stay separately authorized.
- [ ] Include backup-copy verification, schema/network/config identity checks, capacity budget, failure preservation and rollback limits; never clear unresolved nonce/order locks or downgrade schemas automatically.
- [ ] Record the complete protected RPC/reference/deployment/inventory/role/asset/pool/budget input list. Keep external checks unexecuted and 24-hour run `WAIVED_BY_USER`.
- [ ] Ask the manager to assign focused review of exact W5 changes to an existing worker; retain findings and corrected immutable head evidence.
- [ ] Write the complete `task-5-report.md` contract and final user-facing bundle; commit all scoped source changes and keep evidence refs.
- [ ] Final chat response contains status, commit IDs, one-line validation and unresolved inputs only.

## Review checkpoints and continuation

Execute this plan inline; user task already authorizes implementation, so no execution-choice question is required. Continue source-independent work while W1–W4 implement. Routine clone/runtime/root registration decisions belong to W5; only unresolved blockers go to the authorized manager. W5 cannot call incomplete integration complete, and software acceptance cannot claim deployed Testnet readiness.

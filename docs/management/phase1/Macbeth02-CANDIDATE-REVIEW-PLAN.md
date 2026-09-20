# Macbeth02 Exact Candidate Contract Review Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. This plan is executed inline because the active assignment forbids starting additional workers.

**Goal:** Bind the Phase One contract evidence at Macbeth02 source `a13052993b6f408b7be835ecd6f4b13ef6df367d` to manager candidate `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8` without repeating unchanged test suites or converting management collector `NOT_RUN` entries into synthetic passes.

**Architecture:** Use Git object identity for the complete `contracts/` subtree and its source, test, script, deployment, compiler, and dependency-lock components. Rebuild only the compiler artifacts needed for ABI/manifest equality, retain existing independently executed contract and coverage evidence for unchanged tests, and publish an evidence index that keeps historical, current local, collector, hosted, and Testnet boundaries separate.

**Tech Stack:** Git object database; Forge `1.5.1-v1.5.1`; solc `0.8.31+commit.fd3a2265`; Slither `0.11.3`; CPython `3.12.9`; Markdown and plain-text evidence.

**Spec:** User-supplied highest-priority instruction attachment, sections five A, seven, ten 2,
and eleven; its machine-local attachment path is omitted from tracked metadata.

## Global Constraints

- Repository is `pdbsy/quantpass-arbitrum-hackathon`; task is `M3-02-PHASE1-CONTRACTS` on `macbeth02/m3-phase1-contracts`.
- Manager source is `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`, tree `6f1a21845a99e16a0ba171612cd97e9bf3439294`, base `18f5352070910a867b9729b031aa2e3951785e01`.
- Do not run or query GitHub Actions/Checks, push, change remote PR state, alter rulesets, deploy, sign, broadcast, or invoke a new restricted security service.
- Keep the original core coverage and complete compiled-inventory coverage as different denominators.
- The management collector's `foundry`, `fuzz`, `invariant`, and `slither` entries remain `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` until that collector actually executes them.
- Preserve raw logs in `docs/management/phase1/evidence/`; do not edit generated PASS evidence.

---

### Task 1: Prove exact contract-source equivalence

**Files:**
- Create: `docs/management/phase1/evidence/Macbeth02-3a78e34-contract-equivalence.log`
- Create: `docs/management/phase1/Macbeth02-CANDIDATE-REVIEW.md`

**Interfaces:**
- Consumes: Git objects for `a13052993b6f408b7be835ecd6f4b13ef6df367d` and `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`.
- Produces: complete-subtree and component object IDs plus a zero-diff result that later evidence can bind to the manager candidate.

- [x] Record repository, branch, HEAD, tree, clean-state, platform, architecture, and locked tool versions.
- [x] Record both `contracts/` tree IDs and the object IDs for `src`, `test`, `script`, `deployment`, `foundry.toml`, `toolchain.lock.json`, `requirements-slither.lock`, and `openzeppelin-pragma-pins.json`.
- [x] Run `git diff --exit-code a130529... 3a78e34... -- contracts` and retain its exit code.
- [x] Explain that equality covers production Solidity, tests, compiler settings, dependency locks, published ABI, artifact manifest, and local deployment rehearsal sources, but does not inherit hosted checks or external approval.

### Task 2: Rebuild only the missing compiler-bound evidence

**Files:**
- Create: `docs/management/phase1/evidence/Macbeth02-3a78e34-compiler-equality.log`
- Modify: `docs/management/phase1/Macbeth02-CANDIDATE-REVIEW.md`

**Interfaces:**
- Consumes: the locked task-local Forge/solc/Python tools and the equivalence proof from Task 1.
- Produces: a fresh local compiler-artifact, published ABI, and manifest equality result bound to the unchanged contract subtree.

- [x] Run the locked clean-environment `forge build --offline --force` without RPC or deployment inputs.
- [x] Run `check_vault_artifact.py` against the fresh Forge artifact and published Vault ABI.
- [x] Run `build_phase1_contract_manifest.py --check` against the fresh artifact directory and committed schema-2 manifest.
- [x] Record commands, timestamps, exit codes, and output. Stop on any mismatch; do not rewrite the manifest to manufacture equality.
- [x] Do not rerun unchanged full Solidity, fuzz, invariant, Slither, coverage, or deployment-rehearsal suites; cite their exact historical and independent checkpoints through the Task 1 equality proof.

### Task 3: Publish contract-semantic and collector evidence indexes

**Files:**
- Create: `docs/management/phase1/Macbeth02-EVIDENCE-INDEX.md`
- Modify: `docs/management/phase1/Macbeth02-WORKLOG.md`
- Modify: `docs/management/phase1/Macbeth02-COVERAGE.md`
- Modify: `docs/management/phase1/Macbeth02-CANDIDATE-REVIEW.md`

**Interfaces:**
- Consumes: Tasks 1-2 logs, committed tests and scripts, PR24 checkpoint reports, and source-base QA records.
- Produces: requirement-to-source/test/evidence mapping and four independent-entry pointers that the manager can merge without altering collector statuses.

- [x] Map Vault/Locker/Pass permissions, 18/6 precision, locking, profit/principal/loss withdrawal, close, rescue, abnormal-token atomicity, ABI/compiler/manifest equality, and local VM rehearsal to exact source/tests/scripts.
- [x] Preserve core coverage at 100% for Vault/Locker/Pass and full compiled totals at 95.53% lines, 95.12% statements, 73.42% branches, and 95.54% functions.
- [x] Index `foundry`, `fuzz`, `invariant`, and `slither` to the separate `contracts/script/check-phase1-contracts.sh` / `check-local.sh` entry and exact evidence limits while leaving the management collector values `NOT_RUN`.
- [x] State that current local work is not hosted CI, independent security approval, Testnet deployment, signing, broadcast, or merge readiness.
- [x] Run Markdown whitespace checks and `git diff --check`, inspect the final diff, and commit only Macbeth02-authorized reports and logs with the existing Agent-ID and Task-ID trailers.

## Self-review

- Spec coverage: candidate equality, contract semantics, locked compiler/ABI/manifest evidence, coverage denominators, local VM evidence mapping, persistent logs, and four collector `NOT_RUN` mappings are each assigned above.
- Placeholder scan: all inputs, paths, commands, statuses, and expected boundaries are concrete.
- Interface consistency: Task 1 produces the source binding consumed by Tasks 2-3; Task 2 produces fresh narrow compiler evidence; Task 3 publishes only indexed conclusions supported by those artifacts.

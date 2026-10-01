# AlphaForge Pre-merge Security Update Implementation Plan

> **For agentic workers:** Execute inline using executing-plans. The user's single-operator assignment overrides the generic subagent recommendation. Do not start workers.

**Goal:** Clear the newly reported dependency-advisory gate and merge the validated reference-paper delivery into protected master.

**Architecture:** Preserve the existing application and scanner architecture. Update only the three user-approved dependencies, rebuild the restricted Semgrep metadata derivation, and produce fresh C/R/S evidence before protected PR merge and actual-master verification.

**Tech Stack:** Node 24.21.0, npm 11.19.1, Python 3.12.9, Semgrep 1.177.0, Slither 0.11.3.

**Spec:** User approval on 2026-10-01; docs/DEVELOPMENT-TOOLCHAIN.md and docs/DEVELOPMENT-TOOLCHAIN-STATUS.md; PR #40 and Engineering run 36837673050.

## Global Constraints

- Fastify 5.12.3 → 5.12.5; PyJWT 2.14.0 → 2.15.0; Slither's urllib3 2.7.0 → 2.8.0. All other versions remain pinned.
- Preserve original commits, authors, refs, C/R/S evidence, failed CI runs and 24-hour acceptance records.
- No signing, broadcasts, chain deployment, credential introduction, required-check bypass or live-account control.
- Use an independent full-history clone because the registered source branch is already checked out by the running simulation. Do not share writable dependencies or SQLite data.
- The existing 24-hour soak remains evidence for 83fb9d49bff725fde1211ad8b69aff204f8fe803; do not relabel it as a soak of the updated dependency candidate.

### Task 1: Restricted dependency repair

**Files:** package.json, package-lock.json, docs/security/npm-sbom.spdx.json; tools/security/patch_semgrep.py, test_patch_semgrep.py, semgrep-pyjwt.patch, bootstrap.mjs and both requirements locks; planning/security-scanners.lock.json; contracts/requirements-slither.lock and toolchain.lock.json.

**Interfaces:** Existing build_wheel(source, destination, source_sha256) and scanner/contract bootstrap entry points remain unchanged. Derived Semgrep artifacts get a distinct build tag; upstream version, source/native/license bytes remain unchanged.

- [ ] Change the existing derivation test's expected output requirement to `pyjwt[crypto]~=2.15.0`; run `python3.12 tools/security/test_patch_semgrep.py` and verify its real-output mismatch against the old recipe.
- [ ] Change only the recipe requirement and build identity, fetch exact official PyJWT 2.15.0 metadata/wheel and verify its published digest. Reuse the already pinned urllib3 2.8.0 artifact for the Slither graph.
- [ ] Build both derived Semgrep wheels from the pinned upstream bytes, verify member preservation and deterministic hashes, update requirements/artifact hashes through exact inputs.
- [ ] Update Fastify with `npm install --package-lock-only --ignore-scripts --save-exact fastify@5.12.5`; inspect the dependency delta and reject unrelated changes. Install with `npm ci --ignore-scripts`, then use `npm run supply:build` for the SPDX output.
- [ ] Run the derivation tests, focused server/paper/scanner regressions, dependency audit and actual approved scanner/contract gates. Retain raw failures and successes.

### Task 2: Source-bound delivery and merge

**Files:** docs/QINFRA-REFERENCE-PAPER-SERVICE.md; generated .checks/management/latest.json and docs/management/dashboard/data/build-log.json, snapshot.json.

**Interfaces:** Existing management:checks → report-only R → management:build → snapshot-only S pipeline. Protected PR #40 targets master with the registered source branch and attributed commit trailers.

- [ ] Record actual fixes and verification boundaries; commit clean source C with `Agent-ID: Macbeth01` and `Task-ID: AF-LIVE-MARKET`.
- [ ] Run `npm run management:checks`; commit only its actual generated manifest as R. Run `npm run management:build`; commit only its two actual generated JSON snapshots as S.
- [ ] Run `npm run check` on exact S, preserve logs, verify clean tracked state, publish normally to the existing source branch and update PR #40's evidence.
- [ ] Wait for all nine new hosted CI jobs to succeed on exact S, preserve raw results/logs, verify exact protected head/base and no unresolved review threads, then squash merge without deleting source refs.
- [ ] Validate the actual resulting master commit in the independent clone, including source-tree equality, provenance, complete local checks and all nine actual-master hosted CI jobs. Leave the original simulation running.

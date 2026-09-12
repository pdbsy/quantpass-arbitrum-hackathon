# CI-Aware Recorded Git Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `management:check` validate the same recorded source branch and commit in local, GitHub push, pull-request, manual-dispatch, and merge-group checkouts without accepting forged CI identity.

**Architecture:** Keep the existing `execFile`-based Git boundary and add a closed GitHub Actions context parser plus exact-ref resolution inside `tools/management-dashboard/sources.mjs`. Local, push, and manual-dispatch checkouts continue to require the recorded named branch; a validated pull-request context may be detached only when the synthetic merge's second parent equals the exact remote-tracking source branch and the recorded commit is its ancestor. Merge-group checkouts bind the exact queue SHA/ref to remote base/source ancestry. All Git-derived output remains reconstructed from immutable objects rather than copied from environment variables.

**Tech Stack:** Node.js ESM, `node:test`, real temporary Git repositories, shell-free `child_process.execFile`.

**Spec:** `docs/management/tasks/B8.md` and the PR #7 GitHub Engineering failure requirements supplied on 2026-09-10.

## Global Constraints

- Keep `npm run management:check` in the main gate and preserve fail-closed artifact comparison.
- Treat only a complete, closed supported GitHub Actions context as CI; reject partial, malformed, unsupported, or graph-inconsistent values.
- Never use an environment-provided value as proof by itself: cross-check checkout SHA, event ref, base branch, source branch, exact Git refs, and commit ancestry.
- Resolve Git commands through constructed exact refs such as `refs/heads/master` and `refs/remotes/origin/master`; never pass ambiguous or option-like revisions.
- In pull-request CI, distinguish the checked-out synthetic merge commit from its logical PR head at `HEAD^2`.
- Preserve recorded commit syntax validation, recorded clean-state validation, source-branch validation, and recorded-commit ancestry.
- Keep Git execution shell-free, fixed-argument, bounded to 1 MiB output and 5 seconds, with replacement objects disabled and fail-closed errors.
- Do not merge PR #7, enable a write plane, or change the Robinhood Chain Testnet-only boundary.
- Push only after local, simulated push, simulated pull-request, forged-state, `management:check`, and full repository gates pass.

---

### Task 1: Real-Git regression fixtures

**Files:**

- Modify: `test/management-dashboard-sources.test.mjs`
- Modify: `test/management-dashboard-build.test.mjs`
- Test: `test/management-dashboard-sources.test.mjs`
- Test: `test/management-dashboard-build.test.mjs`

**Interfaces:**

- Consumes: current `collectRecordedGitState(root, baseBranch, recorded, options)` behavior.
- Produces: real Git graphs and assertions that define the required local, push, pull-request, and forged-state contracts.

- [x] **Step 1: Extract a focused real-Git fixture helper**

Create a test-only helper that initializes `master`, creates `macbeth/dashboard`, returns literal `baseCommit`, `recordedCommit`, `headCommit`, and can install exact refs with `git update-ref`. Keep every commit real and configure identity through fixed `git -c` arguments.

- [x] **Step 2: Add the normal local named-branch test**

Call `collectRecordedGitState` without GitHub environment data while `macbeth/dashboard` is checked out. Assert `READY`, the recorded branch and commit, and exact ahead/behind values. This catches removing the named-branch equality check from ordinary local operation.

- [x] **Step 3: Add the GitHub push layout test**

Delete the local `master` ref, retain only `refs/remotes/origin/master`, keep `macbeth/dashboard` checked out, and supply a complete push context with `GITHUB_ACTIONS=true`, event `push`, `GITHUB_REF=refs/heads/macbeth/dashboard`, and `GITHUB_SHA=<headCommit>`. Assert `READY`. This catches reuse of the ambiguous missing `master` ref.

- [x] **Step 4: Add the detached pull-request merge layout test**

Create a two-parent synthetic merge, set `refs/remotes/origin/master` to its first parent and `refs/remotes/origin/macbeth/dashboard` to its second parent, detach at the merge commit, and supply a complete pull-request context. Assert `READY`, while the returned branch and commit remain the recorded source values rather than the merge ref/SHA. This catches requiring `git branch --show-current` to equal the source branch in intentional detached CI.

- [x] **Step 5: Add forged branch and commit rejection cases**

Against the same detached graph, assert failure when `GITHUB_HEAD_REF` disagrees with the recorded branch, when the exact remote source ref does not equal `HEAD^2`, and when the recorded commit exists but is not an ancestor of the logical PR head. This catches trusting environment strings, remote-ref aliases, or mere object presence.

- [x] **Step 6: Add the clean-CI versioned-evidence regression test**

Generate a complete validated `.checks/management/latest.json`, version only that sanitized manifest while per-run logs remain ignored, and exercise a genuine clean clone in local, push, and detached pull-request layouts. Require missing, malformed, incomplete, reordered, and unavailable-status-tampered reports to fail rather than reconstructing evidence from the generated Dashboard.

- [x] **Step 7: Run RED and confirm the expected failures**

Run:

```bash
node --test test/management-dashboard-sources.test.mjs
```

Expected before implementation: the local control passes; the push layout returns `RECORDED_GIT_QUERY_FAILED`; the detached pull-request layout returns `RECORDED_GIT_BRANCH_MISMATCH`; forged cases remain fail-closed; incomplete/ordered/status constraints are not enforced; and clean-CI check mode cannot consume an explicit versioned evidence source.

### Task 2: Closed CI context and exact Git graph validation

**Files:**

- Modify: `tools/management-dashboard/sources.mjs`
- Modify: `tools/build-management-dashboard.mjs`
- Modify: `.gitignore`
- Modify: `docs/management/dashboard/ARCHITECTURE.md`
- Modify: `docs/management/dashboard/README.md`
- Test: `test/management-dashboard-sources.test.mjs`
- Test: `test/management-dashboard-build.test.mjs`
- Version: `.checks/management/latest.json`

**Interfaces:**

- Consumes: `options.environment`, the recorded `{ branch, commit, dirtyFiles }`, base branch `master`, and the repository's real refs/graph.
- Produces: a validated local/push/pull-request checkout classification and the same existing `READY` Git-state schema.

- [x] **Step 1: Parse a closed GitHub Actions context**

Add an internal parser that accepts only exact required keys for `push`, `pull_request`, `workflow_dispatch`, and `merge_group`, validates 40-lowercase-hex SHA values and Git branch grammar, and returns a closed union. If `GITHUB_ACTIONS=true`, missing or unsupported values yield `RECORDED_GIT_CI_CONTEXT_INVALID`; otherwise return the local context. Do not copy arbitrary environment keys into Git subprocesses.

- [x] **Step 2: Resolve an exact base ref**

Construct only `refs/heads/<validatedBase>` and `refs/remotes/origin/<validatedBase>`. For GitHub CI require the exact remote-tracking base; for local operation prefer the exact local base and use the exact remote base only when the local ref is absent. Verify existence as a commit before using it in `rev-list`.

- [x] **Step 3: Preserve named-branch validation for local and push checkouts**

Require `git branch --show-current` and the exact `refs/heads/<recordedBranch>` commit to equal the logical checkout head. In push CI additionally require `GITHUB_REF` to be the exact recorded branch ref and `GITHUB_SHA` to equal `HEAD`.

- [x] **Step 4: Validate detached pull-request identity from the Git graph**

Require an empty current branch, canonical `refs/pull/<positive integer>/merge`, matching base/head environment names, `GITHUB_SHA == HEAD`, exactly two merge parents, `HEAD^1` consistent with the exact remote base, and `HEAD^2` exactly equal to `refs/remotes/origin/<recordedBranch>`. Use `HEAD^2` as the expected logical head.

- [x] **Step 5: Reconstruct only after commit ancestry succeeds**

Require the recorded commit object to exist and be an ancestor/equivalent of the logical source head. Generate history from the recorded commit and ahead/behind counts from the resolved exact base ref. Map all unexpected Git failures to `RECORDED_GIT_QUERY_FAILED`, while preserving explicit validation errors.

- [x] **Step 6: Validate a separate versioned evidence source in clean checkouts**

Keep `.checks/management/latest.json` as a separate, sanitized, reviewable source while ignoring all per-run logs. Validate its fixed profile, exact registry-complete ordered IDs, terminal executable-check statuses, and fixed unavailable-tool states before aggregation. Never reconstruct it from `dashboard.json`; missing or invalid source evidence must remain fail-closed.

- [x] **Step 7: Run GREEN and the nearest regression suites**

Run:

```bash
node --test test/management-dashboard-sources.test.mjs test/management-dashboard-build.test.mjs
```

Expected: every local, simulated CI, forged-state, builder, and artifact-reconstruction test passes.

- [x] **Step 8: Inspect direct callers and challenge the patch**

Confirm `tools/build-management-dashboard.mjs` remains the only production caller, check both check/build modes, mutate each context discriminator mentally, and verify one ordinary local checkout plus malformed/partial CI contexts fail or succeed exactly as specified.

- [x] **Step 9: Commit the focused implementation**

```bash
git add test/management-dashboard-sources.test.mjs tools/management-dashboard/sources.mjs docs/management/plans/2026-09-10-ci-aware-git-reconstruction.md
git commit -m "fix(dashboard): validate GitHub CI checkout identity"
```

### Task 3: Evidence refresh, full gates, and PR handoff

**Files:**

- Modify: `docs/management/tasks/B8.md`
- Modify: `docs/management/workers/worker-b.md`
- Modify: `docs/security/DASHBOARD-DIFF-SCAN-2026-09-09.md`
- Regenerate: `docs/management/dashboard/data/dashboard.json`
- Regenerate: `docs/management/dashboard/data/build-log.json`

**Interfaces:**

- Consumes: green simulated layouts and the final focused code diff.
- Produces: truthful remediation evidence, refreshed generated data, a pushed Macbeth-authored PR head, and GitHub check readback without merge.

- [x] **Step 1: Run focused security and legitimate controls**

Run the exact simulated-layout test suite twice: once normally and once with a malformed GitHub context case selected. Confirm the two original CI layouts return `READY`, while forged branch, commit, SHA, ref, and graph inputs remain rejected.

- [x] **Step 2: Run repository gates before snapshot generation**

```bash
npm run management:check
npm run check
npm run audit:dependencies
git diff --check
```

Expected: all configured local gates pass and dependency audit reports no high-or-greater vulnerability.

- [x] **Step 3: Record the narrow remediation scope**

Record the CI checkout compatibility fix and every separately validated Dashboard finding without collapsing repository evidence into an external attestation. Preserve unavailable Solidity tools, toolchain-version mismatch, no-screen validation, protected-CI requirements, and the wider protocol/release blockers. A prose record never substitutes for immutable post-fix verification.

- [x] **Step 4: Commit records, then generate from a clean record commit**

Commit the human-readable record first. Run `npm run management:build` only from that clean commit, verify `npm run management:check`, then commit only the two generated JSON files as the final snapshot.

- [ ] **Step 5: Run final local closure gates**

```bash
npm run management:check
npm run check
npm run audit:dependencies
npm run secrets:check
git diff --check
git status --short --branch
```

Expected: all available gates pass, 97 or more tests pass, and the worktree is clean.

- [ ] **Step 6: Run one read-only bypass/regression review**

Give a fresh reviewer only the user requirements, repository root, policy constraints, and final candidate diff. Confirm no environment-only trust, ambiguous ref, detached-checkout bypass, legitimate local regression, shell execution, unbounded output, or unrelated change remains.

- [ ] **Step 7: Push and bind GitHub checks to the final SHA**

Push only `macbeth/dashboard`, verify `git ls-remote` equals local `HEAD`, read PR #7 as open/draft/unmerged, and wait for both push and pull-request Engineering checks. Require both to pass before reporting the defect fixed; do not merge.

## Self-review

- Spec coverage: all four requested layouts, explicit remote base resolution, detached PR head reconstruction, strict commit/branch ancestry, shell-free Git, bounded execution, local/full gates, gated push, and no-merge handling are assigned above.
- Placeholder scan: every implementation and validation step names concrete inputs, outputs, commands, expected states, or error codes; no deferred implementation instruction remains.
- Type consistency: `collectRecordedGitState(root, baseBranch, recorded, options)` remains the public API; only the optional closed environment input and internal context/ref helpers are added.

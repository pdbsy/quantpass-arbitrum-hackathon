# QuantPass Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chinese, read-only, evidence-backed QuantPass project supervision Dashboard that makes missing, failed, stale, blocked, and unresolved state visible.

**Architecture:** A Node.js build pipeline reads allowlisted repository sources, fixed-argument Git metadata, and bounded local check records; validates and redacts them; then atomically generates a static JSON snapshot and diagnostics. A CSP-constrained browser client renders the snapshot with text-only DOM operations, served by a dedicated loopback-only static server.

**Tech Stack:** Node.js ESM, native `node:test`, native `http`, HTML, CSS, browser JavaScript, existing npm, Prettier, ESLint, and TypeScript gates.

**Spec:** `docs/management/dashboard/ARCHITECTURE.md`

## Global Constraints

- Do not modify `planning/roadmap.json`, Manager status/control files, security policy, protocol architecture, or testnet write gates.
- Do not read or emit `.env`, credentials, cookies, tokens, key files, `~/.codex`, browser data, or Git credential configuration.
- Changing project facts must not be hardcoded in HTML.
- Missing optional sources render `NOT_AVAILABLE`; malformed sources render `DATA_SOURCE_ERROR`.
- Tests display `PASS` only from a completed, commit-bound execution record with exit code zero.
- The Dashboard and preview remain loopback-only; no LAN bind or router forwarding.
- Use Git author `Macbeth <pdbsy@users.noreply.github.com>` in this repository only.
- Work on `macbeth/dashboard`; final merge requires review and explicit authorization.
- Maintain text labels for every state; never rely on color alone.
- Use atomic writes and preserve the last valid generated artifacts when a build fails.

---

### Task 1: Closed schemas and redaction boundary

**Files:**

- Create: `tools/management-dashboard/schema.mjs`
- Create: `tools/management-dashboard/redact.mjs`
- Create: `test/management-dashboard-schema.test.mjs`

**Interfaces:**

- Produces: `TASK_STATUSES`, `CHECK_STATUSES`, `validateDashboardSnapshot(value)`, `validateCheckReport(value)`, `redactValue(value, options)`, `sanitizeLog(text, options)`.
- Consumes: plain JSON-compatible values only; no filesystem or process access.

- [x] **Step 1: Write failing schema tests**

Cover a minimal valid snapshot, every closed status, unknown status rejection, missing mandatory project fields, invalid ISO timestamps, oversized strings, and a `PASS` check without commit/evidence.

```js
test('PASS requires commit-bound evidence', () => {
  const snapshot = validSnapshot();
  snapshot.tests.items[0] = { id: 'lint', status: 'PASS', observedAt: now };
  assert.throws(() => validateDashboardSnapshot(snapshot), /PASS.*commit.*evidence/);
});
```

- [x] **Step 2: Run the schema test and verify failure**

```bash
node --test test/management-dashboard-schema.test.mjs
```

Expected: failure because the schema module does not exist.

- [x] **Step 3: Implement closed schemas**

Use frozen sets and explicit structural checks. Export this exact vocabulary:

```js
export const TASK_STATUSES = Object.freeze([
  'DONE',
  'VERIFIED_DONE',
  'PARTIAL',
  'IN_PROGRESS',
  'READY',
  'BLOCKED',
  'NOT_STARTED',
  'NOT_AVAILABLE',
  'DATA_SOURCE_ERROR',
]);
export const CHECK_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'BLOCKED',
  'NOT_AVAILABLE',
  'DATA_SOURCE_ERROR',
]);
```

- [x] **Step 4: Write failing redaction tests**

Cover PEM blocks, GitHub/cloud/provider token shapes, authorization/cookie/password keys, URL user-info, sensitive query parameters, home paths, recursion depth, arrays, circular input, and byte caps.

```js
test('redaction removes credentials without echoing values', () => {
  const output = redactValue({ authorization: 'Bearer example-sensitive-value' });
  assert.deepEqual(output, { authorization: '[REDACTED]' });
  assert.doesNotMatch(JSON.stringify(output), /example-sensitive-value/);
});
```

- [x] **Step 5: Implement bounded recursive redaction**

Defaults: maximum depth `8`, maximum array length `100`, maximum string length `4096`, maximum sanitized log bytes `65536`. Circular or unsupported values become `[UNAVAILABLE]`; secret-bearing keys become `[REDACTED]`.

- [x] **Step 6: Run focused tests**

```bash
node --test test/management-dashboard-schema.test.mjs
npm run secrets:check
```

Expected: all pass.

- [x] **Step 7: Commit the unit**

```bash
git add tools/management-dashboard/schema.mjs tools/management-dashboard/redact.mjs test/management-dashboard-schema.test.mjs
git commit -m "feat(dashboard): add validated redaction boundary"
```

### Task 2: Markdown, repository, and Git collectors

**Files:**

- Create: `tools/management-dashboard/markdown.mjs`
- Create: `tools/management-dashboard/sources.mjs`
- Create: `test/management-dashboard-sources.test.mjs`
- Create: `test/fixtures/management-dashboard/worker-valid.md`
- Create: `test/fixtures/management-dashboard/worker-malformed.md`

**Interfaces:**

- Consumes: explicit repository root, documented relative source paths, redaction functions.
- Produces: `parseWorkerLog(text)`, `parseTaskRecord(text)`, `collectRepositorySources(root, options)`, `collectGitState(root, baseRef)`.
- All returned sections include `status`, `source`, and `observedAt`.

- [x] **Step 1: Write failing Markdown parser tests**

Require exact documented headings and current-status fields. Missing files are handled by the collector as `NOT_AVAILABLE`; present malformed files return `DATA_SOURCE_ERROR` without silently dropping content.

```js
test('malformed worker log is an explicit source error', () => {
  assert.throws(() => parseWorkerLog('# Worker B Log\n'), /Current status/);
});
```

- [x] **Step 2: Implement conservative Markdown parsing**

Parse only `## Current status`, timestamped activity headings, and documented `- Key: value` records. Keep raw display strings bounded and redacted. Do not implement general Markdown-to-HTML conversion.

- [x] **Step 3: Write failing source-availability tests**

Use an isolated fixture root. Assert Worker A, Manager control, decisions, changelog, and tests become explicit unavailable states when absent; assert mandatory malformed roadmap data fails collection.

- [x] **Step 4: Implement allowlisted file collection**

Use `readFile`/`readdir` on fixed paths only. Refuse symlinks escaping the repository. Maximum source size is `1 MiB`. Never recursively crawl the home directory or read hidden configuration.

- [x] **Step 5: Write failing Git-boundary tests**

Create a real temporary Git repository and assert dirty-file counts, branch, commit, ahead/behind, and bounded recent history. Separately reject hostile ref names before process execution. This exercises the real Git boundary instead of asserting mock behavior.

```js
const state = await collectGitState(repository, 'master');
assert.equal(state.branch, 'codex/test');
assert.deepEqual(state.aheadBehind, { ahead: 1, behind: 0 });
await assert.rejects(() => collectGitState(repository, '--help'), /invalid base ref/i);
```

- [x] **Step 6: Implement Git collection**

Use a minimal environment containing only safe process execution variables, set `GIT_CONFIG_NOSYSTEM=1`, disable replace refs, and never query credential helpers or remotes containing URLs.

- [x] **Step 7: Run focused tests and commit**

```bash
node --test test/management-dashboard-sources.test.mjs
npm run lint
git add tools/management-dashboard/markdown.mjs tools/management-dashboard/sources.mjs test/management-dashboard-sources.test.mjs test/fixtures/management-dashboard
git commit -m "feat(dashboard): collect bounded project evidence"
```

### Task 3: Actual check-evidence recorder

**Files:**

- Create: `tools/management-dashboard/checks.mjs`
- Create: `tools/run-management-checks.mjs`
- Create: `test/management-dashboard-checks.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `CHECK_REGISTRY`, `runCheck(id, context)`, `runChecks(context)`, and `.checks/management/latest.json` matching `validateCheckReport`.
- Consumes: fixed commands, current Git commit, clock, process runner, and redaction functions.

- [x] **Step 1: Write failing check-registry tests**

Assert unique IDs; fixed executable/argument arrays; no shell strings; explicit timeouts; explicit `NOT_RUN` records for Foundry, fuzz, invariant, and Slither; and no false `PASS` from script presence.

- [x] **Step 2: Implement the fixed registry**

```js
export const CHECK_REGISTRY = Object.freeze([
  { id: 'typecheck', file: 'npm', args: ['run', 'typecheck'], timeoutMs: 120000 },
  { id: 'lint', file: 'npm', args: ['run', 'lint'], timeoutMs: 120000 },
  { id: 'format', file: 'npm', args: ['run', 'format:check'], timeoutMs: 120000 },
  { id: 'integration', file: 'node', args: ['--test', 'test/server.test.ts'], timeoutMs: 120000 },
  { id: 'e2e', file: 'node', args: ['--test', 'test/http-e2e.test.ts'], timeoutMs: 120000 },
]);
```

Add the complete unit, secret, dependency, build, and planning entries defined by the architecture. Represent unavailable toolchains as immutable `NOT_RUN` declarations rather than executable entries.

- [x] **Step 3: Write failing runner tests**

Inject a fake process runner and clock. Assert timeout/failure propagation, duration, exit code, commit binding, output truncation/redaction, atomic temporary-file rename, and removal of incomplete temporary files.

- [x] **Step 4: Implement check execution and atomic reports**

Use `spawn` with `shell: false`, fixed `cwd`, minimal environment, stdout/stderr byte caps, timeout termination, and a report-level `complete: true` marker written only after every selected check reaches a terminal state.

- [x] **Step 5: Add npm scripts**

```json
{
  "management:checks": "node tools/run-management-checks.mjs",
  "management:checks:quick": "node tools/run-management-checks.mjs --profile=quick"
}
```

Only the exact `quick` and `full` profiles are accepted; unknown arguments fail.

- [x] **Step 6: Run focused tests and commit**

```bash
node --test test/management-dashboard-checks.test.mjs
npm run format:check
npm run lint
git add package.json package-lock.json tools/management-dashboard/checks.mjs tools/run-management-checks.mjs test/management-dashboard-checks.test.mjs
git commit -m "feat(dashboard): record real check evidence"
```

### Task 4: Snapshot builder and diagnostics

**Files:**

- Create: `tools/build-management-dashboard.mjs`
- Create: `test/management-dashboard-build.test.mjs`
- Create: `docs/management/dashboard/data/dashboard.json`
- Create: `docs/management/dashboard/data/build-log.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: validated collectors and optional complete check report.
- Produces: `buildDashboardSnapshot(context)`, `writeDashboardArtifacts(root, snapshot)`, and deterministic generated JSON.

- [x] **Step 1: Write failing aggregation tests**

Assert all required top-level sections, task normalization with acceptance/evidence fields, security severity counts, issue/blocker aggregation, source health, Dashboard log warnings, explicit unavailable modules, and stale-test detection.

- [x] **Step 2: Implement aggregation without changing source facts**

Map roadmap `done` to `DONE`; reserve `VERIFIED_DONE` for management records explicitly carrying that status. Preserve the source's status text and path. Do not infer ownership, completion, or approval.

- [x] **Step 3: Write failing atomic-output and check-mode tests**

Use a temporary fixture directory. Assert successful temp-file rename, valid output retention after failed build, byte-for-byte deterministic `--check`, and non-zero status for mandatory source errors or broken internal links.

- [x] **Step 4: Implement builder CLI**

Accept only no flag, `--check`, and `--observed-at=<ISO timestamp>` for deterministic tests. Default time comes from the injected clock. Generate formatted JSON with one trailing newline.

- [x] **Step 5: Add npm scripts**

```json
{
  "management:build": "node tools/build-management-dashboard.mjs",
  "management:check": "node tools/build-management-dashboard.mjs --check"
}
```

- [x] **Step 6: Generate the first truthful snapshot**

```bash
npm run management:build
```

Expected: missing Manager/Worker A/decision/changelog sources are visible as `NOT_AVAILABLE`; checks without a completed record are `NOT_RUN`; current severe risks remain visible.

- [x] **Step 7: Run focused tests and commit**

```bash
node --test test/management-dashboard-build.test.mjs
npm run management:check
npm run secrets:check
git add package.json package-lock.json tools/build-management-dashboard.mjs test/management-dashboard-build.test.mjs docs/management/dashboard/data
git commit -m "feat(dashboard): generate truthful control snapshot"
```

### Task 5: Chinese Control Center homepage

**Files:**

- Create: `docs/management/dashboard/index.html`
- Create: `docs/management/dashboard/app.js`
- Create: `docs/management/dashboard/styles.css`
- Create: `test/management-dashboard-ui.test.mjs`

**Interfaces:**

- Consumes: same-origin `./data/dashboard.json` conforming to schema version 1.
- Produces: accessible navigation and text-only views for project, workers, tasks, decisions, security, tests, Git, build, compliance, network, issues, blockers, links, and source health.

- [x] **Step 1: Write failing static-security and structure tests**

Assert `lang="zh-CN"`, external same-origin script/style files, no inline script/style, no remote URL, no form, no HTML event attributes, complete CSP, skip link, landmarks, all 20 navigation labels, and visible textual status containers.

```js
assert.match(html, /QUANTPASS CONTROL CENTER/);
assert.doesNotMatch(html, /<script(?:\s[^>]*)?>\s*(?!<\/script>)/);
assert.doesNotMatch(html, /\son[a-z]+=/i);
```

- [x] **Step 2: Create the stable HTML shell**

Include only headings, navigation, empty region containers, loading/error state, and `<template>` elements. Reference `./styles.css`, `./app.js`, and no third-party assets.

- [x] **Step 3: Write failing browser-renderer tests**

Extract pure render helpers from `app.js`. Assert source values are assigned through `textContent`, unknown statuses are rejected, links are limited to approved relative paths or loopback preview, unavailable sections remain visible, and a fetch/parse failure renders `DATA SOURCE ERROR`.

- [x] **Step 4: Implement text-only rendering**

Render cards and tables with `document.createElement`, `textContent`, and validated attributes. Do not assign source data to `innerHTML`, `outerHTML`, `insertAdjacentHTML`, CSS text, or event-handler attributes.

- [x] **Step 5: Implement desktop-first accessible styles**

Use system fonts, CSS custom properties, high-contrast focus states, responsive grids, reduced-motion support, and explicit status text. Do not add animations beyond simple focus/hover transitions.

- [x] **Step 6: Run focused tests and commit**

```bash
node --test test/management-dashboard-ui.test.mjs
npm run format:check
npm run lint
git add docs/management/dashboard/index.html docs/management/dashboard/app.js docs/management/dashboard/styles.css test/management-dashboard-ui.test.mjs
git commit -m "feat(dashboard): render Chinese control center"
```

### Task 6: Loopback-only Dashboard server

**Files:**

- Create: `tools/serve-management-dashboard.mjs`
- Create: `test/management-dashboard-server.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `createDashboardServer({ root, host, port })` and CLI `npm run management:serve`.
- Consumes: fixed dashboard root; default host `127.0.0.1`; default port `4181`.

- [x] **Step 1: Write failing server tests**

Bind to an ephemeral loopback port. Verify GET/HEAD assets, MIME types, security headers, no-store caching, `405` for mutation verbs, `404` without path disclosure, traversal/encoded-traversal denial, dotfile denial, and rejection of non-loopback host configuration.

```js
await assert.rejects(
  () => createDashboardServer({ root, host: '0.0.0.0', port: 0 }),
  /LOOPBACK_HOST_REQUIRED/,
);
```

- [x] **Step 2: Implement the minimal static server**

Use native `node:http`, URL decoding with error handling, `realpath` containment checks, GET/HEAD only, and an explicit MIME allowlist. Do not add directory listing, cookies, CORS, websocket, proxying, or an API.

- [x] **Step 3: Add the npm script**

```json
{
  "management:serve": "node tools/serve-management-dashboard.mjs"
}
```

- [x] **Step 4: Run focused tests and manual HTTP probes**

```bash
node --test test/management-dashboard-server.test.mjs
npm run management:serve
curl --fail --silent --show-error --head http://127.0.0.1:4181/
curl --fail --silent --show-error http://127.0.0.1:4181/data/dashboard.json
```

Expected: `200`, required security headers, valid schema JSON, and no LAN listener.

- [x] **Step 5: Commit the unit**

```bash
git add package.json package-lock.json tools/serve-management-dashboard.mjs test/management-dashboard-server.test.mjs
git commit -m "feat(dashboard): serve control center on loopback"
```

### Task 7: Operational integration and Dashboard log

**Files:**

- Create: `docs/management/dashboard/README.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `test/management-dashboard-build.test.mjs`
- Modify: `docs/management/tasks/B4.md`
- Create: `docs/management/tasks/B5.md`
- Create: `docs/management/tasks/B6.md`
- Create: `docs/management/tasks/B7.md`
- Modify: `docs/management/workers/worker-b.md`

**Interfaces:**

- Produces: documented build/check/serve workflow and complete Worker B evidence records.
- Consumes: all Dashboard implementation artifacts and the project check pipeline.

- [x] **Step 1: Write failing completeness tests**

Assert every requested module has a working link or an explicit unavailable state; every generated section names its source; broken links appear in `build-log.json`; generated files carry do-not-edit metadata; README commands match package scripts.

- [x] **Step 2: Document safe operation**

Document these exact commands and meanings:

```bash
npm run management:checks
npm run management:build
npm run management:check
npm run management:serve
```

State that `http://127.0.0.1:4181` is local-only, preview remains `http://127.0.0.1:4180`, and neither service may bind to LAN under this plan.

- [x] **Step 3: Integrate Dashboard validation into the main gate**

Add `npm run management:check` to the existing `check` script after planning consistency and before the web build. Do not make `check` execute the evidence runner, because validation must not silently mutate committed artifacts.

- [x] **Step 4: Run an actual quick evidence collection and regenerate**

```bash
npm run management:checks:quick
npm run management:build
npm run management:check
```

Confirm every status matches the actual run. Preserve `NOT_RUN` and `NOT_AVAILABLE` items.

- [x] **Step 5: Update B4-B7 and Worker B records**

Each record must contain Task ID, title, Worker, start, finish, status, summary, files, tests, validation, known limitations, not fully resolved, deferred work, blockers, residual risks, decisions, commit resolution, and next action.

- [x] **Step 6: Commit the unit**

```bash
git add README.md package.json package-lock.json docs/management/dashboard docs/management/tasks/B4.md docs/management/tasks/B5.md docs/management/tasks/B6.md docs/management/tasks/B7.md docs/management/workers/worker-b.md test/management-dashboard-build.test.mjs
git commit -m "docs(dashboard): integrate control center operations"
```

### Task 8: Full validation, diff review, and branch handoff

**Files:**

- Create: `docs/management/tasks/B8.md`
- Modify: `docs/management/workers/worker-b.md`
- Regenerate: `docs/management/dashboard/data/dashboard.json`
- Regenerate: `docs/management/dashboard/data/build-log.json`

**Interfaces:**

- Consumes: complete branch diff and all project gates.
- Produces: reproducible final evidence, clean branch, pushed remote branch, and review link; it does not merge.

- [x] **Step 1: Verify runtime/toolchain truth before testing**

```bash
node --version
npm --version
git status --short --branch
```

If Node is still below `24.12.0` or npm below `11.6.2`, record the mismatch and do not claim clean-environment reproducibility.

- [x] **Step 2: Run actual evidence and full engineering gates**

```bash
npm run management:checks
npm run management:build
npm run check
npm run audit:dependencies
```

Record exact pass/fail/not-run states, durations, commit, and sanitized evidence paths. A network failure is `BLOCKED` or `FAIL`, never `PASS`.

- [x] **Step 3: Run branch diff security review**

Use the repository security-diff workflow against the immutable base/head pair. Validate reportable findings, fix only explicitly authorized findings, and retain non-reportable hardening gaps in Known Issues.

- [x] **Step 4: Verify generated drift, secrets, and clean status**

```bash
npm run management:check
npm run secrets:check
git diff --check
git status --short
```

Expected: generated artifacts match, secret baseline passes, no whitespace errors, and only intentional final evidence files remain changed before the final commit.

- [x] **Step 5: Record and commit B8**

Use `SELF` for the containing commit and let Git metadata resolve the final hash.

```bash
git add docs/management/tasks/B8.md docs/management/workers/worker-b.md docs/management/dashboard/data
git commit -m "chore(dashboard): record final control center evidence"
```

- [x] **Step 6: Push the dedicated branch and verify remote head**

```bash
git push --set-upstream origin macbeth/dashboard
git ls-remote --heads origin macbeth/dashboard
```

Confirm the remote object ID equals local `HEAD`.

Checkpoint evidence from the superseded lineage is intentionally not linked after public-history remediation; repeat exact local/remote object equality against the final clean-lineage head.

- [x] **Step 7: Open or update a pull request without merging**

Base the pull request on `master`, disclose that the branch currently depends on the three PR #6 commits, summarize real failures and unavailable sources, and wait for CI/review. Do not merge until the Manager/user explicitly approves after the prerequisite branch history is resolved.

Result: draft PR [#7](https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/7) was created from `macbeth/dashboard` to `master` after explicit authorization and read back as open, draft, and blocked. GitHub Dependency Review and CodeQL passed; Engineering `verify` passed 97 tests but failed closed at `management:check` with `RECORDED_GIT_BRANCH_MISMATCH`, confirming the independently reproduced detached-checkout defect. Security review remains sealed with two Medium and five Low open findings; independent review also identified unavailable repository-document links, concealed diagnostic detail, non-pair-atomic output replacement, and a missing fixed-worker shape check. No merge is permitted.

## Self-review

- Spec coverage: all requested homepage fields, 20 navigation targets, task detail fields, Worker logs, decisions, security, tests, logs, Git, known issues, Dashboard diagnostics, safe local serving, and source-driven generation are assigned to implementation tasks.
- Security coverage: redaction, bounded inputs/outputs, fixed command execution, path containment, CSP, text-only rendering, loopback binding, no credential reads, atomic output, and fail-closed validation each have tests.
- Truthfulness coverage: optional absence, malformed sources, stale evidence, unrun tools, failed checks, dirty Git state, and blockers have explicit states.
- Ownership coverage: the implementation reads but does not edit Manager-owned project facts.
- Integration coverage: work stays on `macbeth/dashboard`; the prerequisite PR #6 history and final no-merge boundary are explicit.
- Placeholder scan: every step names concrete files, commands, interfaces, expected states, or assertions; no implementation placeholder remains.

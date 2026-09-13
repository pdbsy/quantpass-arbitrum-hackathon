# AlphaForge Blue Dashboard Restoration Implementation Plan

> Execute inline with executing-plans. Current AGENTS.md prohibits delegation.

**Goal:** Restore the user's earlier navy Control Center with current management data.

**Architecture:** Adapt the preserved Dashboard HTML/CSS and read-only interactions. Keep canonical snapshot validation, report projection, GitHub Forum and GET/HEAD-only server.

**Tech Stack:** Existing browser ES modules, CSS, Node 24.21.0 / npm 11.19.1, existing Playwright harness.

**Spec:** User correction on 2026-09-13: dashboard version is wrong; restore the previous blue-background version. Exact source hashes are in docs/migration/dashboard-disposition.json.

## Global Constraints

- AlphaForge display name; preserve source files and original product prototype.
- No local composer, POST client, server change, credentials, signing or broadcast.
- Current independent checkout and AF-MIGRATION branch; no other workers.
- Clean source C, generated manifest-only R, generated snapshot-only S; no manual evidence edits.

## Task 1: Restore the read-only navy Control Center

**Files:** docs/management/dashboard/{index.html,styles.css,app.js}; test/management-dashboard-ui.test.mjs; tools/verify-management-browser.mjs; docs/migration/dashboard-disposition.json.

**Interfaces:** Existing snapshot schema and report search remain unchanged. Restore groupTasks(tasks), filterTasks(tasks, filter), matchesDashboardSearch(query, values), buildTaskDetail(task), selectSnapshotAfterLoad(previous, result).

- [x] Add unit tests for status grouping, literal search, copied detail arrays and failed-refresh retention. Fixture: NOT_STARTED, PARTIAL, BLOCKED, VERIFIED_DONE map to backlog, active, blocked, done; unknown filter throws.
- [x] Run `node --test test/management-dashboard-ui.test.mjs`; verify failure for absent restored helpers.
- [x] Adapt archived HTML shell and styles; replace project-forum/composer with current Worker report section and canonical agent-forum link. Display AlphaForge.
- [x] Adapt only read-only functions. Preserve canonical validation and report rendering. Refresh loads only `./data/dashboard.json`, retaining previous data on failure.
- [x] Run focused tests; extend existing browser harness to exercise list/card switch, task detail, global search, refresh failure/recovery, sidebar and 320/390/1440 widths. Inspect screenshots.
- [x] Update disposition and Dashboard README with the current visual restoration decision; preserve historical hashes and rejected writer disposition.

## Task 2: Record and synchronize verified source

**Files:** Generated .checks/management/latest.json and docs/management/dashboard/data/{dashboard.json,build-log.json}; existing PR #11.

- [ ] Run relevant local checks; commit all reviewed source with Macbeth01 / AF-MIGRATION identity trailers as C.
- [ ] Run `npm run management:checks`; require 11 PASS, 0 FAIL, retain optional NOT_RUN. Commit only manifest as R.
- [ ] Run `npm run management:build`; commit only generated snapshot files as S.
- [ ] Run `npm run check` and management browser validation at clean S; push PR branch and inspect current-head CI.
- [ ] Open restored page for user. Report visual outcome and actual verification; preserve external review requirement.

Self-review: scope covers the requested prior shell and current evidence; no backend or protocol changes. Existing source and archives remain byte-identical.

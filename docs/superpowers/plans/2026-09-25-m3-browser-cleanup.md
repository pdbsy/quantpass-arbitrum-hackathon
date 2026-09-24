# AlphaForge M3 browser cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. No new workers; Macbeth04 is the sole implementer, A/02 review independently.

**Goal:** Preserve original M3 errors and cleanup diagnostics, attempt all owned cleanup, and publish success only after the corresponding lifecycle succeeds.

**Architecture:** Keep actual M3 journey and standalone CLI entrypoints. Capture primary failure separately from labeled cleanup failures, retain a JSON-safe diagnostic on the thrown Error and in failure.json, and narrowly copy that diagnostic into the collector failure artifact. The exported journey retains caller resource ownership; the CLI owns browser/server cleanup.

**Tech Stack:** Node 24.21.0, npm 11.19.1, existing locked Vite and playwright-core, approved native Chrome, Node test runner, local/mock only.

**Spec:** T7-FINDING-003; Macbeth02 addendum f4505a766f6a48662cc06337e815d150b28250e0f6879198ea11ad14a25743d6 and 01A T7 final review 5a0845d32c0f6e7dc4637aa933ac47e399a9ccfb7063b2c8354d2812ed2fd47d. Copies/hash inputs are in outputs/t7-003-implementation. Base e04260432c8a04fcd8e74bcc2ff8d66d5983693b, tree c38288675ad654c30a805087bfea7e6df3786ef6.

## Global Constraints

- Macbeth04 alone edits tools/verify-m3-browser.mjs, the minimal diagnostic projection in tools/coverage/browser.mjs, new test/m3-browser-cleanup.qualified.test.mjs and test/helpers/m3-browser-cleanup.mjs, and the two qualification registrations in package.json/tools/coverage/run.mjs.
- 01B confirmed sole ownership of the minimal package.json coverage:qualify:browser and tools/coverage/run.mjs test-list additions. Keep old browser-tool-failures bytes unchanged; no lockfile, timeout, concurrency, counter or required-check changes.
- Independent clone /private/tmp/AlphaForge-Macbeth04-T7-003, branch macbeth04/t7-m3-cleanup-fix; independent copied dependencies, no shared writable SQLite.
- Preserve all RED attempts and prior evidence. Source edits do not relabel old S execution. No C/R/S regeneration, PR22 update, remote push/CI, deployment, signing, broadcasting or new workers.
- Fault injection operates only at real Playwright/Vite cleanup boundaries and is labeled FAULT_INJECTED. Actual M3 driver/journey executes unchanged during RED; never substitute a synthetic journey PASS.
- Do not add a pending-cleanup guarantee. Existing outer test/runner budgets remain.

## Task 1: Actual exported journey RED and minimal lifecycle correction

**Files:** modify driver and new qualified test; create test helper; preserve logs under outputs/t7-003-implementation.

**Interfaces:** keep runM3BrowserJourneys(page, {origin,evidenceDirectory}); preserve returned normal report schema. Failures retain primary Error identity plus a JSON-safe m3BrowserFailure diagnostic containing scope, primaryError, cleanupErrors. Each serialized error retains name/message/stack and cause where present.

- [ ] Verify clone/toolchain/dependency isolation; run baseline node --test test/m3-browser-journeys.test.mjs with approved browser paths; retain stdout/stderr/exit metadata.
- [ ] Build helper around a real Vite server, real Chrome page and actual exported journey. For primary failure remove data-m3-fixture-evidence after native goto, as the existing bounded M3 negative test does. Wrap native unroute by awaiting the actual removal then throwing a labeled injected Error; wrap goto only to retain the Error identity from the failing journey operation where needed.
- [ ] Add cases for primary+unroute rejection, successful journey+unroute rejection and normal success. Assertions:
```js
assert.equal(failure.message, 'M3_BROWSER_EVIDENCE_UNAVAILABLE');
assert.match(failure.stack, /verify-m3-browser/);
assert.match(JSON.stringify(persisted), /FAULT_INJECTED_M3_UNROUTE/);
assert.equal(existsSync(join(evidenceDirectory, 'result.json')), false);
assert.equal(page.isClosed(), false);
assert.equal(browser.isConnected(), true);
```
Normal regression checks report.state==='PASS', nine wallet sends, result file and removed handlers. The failure artifacts must retain both primary and cleanup stack, not just AggregateError.message.
- [ ] Run focused test-name pattern M3 cleanup on unmodified production S; preserve nonzero RED output and exact source/test hashes. If setup fails, retain attempt and repair harness before counting RED.
- [ ] Driver: declare report/primaryError outside try, catch primary, independently try each off/unroute, collect labeled errors. If failure, persist failure.json then reject primary (or a cleanup error if no primary) with m3BrowserFailure attached. Only after all journey cleanup succeeds write result.json and return report. Do not close caller page/context/browser/server.
```js
for (const [step, cleanup] of cleanups) {
  try { await cleanup(); } catch (error) { cleanupErrors.push({ step, error }); }
}
if (primaryError || cleanupErrors.length) await persistAndThrowFailure(...);
await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
return report;
```
- [ ] Run the same assertions GREEN, retaining artifacts and current source hashes.

## Task 2: Actual standalone CLI and persisted collector boundary

**Files:** same driver/helper/test; narrow tools/coverage/browser.mjs failure projection only.

**Interfaces:** CLI continues native entrypoint and environment paths. Test-only preload redirects the driver's vite import to a proxy calling the real locked createServer; Playwright shim wraps actual launch/newPage/unroute/close. No production injection flags. Persisted primary and cleanup details remain JSON values.

- [ ] Add real CLI cases: early journey primary+browser close reject; successful journey+browser close reject; successful journey+server close reject; normal CLI. Each injected close first calls the real method, records a marker, then rejects. Assert server close marker despite browser failure, primary preserved, nonzero and no success stdout/file on failures. Keep each child's actual stdout/stderr/result/failure/markers, not just a test title.
```js
assert.equal(child.status, 1);
assert.equal(child.signal, null);
assert.doesNotMatch(child.stdout, /"state":\s*"PASS"/);
assert.equal(existsSync(serverClosedMarker), true);
assert.equal(existsSync(resultPath), false);
assert.match(JSON.stringify(failureJson), /FAULT_INJECTED_M3_BROWSER_CLOSE/);
```
- [ ] Capture RED before CLI edits. Then independently attempt browser/server close with primary preservation, delay stdout until cleanup success, and let CLI defer journey result publication until owned cleanup succeeds. Keep default exported behavior compatible; any internal option must only suppress publication, never assertions or cleanup.
- [ ] Add a real collector test using prepared source and fault-injected real Playwright unroute; inspect its actual failure artifact for both Error records and rejection. Keep exact source/baseline binding distinct from final C/R/S. If strict preparation requires a source commit, commit the local minimal source batch before this test and record that commit; do not alter final frozen source or invoke full coverage run.
- [ ] Narrow collector mapping:
```js
({ name: error.name, message: error.message, stack: error.stack,
   ...(error.m3BrowserFailure ? { m3BrowserFailure: error.m3BrowserFailure } : {}) })
```
No counter, reporter, exit status or resource ownership changes. Exercise projection via actual collection, not a serializer-only mock.
- [ ] Verify failure artifact through run-browser/workflow/report where the admitted local candidate permits; report BLOCKED if prerequisites are missing rather than faking new C/R/S. Preserve original fault injection classification.

## Task 3: Verification and source delivery

**Files:** plan checkboxes; source batch and own evidence only.

- [ ] Run focused qualified cleanup suite GREEN and existing M3 journey/default CLI affected regressions, plus normal real M3 CLI. Use locked local eslint/prettier and npm run typecheck for changed implementation/tests. Do not run remote CI or unrelated scans.
- [ ] Re-read diff for original-error identity, persisted diagnostics, all cleanup attempts and delayed success; test helpers must not rewrite production bytes or return fake journey success. Keep evidence for all failed attempts.
- [ ] Commit coherent minimal source batch with Agent-ID: Macbeth04 and Task-ID: M3-04-PHASE1-PRODUCT trailers; preserve historical base and authors. No amend/rebase/force push. If validation needs another source correction, use a subsequent ordinary commit.
- [ ] Persist index with source commit/tree, diff, commands/tool versions, RED/GREEN stdout/stderr/exit codes, scenario originals/hashes, independent dependency evidence and affected evidence graph. Send to 01B for A-group non-author review. Local tests are implementer verification, never independent approval or final candidate readiness.

Plan self-review: covers both finally sites, premature publication, the shallow collector serializer and real boundary tests. No pending semantics, product behavior or dependency changes. The two minimal test registrations are explicitly approved. Execution remains in this session per manager instruction.

# M3 Real Browser Journeys Implementation Plan

> **Owner:** Macbeth04. Execute inline; no additional workers.

**Goal:** Add a reusable local browser verifier that drives the real `apps/web/index.html` → `apps/web/src/product-ui.ts` entry through the existing DEV_MOCK M3 runtime and proves business results from structured runtime and wallet-request evidence.

**Architecture:** Serve the normal Vite development transform on loopback so the existing `?m3Fixture=1` gate loads the production runtime with a local mock transport. The DEV-only fixture publishes a JSON-safe evidence snapshot on its fixture control element. The Node/Playwright driver uses only real UI controls, then validates runtime state and exact wallet targets/calldata. Coverage collection remains owned by Macbeth01 and can wrap this same workflow.

**Toolchain:** Node.js 24.21.0, Vite 8.2.2, isolated reviewed `playwright-core`, local Chrome, Node test runner.

### Task 1: Define and test wallet evidence validation

**Files:**

- Create: `test/m3-browser-journeys.test.mjs`
- Create: `tools/verify-m3-browser.mjs`

1. Write failing unit tests for exact allowlisted targets, approval spender/amount decoding, one-base-unit Pass transfer, Vault action classification, and rejection of malformed/unexpected sends.
2. Run the new test directly and retain the expected module-not-found/red result.
3. Implement the smallest request summarizer used by the real driver.

### Task 2: Expose DEV-only structured evidence

**Files:**

- Modify: `apps/web/src/m3-injected-runtime-fixture.ts`
- Test: `test/m3-browser-journeys.test.mjs`

1. Export a JSON-safe evidence projection containing the current runtime snapshot and copied provider requests.
2. Publish it only on the existing DEV fixture controls and refresh it on runtime publications and fixture-control completion.
3. Test that evidence reflects real connect, selection and provider activity without introducing production authority.

### Task 3: Drive real product-ui journeys

**Files:**

- Implement: `tools/verify-m3-browser.mjs`

1. Import the tracked prototype assets, start Vite on loopback, launch an empty-profile local Chrome context and open `?m3Fixture=1#/trade/trend`.
2. Exercise correct/wrong network, owner changes, Vault A/B selection, exact two-token deposit approvals, deposit/withdraw/close, post-close token/native rescue, one raw Pass unit transfer, degraded/reorg/refresh recovery and selection isolation.
3. After every critical action, read fixture evidence and assert selected Vault, owner/readiness/health, wallet-send target and decoded calldata. Assert no external target or unsupported provider method occurred.
4. Fail on page errors or CSP execution errors and always close browser/Vite resources.

### Task 4: Verify and commit locally

1. Run the new Node test and the real browser verifier with explicit isolated Playwright/Chrome paths.
2. Run related M3 tests, typecheck, lint, format check, full local tests and `build:web` as warranted by the fixture change.
3. Commit locally on `macbeth04/m3-phase1-product-race`; do not push or invoke hosted checks.

### Collector handoff

`tools/verify-m3-browser.mjs` exports `runM3BrowserJourneys(page, { origin, evidenceDirectory })`. The caller supplies an empty-profile page and a loopback HTTP origin serving the real product entry with the existing DEV fixture gate. The function navigates, runs all business assertions, writes `result.json` and a screenshot, and returns the report while leaving the page open. Macbeth01 can then read canonical Istanbul counters from that same page before closing it. The workflow rejects non-loopback origins and blocks and fails unexpected network requests.

The standalone CLI starts the ordinary, uninstrumented Vite development transform because the existing fixture is DEV-only. `build:web` separately verifies the production bundle. Neither result is a formal source-coverage percentage; canonical raw TypeScript AST instrumentation and coverage integration belong to Macbeth01.

# Product Visible Coverage Paths Plan

> **For agentic workers:** Execute this plan inline. Do not start additional workers. Macbeth01 owns the shared coverage entry and package scripts.

**Goal:** Add bounded real-browser assertions for visible AlphaForge product interactions that are present in the production entry but absent from candidate `5dc6da79b4a669cc1daa94b371c0482dac46195c` coverage.

**Architecture:** Exercise the built `apps/web/prototype/AlphaForge_v3_EN.html` plus `apps/web/src/product-ui.ts` through the existing loopback mock backend and an exact isolated Playwright/Chrome pair. Extend the existing `tools/verify-ui-browser.mjs` assertion driver so Macbeth01's current legacy workflow records the interactions, and add a qualified test that runs the real driver and checks its evidence contract. The business implementation, shared coverage collector and package scripts remain unchanged. Persist a JSON receipt and screenshots under ignored `.checks/` evidence.

**Tech Stack:** Approved Node 24.21.0, npm 11.19.1, Vite 8.2.2, Fastify mock backend, qualified Playwright Core 1.62.1, local Chrome 153.

**Spec:** `docs/management/phase1/ASSIGNMENTS.md`; candidate coverage report `report-c7942f8d-a313-4d63-b44f-090a3777e8ac.json` in Macbeth01's ignored closeout evidence.

## Constraints

- Remain local/mock; no wallet signing, broadcast, deployment, external service or credential use.
- Test the imported production prototype and `product-ui.ts`; do not use the unused React entry.
- Add visible interactions and exact assertions. Do not add coverage exclusions, import-only calls, direct function invocation, synthetic counter edits or business behavior solely to change coverage.
- Do not edit `package.json`, coverage manifests, source inventory or shared collector entry points. Macbeth01 explicitly assigned the existing `tools/verify-ui-browser.mjs` product assertion expansion to Macbeth04.
- Preserve independent browser storage and SQLite state in ignored per-run evidence directories.

## Task 1: Freeze the target gaps and test contract

**Files:** Modify `tools/verify-ui-browser.mjs`; create `test/product-visible-browser-paths.qualified.test.mjs` and ignored run evidence only.

- [x] Confirm the local prototype, `product-ui.ts` and existing browser driver are byte-identical to Macbeth01 candidate `5dc6da7`.
- [x] Record the candidate target metrics: prototype lines 80.14%, branches 41.87% with 705 missing; `product-ui.ts` lines 91.71%, branches 76.78% with 75 missing.
- [x] Define a qualified test contract requiring exact browser module path, executable path and loopback port; never silently skip.
- [x] Start the real loopback backend with a per-run SQLite file and serve the ordinary Vite build.

## Task 2: Exercise visible navigation, filters and empty states

- [x] Home: category and search filtering, no-results state, reset and sample press interaction.
- [x] Market: keyword/category/frequency/saved filtering, no-results reset, two-item comparison and cancel.
- [x] Rankings: mode/range/category/search/saved filters and methodology dialog.
- [x] Assert visible counts, selected controls, empty-state text and dialog content after each user action.

## Task 3: Exercise visible dialogs, local content and errors

- [x] Forum/account: search empty state, sort/category, like/bookmark, draft preservation, local note publish/reply/delete, profile update and reset-cancel path.
- [x] Trade: chart range/style/keyboard inspection, asset detail dialog, invalid order feedback, reviewed buy/sell and stable receipt/account readback.
- [x] Trial allocation: claim review/cancel/confirm, missing-consent or over-limit validation, successful allocation/release and local ledger request/cancel.
- [x] Keep exact separation assertions between API balances, trial allocation funds and the Pass trading ledger.

## Task 4: Verify and hand off

- [x] Run the new qualified browser test under the exact approved Node/npm/browser tools and capture the driver's JSON/screenshots.
- [x] Run focused format/lint or syntax checks for the new test and the existing relevant regression suite.
- [x] Inspect changed files, evidence receipt and repository status; commit only bounded driver/test/plan changes on Macbeth04's branch.
- [ ] Send Macbeth01 the commit SHA, tree SHA, exact commands/results, evidence path and the explicit note that shared collector/package integration remains manager-owned.

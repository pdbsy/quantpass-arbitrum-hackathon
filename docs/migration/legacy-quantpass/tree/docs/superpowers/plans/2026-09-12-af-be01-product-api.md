# AF-BE01 Product API Implementation Plan

> **For agentic workers:** Execute task-by-task in this session with executing-plans and test-driven-development; request an independent code review before final publication.

**Goal:** Supply stable local Strategy, Account and Vault APIs while preserving the existing transactional ledger.

**Architecture:** Versioned server-owned catalog and explicit product projections over the current SQLite v1 store. Keep legacy array endpoints and `error` codes, add detail/account routes, cursor pagination metadata and additive structured errors. All financial state continues through existing domain transitions.

**Tech Stack:** Node 24.12.0, npm 11.6.2, TypeScript, Fastify 5, built-in SQLite, node:test.

**Spec:** `docs/management/agents/tasks/AF-BE01-spec.md` (user-authorized AF-BE01 assignment).

## Global Constraints

- AGENT_NAME = Macbeth03; TASK_ID = AF-BE01.
- Branch `macbeth03/AF-BE01-product-api`; commit trailers `Agent-ID: Macbeth03`, `Task-ID: AF-BE01`.
- Draft PR `[Macbeth03][AF-BE01] Build product APIs for strategy and account data`.
- Do not rewrite backend or alter product UI, wallets, contracts, broadcasting or real-fund paths.
- Integer base units + decimal metadata + string serialization; arithmetic uses BigInt.
- Preserve SQLite schema version 1, existing vault IDs, balances, receipts, history and backups.
- Only registered TEST_ONLY local simulations may be claimed; no arbitrary strategy execution.
- Cross-worker communication only in this worker's own PR. End READY FOR REVIEW; no self-merge.

## Task intake

Agent: Macbeth03. Task: AF-BE01. Scope: catalog, account/vault projections, read pagination, stable errors, tests, fixtures and documentation.
Expected files: server source, `test/product-api.test.ts`, narrowly updated server assertions, package test wiring, product contract/fixture documents and this plan/spec.
Protected files: `apps/web/**`, other worker records, existing migration and domain transition logic.
Dependencies: master baseline `0a813de422a02a2b3f0ade7eee693f0d2491ec33`, public worker protocol PR #1; Macbeth02 consumes the contract after publication.
Risks: existing client array/error compatibility, ambiguous account totals, per-strategy isolation, fixture drift, restoring old SQLite files.
Acceptance: all spec verification categories, full check/gates, independent review, exact PR metadata, documented limits and fixtures shared with Macbeth02.

## Frozen-contract update

Exact contract SHA: `73230c43e464cd1b579fa16a6425756291ef9e8e`.
Decisions: PR #8 comments 5646402517 and 5646423661.
Canonical /api/v1 resources map existing state to schemaVersion, strategyId, vaultId, PassBalance and full VaultBalances; Page<T> uses bound opaque process-local cursors. Legacy arrays/aliases remain. Only live order/withdrawal pending operations are exposed; stopping is a Vault state. APIError is closed and canonical errors have only error. Task-local documents and one package.json test-path append are approved.
Added files: api-schema.ts, product-routes.ts, product-cursors.ts, test/helpers/product-api.ts and product-fixtures.ts.
Independent review identified legacy UI states[0] core binding; default legacy list now filters core-flow-demo with a regression test. All published QA findings against the pre-contract SHA are superseded by the frozen-contract candidate, pending independent revalidation.

## 1. Catalog and product projections

Files: create `apps/server/src/strategy-catalog.ts`, `apps/server/src/product-views.ts`, `test/product-api.test.ts`; modify `apps/server/src/app.ts`, `package.json`.
Interfaces: keep `GET /api/strategies` array; add `GET /api/strategies/:strategyId`. Catalog summaries include version and test cash metadata; detail includes explicit local-simulation capabilities. Two named local fixtures exercise isolation without enabling arbitrary strategies. Export `STRATEGIES` compatibly.

- [x] Write tests against actual HTTP injection for detail parity, empty/unknown catalog lookup and second registered claim.
```ts
const list = (await request('/api/strategies')).json();
const detail = await request(`/api/strategies/${list[0].id}`);
assert.equal(detail.statusCode, 200);
assert.equal(detail.json().asset.decimals, 6);
assert.equal(detail.json().scope, 'TEST_ONLY');
```
- [x] Run the test; observe missing detail route / second strategy failure.
- [x] Add versioned catalog and additive vault projection metadata. All money fields derive from validated domain state; exclude receipts, SQL state and internal executor objects.
- [x] Re-run new and existing server tests, then commit with AF-BE01 identity metadata.

## 2. Account totals and bounded reads

Files: modify `store.ts`, `app.ts`, `product-views.ts`, `test/product-api.test.ts`.
Interfaces: `GET /api/account` returns identity, total passes, vault count, exact global balances, status, one bounded vault page and next cursor. Aggregate validated rows with a streaming iterator; page size never changes global totals. `GET /api/vaults` stays an array with next-cursor headers; supports exact strategy filter. Audit stays an array, newest first, with limit/before-revision and a continuation header. Canonical default 50, maximum 100; legacy audit default100; no schema migration.

- [x] Add failing tests for empty Alice account, independent Bob account, two strategies and pagination.
```ts
assert.equal((await request('/api/account')).json().idle, '9007199254740993');
assert.equal((await request('/api/account?limit=1')).json().vaults.length, 1);
```
- [x] Add bounded store page queries and validated row iteration; reuse domain activeGross for allocated-pool valuation and activeNet for net valuation; do not introduce an independent allocation model. Pending withdrawal is separate from idle/active.
- [x] Add keyset continuation, exact strategy filtering and structured pending operations. Keep full immutable receipts in persistence.
- [x] Validate pagination cannot omit totals or mix owners/strategies and existing audit behavior stays compatible.

## 3. Errors, persistence and compatibility

Files: create `apps/server/src/api-errors.ts`; modify server handlers and tests.
Interfaces: canonical errors are exactly `{error: code}` per frozen decision; only legacy errors add safe code/message/retryable metadata. Known domain codes use a fixed allowlist, unknown/internal errors map to LOCAL_OPERATION_FAILED. Invalid amount encoding and overflow return INVALID_REQUEST before domain mutation.

- [x] Add failing assertions for structured validation, stale revision and internal error responses.
```ts
assert.equal(result.json().code, 'REVISION_CONFLICT');
assert.equal(result.json().retryable, false);
assert.equal(result.json().error, result.json().code);
```
- [x] Implement additive safe error serializer in guards, handler and not-found route.
- [x] Reuse real store tests and add account/detail coverage over close/reopen and SQLite backup. Repeated claims/commands preserve revision and balances; a damaged snapshot returns generic failure with no partial summary.
- [x] Run complete checks, including all existing exact-money/idempotency/restart/corruption tests. Update old exact-shape assertions only for the intentionally additive error contract.

## 4. UI fixtures, documentation and review

Files: create `docs/api/AF-BE01-product-api.md`, `docs/api/fixtures/AF-BE01.json`, test-only fixture generator/check coverage.
Interfaces: schemaVersion 1 fixtures with NORMAL, EMPTY, PENDING, ERROR, RUNNING, STOPPED scenarios; each supplies Strategy Summary, Strategy Detail, Account Summary, Vault and Pending Operation (null/empty where absent). Generate from real API journeys using only Alice/Bob and synthetic funds, normalize random vault IDs.

- [x] Generate fixture scenarios through real routes and verify response relationships/amounts; assert committed fixture matches normalized API results.
- [x] Document new/reused routes, exact fields, cursor behavior, account total semantics, error retry rules, legacy compatibility, zero migration, supported simulation limit and frontend dependencies.
- [x] Run `npm run check`, `npm run verify:gates`, identity validation, diff whitespace and clean-state checks. Only report executed results.
- [x] Request an independent read-only code review; fix legacy core binding with a regression test.
- [x] Complete read-only follow-up review of source candidate 0beef3ad9608dcc676c73fdb287f1dd90e29fd16: no new material findings.
- [x] Publish contract and fixture REPLY to Macbeth02 in own PR using Schema-Version 1, Related-PR and Reply-To NONE when no source request exists. Record New APIs, Reused APIs, Data model changes, Migration implications, Fixtures, Verification, Compatibility, Known limits, Frontend dependencies and Retrospective. Leave Draft PR READY FOR REVIEW.

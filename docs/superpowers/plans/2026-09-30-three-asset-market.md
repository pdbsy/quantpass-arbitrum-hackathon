# AlphaForge Three-Asset Market Batch Implementation Plan

> **For agentic workers:** Execute inline with executing-plans. The user prohibits new workers.

**Goal:** Supply durable, complete MSFT/NVDA/AAPL reference batches for the selected three-pair Testnet route.

**Architecture:** Reuse captureReference and replayReference for each canonical source. Assemble up to three captures into one explicitly bounded reference batch, validate all quote timestamps at batch completion, and persist the complete diagnostic or accepted batch as one SQLite row. This is the market-input prerequisite; strategy execution, paper accounting and public V3 transactions remain separate dependent components.

**Tech Stack:** Node 24.21.0, npm 11.19.1, existing TypeScript and node:sqlite; no new dependencies.

**Spec:** User selection 3; docs/QINFRA-UNISWAP-SCOPE.md and docs/QINFRA-ASSET-WHITELIST-V1.md.

## Global Constraints

- MSFT, NVDA and AAPL are selected for real-reference-price-mapped test substitutes. Official canonical source identities and Testnet execution identities remain separate.
- Robinhood Chain Testnet execution only; fixed Uniswap V3 pairs, one pool per order. No signing, broadcast, mainnet runtime, keys, new venues or deployment in this increment.
- Every stale-price, quote-skew, batch-time, interval, count and rejection policy is explicit. No operational defaults, fee, liquidity, weight or permission values are selected.
- All configured assets must have valid observations at batch completion; rejected batches expose no usable portfolio observations.
- Preserve the existing single-reference journal and synthetic engine limits. A separate batch database rejects unrelated databases.
- Source C, manifest-only R and snapshot-only S; no hand-edited evidence. Self-review is not independent approval.

## Task 1: Bounded batch capture and deterministic replay

Files: packages/market-data/src/batch.ts; test/portfolio-market.test.ts.

Interfaces: parseBatchPolicy(input: unknown): BatchPolicy; captureReferenceBatch(input, transport?, now?, signal?): Promise<ReferenceBatch>; replayReferenceBatch(batch): ReferenceObservation[]. BatchPolicy contains selections (1..3 unique source identities on one source chain), maxAgeMs, maxQuoteSkewMs and maxCaptureSpanMs. ReferenceBatch contains policy, startedAt, completedAt, complete member captures, status/reason and observations or null.

- [x] Write failing tests for exact three-asset prices, quote skew, end-of-batch staleness, halted members, duplicates, source identity substitution, clock regression, cancellation, denied access, and projection tampering.
```ts
assert.equal(batch.observations?.[0]?.tokenBidUsd18, '100000000000000000000');
assert.equal(staleBatch.observations, null);
```
- [x] Run node --test test/portfolio-market.test.ts; record missing batch API failure.
- [x] Implement strict snapshot validation, concurrent existing captures, explicit overall timeout, all-or-none projection, and replay that recomputes every accepted member and batch bound.
```ts
export interface BatchPolicy { selections: Selection[]; maxAgeMs: number; maxQuoteSkewMs: number; maxCaptureSpanMs: number; }
```
- [x] Run the focused suite, then inspect all boundary failures for sanitized diagnostics.

## Task 2: Dedicated batch journal and continuous worker

Files: packages/market-data/src/batch-journal.ts; packages/market-data/src/batch-continuous.ts; packages/market-data/src/journal-db.ts; packages/market-data/src/capture.ts; tools/automata/collection-input.ts; tools/automata/collect-market.ts; tools/automata/collect-portfolio-market.ts; test/portfolio-market.test.ts.

Interfaces: BatchJournal.append(batch): number; read(id): ReferenceBatch; close(): void. parseBatchCollectionConfig(input): BatchCollectionConfig extends BatchPolicy with intervalMs, maxBatches and maxConsecutiveRejections. collectReferenceBatches(input, journal, transport?, now?, signal?): Promise<BatchCollectionSummary>. openJournalDatabase(path, applicationId): DatabaseSync shares existing path and database-identity checks. readCollectionInput(path): unknown shares bounded regular-file CLI input validation.

- [x] Write failing restart/immutability/tamper/cross-database tests and worker rejection/cancellation/input/CLI tests.
```ts
assert.equal(restarted.lastBatchId, 3);
assert.equal(result.reason, 'JOURNAL_APPEND_FAILED');
```
- [x] Run the focused suite and capture expected failures before implementation.
- [x] Implement one atomic SQLite row per complete batch; validate replay on append/read, preserve IDs and diagnostic evidence, and refuse unrelated databases. Refactor shared file/database checks without changing existing single-asset behavior.
```ts
const payload = JSON.stringify(batch);
db.prepare('INSERT INTO reference_batches(payload,sha256) VALUES (?,?)').run(payload, digest(payload));
```
- [x] Implement continuous completion-relative pacing, terminal 401/403 handling, explicit rejection limits, sanitized persistence failures and cancellable shutdown. CLI invalid inputs fail before database/network work.
- [x] Run portfolio plus existing capture/continuous tests and type/lint/format checks.

## Task 3: Source record and validation

Files: docs/QINFRA-THREE-ASSET-MARKET.md; docs/QINFRA-UNISWAP-SCOPE.md; package.json; tools/management-dashboard/checks.mjs.

- [x] Record selected three pairs, implemented input boundary and pending strategy/execution parameters; do not enable whitelist entries or claim complete trading.
- [x] Register the real behavior suite in package and management unit commands.
- [ ] Commit source C on codex/AF-LIVE-MARKET with Agent-ID Macbeth01 / Task-ID AF-LIVE-MARKET.
- [ ] Collect actual management checks; commit only latest.json as R, generate and commit only dashboard.json/build-log.json as S.
- [ ] Run npm run check on final local head; report actual counts, pending checks and no hosted-CI/deployment claim.

## Dependent delivery sequence

1. Market batches in this plan.
2. Durable paper events and atomic strategy/checkpoint consumption, cashflow-neutral NAV and separate personal/public performance; chosen test strategy and weights must be confirmed first.
3. Qualified V3 router/artifacts, three separate test pools, owner-bounded authorization and execution/reconciliation; concrete pool/fee/liquidity/slippage/spend/expiry/liquidation policy and public deployment approval precede activation.

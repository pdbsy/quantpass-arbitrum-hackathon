# AlphaForge Minute Reference Paper Trading Implementation Plan

> **For agentic workers:** Execute inline with executing-plans. The user prohibits new workers.

**Goal:** Run the confirmed three-asset EMA 15/30 on sampled one-minute reference closes with durable, reproducible virtual paper accounting.

**Architecture:** A read-only batch consumer forms causal minute closes and maintains bounded incremental EMA state. A separate append-only SQLite paper ledger commits each input cursor, state and events together, checks source receipts on replay, and refuses changed configuration or sources. This virtual research account never modifies Vault, PASS or chain execution.

**Tech Stack:** Approved Node 24.21.0 / npm 11.19.1, existing TypeScript and node:sqlite; no dependency changes.

**Spec:** User confirmations on 2026-09-30; docs/QINFRA-THREE-ASSET-MARKET.md.

## Global Constraints

- One-minute sampled reference closes, EMA 15/30 and original 15 bps entry hysteresis; preserve QuantConnect attribution.
- Confirmed collection policy: completion-relative 5 seconds, 30-second quote age, 10-second cross-asset skew, 30-second minute-close age.
- Buy at reference ask and sell at bid, both with 10 bps adverse slippage and 30 bps fee, explicitly simulation assumptions.
- Three identities each at most one third of current virtual NAV including entry fees. No automatic overweight sale; freeze additional buying and wait for strategy exit.
- Runtime virtual funding is explicit; cash-only withdrawal never triggers an asset sale. Unit accounting excludes external flows from return.
- Missing minutes are never synthesized. The user confirmed retain-on-gap before implementation; reset is available only as explicit configuration.
- Initial virtual cash and liquidation thresholds are mandatory explicit inputs, never guessed operational defaults.
- No credentials, signing, broadcast, deployment, mainnet RPC, automated publication or merge. Canonical source chain IDs are REST reference identities only.
- Dedicated read-only source and writable paper database, independent of Vault and PASS; full immutable history, bounded state.
- C/R/S evidence, local checks only; no worker or independent-review claim.

## Task 1: Minute samples and streaming EMA

Files: packages/automata/src/reference-minutes.ts, reference-ema.ts; test/reference-paper.test.ts.

Interfaces: advanceMinutes(state, observations, maxCloseAgeMs) returns cloned state plus closed/gap events; advanceEma(state, bar) returns cloned bounded EMA state. One minute closes only after all source clocks cross its end.

- [x] Write failing causal-close, stale-close, duplicate/conflict, long-gap and 150+ minute recurrence tests.
```ts
assert.equal(advanceMinutes(state, beforeBoundary, 30000).events.length, 0);
assert.equal(closed.at, 60000);
assert.equal(stream.slow.count, 30);
```
- [x] Run the focused suite and capture the missing-feature failure.
- [x] Implement per-identity latest sample validation, bounded minute buckets, compact gap events and original integer EMA arithmetic.
- [x] Run the focused suite and type checks.

## Task 2: Virtual reference paper accounting

Files: packages/automata/src/reference-paper.ts; test/reference-paper.test.ts.

Interfaces: parsePaperConfig(input), createPaper(config), applyPaperBatch(state, batch), fundPaper(state, direction, amount6, at), stopPaper(state, at), paperNav(state, at). Functions are pure and return state plus immutable events.

- [x] Write failing independent money expectations: entry spread/fees/slippage, exact one-third cap, cash-only withdrawal, cashflow-neutral returns, threshold/manual stop and no duplicate order.
```ts
assert.equal(result.state.cash6, '898595697');
assert.throws(() => fundPaper(state, 'out', tooMuch, now), /INSUFFICIENT_CASH/);
```
- [x] Run the failing suite.
- [x] Implement 6-decimal cash / 18-decimal quantity and price conversion, rational units, persisted signals and stop latch. Fees and gross rounding are explicit. Dust that cannot be settled remains tracked and blocks completed stop.
- [x] Run the suite including all prior synthetic engine tests; preserve existing limits and protocols.

## Task 3: Atomic replay and continuous consumer

Files: packages/market-data/src/journal-db.ts, batch-journal.ts; packages/automata/src/reference-paper-journal.ts, reference-paper-worker.ts; tools/automata/reference-paper.ts; test/reference-paper.test.ts.

Interfaces: BatchJournal(path, {readOnly:true}).next(after), entry(id) return verified row ID/hash/batch. PaperJournal initializes an explicit virtual config/source anchor, appends checkpoint + state + events with revision check, and replays deterministic transitions. consumePaper consumes ordered rows then polls with explicit bounded/unbounded count and signal.

- [x] Write failing real SQLite tests for read-only no-create, restart exactly once, atomic rollback, altered source/config, concurrent revision, journal tamper and CLI invalid input/help.
```ts
assert.equal(restarted.snapshot().cursor, 31);
assert.equal(restarted.snapshot().state.fills, firstRunFills);
```
- [x] Run the failing suite.
- [x] Implement immutable transactional steps, checksum chain and deterministic replay with original batch receipts. Keep producer database schema unchanged.
- [x] Add offline CLI with explicit arguments and graceful cancellation; live mode has no exchange credentials.
- [x] Run focused tests, type/lint/format checks.

## Task 4: Evidence and delivery

Files: docs/QINFRA-REFERENCE-PAPER.md; package.json; tools/management-dashboard/checks.mjs; this plan.

- [x] Register tests in normal and management unit commands; record implementation and honest limits.
- [x] Run bounded offline integration with 150+ minute fixtures and restart; optional official-reference read-only smoke only with confirmed policy.
- [ ] Commit source C with Macbeth01 / AF-LIVE-MARKET trailers, collect management checks, commit R, build and commit S.
- [ ] Run full check on final head and report actual tests and pending hosted/deployment work.

## Self-review and bounded evidence

The first failing tests preceded minute, paper, journal and storage changes. Additional failing tests reproduced invalid CLI initialization, stale consumer state after runtime cash changes, historical input after controls, cost-triggered liquidation, incorrect quality summaries and partial order accounting at a counter limit; all were repaired. No worker or independent approval was used. New compressed rows preserve original hashes and full receipts, with bounded expansion and legacy reading. Bounded official REST input produced 3 accepted and 1 skew-rejected round; no live warmup or fill was produced. Actual C/R/S and final-head validation results are recorded by their generated evidence, not these planning checkboxes.

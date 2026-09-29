# AlphaForge Route C Implementation Plan

> **For agentic workers:** Use executing-plans inline. Current user prohibits workers and requires clarification of uncertain product decisions.

**Goal:** Deliver the approved three-environment validation route without interpreting route selection as permission for custody, execution, or deployment choices.

**Architecture:** Share canonical asset identities and reproducible market observations between live reference paper trading, public Testnet execution, and fixed-block mainnet fork tests. Begin with an independent read-only market collector; do not relabel the existing synthetic replay engine as a live execution system.

**Tech Stack:** Existing Node 24.21.0, npm 11.19.1, TypeScript, node:sqlite; no new dependencies.

**Spec:** User-approved Route C and docs/QINFRA-ASSET-WHITELIST-V1.md; docs/QINFRA-RESEARCH.md preserves the previous research baseline.

## Global Constraints

- No mainnet signing or broadcasting. CI remains offline/local/mock.
- Confirmed user decisions: Robinhood Chain only; Uniswap as the initial execution venue; real-reference-price-mapped test substitutes; platform-managed restricted executor keys; owner-preauthorized limited liquidation after authorization expiry.
- Uniswap version/router/pools, settlement asset, numeric risk limits and liquidation duration remain unselected. Protocol selection does not authorize arbitrary router commands or mainnet execution.
- Registry membership alone cannot prove COMMON_STOCK classification, exchange, or valid oracle deployment.
- Official REST prices are underlying-equity reference prices, not executable token quotes. Preserve multiplier and provenance.
- Keep source C / manifest R / snapshot S evidence boundaries. Do not hand-edit generated PASS evidence.

## Task 1: Official reference observations

Files: packages/market-data/src/robinhood.ts, test/market-data.test.ts.
Interface: parseRegistry(raw: unknown); normalizeReference(registry, quotes, selection, receivedAt, maxAgeMs).

- [x] Write failing tests for canonical deployment binding, exact decimal/multiplier conversion, stale/halted/malformed observations, and duplicate registry identities.
- [x] Run `node --test test/market-data.test.ts`; confirm missing implementation is the failure.
- [x] Implement bounded parsing and immutable evidence fields; emit `REFERENCE_ONLY`, never trade eligibility.
- [x] Rerun the focused tests and TypeScript validation.

Example independently calculated acceptance vector:
```ts
// Underlying bid 100.123456789 * 1.5 shares/token = 150.1851851835.
assert.equal(observation.tokenBidUsd18, '150185185183500000000');
```

## Task 2: Read-only capture and replay evidence

Files: packages/market-data/src/capture.ts, tools/automata/capture-market.ts, test/market-capture.test.ts.
Interface: captureReference(selection, fetcher, now); MarketJournal.append(capture), read(id), close().

- [x] Write failing tests for redirect rejection, response bounds, provider failure, and SQLite restart/hash integrity.
- [x] Implement fixed official HTTPS GET endpoints, bounded time/body, raw-byte SHA-256, and an append-only SQLite observation journal.
- [x] Provide a CLI with explicit symbol/chain/address/max-age/output arguments and a single-sample default. It never calls RPC or submits orders.
- [x] Verify record/reopen/replay equivalence using offline transport fixtures. Register tests in the existing default suite.
- [x] Run one public read-only capture if the official endpoint responds; preserve failures as failures.

## Task 3: Dependent Route C components

These components remain unimplemented. The confirmed scope above supersedes the earlier pending-decision list; unresolved choices remain explicit:
- Real-time paper worker: durable events/checkpoints and independent risk lifecycle; retain existing synthetic limits until replacement is verified.
- Public Testnet: use verified official deployments where available; real-price-mapped substitutes are approved and must be labeled test-only. Platform-managed execution stays within owner-granted onchain permissions and cannot withdraw funds. Expiry permits only owner-preauthorized, time-limited liquidation; no implicit duration or risk limits.
- Mainnet fork: qualify the selected Uniswap venue, pin block/hash and artifacts, isolate local writes, and verify approved tool availability before installation. See docs/QINFRA-UNISWAP-SCOPE.md for qualification boundaries.

## Verification and handoff

- [ ] `npm run typecheck`, focused tests, lint/format checks, then `npm run check` on the actual changed source.
- [ ] Document completed behavior separately from pending permissions and untested network capabilities.
- [ ] Keep this task branch local; new PR publication/merge/deployment is not inherited from previous PR authorizations.

## Task 4: Offline underlying-asset evidence gate

Files: packages/market-data/src/whitelist.ts, test/asset-whitelist.test.ts, package.json.
Interface: assessUnderlyingAsset(input: unknown): { status: 'BLOCKED'; reason: string } | { status: 'ELIGIBLE'; asset: AllowedUnderlyingAsset }.

Inputs are trusted collector/review artifacts supplied by backend integration, not strategy claims. The pure evaluator checks their shape, identity and consistency; it does not authenticate web pages, perform RPC, authorize execution or enable real assets. No runtime route is added.

- [x] Add failing behavior tests for canonical identity, chain separation, all excluded security types, official-source review validity, inactive/duplicate registry entries, test substitutes, feed binding/freshness/round health and sequencer recovery.
- [x] Implement fail-closed parsing using the existing registry parser. Require explicit evidence times and freshness/grace bounds; no operational defaults. Example: `assert.equal(assessUnderlyingAsset(fixtureWithSameTickerDifferentAddress).status, 'BLOCKED')`.
- [x] Run `node --test test/asset-whitelist.test.ts test/market-data.test.ts test/market-capture.test.ts`, typecheck and lint. Register the new tests in the existing suite.
- [x] Document the trust boundary and pending source collection. Keep every real asset disabled until complete evidence exists.
- [ ] Freeze source C, collect management evidence, commit manifest R and generated snapshots S; run the full local check. Do not publish or merge.

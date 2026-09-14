# Macbeth04 M3 Product UI Worker Log

## Current status

- Current task: M3-04-PRODUCT-UI
- Status: IN_PROGRESS
- Branch: macbeth04/M3-product-ui
- Last known commit: 971e625a9b8a869affd06689d931b730ff566987
- Blocker: Real Testnet integration awaits Macbeth02 contract capability and Macbeth03 shared chain interface.
- Last activity: 2026-09-14T21:12:58+08:00

## Activity log

### 2026-09-14T20:18:00+08:00 — Startup and capability audit

- Task: M3-04-PRODUCT-UI
- Status: PASSED
- Branch: macbeth04/M3-product-ui
- Commit: 7ecba357d5a19f387e86f578822af04a6261fed2
- What changed: Created the user-required isolated implementation branch from the fixed baseline and classified public capabilities.
- Why: Prevent unmerged management or worker changes from entering the product branch and keep unavailable chain behavior explicit.
- Files changed: None.
- Tests run: `npm test` baseline with approved Node/npm, including an elevated rerun for loopback tests.
- Tests passed: 378.
- Tests failed: 0 after the loopback-capable rerun.
- Known limitations: Environment doctor reports local port 4181 already occupied by the separate management Dashboard; no process was stopped.
- Dependencies: Macbeth01 task registration; Macbeth02 contract interface; Macbeth03 chain adapter/interface.
- Open questions: Exact Task-ID and canonical strategy mapping were pending at this point.
- Decision requests: Sent both questions to Macbeth01.
- Next step: Continue non-blocking presentation design and tests.

### 2026-09-14T20:47:00+08:00 — Manager registration and strategy decision

- Task: M3-04-PRODUCT-UI
- Status: PASSED
- Branch: macbeth04/M3-product-ui
- Commit: 7ecba357d5a19f387e86f578822af04a6261fed2
- What changed: Fetched PR #15 and verified full head `84fdc15fdfcc0dd6db2f6fe2c9a10df53cc0e358`, task registration and baseline. Recorded `trend` as the first M3 product strategy; retained `core-flow-demo` and `satellite-flow-demo` as isolated local identities.
- Why: Bind commits and product identity to the manager's immutable registration without copying unmerged management changes.
- Files changed: Implementation plan updated locally.
- Tests run: Repository/branch ancestry and registration content checks.
- Tests passed: All startup checks.
- Tests failed: 0.
- Known limitations: Solidity/on-chain ID encoding and deployment mapping remain owned by Macbeth02/03.
- Dependencies: Macbeth01 decision resolved the frontend ID; 02/03 interfaces remain pending.
- Open questions: None for the first product strategy.
- Decision requests: Resolved by Macbeth01.
- Next step: Implement the presentation-only product shell.

### 2026-09-14T21:12:58+08:00 — Canonical product shell and browser acceptance

- Task: M3-04-PRODUCT-UI
- Status: PASSED_WITH_BLOCKED_DEPENDENCIES
- Branch: macbeth04/M3-product-ui
- Commit: Source `a29ce9da10ed1c8e853595da7164ae225ebddff4`; provenance `971e625a9b8a869affd06689d931b730ff566987`.
- What changed: Added a pure M3 presentation renderer; canonical strategy, provenance, wallet/network/transaction status, explorer evidence and disabled action UI; integrated it through account/trade page extension points.
- Why: Deliver a truthful UI boundary now while leaving wallet, RPC and transaction truth with Macbeth03.
- Files changed: `apps/web/src/m3-product-shell.ts`, `apps/web/src/product-ui.ts`, `test/m3-product-ui.test.ts`, `package.json`, plan and provenance evidence.
- Tests run: Focused TDD tests; typecheck; lint; format check; UI importer/build tests; production web build; local browser checks for `trend`, `core-flow-demo` and account routes; browser console inspection; full `npm test`.
- Tests passed: 10/10 new unit/integration tests, 13/13 targeted UI/import/build tests, typecheck, lint, format, web build, manual browser route checks, migration provenance 3/3, and 388/388 tests after refreshing provenance.
- Tests failed: The first full run found only migration provenance hash drift for modified `product-ui.ts`; the recorded hash was updated and the full test stage passed on rerun. The umbrella check then stopped at `management:check` because its commit-bound report correctly rejects a dirty source tree.
- Known limitations: No real wallet connection, RPC state, contract read/write, receipt, readback/indexer projection or deployed strategy mapping exists on the current public baseline.
- Dependencies: Reviewed Macbeth02 ABI/deployment/authorization capability and Macbeth03 shared UI projection.
- Open questions: Macbeth02 partial-withdrawal policy remains outside this UI shell; unknown operations stay disabled.
- Decision requests: None outstanding for this phase.
- Next step: Run final complete checks, commit with required identity metadata, publish a Draft PR and request independent review.

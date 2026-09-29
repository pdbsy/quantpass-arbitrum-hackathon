# Qinfra Stage Two Implementation Plan

> **For agentic workers:** Execute inline using executing-plans. The user's no-worker constraint takes precedence over subagent defaults.

**Goal:** Enable language-independent quantitative strategy integration with multi-asset configuration and observable, recoverable local execution.

**Architecture:** The server exposes a versioned JSON context and accepts target-weight decisions bound to that context. Strategy adapters never own execution, funding or liquidation. The existing pure engine supplies the shared target executor; SQLite atomically persists decisions and Vault projections.

**Tech Stack:** Existing locked Node 24.21.0, npm 11.19.1, TypeScript, Fastify, SQLite, React. No dependency/tool/runtime upgrades.

**Spec:** docs/specs/AF-P2-QUANT-STRATEGY-INTERFACE.md (derived from confirmed language-independent strategy requirement).

## Global Constraints

- Start only after stage-one merge and actual-master verification.
- Independent existing AlphaForge checkout, new registered Macbeth01 task branch, correct Agent-ID/Task-ID on every commit.
- local/mock, no new credentials, arbitrary network callback, strategy code upload/eval or chain execution.
- Preserve existing v1 runs and fixture bytes/hashes. All new creation options are optional and default to existing behavior.
- Stop and limits always take precedence; ownership, exact units, idempotency and cash-only withdrawals remain unchanged.
- Keep original source identities, reports and failed CI evidence; new C/R/S for new source.

## Task 1: Protocol and shared target execution

Files: packages/automata/src/model.ts, engine.ts; new packages/automata/src/strategy-protocol.ts; test/automata-strategy.test.ts.

Interfaces: `StrategyDecision { protocol:'alphaforge-targets-v1'; runId:string; id:string; expectedRevision:number; frameSeq:number; targets:Record<string,number> }`; `Parameters.strategyMode?: 'rebalance'|'external'`; new engine Action `{type:'decision'; id:string; frameSeq:number; targets:Record<string,number>}`.

- [x] Write expected-value tests: external run with1000 at100 remains1000 cash after frame; valid50% target buys5 units; later100% target at same frame reuses only remaining quote capacity.
- [x] Assert stale frame, future frame, total weight>10000, unknown asset, short/negative targets and missing context cannot execute; prior Run is unchanged on rejection.
- [x] Implement protocol validation independent from HTTP. Extract rebalance target execution so built-in and external modes share sell-before-buy, exact fees, slippage/capacity and supervisor checks.
- [x] Assert frame-triggered liquidation blocks a later otherwise valid external target. Pause rejects new strategy decisions but continues limits. Run all existing engine tests.

Example failing test skeleton (using existing engine fixture helpers):
```ts
const initial = createRun('external', '1000000000', { ...parameters, strategyMode: 'external' });
const observed = transition(initial, { type: 'frame', frame: frame(1, '100000000') });
assert.equal(observed.trades.length, 0);
const decided = transition(observed, { type: 'decision', id: 'example', frameSeq: 1, targets: { 'rwa-a': 5000 } });
assert.equal(decided.positions['rwa-a'].quantity, '5000000');
assert.equal(decided.cash, '500000000');
```

## Task 2: Context, commands, persistence and HTTP contract

Files: apps/server/src/automata-store.ts, automata-routes.ts, api-errors.ts; test/automata-api.test.ts, automata-store.test.ts.

Interfaces: `GET /api/v1/automata/:id/strategy-context`; `POST /api/v1/automata/:id/decisions` consumes StrategyDecision; `AutomataStore.strategyContext(owner,id)` and `decide(owner,id,decision)` use the existing transaction/revision/receipt path.

Context JSON contains protocol/run ID, revision, observed frame/clock, status, current quotes, holdings, cash, eligible asset metadata and risk limits. No future frames or private state of other owners. Strategy decision receipt records last accepted id/frame and persists across process restart. No decision grants funding access.

- [x] HTTP test obtains context after a step, posts a valid decision, retries same ID without duplicate fill; conflicting duplicate returns409.
- [x] A funding command invalidates old context revision. Other owner cannot read context or submit a decision. Unknown keys and malformed integer units reject400.
- [x] Inject SQLite failure after execution preparation; verify run, receipt and Vault all roll back. Close/reopen storage and replay same accepted decision.
- [x] Add strict schemas and fixed public errors; context remains read-only. Existing v1 record loads without mutation of its original digest.

## Task 3: Multi-asset interface and monitoring

Files: apps/web/src/Automata.tsx, automata-client.ts, automata.css; test/automata-client.test.ts.

- [x] Form permits RWA-A/RWA-B weights and an eligible price-limit asset. Sum<=100%; default A50/B0 reproduces stage one.
- [x] Selector enables built-in rebalance or external target mode. Display the context/decision endpoints and protocol version; do not expose session cookies.
- [x] Display current observed frame, last accepted strategy decision and waiting/paused/liquidating status. User can manually pause/resume/stop regardless of strategy availability.
- [x] Test form conversion for two assets, overallocated totals, price limits on noneligible asset and stable defaults.
- [x] Browser run external strategy with two assets, valid decision, funding change/stale rejection, then stop; verify whole-portfolio zero holdings and responsive layout.

## Task 4: Language-neutral documentation and executable reference client

Files: docs/AF-P2-QUANT-STRATEGY-INTERFACE.md; tools/automata/strategy-client.mjs; test/automata-strategy-client.test.mjs.

- [x] Document exact JSON request/response/error examples and frame/revision/idempotency semantics.
- [x] Reference Node client uses only the existing pinned runtime, explicitly targets a loopback local/mock URL, selects a demo owner, requests context and submits target weights. It never accepts an arbitrary host, transfers funds, creates a run or signs anything.
- [x] Test URL rejection, polling/cancellation, stale-context recovery and uncertainty-safe retry of the same immutable request before generating a new ID. Strategy decisions remain visible in records.
- [x] Register all tests in npm and management collector; complete source-bound verification and report finite replay/capacity limits honestly. Long-term production audit compaction and real adapters remain separate work.

## Execution evidence

Stage one merged through PR #35 as 005b98b1ea704cdfb78df964a4e2b4734af11b04. Actual-master local full check and Engineering run 36525648840 passed before stage-two closeout. Stage-two core/API/client failing tests were run before their implementation; the current 44-test automata suite passes. Browser verified external mode stayed at 500 cash before its first signal, accepted A50/B50 with two fills, then manual stop closed both positions with four total fills. 390px document width equals scroll width. Full source-bound collection and CI results are recorded in the generated evidence and PR; checkboxes mark implemented tasks, not a claim that pending hosted CI has passed. Single-agent technical review only, per user no-worker instruction.

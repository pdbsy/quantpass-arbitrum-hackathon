# AlphaForge RWA Phase One Implementation Plan

> **For agentic workers:** Use executing-plans inline, task by task. The current user prohibits worker delegation; that instruction overrides any subagent recommendation.

**Goal:** Run a recoverable, deterministic RWA rebalance bot with whole-portfolio liquidation from the existing local product.

**Architecture:** Pure event-driven integer engine with a synchronous quote simulator, a SQLite/Vault adapter and authenticated local API. A React workspace links from the existing product. The supervisor owns liquidation; strategy code cannot undo it.

**Tech Stack:** Existing Node 24.21.0 / npm 11.19.1 / TypeScript / Fastify / React / node:sqlite; no new dependencies.

**Spec:** `docs/specs/AF-P1-RWA-AUTOMATA.md` plus the current user's confirmed decisions in this chat.

## Global Constraints

- Local/mock only; no RPC, signing, broadcasts, real addresses or credentials.
- Isolated worktree `alphaforge-rwa-phase1`, branch `macbeth/AF-P1-rwa-automata`, base 15d2a210e4a23ff16eb9270bde7c23b3657a441f.
- Keep complete history, required checks, historical artifacts and source refs.
- Do not share writable node_modules or SQLite data. No workers or independent-review claims.
- User approved changing allocated capital during a run; unitized return must exclude cash flows. User confirmed cash-only withdrawals; reject excess without selling holdings.
- Stop, portfolio percentage limits and named-token price limits all latch full-run liquidation. Inclusive boundaries; no automatic restart.
- Source C, report R and snapshot S remain separate; missing checks are NOT_RUN/BLOCKED.

## File Map and Interfaces

- `packages/automata/src/model.ts`: JSON-safe Run, Quote, Frame, Parameters, Action and exact-unit validation.
- `packages/automata/src/engine.ts`: `createRun(id, cash, parameters)`, `transition(run, action)`, `equity(run)` and `returnBps(run)`; pure, immutable transitions.
- `packages/automata/src/fixtures.ts`: versioned synthetic instruments and replay datasets, with a hash computed at the server boundary.
- `apps/server/src/automata-store.ts`: transactionally persist engine transitions and project the allocated portfolio into its existing Vault.
- `apps/server/src/automata-routes.ts`: owner-scoped create/read/action endpoints and optional bounded replay scheduler.
- `apps/web/src/Automata.tsx`, `automata-main.tsx`, `automata.css`, `apps/web/automata.html`: local user workspace.
- `test/automata-engine.test.ts`, `automata-store.test.ts`, `automata-api.test.ts`: independent expected-value and recovery tests, registered in npm test and management collector.
- `docs/AF-P1-RWA-AUTOMATA.md`: operating instructions, capability limits and validation results.

## P1-01 / P1-02 — Contracts and replay

- [x] Write tests for unknown instruments, invalid prices, replay order, duplicate frames and canonical exact units.
- [x] Run engine behavioral tests before implementation and retain failing output.
- [x] Implement typed JSON state and input validation. Replay advances virtual time and only exposes current/past frames. Conflicting or out-of-order frames fail; exact duplicate is a no-op.
- [x] Verify targeted tests and type checking before proceeding.

## P1-03 — Runtime and rebalance

- [x] Test a 1,000-unit portfolio at price 100 with a 50% target: fee-free buy gives 5 units and 500 cash. Verify no lookahead or mutation of the original state.
- [x] Implement a threshold/interval rebalance decision, with sell-before-buy ordering and an independent supervisor.
- [x] Test pause, resume and stop with literal expected states; stop with no holdings is immediately stopped.

## P1-04 — Limits and execution

- [x] Test inclusive +10%/-5% portfolio limits, named-price limits, multi-asset full liquidation and immutable trigger reasons.
- [x] Test stale/missing quotes, slippage rejection, partial capacity, repeated stop and zero-capacity retry. Previously consumed quote capacity cannot be reused.
- [x] Implement exact fees/rounding and one bounded execution attempt per asset/quote. A failed sale remains blocked; a partial sale with residual holdings remains blocked until another eligible quote.
- [x] Verify restarting after serialization does not reset limits, spent capacity or trigger latches.

## P1-05 — Funding, ledger and recovery

- [x] Test cash flows against hand-derived unitized NAV: a deposit or withdrawal alone cannot create profit or clear a trigger.
- [x] Write real SQLite tests for atomic funding/run updates, ownership, command replay, competing revisions, restart and rollback after injected storage failure.
- [x] Implement an additive versioned run store, a guarded Vault checkpoint and legacy-command exclusion while the run owns allocated funds.
- [x] Run `node --test test/automata-engine.test.ts test/automata-store.test.ts`.

## P1-06 — API and UI

- [x] Write HTTP tests for session/CSRF enforcement, owner isolation, schema rejection, funding, stepping, liquidation and retries.
- [x] Register endpoints only in the local app. A serialized scheduler processes bounded synthetic frames and recovers persisted runs after server restart.
- [x] Build the UI for configuration, funding, pause/resume, stop-and-liquidate, progress, holdings, trades, trigger reasons and unitized NAV. Link from existing product without changing the historical imported HTML.
- [x] Verify desktop/mobile display and execute a complete local browser journey.

## P1-07 — Verification and delivery

- [x] Register all new tests in existing npm and management check entry points. Run typecheck, lint, format, complete tests, safety/metadata/supply checks and build.
- [x] Self-review changed paths for duplicate execution, accounting drift, unbounded input, stale valuation and unsafe API access. No self-review is independent approval.
- [ ] Save source C, collect report R and generate snapshot S by the existing workflow; preserve failures and NOT_RUN checks.
- [ ] Report exact commits, commands, results and remaining external checks. Do not merge, deploy or transact.

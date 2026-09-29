# AlphaForge Qinfra Closeout Implementation Plan

> **For agentic workers:** Use executing-plans inline. The user's explicit single-worker instruction overrides delegation defaults.

**Goal:** Deploy a traceable open-source EMA test adapter locally, close the Hackathon demonstration loop and publish measured synthetic research artifacts.

**Architecture:** Extend the current targets protocol with bounded observed history; a pure EMA selector sends only target weights through the existing client. A durable outbox owns pending requests. Demo lifecycle and research orchestration remain outside the trading engine.

**Tech Stack:** Existing Node 24.21.0 / npm 11.19.1 / TypeScript / Fastify / SQLite / React. No new dependencies.

**Spec:** docs/specs/AF-QINFRA-CLOSEOUT.md

## Global Constraints

Local/mock, loopback only; no credentials/mainnet/signing. Macbeth01 only. Preserve previous branch/source refs, dataset bytes and C/R/S evidence; new task branch `macbeth01/AF-QINFRA-CLOSEOUT`. Strategies cannot own funding or clear a stop latch. Existing history limits remain explicit.

## Task 1 — Source and deterministic selector

Files: new `packages/automata/src/ema-strategy.ts`, `third_party/lean-ema/`, `test/automata-ema.test.ts`; extend fixtures and store context.

Interfaces: `emaTargets({observations, parameters, positions, frameSeq})` returns `Record<string,number> | null`; `observations` is a prefix of Frame[] whose final seq equals frameSeq.

- [x] Write and run failing tests: 29 samples => null; 30 constant-100 samples with final 120 => A50/B50 entry; held A/B with 30 constant100 then80 => zeros; repeated context => same targets; future/missing sequence => rejection. Prefix mutation cannot affect earlier decisions.
- [x] Implement fixed-point EMA seeded by each period's SMA, entry comparison `fast * 100000 > slow * 100015`, exit `fast < slow`. Return null if no transition; preserve the configured budget for held assets when another asset transitions.
- [x] Preserve fixed-source Python and Apache-2.0 bytes with SHA-256 metadata. Append `ema-cycle` without changing existing fixtures. Test context never returns frames after current cursor, including owner isolation.

## Task 2 — Durable external client

Files: `tools/automata/strategy-client.mjs`, new `tools/automata/decision-journal.mjs`, `test/automata-ema-client.test.mjs`.

Interfaces: optional `selectTargets(context)` and journal `{load(key), prepare(key,body), clear(key,body), close()}`; journal key includes origin, owner and runId. SQL persistence precedes network send.

- [x] Real SQLite test: server accepts request, response lost, client/journal reopen; identical body is resent and run trade count does not grow. Reject journal envelope run mismatch before transmission.
- [x] Add selector support without changing fixed-target defaults. Null selector output does not send a decision. Clear a journal row only if it still matches the acknowledged body.
- [x] Run existing strategy-client/API tests and new restart tests.

## Task 3 — Reproducible local deployment

Files: new `tools/automata/ema-demo.mjs`, `tools/automata/ema-demo-runtime.mjs`, `test/automata-ema-demo.test.mjs`; web dataset option; package scripts.

Interfaces: `provisionEma(client)` idempotently creates the demo run; `advanceEma(client)` processes the current decision before advancing one frame, respects paused/stopped, and requests stop at replay completion. Demo database and journal are separate from the generic demo.

- [x] Test through real Fastify routes and SQLite: provision twice does not duplicate deposits; rise/fall enters and exits both assets; restart continues the same run; stop before first entry prevents later buys; paused does not buy but risk observations continue.
- [x] Implement loopback server and driver. `--fast` only changes wall-clock demo pacing, not market timestamps. SIGINT closes resources; it does not pretend an unfinished run was liquidated.
- [x] Build and run the actual HTTP demo; inspect UI positions, source mode and stop status. Save screenshot.

## Task 4 — Research harness and closeout evidence

Files: new `tools/automata/research.mjs`, `test/automata-research.test.mjs`, `docs/QINFRA-HACKATHON-CLOSEOUT.md`, `docs/QINFRA-RESEARCH.md`; test registries.

- [x] Failing tests require: decisions from observation t fill no earlier than t+1; future-only changes preserve prior results; JSON checkpoint/resume and async recorded delivery match; data/model changes alter manifest ID; fixed-path fee/slippage increases reduce ending equity.
- [x] Implement a pure checkpoint `{run,pending,observations}` using the existing engine, with no wall-clock fields in deterministic results. Manifest includes input and code hashes, parameters, model/cadence and exact runtime. Produce baseline/stress outputs, separating fixed-path cost sensitivity from full-strategy sensitivity.
- [x] Register tests; run targeted tests, typecheck/lint/build and full tests. Keep unavailable real feed and venue calibration marked NOT_RUN. Preserve old evidence/source refs.

Final evidence collection follows the source commit: full collector → manifest-only R → snapshot-only S → exact-head check. Its completion is recorded by generated evidence and command logs, not by editing this source plan after collection. Public publication remains separately gated.

Local verification before source freeze: 56 automata tests pass; 1,540 total tests, 1,534 pass, 6 skip, zero failures. Browser confirmed four fills and flat stopped positions; 390px viewport has no horizontal overflow. Review was performed by the same worker under the user's no-workers instruction; independent approval is NOT_RUN.

## Hosted CI follow-up — 2026-09-29

The first hosted scan at source 9d3d23df146c reported `af.js-sql-taint` in `DecisionJournal.load` (run 36538619485). The queries already bind parameters. Keep the scanner rules and qualification canaries unchanged; compile the three constant statements once during construction, before request data is processed. Add a real SQLite regression with SQL-shaped keys/envelopes to prove opaque storage, exact acknowledgement deletion, isolation and continued usability. Existing crash/restart and write-before-send regressions remain required. Collect fresh C/R/S and require hosted Semgrep on the resulting head; same-worker analysis is not independent approval.

# AlphaForge Reference Paper Service Implementation Plan

> **For agentic workers:** Use executing-plans inline. The current user prohibits workers and subagent delegation.

**Goal:** Stabilize the approved continuous reference paper account and provide a dedicated local acceptance page.
**Architecture:** One local runtime owns a dedicated reference journal and virtual ledger. It captures official reference prices, consumes persisted rounds, exposes owner-scoped controls, and creates consistent paired backups at actor boundaries, then cooperatively verifies snapshots outside the financial actor. The legacy synthetic page stays separate.
**Tech Stack:** Approved Node 24.21.0 / npm 11.19.1, native SQLite, existing Fastify / React / Vite.
**Spec:** docs/QINFRA-REFERENCE-PAPER.md plus current user approvals.

## Global Constraints

- Single worker, independent codex/AF-LIVE-MARKET checkout, own dependencies and SQLite.
- Local/mock only. Reference GETs do not sign, broadcast, deploy or enable chain execution.
- Existing 3 symbols, EMA 15/30, one-minute periods, 1/3 caps, fee 30 bps and adverse slip 10 bps.
- Quote age 30 s, inter-asset skew 10 s, close age 30 s; missing periods retain EMA.
- Virtual starting cash 1,000 AF-USDC; manual stop latches liquidation, no automatic restart.
- Cash-only funding out; no automatic asset sale for withdrawals.
- User approved local runtime, decimal 2 GB total storage, automatic 24-hour consistent backups and manual page backups.
- Existing evidence and public protocol IDs stay unchanged. C -> R -> S, no fabricated hosted CI or independent review.

## Task 1: Durable controls and diagnostic recovery

Files: batch-continuous.ts, reference-paper-journal.ts, BatchJournal; test/reference-paper-service.test.ts and test/helpers/reference-paper.ts.
Interfaces: PaperJournal(path, config, source, {owner?, deferReplay?}); replayAsync(signal); control({id,expectedRevision,action}, at); history(before?, limit); backupTo(path).
- [x] Write failing tests for null rejection limit, denied access terminal behavior, owner mismatch, exactly-once fund retry after reopen and changed-ID-body conflict.
- [x] Run `node --test test/reference-paper-service.test.ts`; confirm failures come from absent behavior.
- [x] Preserve legacy metadata without owner; bound ledgers require the same owner. Store control commands in existing immutable hash chain.
```ts
journal.control({id:'fund-1', expectedRevision:1, action:{type:'fund',direction:'in',amount6:'1000000'}}, at);
```
- [x] Add bounded history and Node SQLite backup methods. Recover paired backup by reopening it and verifying deterministic replay.
- [x] Run focused tests and existing paper/market regressions.

## Task 2: Runtime recovery, health and storage

Files: reference-paper-service.ts, paper-storage.ts; same focused test.
Interfaces: ReferencePaperService explicit config and directory, injected read transport/clock for tests, cycle(), view(owner), control(owner,request), backup(owner,id), start(), close().
- [x] Test journal catch-up after interrupted source append, paused data -> fresh data recovery, stopped-state retention after reopen, competing-service lease rejection, quota before write, backup restore and immutable configuration mismatch.
- [x] Implement a serial actor queue with exclusive process lease; no simultaneous capture/controls/backup mutation.
- [x] Before append/backup reserve conservative SQLite headroom; count dedicated files and snapshots, never prune evidence.
- [x] Quota/persistence/access denial stop capture and surface blocked reasons. Rejected quotes keep diagnostic collection active.
- [x] Return bounded history, exact decimal strings, warmup counts, current valuation availability and storage health. Do not expose disk paths or raw captures.
- [x] Run focused tests using offline captures only.

## Task 3: Local API and dedicated page

Files: reference-paper-routes.ts, app.ts optional injection, tools/automata/reference-paper-service.ts; reference-paper.html, ReferencePaper.tsx, reference-paper-client.ts, reference-paper-main.tsx, CSS and Vite input.
- [x] Test missing session, wrong owner, cross-origin/header rejection, strict body, fund retries/conflicts and stop via existing app.inject.
- [x] Register dedicated routes only when explicitly configured. Bind listener to loopback and keep the synthetic page unchanged.
- [x] Render mode, current price age, data pause reason, EMA warmup, simulated fills/positions/cash/NAV, exact return and funding controls.
- [x] Save pending financial command locally before POST; retry the same ID/body on uncertain transport result.
- [x] Display stale valuation as unavailable; preserve stop pending without claiming successful liquidation.
- [x] Validate UI build and browser page with a separate fixture account, clearly labeled offline, then the approved live account if runtime choices are answered.

## Task 4: Acceptance and evidence

Files: docs/QINFRA-REFERENCE-PAPER-SERVICE.md, package.json test registration, management-dashboard/checks.mjs.
- [x] Verify fixture warmup/trade/withdraw/stop/restart/backup journeys; mark real continuous 30-valid-minute acceptance only if actually observed.
- [x] Run typechecks, focused suite, UI build; inspect diff.
- [ ] Commit source C with existing task trailers, collect management checks, commit only R, build and commit only S; run final npm run check.
- [ ] Report exact limitations and missing prerequisites; no push/merge/deploy.

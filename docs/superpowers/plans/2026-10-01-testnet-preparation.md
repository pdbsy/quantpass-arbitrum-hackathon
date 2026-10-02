# AlphaForge Testnet Preparation Implementation Plan

> **For agentic workers:** Use executing-plans inline, task by task. The user's single-operator assignment overrides subagent recommendations. Do not start workers.

**Goal:** Deliver the non-encryption Testnet preparation and a reviewable Dots server handoff, then merge a fully checked release into master.

**Architecture:** Preserve the original phase-one custody/runtime. Add separately identified trading components and strict operator configuration so test substitutes, canonical references, chain execution and paper execution cannot acquire one another's authority. The default development and CI paths remain offline and non-broadcasting.

**Tech Stack:** Node 24.21.0, npm 11.19.1, Python 3.12.9, Forge 1.5.1, solc 0.8.31, Fastify 5.12.5, SQLite.

**Spec:** docs/specs/AF-TESTNET-PREP.md; current user instruction; docs/DEVELOPMENT-TOOLCHAIN.md and docs/DEVELOPMENT-TOOLCHAIN-STATUS.md.

## Global Constraints

- Base is actual master `913b5c405da64bcab0ffd6070f5c40cbe4f7631f`; task branch `macbeth01/AF-TESTNET-PREP`, separate full-history checkout and separate writable data/dependencies.
- Testnet 46630 only. No signatures, broadcasts, server deployment, mainnet enablement or live account control in this task's verification.
- Exact 6/18-decimal PASS conversion; owner-only withdrawals to the immutable owner; runtime cash-only withdrawal; no fabricated fills or prices.
- Preserve all authors, refs, original C/R/S and failures. New evidence must identify its exact source; self-review is not independent approval.
- SwapRouter02 exactInputSingle; three fee-3000 pools; public HTTPS wallet login. Ethers 6.17.0 and its reviewed graph are approved. Additional third-party artifact/license changes require review and approval.

### Task 1: Operator configuration admission

**Files:** Create `packages/testnet/src/server-config.ts`, `test/testnet-server-config.test.ts`; register the test in `package.json` and the management unit registry.

**Interfaces:** `parseTestnetServerConfig(input: unknown)` returns a frozen explicit Testnet indexing configuration. `loadTestnetDeployments(config, endpoints, manifestReader)` returns existing `M3ChainRuntimeDeployment` values after strict canonical manifest validation. RPC endpoint values arrive separately from private environment input and never enter public configuration or diagnostics.

- [x] Write tests that reject mainnet, unexpected fields, missing deployment bindings, duplicated database paths, unsafe origins and a modified manifest. Assert that invalid inputs trigger no manifest reads.
- [x] Run the new test under pinned Node and retain the expected failure before creating the module.
- [x] Implement strict exact-field parsing and existing deployment-manifest validation; keep the original `m3-main.ts` demonstration unchanged.
- [x] Run the behavior tests and type check; retain logs and commit the isolated deliverable with AF-TESTNET-PREP trailers.

### Task 2: Trading contracts and selected protocol qualification

**Files:** New trading Vault, restricted grant, test-stock/reference-feed and selected V3 interface/adapter files under `contracts/src`; corresponding owner/accounting/execution/recovery tests under `contracts/test`; separate deployment inventory under `contracts/deployment`.

**Interfaces:** The owner supplies immutable strategy/token identities and explicit executor grants; typed single-pool actions bind state version, input/output token, amount, minimum output and deadline. The executor has no withdrawal target or arbitrary-call interface. Selected V3 behavior and deployment artifacts must match the approved router interface.

- [x] Freeze the user's router and fee answers in the spec and review any exact artifact/library dependencies before installation.
- [x] Write and observe failing tests for executor withdrawal denial, third-asset accounting, grant expiry/revocation, sell-only liquidation, spent allowance cleanup, price staleness, duplicate actions and exact PASS release after profit/loss/full close.
- [x] Implement the bounded owner controls and selected single-pool trade path, preserving the original phase-one ABI and artifact identity.
- [x] Rehearse actual selected V3 behavior in the isolated EVM; retain negative, fuzz and invariant results; run the real pinned contract and Slither gates without suppressions.

### Task 3: Durable execution and reconciliation

**Files:** New typed execution/intent store modules and operator entry point, with API and restart/reorg tests.

**Interfaces:** Every intent has a stable ID, source/grant/config binding and explicit chain/recipient/calldata. Journal before any later authorized submission; uncertainty blocks resubmission. Receipt evidence is reconciled at canonical block identity against contract events and positions before performance publication.

- [x] Write failure cases for lost responses, restart, hash/nonce reuse, wrong chain, reorg, stale grants and mismatched positions; no verification test signs or broadcasts.
- [x] Implement the durable state transitions and explicit operational gates using the qualified dependencies.
- [x] Verify recovery from independent database copies and distinguish paper, Testnet fill, reference valuation and platform-paid gas costs.

### Task 4: Access and wallet product integration

**Files:** Dedicated Testnet server/browser entry points and selected access controls; wallet lifecycle and HTTP boundary tests.

**Interfaces:** Owner wallet actions use configured validated Testnet identities. The selected private/public server profile controls ingress and authentication. Public mode cannot expose Alice/Bob impersonation, simulator funding or server-side custody of owner keys.

- [x] Freeze the access answer, then write real boundary/session/wallet-account-change tests for that model.
- [x] Implement the selected profile, explicit chain switching, owner transaction review and truthful action status; preserve the original local demo.
- [x] Run HTTP and browser acceptance against independent fixture data; actual public-chain writes remain NOT_RUN.

### Task 5: Dots handoff and release acceptance

**Files:** New Testnet handoff, operator configuration examples, service/deployment worksheets and offline preflight command; integration with existing check entry points.

**Interfaces:** Offline preflight reports missing configuration/deployment evidence without network/signing side effects. A filled operator worksheet produces a concrete reviewed deployment/initialization sequence; RPC credentials and keys remain outside repository/browser/logs.

- [x] Document build/release pinning, explicit owner/executor roles, tested startup commands, private secret paths, backups, restart reconciliation, shutdown/liquidation difference and rollback.
- [x] Test operator-command misuse, absent/contradictory parameters, mainnet rejection, safe backup and configuration identity.
- [ ] Capture clean source C, actual report-only R and generated snapshot-only S; run full checks and all applicable security/contract gates.
- [ ] Publish normally, attach the PR, require exact-head hosted gates before protected squash merge, then verify actual master locally and in hosted CI. Retain every raw failure and successful report.

Task 4 browser evidence covers the actual built entry, rendered custody/Testnet labels and missing-wallet handling. Owner/session/actions have separate fixture HTTP and wallet-client regressions. Real extension-wallet and public-chain owner workflows remain NOT_RUN for Dots external acceptance. Progress logs, including sandbox socket failures and the migration provenance mismatch, are preserved under .checks/market-data; this checklist is not generated PASS evidence.

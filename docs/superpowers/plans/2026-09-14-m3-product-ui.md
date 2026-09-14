# AlphaForge M3 Product UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. In this session, execute inline because the repository instructions keep Darwin and additional workers inactive.

**Goal:** Extend the warm AlphaForge product UI with a truthful pre-Strategy-Runtime product shell that can consume Macbeth03 chain projections when they exist, while clearly separating fixtures and local simulation from Robinhood Chain Testnet state.

**Architecture:** Keep the protected prototype byte-identical and add a small, pure presentation module beside `product-ui.ts`. The module renders values supplied by a caller and never owns wallet, RPC, transaction, receipt, or readback transitions. The current integration supplies only facts available on the public baseline: route strategy ID, fixture/local provenance, the canonical Robinhood Chain network configuration, and unavailable capabilities. Real reads and writes remain disabled until Macbeth02 publishes contract capability and Macbeth03 publishes the adapter projection.

**Tech Stack:** TypeScript, browser DOM, existing imported AlphaForge prototype, Node 24.21.0, npm 11.19.1, Node test runner; no new dependency.

**Spec:** User attachment `pasted-text.txt` dated 2026-09-14, freezing D1 canonical `strategyId`, D2 the complete user path before Strategy Runtime, and D3 Macbeth03 ownership of chain transaction truth.

## Global Constraints

- Branch is `macbeth04/M3-product-ui` at canonical baseline `7ecba357d5a19f387e86f578822af04a6261fed2`.
- Do not edit `apps/web/prototype/AlphaForge_v3_EN.html` or generated `apps/web/public` assets.
- Do not add a wallet/EVM dependency, provider integration, ABI, contract address, deployment metadata, transaction transition engine, or second chain adapter.
- Use `ROBINHOOD_CHAIN_TESTNET` as the only frontend source for network name, chain ID and explorer base URL.
- Alice/Bob and current API values remain visibly `LOCAL SIMULATION`; original charts remain visibly `FIXTURE`.
- Keep Buy Pass, Sell Pass, Deposit, Withdraw and Approve visible but disabled with `NOT IMPLEMENTED` while public 02/03 capabilities are absent.
- Never present local command IDs, localStorage, SQLite revisions, fixture values, or static UI state as chain-confirmed evidence.
- Treat `CHAIN_CONFIRMED` as receipt success and `READY` as receipt success plus required readback, but render only projections received from Macbeth03.
- Strategy Runtime, venue execution, positions, fills and strategy-generated PnL remain `NOT IMPLEMENTED / FUTURE PHASE`.
- Task-ID is `M3-04-PRODUCT-UI`. Macbeth01 fixed `trend` as the first canonical M3 product strategy; `core-flow-demo` and `satellite-flow-demo` remain isolated historical local identities.

## Capability Classification

| Class             | Current baseline capability                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAN IMPLEMENT NOW | Pure presentation, provenance labels, canonical network display, disabled capability controls, route/account shell integration, semantic tests                                  |
| UI SHELL ONLY     | Wallet/network states and transaction lifecycle rendering from an injected read-only projection                                                                                 |
| BLOCKED           | Real wallet connection/switching, RPC health, Testnet Pass/Vault reads, transaction submission, receipt/readback/indexing, deployment mapping and Solidity/on-chain ID encoding |
| NOT IMPLEMENTED   | Buy/Sell/Deposit/Withdraw/Approve writes and all Strategy Runtime/venue/order/position/PnL behavior                                                                             |

## Task 1: Add semantic presentation tests

**Files:** Add `test/m3-product-ui.test.ts`; update `package.json` test list only after the focused test exists.

**Interfaces:** Tests import pure presentation functions from `apps/web/src/m3-product-shell.ts`. The presentation input is immutable data supplied by a chain owner; it contains no provider or state-transition methods.

- [x] Assert fixture and local-simulation provenance remain distinct from Testnet.
- [x] Assert network name and chain ID come from `ROBINHOOD_CHAIN_TESTNET`.
- [x] Assert unsupported asset actions stay visible, disabled and labeled `NOT IMPLEMENTED`.
- [x] Assert wallet statuses and all frozen transaction lifecycle statuses have distinct, human-readable output.
- [x] Assert `CHAIN_CONFIRMED` explicitly says readback is pending while `READY` says product state is updated.
- [x] Assert unknown/untrusted text is escaped.
- [x] Run the focused test and record the expected missing-module failure before implementation.

## Task 2: Implement a read-only M3 product shell renderer

**Files:** Add `apps/web/src/m3-product-shell.ts`.

**Interfaces:** Export immutable wallet, network and transaction presentation types plus `renderM3StrategyShell(input)` and `renderM3AccountShell(input)`. These functions only map supplied values to escaped HTML. They do not connect wallets, derive transaction states, poll RPC, build explorer URLs for transactions, or mutate product state.

- [x] Import `ROBINHOOD_CHAIN_TESTNET`; do not copy network constants.
- [x] Render `trend` as the first canonical product strategy and keep historical local identities isolated.
- [x] Render account identity and wallet identity as separate concepts.
- [x] Render fixture/local/Testnet provenance labels on every data group.
- [x] Render disabled roadmap actions and explicit dependency reasons.
- [x] Render all frozen wallet/network/transaction status labels when provided by a future Macbeth03 projection.
- [x] Keep the default public-baseline projection disconnected, idle, and unavailable.
- [x] Run the focused test until it passes.

## Task 3: Integrate through existing product extension points

**Files:** Modify `apps/web/src/product-ui.ts`; extend `test/m3-product-ui.test.ts` or the existing UI build test.

**Interfaces:** Prepend the M3 shell through `AF.pages.trade` and `AF.pages.account`. Preserve `AF.pages.*`, `AF.app.*`, the original page bodies and local ProductAdapter behavior.

- [x] Add a failing pure page-extension test proving existing account/trade content is preserved.
- [x] On original strategy routes, label original content `FIXTURE` and render the Testnet capability shell separately.
- [x] On backend strategy routes and account data, label the existing API content `LOCAL SIMULATION`.
- [x] Keep `/trade/:strategyId` as the single detail-route shape; do not add a Testnet-only page.
- [x] Add the account wallet/network/asset shell while keeping current local account data separated.
- [x] Run targeted UI, importer and build tests.

## Task 4: Record evidence and close only the implemented phase

**Files:** Add `docs/management/agents/logs/M3-04-PRODUCT-UI.md`; update this plan's checkboxes.

- [x] Record Task, status, branch, exact commit, change rationale, files, tests, limitations, dependencies, decision requests and next step.
- [ ] Run typecheck, lint, format check, focused UI tests, full test suite and web build with the approved toolchain.
- [ ] Verify the protected prototype byte count and SHA-256 tests still pass.
- [ ] Request independent review before integration.
- [ ] Create small commits and Draft PR with Task-ID `M3-04-PRODUCT-UI`.

## Deferred Integration Gates

- Macbeth01: resolved Task-ID and first canonical strategy; future product strategy assignments still require explicit decisions.
- Macbeth02: reviewed ABI, deployed Testnet addresses, supported operations, authorization semantics, events and stable error behavior.
- Macbeth03: wallet interface, network state, read projections, transaction lifecycle projection, receipt/readback semantics and explorer evidence.
- Macbeth05: acceptance validation for happy, rejection, wrong-network, failed, replaced, stale and readback-lag paths.

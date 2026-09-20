# M3 Phase One Product Loop Implementation Plan

> **For agentic workers:** Execute these tasks inline in the Macbeth04 session. Each behavior change follows a red/green/refactor cycle and each checkpoint remains reviewable.

**Goal:** Complete the authorized Pass and Vault product loop in the active AlphaForge browser entry while keeping unavailable protocol capabilities fail-closed and provenance explicit.

**Architecture:** Extend the existing `M3ProductRuntime` boundary with narrowly typed Pass, Vault-selection and rescue operations. Keep transaction preparation inside trusted factories, reuse the existing wallet session/simulation/confirmation flow, and render those capabilities through `product-ui.ts` and `m3-product-shell.ts`. Version-bind any factory, discovery or backend evidence interface supplied by Macbeth02/03.

**Tech Stack:** TypeScript 6, EIP-1193 mock transport, Node test runner, Vite browser entry, existing chain adapter ABI encoders.

**Spec:** `docs/management/phase1/Macbeth04-INTAKE.md` and the read-only assignment at commit `48cccb8743d2e77ec8001187c00e95044a3d2f40`.

## Global constraints

- Base is exactly `18f5352070910a867b9729b031aa2e3951785e01`.
- AF-USDC uses 6 decimals; Pass uses 18 decimals. The `10^12` conversion is only for Vault capacity.
- Owner is explicit, non-zero and immutable. AlphaForge Account identity never grants wallet rights.
- Paid sale and real Buy/Sell are outside Phase One.
- No external deployment, signing, broadcast, mainnet, real funds, secrets, rule changes or merge.
- Browser acceptance uses only mock transport on `127.0.0.1:5194`.

---

### Task 1: Publish intake and establish review channel

**Files:**
- Create: `docs/management/phase1/Macbeth04-INTAKE.md`
- Create: `docs/management/phase1/Macbeth04-IMPLEMENTATION-PLAN.md`

**Interfaces:**
- Consumes: fixed base and manager registration commit.
- Produces: immutable intake commit, Draft PR and public ACK URL.

- [ ] Verify branch, base, clean state, tool versions, actual entry and baseline tests.
- [ ] Commit the intake with exact Macbeth04 task identity.
- [ ] Push the worker branch, create a Draft PR, and publish one ACK addressed to Macbeth01 with the exact assignment-comment URL.

### Task 2: Add full-precision Pass transfer

**Files:**
- Create or modify: `apps/web/src/m3-pass-actions.ts`
- Modify: `apps/web/src/m3-product-runtime.ts`
- Modify: `apps/web/src/m3-browser-runtime.ts`
- Modify: `apps/web/src/m3-product-shell.ts`
- Modify: `apps/web/src/product-ui.ts`
- Test: `test/m3-product-runtime.test.ts`
- Test: `test/m3-browser-runtime.test.ts`
- Test: `test/m3-product-ui.test.ts`

**Interfaces:**
- Consumes: reviewed deployment Pass address and the existing trusted `PreparedActionFactory`/wallet flow.
- Produces: `reviewPassTransfer` and `confirmPassTransfer` behavior bound to recipient, full 18-decimal raw amount, chain, account and token.

- [ ] Add a failing test proving `0.000000000000000001` Pass prepares one raw unit and that a six-decimal parser would be rejected by the expected literal calldata.
- [ ] Add failing session-change and double-confirm tests proving no second wallet submission occurs.
- [ ] Implement the minimal ERC-20 transfer factory and runtime review/confirm path with fixed token target.
- [ ] Add failing presentation tests for recipient, exact raw amount and non-sale copy, then render the transfer review in the active product entry.
- [ ] Run focused tests and commit the green checkpoint.

### Task 3: Add post-close rescue without reopening closed actions

**Files:**
- Modify: `apps/web/src/m3-vault-actions.ts`
- Modify: `apps/web/src/m3-product-runtime.ts`
- Modify: `apps/web/src/m3-browser-runtime.ts`
- Modify: `apps/web/src/m3-product-shell.ts`
- Modify: `apps/web/src/product-ui.ts`
- Test: `test/ui-m3-vault-actions.test.ts`
- Test: `test/m3-browser-runtime.test.ts`
- Test: `test/m3-product-ui.test.ts`

**Interfaces:**
- Consumes: existing `rescueUntrackedToken(address)` and `rescueNative()` Vault ABI plus live owner/closed reads.
- Produces: owner-only `rescue-token` and `rescue-native` review/confirm operations available only after close.

- [ ] Add failing factory tests for exact Vault target, token address, zero value and native rescue calldata.
- [ ] Add failing runtime tests proving rescue is unavailable before close, for non-owner/wrong-chain sessions, and available after canonical or live-exit closed reads.
- [ ] Implement the minimal trusted action factory/runtime path and preserve single-use review semantics.
- [ ] Add failing shell tests proving closed deposit/withdraw/close/approve stay disabled while legal rescue remains enabled and labeled with independent raw units.
- [ ] Render token/native rescue dialogs and run focused tests before committing.

### Task 4: Bind initial allocation and Vault create/select to immutable handoffs

**Files:**
- Modify: `apps/web/src/m3-browser-runtime.ts`
- Modify: `apps/web/src/m3-product-shell.ts`
- Modify: `apps/web/src/product-ui.ts`
- Create: `docs/product/PHASE1-OPERATIONS.md`
- Test: `test/m3-browser-runtime.test.ts`
- Test: `test/m3-product-ui.test.ts`

**Interfaces:**
- Consumes: Macbeth02 factory/allocation ABI SHA and Macbeth03 multi-Vault discovery/submission SHA.
- Produces: exact capability model for initial allocation, create and select; no inferred address, price or authority.

- [ ] Record the immutable 02/03 handoff SHAs and compare their strategy/owner/address semantics against the base runtime.
- [ ] Add failing tests for zero owner, foreign strategy, duplicate Vault, missing manifest and mismatched discovery results.
- [ ] Implement create only if the handoff exposes a reviewed factory; otherwise keep a precise `NOT_IMPLEMENTED / INTERFACE_PENDING` state and document the Phase One blocker.
- [ ] Add selection tests that bind wallet, strategy, chain and selected Vault across refresh and account/chain changes.
- [ ] Render initial allocation as distribution/capacity rather than sale or price, then commit the verified checkpoint.

### Task 5: Recovery, provenance and actual browser acceptance

**Files:**
- Modify: `apps/web/src/m3-injected-runtime-fixture.ts`
- Modify: assigned product/browser tests.
- Create: `docs/product/PHASE1-BROWSER-ACCEPTANCE.md`
- Create: `docs/management/phase1/Macbeth04-HANDOFF.md`

**Interfaces:**
- Consumes: completed runtime operations and the existing production-runtime mock transport.
- Produces: reproducible port-5194 browser evidence and an exact-SHA handoff to Macbeth01/03/05.

- [ ] Add failing fixture tests for reload restoration, wallet/chain changes, duplicate clicks, 18-decimal precision recovery, degraded API direct exits and closed rescue.
- [ ] Implement only the mock controls/state needed to exercise the same production runtime.
- [ ] Run focused tests, typecheck, lint, formatting and the repository gate; preserve any C/R/S-specific expected mismatch until source closeout.
- [ ] Start the Vite browser on `127.0.0.1:5194`, execute the documented journey with mock transport only, and record screenshots/errors without claiming Testnet execution.
- [ ] Write the handoff with exact source/candidate/tree, commands/results, unresolved 02/03 dependencies and NOT_RUN items; send the non-sensitive summary to Macbeth01.

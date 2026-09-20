# M3 Confirmation Vault Selection Race Implementation Plan

> **Owner:** Macbeth04. Execute this plan inline because the assignment explicitly forbids additional workers.

**Goal:** Prevent a reviewed operation for Vault A from reaching the wallet if the selected Vault changes before the actual send boundary, while preserving truthful tracking when the send has already begun.

**Architecture:** Keep review ownership and selection generation in `M3BrowserRuntimeSet`, and carry a synchronous guard through each confirmation path to `Eip1193Wallet.submit`. The wallet invokes the guard after all asynchronous preflight/session checks and immediately before `eth_sendTransaction`. A successful guard also publishes the wallet-pending state; no selection check runs after submission starts, so the original runtime continues tracking the real transaction.

**Toolchain:** Node.js 24.21.0 and npm 11.19.1 via fnm; TypeScript; Node test runner.

---

### Task 1: Reproduce the three confirmation races

**Files:**

- Modify: `test/m3-browser-runtime-set.test.ts`
- Evidence: `.checks/M3-04-PHASE1-PRODUCT/confirmation-vault-race-red.log`

1. Extend the fake EIP-1193 provider with controllable runtime-code and send-response gates.
2. Add same-account, same-chain Vault A and Vault B fixtures.
3. Add failing tests for Vault action, Pass transfer, and deposit approval: review on A, start confirmation, pause in an asynchronous runtime-code check, select B, release, and require `M3_VAULT_SELECTION_CHANGED` with no wallet send.
4. Add A→B→A, duplicate confirmation, refresh interleaving, and post-send late-selection tests.
5. Run `fnm exec --using=24.21.0 node --test test/m3-browser-runtime-set.test.ts`; save the expected failure showing the current implementation still sends to A after the selection changed.

### Task 2: Put invalidation at the wallet send boundary

**Files:**

- Modify: `apps/web/src/chain-wallet.ts`
- Modify: `apps/web/src/m3-chain-action-flow.ts`
- Modify: `apps/web/src/m3-browser-runtime.ts`
- Modify: `apps/web/src/m3-browser-runtime-set.ts`

1. Add an optional synchronous `beforeSend` callback to the wallet submission contract.
2. Invoke it after pre-send simulation and session validation and immediately before `eth_sendTransaction`.
3. Thread the callback through Vault action, Pass transfer, and deposit approval confirmations.
4. Move wallet-pending publication into the guarded callback so a rejected stale selection cannot leave Vault A in a false pending state.
5. Preserve the consumed review's runtime and generation in `M3BrowserRuntimeSet`; the callback must reject whenever either no longer matches, including A→B→A.
6. Do not revalidate after the send call starts; let the original runtime record the original chain, Vault, owner, operation, and transaction outcome.

### Task 3: Verify behavior and create a local commit

**Files:**

- Verify: `test/m3-browser-runtime-set.test.ts`
- Verify: `test/m3-browser-runtime.test.ts`
- Verify: `test/m3-chain-action-flow.test.ts`
- Verify: `test/ui-chain-wallet.test.ts`
- Verify: `test/m3-injected-runtime.test.ts`
- Evidence: `.checks/M3-04-PHASE1-PRODUCT/confirmation-vault-race-pass.log`

1. Run the focused runtime-set test until all race cases pass.
2. Run related wallet/runtime/flow tests and type checks using the pinned toolchain.
3. Run the repository's applicable local validation commands from `package.json`; do not invoke remote checks or Actions.
4. Review the final diff for scope, generated-evidence rules, and accidental remote or mainnet behavior.
5. Commit locally on `macbeth04/m3-phase1-product-race` and report the reproduction, fix, tests, commit, and remaining risks to Macbeth01.

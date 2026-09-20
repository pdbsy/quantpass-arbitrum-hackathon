# M3 Multi-Vault Product Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Phase One product select an allowlisted Vault by `(chainId, vaultContract)`, preserve correct rights and operation state across Vaults that may share one StrategyPass, and reject confirmations prepared before a selection change.

**Architecture:** Keep each `M3BrowserRuntime` scoped to one complete reviewed deployment record. Add a small product-runtime set that owns one runtime per allowlisted Vault, forwards only the selected runtime, and binds every review object to the selection generation that created it. The backend runtime-status route only cross-checks the selected allowlisted identity and health; it never supplies trusted deployment fields.

**Tech Stack:** TypeScript 6, Node 24 test runner, browser EIP-1193 provider, Fastify same-origin Chain API, Vite.

**Spec:** `docs/chain/PHASE1-MACBETH04-API-HANDOFF.md` at final Macbeth03 source
`a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`, plus Macbeth01's M3 closeout instruction dated
2026-09-20.

## Global Constraints

- Selection identity is exactly `(46630, vaultContract)` from an explicit allowlisted deployment set.
- Every set entry remains a complete `M3BrowserDeploymentConfig`; API data cannot create or extend the allowlist.
- Multiple Vaults may share one StrategyPass when their immutable strategy IDs agree; each Vault and PassLocker remain independent.
- Switching Vault invalidates every unconfirmed Vault action, deposit approval, and Pass-transfer review created under the previous selection.
- Wallet account, allowances, current operation evidence, and write capability are read separately for the selected Vault.
- Paid issuance, Buy/Sell, factory discovery, deployment, signing, broadcast, mainnet, and invented Testnet addresses remain outside this task.
- Run repository commands through Node `24.21.0` and npm `11.19.1` using `fnm exec --using=24.21.0`.

---

### Task 1: Cross-check the selected backend runtime against trusted deployment identity

**Files:**

- Modify: `apps/web/src/m3-vault-client.ts`
- Modify: `apps/web/src/m3-browser-runtime.ts`
- Test: `test/ui-m3-vault-client.test.ts`
- Test: `test/m3-browser-runtime.test.ts`

**Interfaces:**

- Produces: `M3RuntimeStatusSnapshot` and `M3VaultReader.readRuntimeStatus?()`.
- Consumes: the selected `M3BrowserDeploymentConfig` as the only trust source.

- [x] **Step 1: Write failing client tests for exact contract-qualified runtime status**

```ts
const status = await client.readRuntimeStatus();
assert.equal(requests[0], `/api/v1/chain/runtime-status/${CONTRACT}`);
assert.deepEqual(status.deployment, {
  chainId: 46_630,
  contract: CONTRACT,
  manifestDigest: MANIFEST_DIGEST,
  abiHash: VAULT_ABI_HASH,
  runtimeBytecodeHash: VAULT_CODE_HASH,
  strategyPassAddress: PASS,
  strategyPassAbiHash: PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: PASS_CODE_HASH,
});
```

Add malformed, wrong-contract, and unhealthy payload cases. The production change caught by these tests is accepting a runtime-status response that cannot be tied to the selected reviewed Vault.

- [x] **Step 2: Run the client test and verify RED**

Run: `fnm exec --using=24.21.0 node --test --test-name-pattern="runtime status" test/ui-m3-vault-client.test.ts`

Expected: FAIL because `readRuntimeStatus` does not exist.

- [x] **Step 3: Implement strict status parsing and the contract-qualified GET**

```ts
interface M3RuntimeStatusSnapshot {
  readonly lastAttempt: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED';
  readonly errorCode: 'M3_INDEXER_SYNC_FAILED' | null;
  readonly database: {
    readonly status: 'HEALTHY' | 'UNHEALTHY';
    readonly schemaVersion: number;
    readonly integrity: 'OK' | 'FAILED';
  };
  readonly deployment: {
    readonly chainId: 46_630;
    readonly contract: Address;
    readonly manifestDigest: BlockHash;
    readonly abiHash: BlockHash;
    readonly runtimeBytecodeHash: BlockHash;
    readonly strategyPassAddress: Address;
    readonly strategyPassAbiHash: BlockHash;
    readonly strategyPassRuntimeBytecodeHash: BlockHash;
  };
}
```

Reject arrays, missing fields, extra authority inference, invalid addresses/hashes, unhealthy database evidence, and `lastAttempt: FAILED`.

- [x] **Step 4: Write and run a failing browser-runtime identity mismatch test**

Provide a reader whose Vault and Pass projections are otherwise valid but whose runtime status names another Vault. Expect the selected runtime to remain fail-closed for canonical writes.

Run: `fnm exec --using=24.21.0 node --test --test-name-pattern="runtime status identity" test/m3-browser-runtime.test.ts`

Expected: FAIL because the browser runtime does not call or compare runtime status.

- [x] **Step 5: Add the minimal identity/health comparison before canonical reads**

Compare all status deployment hashes and addresses with the reviewed config. Keep `deploymentBlock` and `abiVersion` sourced from the allowlist because the status route does not expose them. A mismatch throws `M3_RUNTIME_STATUS_MISMATCH`; unavailable/unhealthy status throws `M3_RUNTIME_STATUS_UNAVAILABLE`.

- [x] **Step 6: Run Task 1 tests and commit**

Run: `fnm exec --using=24.21.0 node --test test/ui-m3-vault-client.test.ts test/m3-browser-runtime.test.ts`

Expected: PASS.

Commit: `[Macbeth04][M3-04-PHASE1-PRODUCT] Cross-check selected runtime identity`

---

### Task 2: Add the allowlisted runtime set and selection-generation guards

**Files:**

- Create: `apps/web/src/m3-browser-runtime-set.ts`
- Modify: `apps/web/src/m3-product-runtime.ts`
- Create: `test/m3-browser-runtime-set.test.ts`

**Interfaces:**

- Produces: `M3VaultSelection`, `M3VaultSelectionState`, `M3SelectableProductRuntime`, and `createM3BrowserRuntimeSet(options)`.
- Consumes: `createM3BrowserRuntime`, a shared provider, and one optional reader factory per reviewed deployment.

- [x] **Step 1: Write the failing selection and shared-Pass tests**

```ts
const runtime = createM3BrowserRuntimeSet({
  provider,
  deployments: [vaultADeployment, vaultBDeployment],
  vaultReader: (deployment) => readers.get(deployment.vaultAddress)!,
  transportProvenance: 'DEV_MOCK',
});

assert.deepEqual(
  runtime.vaultSelection.options.map((item) => item.vaultAddress),
  [VAULT_A, VAULT_B],
);
assert.equal(vaultADeployment.strategyPassAddress, vaultBDeployment.strategyPassAddress);
await runtime.connect();
const oldReview = await runtime.reviewAction({ kind: 'withdraw', usdcBaseUnits: '1' });
await runtime.selectVault({ chainId: 46_630, vaultAddress: VAULT_B });
await assert.rejects(runtime.confirmAction(oldReview), /M3_VAULT_SELECTION_CHANGED/);
```

Also assert that A and B use distinct owners, allowance spenders, Vault targets, and operation evidence while returning the same Pass address/balance source. The production changes caught are global Pass uniqueness, stale selected rights, or dispatching A's prepared action to B.

- [x] **Step 2: Run the new test and verify RED**

Run: `fnm exec --using=24.21.0 node --test test/m3-browser-runtime-set.test.ts`

Expected: FAIL because the runtime-set module does not exist.

- [x] **Step 3: Implement the minimal runtime-set proxy**

```ts
export interface M3VaultSelection {
  readonly chainId: 46_630;
  readonly vaultAddress: Address;
}

export interface M3SelectableProductRuntime extends M3ProductRuntime {
  readonly vaultSelection: M3VaultSelectionState;
  selectVault(selection: M3VaultSelection): Promise<void>;
}
```

Reject an empty set, duplicate `(chainId, vaultAddress)` entries, and unknown selections. Permit repeated StrategyPass addresses. Keep one underlying runtime per Vault. On selection, advance a generation, refresh the newly selected runtime, and publish only its snapshot. Bind action, approval, and Pass-transfer reviews to both the selected runtime and generation; delete bindings before confirmation.

- [x] **Step 4: Run Task 2 tests and commit**

Run: `fnm exec --using=24.21.0 node --test test/m3-browser-runtime-set.test.ts test/m3-browser-runtime.test.ts`

Expected: PASS.

Commit: `[Macbeth04][M3-04-PHASE1-PRODUCT] Isolate allowlisted Vault selections`

---

### Task 3: Expose Vault selection in the product and deterministic browser fixture

**Files:**

- Modify: `apps/web/src/product-ui.ts`
- Modify: `apps/web/src/m3-product-shell.ts`
- Modify: `apps/web/src/m3-injected-runtime-fixture.ts`
- Modify: `test/m3-product-ui.test.ts`
- Modify: `test/m3-injected-runtime.test.ts`

**Interfaces:**

- Consumes: `M3SelectableProductRuntime.vaultSelection` and `selectVault`.
- Produces: a `<select data-chain-vault-select>` whose value encodes the exact chain/Vault pair.

- [x] **Step 1: Write failing presentation tests for two reviewed Vault choices**

Render a chain presentation with two choices that share a Pass address. Assert both escaped Vault addresses appear, exactly one is selected, the displayed Pass remains the shared token, and the copy describes a reviewed allowlist rather than discovery or deployment.

Run: `fnm exec --using=24.21.0 node --test --test-name-pattern="Vault selection" test/m3-product-ui.test.ts`

Expected: FAIL because the selector is not rendered.

- [x] **Step 2: Implement selector presentation and product event handling**

On `change`, parse the exact key, clear `onchainDraft` and `passTransferDraft`, close the dialog, and await `selectVault`. Do not synthesize a Vault from a URL label or backend status response.

- [x] **Step 3: Write failing two-owner injected-fixture tests**

The fixture uses Vault A and Vault B with separate owners and Lockers but the same StrategyPass. Connect as A, establish A allowance/operation state, switch to B, connect as B, and assert B starts with its own allowances/operation state. Switch back after changing the provider account and assert A owner writes remain disabled until a matching owner reconnects.

Run: `fnm exec --using=24.21.0 node --test --test-name-pattern="shared Pass" test/m3-injected-runtime.test.ts`

Expected: FAIL because the fixture exposes only one runtime.

- [x] **Step 4: Expand only the DEV fixture needed by the acceptance test**

Use one provider and shared Pass balance, two deployment records, two Vault readers, two owners, two Lockers, and independent per-Vault allowance/operation maps. Keep all addresses deterministic and explicitly mock-only.

- [x] **Step 5: Run Task 3 tests and commit**

Run: `fnm exec --using=24.21.0 node --test test/m3-product-ui.test.ts test/m3-injected-runtime.test.ts test/m3-product-dialog.test.ts`

Expected: PASS.

Commit: `[Macbeth04][M3-04-PHASE1-PRODUCT] Add reviewed Vault selector`

---

### Task 4: Update evidence, validate the complete boundary, and publish a new candidate

**Files:**

- Modify: `docs/product/PHASE1-PRODUCT-WALLET-FLOWS.md`
- Modify: `docs/management/phase1/Macbeth04-WORKLOG.md`
- Modify: `docs/management/agents/M3-04-PRODUCT-UI.md` only if its acceptance table is stale

**Interfaces:**

- Records: exact Macbeth03 source, shared-Pass ownership rule, allowlisted selection behavior, runtime-status trust boundary, and current NOT_DEPLOYED limits.

- [x] **Step 1: Update product and worker evidence**

State that multi-runtime APIs exist, the product selects from complete reviewed deployment records, and runtime status only cross-checks identity/health. Record that shared Pass ownership is per Strategy while Vault/Locker/owner/allowance/operation state remains per Vault. Keep factory/on-chain discovery and real deployment excluded.

- [x] **Step 2: Run focused verification**

Run:

```sh
fnm exec --using=24.21.0 npm run typecheck
fnm exec --using=24.21.0 npm run lint
fnm exec --using=24.21.0 npm run format:check
fnm exec --using=24.21.0 node --test test/m3-browser-runtime-set.test.ts test/m3-browser-runtime.test.ts test/m3-injected-runtime.test.ts test/m3-product-ui.test.ts test/ui-m3-vault-client.test.ts test/m3-product-dialog.test.ts
fnm exec --using=24.21.0 npm run build:web
```

Expected: PASS.

- [x] **Step 3: Run the full suite and agent identity check**

Run:

```sh
fnm exec --using=24.21.0 npm test
fnm exec --using=24.21.0 npm run verify:agent-identity
```

Expected: product tests PASS. If the known shared migration-provenance entry remains the only failure, record its exact expected/actual hashes for Macbeth01 without editing generated PASS evidence.

- [x] **Step 4: Re-run local browser acceptance**

Verify two reviewed Vault choices, two owners, shared Pass display, per-Vault allowance/operation isolation, stale-review rejection after switching, wrong-network disabling, and one-raw-unit Pass transfer in the deterministic mock only.

- [x] **Step 5: Commit evidence, push, and update Draft PR #27**

Commit: `[Macbeth04][M3-04-PHASE1-PRODUCT] Record multi-Vault product acceptance`

Push the ordinary task branch, update the PR description with the final validation, and send Macbeth01 the new head/tree plus any exact remaining integration blocker. Do not merge, deploy, sign, or broadcast.

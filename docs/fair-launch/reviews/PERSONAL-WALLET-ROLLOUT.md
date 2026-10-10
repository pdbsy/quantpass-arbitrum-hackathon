# Personal wallet rollout, 2026-10-10

The user explicitly selected `0x86767116cd40bf6b4f8cf88e08d11e38b04364cf` as administrator/deployer and chose to sign personally. They accepted 2,000,000 AF-USDC and the initial reserves/ETH output limits recorded in [GO-LIVE.md](../GO-LIVE.md). LP and subscription proceeds use the same approved address. The ordinary test wallet has no privileged role.

## Delivery

The additive `deployment.html` entry bundles a SHA-256 pin for public unsigned transaction data. Its wallet session validates chain 46630, the approved account, exact nonce order, real execution gas limits, finite fees and available native balance. A wallet-wide Web Lock and a fresh read of the persisted journal prevent two tabs from requesting the same step. Intent is persisted before a wallet request. Unknown outcomes cannot be resent; recovery verifies the actual wallet hash against chain transactions and receipts. Saved confirmations are rechecked, with three inclusive canonical L2 blocks required before progress. A wallet's open approval prompt cannot be withdrawn by the page; the page explicitly instructs the user to reject an expired prompt.

The page performs no unattended signing. It can export the 41 confirmed hashes for the separate read-only verifier. `wallet-deployment-verify.ts` validates constructor configuration, actual runtime bytes, token/ETH movements, allowances, AMZN's actual pool and LP shares, TSLA escrow, claim and conversion reserves, both stock reserves and the remaining administrator allocation. Its CLI checks the approved payload's fixed bytes hash before parsing, opening RPC or writing a manifest. Compiler immutable placeholders are never substituted for actual runtime hashes. Its transport has no account-discovery, signing or write methods.

Home, Trade, `index.html`, original UI styles and product wallet behavior were not edited. Vite adds only the independent deployment entry. Static publication keeps the existing live entry and its dependencies, authentication gate, reader and databases.

The authentication UID can expose verified Google identity through a bounded private Unix socket while retaining exclusive database access. The market UID receives no direct authentication-database permission. Quote and claim keys decrypt only in memory from separate private encrypted files; the returned capability exposes typed voucher signing only. These service connections are prepared and tested, not activated against an undeployed manifest.

## Necessary validation and actual failures

| Check | Result and scope |
|---|---|
| Wallet session | 11/11 passed with an isolated EIP1193 transport, including all 41 simulated steps, gas, identity, nonce, expiry, funds, storage, concurrent tabs and reorg boundaries. This is not a real wallet deployment. |
| Deployment verifier | Four related tests passed with actual local EVM receipts for 15 deployments and 26 configurations. Anvil's missing ArbGasInfo precompile uses an explicitly isolated bounded shim. Target Testnet is not represented by that shim. |
| CLI approval substitution | One additional test passed with zero RPC calls and zero output files. No repeat of the 41-step EVM run was needed for this CLI-only gate. |
| Identity and voucher signer integration | Fourteen targeted checks passed; actual UID 994/990 socket isolation was separately qualified against a temporary database with read-only mounts. Production identity activation is NOT_RUN. |
| Deployment engine final deadline fixes | Two targeted regressions passed after durable reservation/broadcast writes were moved ahead of final synchronous expiry checks. The injected engine is separate from personal browser wallet signing. |
| Independent review | A reviewer who authored neither the wallet page nor the receipt verifier inspected both frozen modules. Independent storage-failure and CLI-substitution tests each passed. No remaining blocker in this scope; this is manual review, not a managed Codex Security scan. |
| Static browser | Actual Chromium loaded the build at desktop and 390px widths with no page errors or overflow. No wallet or identity was injected; the signing button stayed disabled. |
| Build and source | Both TypeScript projects, scoped lint/format, deployed-path Vite build and diff checks passed. The existing secret baseline passed over 1,235 files before this evidence document was added; ignored private storage and binary data remain outside its coverage. |

The first actual local full deployment failed at Vault Factory with the original 8,000,000 gas cap. Its corrected local estimate was 8,946,289, with 20% buffer 10,735,547. The per-step policy was raised to 12,000,000 and aggregate gas budget to 0.010 test ETH, without changing any asset allocation. A fresh full initialization then passed; the failed run is not counted as a pass. A fixed test password initially triggered the secret baseline and was replaced with a generated temporary value; no scanner rule was weakened.

The corrected official Testnet read-only preflight completed at `2026-10-10T06:48:42Z`, with nonce 0, 0.02 ETH, gas price 10,000,000 wei and execution limit 32,000,000. The first deployment estimate was 965,109 gas. The conservative envelope is 0.00984 ETH gas + 0.002 ETH conversion funding + 0.0005 ETH retained balance = 0.01234 ETH. Two intermediate read-only attempts rejected an invalid RPC response; later bounded diagnosis and the recorded final preflight succeeded. The complete dependent target graph remains NOT_RUN until each prior contract exists.

## Commands and remaining real work

```sh
npm run build:web -- --base=/alphaforge/
node --test --test-isolation=none test/launch-deployment-wallet.test.ts
npm run test:fair-launch:wallet-receipts
npm run fair-launch:verify-wallet -- docs/deployment-approved.json ACTUAL_WALLET_RECEIPTS.json PRIVATE_MANIFEST.json
```

The last command creates a manifest only after the actual official-chain receipts match. It does not deploy, sign or fund anything. The first three commands produce local build/test evidence only.

The initial signing window ends at `2026-10-11T06:36:40Z`. Keep this payload fixed while signing; unrelated wallet transactions invalidate the predicted deployment graph. A future window must preserve and requalify existing transaction evidence instead of deleting pending intent or replaying initialization.

Actual Testnet deployment, funding, receipt verification, reader activation, ordinary verified-account claims/trades/Vault acceptance and fresh stock execution are still **NOT_RUN**. Fresh stock feeds require real sources, calendar and keeper signatures and remain explicitly unsigned tasks. Both workflows on parent `077e778` passed; they do not qualify this new source. Current-source required checks must be evaluated separately. Managed Codex Security remains `NOT_RUN / BLOCKED_TOOL_UNAVAILABLE`.

## Publication-check recovery

The Fair Launch workflow passed on `0b9452`, but Engineering checks failed. The complete default Gitleaks scan reported 14 `generic-api-key` occurrences in the approved public plan, alongside the previously reviewed historical occurrence. Each new occurrence is a 20-byte contract address independently derived from the approved deployer and nonce. The recovery binds exactly the published Git blob, SHA-256, typed Git path and 14 unique source lines; it keeps the unsuppressed findings and scanner exit codes. Other files, extra or duplicate findings, changed blobs, private keys and expired proofs continue to fail. The original historical disposition is unchanged. This public-address proof is valid only through October 19 UTC; it does not renew automatically.

Thirty related scanner tests passed. An independent reviewer additionally checked six composition boundaries. The actual pinned Gitleaks CLI then passed its canary, complete locally fetched history and current tracked sources: raw history retained 15 findings and raw current sources retained 14. This local recovery run included the working-tree fix; it does not replace required checks on the final committed source.

All three Engineering source-verification hosts also failed the privacy scanner's 12 MiB aggregate capacity, after their tests passed. The committed repository measured 13,275,694 bytes, exceeding that capacity even without the deployment plan. The finite aggregate capacity is now 16 MiB; the 2 MiB per-file ceiling and all detection rules remain. The complete current scan and two targeted capacity tests passed, including detection beyond the previous ceiling and rejection at one byte beyond the new ceiling. No file is excluded. The failed workflows remain evidence of failure; the final source must pass fresh required checks before publication.

The next source `172329f` passed Gitleaks and Fair Launch but failed Semgrep's general weak-hash rule on the Git object-ID calculation, and three isolated missing-history tests failed because the new proof dependency was loaded before history admission. The object-ID calculation now delegates to bounded read-only `git hash-object`, without writing objects, while the independent SHA-256 payload pin remains authoritative. The original Semgrep rules then passed a real targeted scan. The six proof tests passed after a local sandbox input-pipe timeout was diagnosed and the same bounded read-only command was rerun in the permitted environment; three independently selected regressions also passed. The fixed proof module is loaded only after history and master-reference admission. Incomplete-history fixtures continue to require no external dependencies, while the complete scanner fixture uses the real installed runtime dependencies. Final committed-source checks remain required.

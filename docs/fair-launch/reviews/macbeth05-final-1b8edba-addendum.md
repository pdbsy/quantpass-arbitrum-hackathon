# Final claim and unsigned-plan review addendum

Reviewed immutable `1b8edba0fbf6b54862e12cf6b122258efe49ad59` against `aca74a1e2829fb5d8ae0592371bf2ae1512962c5`. Scope was the wallet-linkage response, atomic claim registry guard, unsigned deployment metadata, exact feed keeper lookup, and environment example relocation. Existing contract, integration, executor, SSE/error fixes and CI evidence are reused. Uncommitted ingress/service/documentation examples present during inspection are outside this checkpoint.

No new confirmed security vulnerability or blocking engineering issue was found in this delta. The already-claimed registry-reset candidate documented in `macbeth05-claim-registry-restore-candidate.md` is fixed for the reproduced scenario. This is a bounded independent read-only engineering/security review, not a formal Security scan, third-party audit, GitHub approval, performance certification or authorization for deployment/funds actions.

## Claim restoration and wallet linkage

`packages/launch-market/src/store.ts:234` now performs reconciliation inside the atomic Claim reservation. Canonical event count for the configured chain must exactly equal the fresh onchain successful-claim count. Each event must map to a preserved account and voucher with the same account key/account relationship, original voucher wallet, transaction hash and included/completed status. A missing event causes `CLAIM_RECONCILIATION_REQUIRED`; a lost/inconsistent original identity mapping causes `CLAIM_IDENTITY_RECOVERY_REQUIRED`. These checks precede voucher issuance/signing and do not clear eligibility or reconstruct identity from public wallets.

The original wallet is compared to the voucher, rather than the account's currently rebound wallet. This retains legitimate rebinding behavior. The guard is confined to Claim reservation: public chain indexing, Mint, trading, Vault actions and receipt recovery do not call it. Direct-wallet inclusion can briefly advance the chain count before indexer reconciliation; only new Claim issuance waits during that interval.

This reviewer repeated only the bounded offline reproduction against the new guard using in-memory databases and ephemeral test wallets. No source or real-chain state changed. Output:

```json
{"beforeReplay":"CLAIM_RECONCILIATION_REQUIRED","afterReplay":"CLAIM_IDENTITY_RECOVERY_REQUIRED","preservedOriginalVoucherAfterRebind":"ISSUED"}
```

The new targeted regression also exercises lost mappings after replay, count lag, preserved original wallet following rebinding, and corrupted voucher wallet. Parent reports 17 related tests plus one targeted regression passing; those suites were inspected in source and not rerun wholesale by this reviewer.

`packages/launch-market/src/service.ts:132` now exposes an account ID on a public wallet projection only if that account's actual stored wallet equals the queried owner. An authenticated user's unrelated/unbound wallet therefore cannot appear linked in the UI. Quote submission still separately requires the actual bound wallet.

The successful-event guard cannot establish whether a lost registry once issued an unconsumed, still-valid voucher while chain totalClaims was zero. Approved genesis initialization must remain distinct from restoration, and migrations/backups must retain the full account/voucher registry and private namespace, including uncertain/pending vouchers. Unknown email-to-opaque-key mappings are not automatically recoverable from chain logs. The fix closes the reported already-claimed reset path, not arbitrary registry-loss recovery.

## Unsigned plan and reference metadata

- Deployment schema 2 records each explicit CREATE nonce, predicted contract, constructor arguments, initial token recipient and fixed supply. Explicit deployer/admin/quote/claim identities and both LP recipients are still required and nonzero; there is no LP fallback to the proceeds wallet or deployer.
- Funding actions now expose parallel asset/address and base-unit amount arrays plus precise `assetMovements` containing source/destination. Transfers identify the actual recipient; native and token reserve funding identify the separately funded reserve. Approval actions describe spender and allowance and correctly contain no token movements.
- AMZN pool initialization records actual pool/LP shares as receipt-derived unresolved outputs, explicit LP recipient, and exact 500,000 PASS / 250,000 AF-USDC input reserves. TSLA Mint opening records the independent public inventory, locked LP reserves and explicit TSLA LP recipient. Proceeds distribution remains the fixed EOA. Metadata agrees with the unchanged ABI/calldata and deployment-then-configuration order; target gas remains `NOT_RUN`.
- `tools/launch-market/prepare.ts` uses artifact reads and signer-free `ContractFactory.getDeployTransaction`, never invokes the imported local fixture deployment function, and creates no RPC, private key, signer, funding or broadcast path. Schema/metadata changes do not execute the plan.
- The stock-reference CLI now reads `keeper()` and `referenceIdentity()` from the exact configured feed at the pinned canonical block. It reports the actual keeper as caller rather than assuming the strategy creator. It still performs only read RPC and fixed market-data GET calls, writes a new owner-private unsigned output file, and never includes credentials in that output or signs/broadcasts actions.
- The environment example relocation to `deploy/launch-market/.env.example` preserves its contents. Existing secret-file policy explicitly permits `.env.example` basenames while rejecting other environment files; this change introduces no secret or policy waiver.

## Bounded CI/tooling review

The additive workflow and local check tooling are unchanged in this final delta; their earlier review is reused and exact frozen source was reread. Workflow actions are immutable SHA pins, permissions are read-only, checkout does not persist credentials, and Node/npm/Python/contract tools use existing exact admissions. Contract tests target only new market/launch-vault paths, with ABI/artifact identity checks, targeted new server/UI tests, web build and isolated EVM flow. No existing required check or scanner waiver is weakened.

Anvil is locked to Linux x64 1.5.1 and commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`. Bootstrap downloads only its fixed official npm archive, rejects redirects, checks archive SHA-512 and binary SHA-256, rejects a mismatched existing executable, and verifies version/commit before use. The local checker rechecks the binary hash, creates its own ephemeral loopback listener and Anvil chain 46630, overwrites the test RPC environment with that local endpoint, and terminates its child afterwards. The local deployment fixture additionally requires HTTP loopback plus the admitted Anvil client version/chain. The preparation helper imports only artifact reading capability from this module; importing it does not execute deployment. Tool downloads or the EVM suite were not rerun for this metadata/guard review.

The previous report's distinctions remain: actual target transactions are `NOT_RUN`, read-only target gas bounds plus a local receipt are not a target execution receipt, complete load qualification must be supported by its separate completed artifact, and a verified HTTPS auth ingress/read-only access database is an operational dependency. No reviewed source edits, GitHub publication/approval, formal scanner PASS, Slither run, external signature, live deployment or funds mutation were performed by this reviewer. All earlier report limitations and PR ancestry disclosures continue to apply.

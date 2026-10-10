# Claim registry restoration review addendum

Candidate requested after final delta review of immutable `aca74a1e2829fb5d8ae0592371bf2ae1512962c5`. This addendum narrows the earlier stable-identity conclusion: ordinary restart, wallet rebinding and retained-registry reorg recovery preserve eligibility, but a fresh or incorrectly restored registry cannot safely authorize claims merely because chain event replay succeeds.

## Confirmed restore gap

`LaunchMarketStore.trustedAccount()` derives an opaque account key from a new random UUID. Private storage namespace/schema checks prevent mixing identities within an existing directory but allow a fresh directory for the same origin/manifest. If the durable account mapping is lost, logging in with the same verified email/subject creates a different key. The Claim reserve rejects reuse of the old onchain key, not a newly generated key for the same email. `reserveClaim()` at this checkpoint compares historical events only against the current key and global remaining slots.

Replaying chain events restores old opaque keys, amounts and wallets; it cannot reconstruct their email/subject mapping. Therefore checking only `canonicalClaimCount == chainSuccessfulClaims` is insufficient.

Executed a bounded offline reproduction using two in-memory SQLite stores and an ephemeral test wallet. The original store created a voucher and observed its successful claim. The second store used the same verified identity/wallet, replayed that old canonical claim, and still issued a different account key and new voucher. Output:

```json
{"sameVerifiedIdentity":true,"newOpaqueKey":true,"canonicalClaimsReplayed":1,"chainSuccessfulClaims":1,"claimsMappedToPreservedAccounts":0,"newVoucherStillIssued":true}
```

No product source, external network, actual blockchain, production signing key or live funds were touched. The trigger requires registry loss or an incorrect fresh/restore configuration; this is not a claim that an ordinary remote account can delete server state.

## Recommended fail-closed boundary

Before signing or returning any Claim voucher, perform the following checks inside the same atomic reservation transaction:

1. Count canonical Claim events for the configured chain. Require the count to equal the fresh canonical snapshot's successful claim count, not merely remain below it.
2. For every canonical event, require a preserved account row with the same opaque key and a voucher row whose `account_id` and `account_key` identify that account. Require the original voucher wallet and recorded claim transaction hash to match the event. Missing or inconsistent mappings require registry recovery.
3. Keep the existing unique account/subject/email and voucher constraints, stable key, per-account prior-voucher policy and global slot reservation checks.

Use a bounded reconciliation/registry-recovery error and disable only new Claim issuance. Minting, trading, public balances, Vault actions, chain event replay and existing receipt recovery should continue. A direct-wallet claim can advance the chain count before the indexer catches up; the first check then causes a temporary delay rather than granting an entitlement. Once canonical replay and the original voucher mapping reconcile, claims resume.

Compare event wallet to the original voucher wallet, not the account's current bound wallet. An account can legitimately rebind after claiming. An unknown old key must remain unknown; never manufacture an email/account mapping from a public wallet or automatically clear eligibility to make reconciliation pass.

## Limits

The successful-event guard cannot prove the absence of lost, still-valid vouchers before any onchain success. For example, chain `totalClaims == 0` does not reveal an old 60-second voucher pending when a registry is lost. A migration must preserve the complete account/voucher registry and private namespace, including pending/uncertain vouchers, and distinguish approved genesis provisioning from restoration. Opaque onchain events cannot automatically recover missing identity mappings. The proposed guard closes the already-claimed reset candidate; it is not a guarantee of recovery from arbitrary identity-registry loss.

No implementation edit was made by this reviewer. A subsequent immutable checkpoint must confirm the guard and targeted cases: fresh registry plus replayed unknown claim; retained registry during direct-wallet indexing lag; successful reconciliation; legitimate wallet rebinding; canonical reorg rollback; and continued trading while claim issuance is blocked. Existing contract and broad historical matrices need not be repeated.

# Actual Testnet rollout continuation

The user instructed “那就上线” on 2026-10-10, then explicitly selected their existing wallet `0x86767116cd40bf6b4f8cf88e08d11e38b04364cf` as deployer and administrator, with personal wallet signatures. They also accepted the starting funds and limits below. The approved LP and subscription-proceeds recipient remains that same address. This authorization never grants the server access to the user's private key.

The ordinary user wallet `0x5a2Acf1a388FE4f19aEfFA404e07E916B5b07B77` is excluded from deployer, administrator and LP roles. Its superseded deployment proposal must not be executed. The quote and claim identities remain separate offline voucher signers.

## Observed state

Both hosted workflows on source `077e778777d83f0692cd4f6eed20d7b6f7797b9d` completed successfully: [Fair Launch](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/38024835051) and [Engineering](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/38024835041). These results apply to that commit and do not qualify later changes.

The official chain-46630 RPC returned the approved recipient's public balance as `20000000000000000` wei, latest/pending nonce 0, no code, at `2026-10-10T06:14:47Z`, block `132083643`, hash `0x59ee5ce397e3054700f1ea407801eef15357aca2456f961ffe180d9c39649fed`. This is a read-only observation, not an administrator assignment, signing channel or funds transfer.

The live market service still has a null manifest, `NOT_DEPLOYED`, no indexer, and a snapshot endpoint returning 503. Its anonymous account route returns 401. The existing Home and Trade web release is preserved.

## Connections added for rollout

`tools/launch-market/access-identity-daemon.ts` runs under the authentication service UID with read-only access to the existing private Google-session database. The market service queries a bounded Unix socket instead of obtaining database access. Only verified identities leave the database process. Whitelist, subject binding, expiry, revocation and mutation CSRF remain authoritative. Neither service caches a verified identity or logs session tokens, email, CSRF or credentials. The new service example is not installed automatically.

`loadOfflineVoucherSigner` supports the existing separate encrypted quote and claim keystores. It validates private file ownership, permissions, links, bounded input and KDF work before decrypting in memory. Its returned object exposes only address lookup and typed-data signatures. It has no provider, transaction-signing method or broadcast method. The legacy raw-key file mode remains compatible; mixed or incomplete modes are rejected. Operator errors are sanitized.

Fourteen targeted identity/reference/signer checks passed. Independent module review found no blocking identity or signer-loader issue. An additional isolated `/tmp` test used the actual authentication UID 994 and market UID 990: the DB, WAL, SHM and staged source were mounted read-only; only the socket directory was writable. The market UID could query a legitimate temporary verified identity and pass CSRF while direct database reads returned EACCES. Forged headers, website identity, incorrect CSRF, revocation, expiry and whitelist removal were rejected. Runtime bytes matched the approved Node 24.21.0 SHA. The temporary service and files were removed. This validates service isolation with a temporary database, not an actual production Google login or claim. Production identity activation remains NOT_RUN.

`tools/launch-market/deployment-execution.mjs` is a separately injected deployment journal component. It binds an explicit approval to the exact regenerated unsigned plan, finite budgets, qualified compiler/source graph and Testnet-only Slither review. It records reservation and the full signed envelope before a single send attempt; uncertain outcomes are reconciled by their recorded hash. Failed or reorganized actions stop progress. Three inclusive L2 confirmations and a supplied independent contract-state verifier are required before moving to the next action. Oracle preparation steps remain unexecuted.

The component is **not a complete production deployment CLI**. Real signing integration, concrete constructor/funding/LP postcondition verification and actual manifest construction must be connected and independently checked before executing it. A verifier returning a fixture result does not prove deployment. The original restricted Vault executor is unchanged.

The user's chosen personal-wallet path instead uses the separate browser deployment entry and `wallet-deployment-verify.ts`. Their actual scope, independent review, failed initial gas cap and corrected tests are recorded in [PERSONAL-WALLET-ROLLOUT.md](reviews/PERSONAL-WALLET-ROLLOUT.md). The browser signs through the user's wallet; the verifier constructs a manifest only from real official-chain evidence. Neither component turns local test receipts into target-chain deployment.

## Storage and activation

A read-only inspection found all seven business tables in the unconfigured preview market database empty: accounts, wallet challenges, claim vouchers, quotes, operations, claim events and market snapshots. The metadata schema is version 1, application ID `1095126347`, schema digest `ebcd5b0c6de108735f97ebbac53d7e7545cfa9c35d0d2a5dc38d7c7d953b64a6`. The namespace digest is `0x3a2cb1937c5627d83c204b8feccc8bb9b0f3fff0be73ce5e26075aad0d1efb9f`.

Before activation, stop the existing reader cleanly, recheck the business counts, create a bounded backup under the existing namespace, and preserve the complete old directory. Only if the stopped database still contains no business records may the first real manifest use a new private target directory. Any new accounts or vouchers require an explicit preserving migration; do not delete the old database, restore an empty registry or alter its namespace in place. Never enable the identity bridge on the preview while relying on the earlier empty-count observation.

After deployment, obtain actual pool addresses, deployment blocks and immutable-adjusted runtime hashes from canonical receipts and chain state. Activate the existing loopback reader only with that verified manifest, the approved signer files, bounded identity socket and preserved target data directory. Then run the genuine ordinary-wallet claim, Mint, ETH/AF-USDC buy/sell and cash-Vault checks. Source-confirmed stock execution requires its own fresh feed/market calendar and immutable keeper signing channel; a weekend display quote cannot enable a new stock trade.

## Approved rollout inputs and actual prerequisites

Administrator/deployer is the user's existing `0x86767116cd40bf6b4f8cf88e08d11e38b04364cf`, using their own injected browser wallet. The ordinary test-user wallet remains excluded. The separate deployment page requests each transaction through that wallet; the server cannot sign or broadcast for it. The encrypted quote and claim signers retain only their voucher roles.

The approved starting supply is 2,000,000 AF-USDC: TSLA LP 250,000; AMZN LP 250,000; claims 100,000; conversion 100,000; two TEST-stock reserves 100,000 each; the remaining 1,100,000 stays with the approved administrator as initial supply owner. PASS supplies remain fixed and subscription proceeds are separate from LP. Approved conversion funding is 0.002 native test ETH, per-transaction output 0.0002, per-account daily output 0.001, global daily output 0.0016 and retained reserve 0.0002 ETH. This is a small initial smoke-test reserve, not a guarantee that 100 users can all sell into ETH.

`docs/deployment-approved.json` contains only public transaction data: 15 deployments, 26 configuration/funding transactions and two explicitly unresolved fresh-stock-reference steps. The page bundles a SHA-256 pin and permits only the approved wallet and chain 46630. Nonce 0 address predictions require the reviewed order; any unrelated wallet transaction stops this plan. The signing window initially expires at `2026-10-11T06:36:40Z`; expiry stops new wallet requests and does not invalidate an already executed transaction. Recorded hashes are reconciled against actual chain receipts, never treated as completed because they exist in browser storage.

The first full local deployment attempt exposed an 8,000,000 gas cap failure at the Vault factory. That failed run is retained as a failure. A fresh local measurement returned 8,946,265 estimated gas; a 20% buffer requires 10,735,518. The corrected engineering policy uses a 12,000,000 per-transaction cap, maximum fee 20,000,000 wei/gas and a 0.010 test ETH aggregate gas budget. The conservative 41-transaction bound is 0.00984 ETH; including the separate 0.002 ETH conversion funding and 0.0005 ETH retained wallet balance requires 0.01234 ETH. This correction changes no asset ownership or reserve amount. Every target transaction is estimated after its dependencies exist; the isolated EVM measurement does not qualify the full target-network graph.

A legitimate verified test account remains necessary for actual ordinary-user acceptance. No fabricated login or local identity may replace it. Deployment, target-chain claims/trades, manifest activation and target-stock execution remain **NOT_RUN** until their actual prerequisites and receipts exist.

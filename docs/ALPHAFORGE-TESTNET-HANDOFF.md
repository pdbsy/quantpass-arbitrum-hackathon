# AlphaForge Hackathon Testnet handoff

This release prepares Robinhood Chain **Testnet 46630** only. Dots will perform the later server deployment and external-chain acceptance under a separate operational assignment. Strategy encryption is excluded. Actual chain deployment, owner login/signatures, submitted transactions and sustained external execution are **NOT_RUN** until their real evidence exists. Preparation CI never unlocks a key, signs or broadcasts.

## Release and process separation

Pin a complete-history release commit and retain its source C, report R, snapshot S and every failed/successful CI run. Use the approved Node 24.21.0/npm 11.19.1, Python 3.12.9 and locked contract tools. Install with scripts disabled; run the documented toolchain admission and full release checks before serving. Do not replace pinned versions with `latest`, share writable dependencies/databases or edit generated PASS evidence.

Use a POSIX host, two service users and immutable release directories. The public `alphaforge-web` user cannot read `/etc/alphaforge/executor` or the executor data directory. Private folders are 0700 and key/password files 0600, owned by the executor user. No owner key goes onto the server. Set a separate, non-owner platform executor and keeper in explicit deployment/operator inputs; they may share a dedicated Testnet-only platform address, in which case one process and one durable nonce journal coordinate both roles. Never reuse either key in another process/data directory.

The example service files are uninstalled operator templates. Keep `Restart=no`; investigate failures before an explicitly authorized restart. SIGTERM stops the process and preserves records; **it does not send Vault stop or liquidation transactions**. Owner stop is a separate wallet-confirmed action. Windows development CI is retained; Windows public/executor filesystem ACLs have not been qualified and those operational entries refuse to run there.

## Inputs that must be filled before deployment

Copy the examples into private configuration directories. Empty strings/nulls are deliberate blockers, not defaults:

- HTTPS domain/certificate, loopback port, private archive-capable 46630 RPC endpoint, server paths and service users.
- Deployer, strategy creator, explicitly confirmed Vault owner cohort, dedicated executor/keeper, strategy ID/ref, fresh deployer nonce, fixed test token/PASS supplies and distribution amounts.
- Testnet WETH address and explicitly reviewed Router02 auxiliary constructor addresses. Native/WETH, V2 and position-manager routes are outside the single-pool Vault adapter; no mainnet address may be substituted. FactoryV2/positionManager may be explicitly disabled with zero; WETH must be explicitly supplied, not guessed from the local fixture.
- Actual canonical pool addresses, fresh midpoint × multiplier initialization prices, tick ranges, uint128 liquidity and separate operator LP token budgets. LP capital never comes from user Vaults. Budget approvals are cleared after seeding.
- Owner-selected deposit/runtime amounts, grant expiry, finite liquidation window, single-order and cumulative-buy limits, slippage, optional risk bounds. The owner reviews these on the page; login does not grant execution authority.
- Executor minimum order, deadline (1–30 seconds), explicit gas limit/fee cap/priority fee, maximum per-transaction gas cost and **lifetime** gas budget. Reserved/uncertain attempts consume conservative gas-budget reservations; no automatic calendar reset or nonce recovery occurs.
- Reference reviewer, reviewed/expiry times and three archived issuer/exchange sources with SHA-256, COMMON_STOCK/NASDAQ/NYSE/NYSE_AMERICAN classification, official Registry asset IDs, canonical source deployments and exact current multiplier. Test substitutes never become official Stock Tokens or canonical-whitelist entries.

The retained storage ceiling is 8,000,000,000 bytes across the two service directories, including every historical record, partial file and backup. The examples allocate 4 GB each; if repartitioned, their sum must remain within the approved total. No historical deletion or automatic archive occurs. Leave working room for database/WAL growth and independent temporary restore copies; collection/trading pauses before insufficient room. First server load and sustained throughput remain subjects of Dots acceptance.

## Offline preparation

Check `package.json` on the pinned release. From the checkout, with the approved Node/npm active:

```sh
npm ci --ignore-scripts
npm run check
bash contracts/script/check-local.sh
npm run testnet:preflight -- /etc/alphaforge/web/operator.json
npm run testnet:preflight -- /etc/alphaforge/executor/operator.json
npm run testnet:deployment -- --prepare /etc/alphaforge/executor/deployment.json /etc/alphaforge/executor/reference-admission.json REFERENCE_DIGEST /etc/alphaforge/executor/new-unsigned-plan.json
```

Offline preflight opens no database, listener or RPC and reports deployed evidence as offline-only. Empty public Vault configuration remains NOT_DEPLOYED. Deployment planning uses freshly qualified compiler artifacts, the exact approved V3 bytecode and explicit constructor values. It produces unsigned creation transactions and predicted addresses, plus Factory `createPool` calls. It never creates grants, distributes funds or sends a transaction. Any nonce/address/artifact change invalidates the plan. Confirm each real 46630 receipt before continuing.

Pool initialization uses the read-only `testnet:pools -- --prepare <pool-worksheet.json> <deployment-evidence.json> <evidence-digest> <reference.json> <reference-digest> <new-output.json>` entry and `preparePoolInitialization` in `packages/testnet/src/pool-init-plan.ts`, taking the explicit operator, real pool/stock/seeder addresses and LP budgets. It verifies canonical deployment/seeder state, operator balances and fresh official midpoint mappings, then prepares unsigned calls. Existing initialized pools have `initialize: null`; do not invent a reset. Verify Factory `getPool`, token order, fee 3000, deployed bytecode and seeder immutables before an operator signs its returned initialize/approve/seed/clear-approval calls. Record the actual mint and removal results. The actual V3 protocol tests cover these paths in a local VM; those tests are not external Testnet receipts.

## Deployment evidence and wallet surface

After real deployment, use `testnet:deployment-evidence -- --verify <worksheet.json> <reference.json> <reference-digest> <receipt-hashes.json> <new-evidence.json>` with the private RPC endpoint. The receipt file contains exact `creationHashes` and `poolCreationHashes` arrays in the unsigned plan order. The verifier regenerates the plan from current qualified artifacts, checks real creation calldata/deployer/nonce/chain/receipt/address/canonical code and each pool creation, and qualifies actual immutable/balance inventories. Extract one schema-v1 deployment manifest and a `TEST_SUBSTITUTES` inventory per owner. Use the dedicated `alphaforge-trading-v1` ABI/hash, actual Vault/PASS deployment blocks and actual runtime Keccak hashes. Preserve creation transactions, constructor parameters, chain identity and source/build digests alongside the manifests. Inventory records the immutable owner/locker/AF-USDC/Factory/Router/Quoter, ordered MSFT/NVDA/AAPL test tokens, feeds, pools, keeper/reference identity and all fourteen auxiliary code hashes. Reference identity is `evidenceHash(term)` of the exact ordered term fields `{identity, assetId, symbol, multiplier}`.

Validate manifests with the offline preflight, then qualify them at a canonical EIP-1898 RPC snapshot. The runtime checks code hashes, immutables, 6/18 decimals, exact PASS capacity/backing, tracked positions, zero router allowances and the three canonical fee-3000 pools. A supplied inventory alone is not a proof of deployment. Chain reorgs and inconsistent positions stop publication of personal NAV/returns. Keep L2 soft confirmation, unknown L1 finality and full external acceptance distinct.

Only serve the dedicated Testnet build through HTTPS. The backend listens on loopback; the proxy must overwrite Host/forwarded-protocol/client-IP as in the template. Do not expose the loopback port publicly. Original Alice/Bob demo APIs/pages are not registered in this server. Wallet login uses a login-only, domain/46630/nonce/expiry-bound message, one-use challenges, opaque secure cookies and owner-scoped data. Owner operations show a concrete transaction preview and require the owner wallet. Unknown submissions remain blocked across reloads; they are never automatically sent again.

```sh
npm run build:web
npm run testnet:server -- --serve /etc/alphaforge/web/operator.json 4190
```

Provide `AF_TESTNET_RPC_URL` through a protected service environment file. Never put it in the browser, repository or logs.

## Private execution activation

First use explicit watch-only mode. It collects/replays references and prepares actions, with no signer:

```sh
npm run testnet:executor -- --watch /etc/alphaforge/executor/operator.json
```

Activation later requires a separate authorization, actual owner grants and protected version-3 scrypt/AES-128-CTR keystores/password files. The operational command also requires `AF_TESTNET_EXECUTION_ACK=I_AUTHORIZE_TESTNET_SIGNING_46630`, `AF_EXECUTOR_KEYSTORE_FILE`, `AF_EXECUTOR_PASSWORD_FILE`, `AF_KEEPER_KEYSTORE_FILE`, `AF_KEEPER_PASSWORD_FILE` and the private RPC endpoint. CI/GitHub Actions refuse signing activation regardless of the acknowledgement. No default key, password or financial amount is supplied.

```sh
npm run testnet:executor -- --run-testnet --enable-signing /etc/alphaforge/executor/operator.json
```

Five-second capture uses official sources, maximum 30-second quote age and 10-second cross-asset skew. Minute closes require a sample within 30 seconds; missing minutes do not fabricate prices or advance EMA. The adapted QuantConnect/Lean EMA 15/30 retains its existing sampled bid-close signal semantics; **valuation** uses bid/ask midpoint multiplied by the official Stock Token multiplier. Pending or changed multipliers latch a reference pause, including changes visible in rejected batches. Resume requires reviewed mappings and a deliberate recovery plan, not a silent rewrite of historical units.

The keeper updates explicit test reference feeds only; these are not canonical production oracles. Execution uses QuoterV2 and actual V3 fills, with fee 3000. The planner and Vault enforce owner-granted limits, a one-third per-stock cap and typed routes. Divergence beyond authorized reference slippage pauses execution; the service does not spend extra LP funds to adjust prices. Stop/bounds/expiry enter SELL-only liquidation within the preauthorized interval; insufficient liquidity or stale references retain holdings and blocked status. After the interval, the owner can recover with an explicit wallet-confirmed sell.

Signed envelopes are validated and saved before one-shot transmission. Reserved, signed, unknown-broadcast or reorged orders block another use of that executor. Receipt/envelope/event reconciliation and personal position/NAV indexing are separate checks; seeing a hash is not a fill. Actual platform-paid ETH gas is recorded separately from owner AF-USDC returns. Pool fee and impact are included in fills; precise fee-versus-market-impact decomposition is not invented. Public strategy performance is NOT_PUBLISHED; Builder sales/rent/performance fees/buybacks remain SIMULATION_ONLY.

For page status, optionally export `AF_EXECUTOR_STATUS_EXPORT_FILE=/run/alphaforge-status/execution-status.json` into a 2750 executor-owned status directory with the web reader group, files 0640. Give the web user only group-read access and configure `executorStatus.file/configurationDigest` in its operator JSON. This sanitized export contains state and owner/Vault identifiers, never keys, RPC, raw signed envelopes or personal performance. Stale/wrong-digest status is unavailable. Private executor data/key folders remain 0700/0600 and unreadable by the web user.

## Recovery, backup and rollback

Both running services save a verified consistency snapshot at least every 24 hours when capacity permits; the page offers manual backup of public chain/evidence databases. Private executor backups include raw reference batches and the order journal. Backups count toward retained capacity. Failed/partial backups remain as evidence and must not be automatically deleted. Verification copies each database into an independent temporary directory, checks original digests/table fingerprints and replays evidence. Login challenges/sessions are ephemeral and intentionally excluded.

```sh
npm run testnet:restore -- --verify /var/lib/alphaforge-web/backups/ACTUAL_BACKUP_ID CONFIGURATION_DIGEST /private/operator/new-restore-report.json
```

This command is verification, **not live replacement**. Preserve original backups. Before an actual restoration, stop the relevant service under explicit operator authorization, retain its database/WAL/SHM and logs, restore to an independent data directory and compare configuration/owner identities, raw source/event hashes, cursors, EMA, cash, positions, PASS, orders, costs and NAV. A reserved or unknown order is never cleared merely to resume trading. Reconcile its hash/nonce/canonical receipt first; unsupported recovery remains blocked. Restart performs identity/schema/backup checks and never resets stale locks automatically.

Rollback means choose the preceding qualified source/build and preserve the new data/evidence. Never open a newer schema with an older incompatible binary or revert onchain user state. Stop/revoke/liquidate remains an owner decision, not a rollback side effect. Grants/key rotation and any unresolved nonce require explicit operational reconciliation.

## Dots external acceptance checklist

Record actual source/lock/artifact digests, host identity, HTTPS/proxy access, wrong-origin rejection, wallet owner isolation, fresh Registry/source review and chain46630 qualification. Then test explicit owner approvals/deposit/PASS lock/runtime allocation/grant, actual keeper feeds, one typed buy/sell in each fee-3000 pool, cash-only withdrawal rejection, stop and finite-expiry liquidation, loss close/PASS release, dust rescue, key revoke/rotation, crash/unknown send, restart/reorg, capacity pause, auto/manual backup and independent-copy restore. Compare receipts/fills/positions, cashflows, weighted costs and NAV; verify another owner cannot view or control the Vault. Sustain a fresh timed run with its raw errors and gaps. Missing markets/liquidity/permissions remain BLOCKED; do not turn local mocks or the old paper soak into external-chain PASS.

首轮部署者与 Vault owner 使用普通 EOA 地址。带代码的 owner（包括委托代码账户）不在首轮交易范围内；登录验证不能替代交易适配。生成部署证据前核验这一条件，服务快照也会拒绝带代码 owner。

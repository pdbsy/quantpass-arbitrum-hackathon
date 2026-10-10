# AlphaForge engineering Testnet release acceptance

This matrix implements the manager's 2026-10-03 acceptance contract. It is a gate inventory, not execution evidence. The fixed baseline is `3cb9caa810e34d8ff9f9a6c68b5ef674f489689e`, tree `66edd0027fd2ae564a3a485e6ea5c5bc577fea5c`. Candidate results must name an immutable source C, report R and snapshot S, exact tools and lock digest.

| Gate | Required review and execution | Owner | Initial status |
| --- | --- | --- | --- |
| AFREL-G01 product | All visible routes/actions classified as Testnet, isolated mock or labeled research/demo; account panel/nav/export/API and six-strategy/chart/external/EMA feedback gaps covered. | W1, W4 | NOT_RUN |
| AFREL-G02 identity/API | Per-owner sessions/data; races, reconnect/stale behavior; Host/Origin/protocol and production impersonation rejection. | W2, W4 | NOT_RUN |
| AFREL-G03 execution safety | No signer by default; complete preflight and finite budgets; durable unknown-order/nonce restart, reorg, stop/expiry/revoke. | W2, W4 | NOT_RUN |
| AFREL-G04 packaging | One application container, one business-data volume, separate Unix users/private subdirectories, PID1 and orderly signals, verified TLS topology. | W3, W5 | NOT_RUN |
| AFREL-G05 recovery | Container/image replacement preserves data; short backup and independent restoration; unknown transaction state retained; total storage budget enforced. | W2, W3, W4 | NOT_RUN |
| AFREL-G06 Linux application | Exact authentic Node/npm; actual paths/effective configuration and runtime admission; no proxy/TLS bypass. | W3 | NOT_RUN |
| AFREL-G07 Linux contracts | Native locked Forge/solc/Slither/Python and artifact/wheel hashes; real tests/invariants/raw analysis and ABI/bytecode/settings comparison. | W3 | NOT_RUN |
| AFREL-G08 network boundaries | Network/deployment/ABI/precision/RPC/reorg/database/evidence identities; stable IDs; mainnet disabled/unconfigured. | W2, W5 | NOT_RUN |
| AFREL-G09 mock E2E | Actual browser and API on integrated candidate; independent A/B owners/db/browser/wallet/RPC; duplicate/unknown/reorg/recovery faults. | W4, W5 | NOT_RUN |
| AFREL-G10 full checks | Fresh full `npm run check`; exact unique counts/skips/raw failures; all existing CI wiring retained. | W5 | NOT_RUN |
| AFREL-G11 independent review | W5 specification and quality reviews of W1–W4; existing worker review of exact W5 changes; manager final acceptance. | W5, manager | NOT_RUN |
| AFREL-G12 live MCP | Deployed authenticated read-only route with sanitization/freshness/current-versus-archived semantics and corroborating runtime evidence. | W2, W5, Luis | NOT_DEPLOYED |
| AFREL-G13 external watch-only | Exact release/config/image on Linux host; protected historical RPC/reference/deployment inputs; two continuous processes and short stop/restore/recovery. | Luis, manager | NOT_RUN |
| AFREL-G14 wallet/live chain | Applicable authority; reviewed roles/grants/assets/pools/budgets; real login/receipts/reconciliation/revoke/exit. | Luis, user, manager | NOT_RUN |
| AFREL-G15 sustained window | 24-hour continuous execution was explicitly deferred and accepted for this round. | User | WAIVED_BY_USER |

## Readiness levels

| Level | Completion evidence | Initial state |
| --- | --- | --- |
| Software/package acceptance | Fixed candidate checks/reviews, actual built artifacts and applicable container/Linux qualification; unresolved material limits reported. | IN_PROGRESS |
| Deployed watch-only | Verified host release/config/image plus real valid watch inputs and deployed processes. An empty Vault configuration is NOT_DEPLOYED. | NOT_DEPLOYED |
| Wallet login | Real EOA domain/46630/nonce/expiry-bound challenge and authenticated owner isolation over qualified HTTPS. | NOT_RUN |
| Live-chain execution | Separately authorized concrete grants/transactions, real canonical receipts/fills/positions/cash/NAV and recovery. | NOT_RUN |

Local mock, unsigned planning, offline preflight, heartbeat and archived snapshots cannot complete a higher level. This round grants no server deployment, wallet use, signing, broadcast, mainnet or master merge authority.

## Existing command and CI map

`npm run check` performs typecheck, lint, formatting, the root Node test list, secret/public metadata checks, static Robinhood network check, governance, supply, vendor V3 artifact qualification, threat model, planning, forum, management snapshot consistency and web build. Root test additions must also be registered in the management collector's unit list when they belong to that profile.

Preserve `verify`, `verify-windows`, `verify-macos`, `contracts-m3-macos`, `source-policy-js`, `dependency-delta-audit`, `semgrep-ce`, `osv-scanner` and `gitleaks`. Hosted execution of the final candidate remains NOT_RUN until actual run/job evidence exists. A source workflow and a previous green CI run cannot substitute for current execution.

Linux Node/npm checks, Linux native contract qualification and Docker lifecycle checks are separate gates. Darwin arm64 native contract qualification cannot satisfy Linux x64. `npm run audit:dependencies` requires network and stays distinct from offline product tests. New workflow jobs require matching strict workflow/environment policy updates; no required job may disappear.

## Source/report/snapshot sequence

Dedicated release commands are `npm run test:release-mock:api` for the isolated API/recovery/runtime/process tests and `npm run test:release-mock -- --expected-source=<exact-C>` for all five mandatory acceptance phases. The complete command uses the separately qualified native browser driver and installed Chrome with private mock state. Its two pure evidence tests also belong to the root and management unit profiles; overlapping cases are never added to unique totals. Container commands are `container:prepare-inputs`, `container:test`, `container:verify-runtime -- <immutable-image-ID>` and `container:lifecycle:mock -- <immutable-verification-image-ID>`. Preparation downloads only locked reviewed artifacts; image inspection/lifecycle require an actual built image ID. Platform-specific qualification remains separate from cross-platform root unit checks.

1. Commit all source/config/docs/root changes as source C on the named integration branch and retain an exact source ref. Confirm clean state and fixed lock/tool identity.
2. Run actual `npm run management:checks` from C. Capture original output and every per-check log. Collector contract/fuzz/invariant/Slither entries remain `NOT_RUN` when not registered; separate contract evidence cannot be inserted as their PASS.
3. Commit only `.checks/management/latest.json` as R.
4. Run `npm run management:build` and commit only the two allowed dashboard JSON files as S.
5. Run fresh full candidate checks on S and prove HEAD/tree/lock stayed unchanged. Any subsequent source change starts a new source/evidence cycle.

Independent review is named and commit-bound. Self-review and repository-local consistency checks do not close historical external governance risks. Original failures, timeouts, cancellations, skips and raw analyzer findings are retained with command/exit/time/hash. Focused retries are counted as retries of the same unique tests; browser observations and other-baseline results have separate inventories.

`npm run release:history` is an additional read-only candidate check. It requires the exact retained base plus four distinct `refs/evidence/release-w1` through `release-w4` commits, full history and inclusion of every original head in the current integration candidate. Missing, unrelated, duplicated, baseline-only or unmerged source heads block. This proves Git history inclusion, not independent approval; specification/quality review and all runtime gates remain separate. The command never creates or rewrites refs.

## Protected operational inputs

- Public/executor configuration; exact network/config identity; deployment manifests, inventories, bytecode/build digests and canonical creation/initialization receipts.
- Protected historical/canonical chain46630 RPC; EIP-1898/code/log/receipt capability and confirmation/reorg policy.
- Reviewed reference admission and three archived issuer/exchange originals with hashes, current multipliers/classifications and review expiry.
- Deployer, EOA owner cohort, non-owner executor/keeper, strategy identity, assets/PASS decimals/supply/backing and actual canonical fee-3000 pool inventory/liquidity.
- Owner-selected deposits, runtime/grants/expiry/slippage/risk bounds; explicit minimum order/deadline/gas/fee/lifetime budgets; independent LP budgets.
- Luis/Dots host/image/config identity, local-volume filesystem, service users/permissions, HTTPS/domain/proxy authentication and supported contact channel.

Missing inputs remain blocked. No secret values belong in source, docs, build args, images or evidence logs. The 8 GB ceiling covers retained historical data and backups; CPU/RAM minimum remains unverified.

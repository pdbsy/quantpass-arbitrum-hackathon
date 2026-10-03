# AlphaForge Luis/Dots operator handoff

This is the engineering preparation runbook for a later authorized deployment. Luis operates through Dots after the manager accepts a fixed bundle and the supported contact/host path is verified. W5 does not deploy, publish MCP, configure secrets, sign, broadcast or merge master. The 24-hour continuous gate is `WAIVED_BY_USER` for this round; short host functional and recovery checks remain required.

## Bundle identity and acceptance

The final bundle inventory must include the immutable integration source C, its tree, lock SHA-256, report R, snapshot S, original worker heads/authors, actual Node/npm/Python/Forge/solc/Slither identities, raw command log digests and first failure/skip inventory. Retain the full Git history and evidence refs. Source/config/ABI/deployment/RPC/reorg/data namespace identity is network-bound; mainnet remains unconfigured/disabled.

Image build and runtime identity is pending W3 delivery. Record the actual OCI image digest and platform only after a verified build; a source Dockerfile digest or image tag is not an image digest. Example public/executor config hashes identify examples only. Operational config digests stay `NOT_PROVIDED` until Luis hashes his protected inputs without disclosing their values. Missing artifacts never acquire invented digests.

## Host evidence request

Use a dedicated native Linux x86_64 host for AFREL-G06/G07 and container qualification. A Linux arm64 Docker daemon on an Apple Silicon Mac may run x64 emulation, but such evidence must be labeled emulated and cannot claim native Linux x64 qualification. Return sanitized outputs, exit codes and UTC timestamps for:

```sh
uname -s
uname -m
docker version
docker info --format '{{.OSType}}/{{.Architecture}}'
git rev-parse HEAD
git rev-parse HEAD^{tree}
git rev-parse --is-shallow-repository
git status --porcelain=v1 --untracked-files=all
node --version
npm --version
sha256sum package-lock.json
```

The exact accepted source commit and reviewed W3 image/run commands are required before host execution. No `latest`, unreviewed replacement compiler, alternate registry, disabled TLS or unqualified platform claim is accepted. The current local daemon was observed as Linux arm64, so native x64 host qualification is still a separate input.

## Storage and process contract

Run one application container and one persistent local business-data volume. The public process and continuous executor use distinct Unix identities and private subdirectories. Share only a bounded sanitized status export: executor owns its directory, the public reader has group-read access, and no private RPC URL/key/password/raw signed transaction/other-owner record is exposed. No scheduler request or catch-up invocation substitutes for the continuous executor.

Private configuration/data directories are 0700 and private files 0600. The optional status directory follows the existing 2750 executor-owned/group-read contract with files 0640. Owner keys never go onto the server. Mount configuration read-only from protected host paths; secrets never enter source, Docker build args/layers, images, logs or the browser. W3's reviewed supervisor controls startup, signals, child termination and no-signing activation. Do not copy the historical executor systemd template's signing command.

All SQLite database/WAL/SHM, nonce/order journals, original reference archives and backups live on local disk. The 8,000,000,000-byte ceiling covers both private service directories and all historical/partial/backup files; it is not an 8 GB RAM requirement. CPU/RAM and retained growth rates require actual host measurement. Capacity failure pauses collection/execution and retains evidence; it never deletes history automatically.

## Offline finite checks before serving

With the approved exact tools active on the immutable accepted source:

```sh
npm ci --ignore-scripts
npm run check
bash contracts/script/check-local.sh
npm run testnet:preflight -- /etc/alphaforge/web/operator.json
npm run testnet:preflight -- /etc/alphaforge/executor/operator.json
```

The contract entry is the existing Darwin lock path until W3's reviewed Linux native profile is integrated; Luis must use the accepted platform-specific qualification command, never bypass the platform/hash check. Public example configs can be valid while reporting zero Vaults/NOT_DEPLOYED. Executor watch requires complete configuration, at least one deployed Vault, manifest/inventory/receipt/build digests, reviewed reference mapping plus three exact archives and finite order/deadline/gas/lifetime budgets. An example rejection is expected missing-input behavior.

Unsigned deployment and pool plans require independently qualified exact artifacts, explicit constructor/deployer/nonce/pool/LP values and reviewed operational inputs. Preserve unsigned plan digests and compare every eventual real receipt/code/immutable identity. This preparation runbook does not grant the authority to sign those plans.

## HTTPS and health contract

The host HTTPS proxy serves the dedicated Testnet build. Its upstream binds only to loopback, and the container's published host port must likewise be loopback-only. The proxy overwrites Host, forwarded protocol and client-IP according to `deploy/testnet/nginx.example.conf`, enforces domain/TLS/body/timeout policy, and exposes no private data or demo impersonation routes.

Owner login is an EOA domain/chain46630/nonce/expiry-bound login-only challenge using one-use challenges and secure opaque cookies. Login does not grant trading permission. Validate wrong Host/Origin/protocol, missing/expired session and owner A/B isolation. Do not capture cookie/token values in returned logs.

Read-only health must distinguish process/heartbeat, configuration admission, deployment identity, current verified market data and execution readiness. A heartbeat alone cannot prove valid prices, an actual deployed Vault or successful fills. Missing/stale/wrong-config status stays unavailable. Archived snapshots remain explicitly archived.

## Authenticated read-only MCP connection preparation

The reviewed server exposes `POST /api/testnet/mcp`, with `initialize`, `notifications/initialized`, `ping`, `tools/list` and three tools: `alphaforge_status`, `alphaforge_test_results`, `alphaforge_readiness`. Every request validates a current owner session. It accepts a valid wallet-session bearer token for this exact MCP route, or the existing secure session cookie; arbitrary owner hints never select a different owner. The current implementation supports protocol versions 2024-11-05, 2025-03-26 and 2025-06-18. It is a stateless JSON response compatibility surface; deployed Codex transport/protocol negotiation and a published authenticated plugin remain NOT_RUN.

Codex supports HTTP MCP URLs, bearer tokens sourced from an environment variable, extra HTTP headers and an enabled-tools allowlist. Desktop and CLI share MCP configuration. This preparation example follows the actual [official Codex MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), fetched during this review. Luis must replace the reserved example origin with the admitted deployment origin and provision a short-lived owner session only after an explicitly authorized wallet login. The example is a handoff artifact; W5 has not registered it or configured any token.

```toml
[mcp_servers.alphaforge_testnet]
url = "https://test.alphaforge.example/api/testnet/mcp"
bearer_token_env_var = "AF_TESTNET_OWNER_SESSION"
http_headers = { "Origin" = "https://test.alphaforge.example", "X-AlphaForge-Client" = "1" }
enabled_tools = ["alphaforge_status", "alphaforge_test_results", "alphaforge_readiness"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Keep the session token in protected local operator memory/environment, never in source, TOML literal values, arguments, returned logs or this bundle. A login-only EOA challenge is signed in the owner's local wallet; owner private keys never enter the server. The current service has no OAuth discovery/login flow, so a Codex OAuth login command does not acquire this session. Logout, expiry or revocation requires explicit fresh owner authentication. Luis must verify actual client negotiation and all three owner-scoped tools over valid TLS, then verify missing/expired/wrong-owner sessions and rejected Origin/client headers. Return sanitized tool results and actual client/protocol versions, not tokens. The proxy supplies trusted protocol/Host values; no client-side forwarded-protocol bypass is part of the example.

## Watch-only and finite operational smoke

After protected inputs and host deployment are separately authorized, the known service entrypoints are:

```sh
npm run testnet:server -- --serve /etc/alphaforge/web/operator.json 4190
npm run testnet:executor -- --watch /etc/alphaforge/executor/operator.json
```

Supply protected historical RPC through the reviewed private service mechanism. Do not echo its URL. Use W3's accepted no-signing container command for container deployment. CI, healthchecks and restarts cannot activate signing. No signer is supplied for watch-only. The signing acknowledgement/keystore command is deliberately outside this round's execution sequence.

Collect bounded start/health/current-readiness status, clean SIGTERM completion, restart and no-signer evidence. Then verify a short persistence/backup/independent restoration sequence using isolated host smoke data, not owner production state. Confirm image/container replacement keeps the volume identity and journal. Return raw failures and gaps, sanitized command logs and actual digests; no 24-hour run is requested.

## Backup, migration and rollback

`npm run testnet:restore -- --verify` takes an existing backup directory, its exact configuration digest and a new output report path. It verifies independent temporary copies; it does not replace live data. Preserve original backup files and failed/partial copies. Never claim a successful HTTP response or copied file proves a verified database restoration.

Before any separately authorized live migration or replacement, stop the affected processes, retain database/WAL/SHM and logs, copy to a new independent directory and compare schema/network/config/deployment/owner identities, cursors/raw hashes, EMA/cash/positions/PASS/orders/cost/NAV. Ephemeral login sessions/challenges are intentionally not restored. Unknown/reserved/signed/reorged order states and conservative lifetime gas reservations must survive.

Rollback chooses a preceding qualified binary/image and retains the new state/evidence. It cannot undo chain state, discard ambiguous order/nonce records, downgrade a newer schema or silently switch network identity. SIGTERM is a process stop; it does not submit a Vault stop/liquidation. Owner stop/revoke/recovery and any real liquidation stay explicit separately authorized operations.

## Remaining protected inputs and result levels

Return the reviewed public/executor config digests, deployment manifests/inventories/receipts/build identity, protected historical/canonical RPC qualification, reference admission and three archived source hashes, EOA owner cohort and non-owner executor/keeper, token/PASS/pool inventory, owner grants/expiry/slippage/risk constraints, finite order/deadline/gas/lifetime limits and independent LP budgets. No secret values are requested.

Report software/package acceptance, deployed watch-only, wallet login and real-chain execution independently. Current status: software preparation IN_PROGRESS; deployed watch-only NOT_DEPLOYED; wallet/live chain NOT_RUN; sustained 24-hour gate WAIVED_BY_USER. Existing connected historical MCP snapshots are retained provenance, not evidence of a newly running executor.

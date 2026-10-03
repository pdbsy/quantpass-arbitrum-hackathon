# AlphaForge W2 runtime handoff

This source prepares Testnet 46630. No live deployment, wallet authorization, real transaction signing/broadcast, mainnet activation or hosted D1 write was performed. The 24-hour sustained window is **WAIVED_BY_USER for this engineering round**; runtime interfaces retain `NOT_RUN` because a waiver is not an observation.

## Source and hosted failure boundary

Fixed starting source: `3cb9caa810e34d8ff9f9a6c68b5ef674f489689e`, tree `66edd0027fd2ae564a3a485e6ea5c5bc577fea5c`. Hosted Sites `231839e57d4e12e8a6f913de58c83d1222ac9c5d`, local prototype `cd9fd5fe3702c41d1d429e542520f03bb3ca76ac` and this Testnet branch are distinct sources.

The recorded Sites symptom is later Alice/Bob/Refresh reads settling at DISCONNECTED / LOCAL_OPERATION_FAILED. HTTP status and server logs were not captured; root cause remains UNVERIFIED. This fixed backend emits LOCAL_OPERATION_FAILED for unexpected/storage/invariant failures and SESSION_REQUIRED for expired/invalid local identity. Existing recovery tests reproduce damaged rows/transaction read failures and demonstrate sanitized errors followed by successful recovery; they do not identify the hosted cause. Browser identity races/reconnection belong to W1's frontend adapter work; no shared D1 backend was substituted into the container architecture.

## Live REST and MCP compatibility

Existing `/api/health` remains a public HTTPS-ingress liveness route. It cannot establish chain readiness. Additive owner-scoped GET routes:

- `/api/testnet/status`: current public-process observation, source/release/config/network digests, storage and backup state, this owner's Vault canonical/freshness/market and restricted-executor state.
- `/api/testnet/readiness`: explicit blockers and BLOCKED_FOR_PERSISTENT_TESTNET; external deployment acceptance is not configured by this change. Heartbeat proves process liveness only.
- `/api/testnet/test-results`: NOT_CONFIGURED by default. An operator-supplied archive is always RECORDED_TEST_SNAPSHOT with its own source, timestamp, age, raw-log SHA-256 and pass/fail/skipped counts. It never claims tests ran in the live process.

All three require the current `__Host-af_testnet` wallet-session cookie. Server-side auth is repeated for every request; client tool hints or owner headers confer no authority. Responses allowlist fields and omit private directories, RPC URLs, backup file IDs, raw signed envelopes and other owners' records. At most 16 configured Vaults are read.

`POST /api/testnet/mcp` is a **stateless JSON-RPC HTTP MCP compatibility surface**, not a deployed plugin or a general MCP service. It implements `initialize` (versions 2024-11-05, 2025-03-26, 2025-06-18), `notifications/initialized` (202), `ping`, `tools/list`, and `tools/call` for `alphaforge_status`, `alphaforge_test_results`, `alphaforge_readiness`. Each tool accepts only `{}` arguments. Unknown methods/arguments return standard JSON-RPC errors; no write tool exists. Tool discovery itself requires auth.

The compatibility client must send Host matching the configured HTTPS origin, trusted-proxy HTTPS headers, `Origin: <configured origin>`, `X-AlphaForge-Client: 1`, and either the secure wallet-session cookie or `Authorization: Bearer <current wallet session token>`. Bearer is accepted only by this MCP route, expires/revokes with the wallet session and is not an owner hint. Existing ingress/rate/body limits remain. A storage pause still permits these read-only MCP requests. There is no OAuth discovery, SSE/event resumption, remote-session provisioning or autonomous credential acquisition; a connector needing those transports requires a separately reviewed adapter. Luis/Dots publishes the eventual MCP.

The web server CLI remains `--serve <operator.json> <port>`. Optional protected environment inputs:

- `AF_RELEASE_IDENTITY_FILE`: bounded regular JSON `{schemaVersion:1, sourceCommit:<40 lowercase hex>, sourceTree:<40 lowercase hex>, lockSha256:<64 lowercase hex>, releaseDigest:<0x + 64 lowercase hex>}`. W5 must derive these from accepted source C/report R/snapshot S and build artifact. Runtime labels it OPERATOR_SUPPLIED_DESCRIPTOR; shape checking does not verify Git/build bytes or governance.
- `AF_TEST_RESULTS_FILE`: bounded regular JSON `{schemaVersion:1, sourceCommit, observedAt:<epoch ms>, tests, pass, fail, skipped, rawLogSha256}`. Counts are nonnegative, bounded and must sum; timestamps cannot be future. Failure/skip counts remain intact. Runtime labels it OPERATOR_SUPPLIED_ARCHIVE; it does not rerun or rehash raw logs. Use a unique test run, never add overlapping focused counts.

Missing descriptors remain NOT_CONFIGURED. Neither input carries RPC/keys or enables execution.

## Freshness, canonical recovery and identities

`TradingChainRuntime` has additive optional `now` injection and `observation()`. A projection expires 90 seconds after a successful complete sync, or on clock reversal; stale/syncing/degraded/closed projections withhold personal NAV and unsigned owner actions. Qualified retry restores reads. Public sync continues after an individual Vault fails while retaining a global storage gate. Canonical reorg evidence, orphaned history and pending owner transaction IDs remain preserved.

Status market validity also checks every reference against the current observation clock (30 seconds), independently of process heartbeat and recent RPC success. Soft readiness remains depth 3, bounded reorg search 128, L1 finality UNKNOWN. A descriptor binds environment/46630, profile/config, manifests/inventories/deployed ABI+code identities, AF-USDC 6 decimals, PASS/stocks 18 decimals, exact `passRaw = usdcRaw * 10^12`, corporate-action units and required archive/EIP-1898/canonical receipt/log capability. Mainnet stays DISABLED_UNCONFIGURED. A chainId change cannot adapt addresses/units/ABI/storage.

`testnet:preflight <operator.json>` retains its existing arguments and opens no RPC, database, listener or signer. For public/executor profiles it adds config/network digest+descriptor, missing-input blockers, RPC capability requirements, receipts NOT_RUN and unsigned finite executor budgets. Executor admission also checks keeper/owner/reference identities against the three archived source terms. Offline manifests/archives are not external deployment or fresh market evidence.

## Executor recovery and host nonce ownership

Existing durable nonce reservation, signed-envelope verification, one-shot claim before send, canonical outcome/reorg reconciliation, gas/lifetime budgets, stop/revoke and bounded expiry remain. Startup now checks bounded stored intents, row owner/executor/id agreement, nonce/state consistency, signed envelope/hash and latest outcome/projection agreement. Corrupt journals block without modifying original records or releasing nonce ownership. No unsupported schema migration or automatic resubmission exists.

Signing startup additionally requires `AF_EXECUTOR_NONCE_DIRECTORY`: one preexisting executor-owned 0700 real directory on local disk, shared by every signing process for these platform addresses on the host. Address-specific 0600 exclusive `.lock` files prevent concurrent use even from another business-data directory. Persistent `.identity.json` files bind each address to the reviewed network namespace. Crash/stale locks and namespace mismatches block; PID guesses never clear them. Do not duplicate the same keys into another host/directory. This host-local protection does not establish a distributed signer coordinator.

Keys unlock only after real-chain input qualification, storage namespace/journal validation, unresolved-order rejection and nonce ownership. A signing restart with RESERVED/SIGNED/BROADCAST_UNCERTAIN/REORGED state is rejected before unlock. Use explicitly authorized watch-only reconciliation first; unknown reserved/signed orders without canonical resolution need an operational recovery decision. `--watch` still needs full valid deployment/Vault/reference/RPC/order/deadline/gas/lifetime inputs. No restart/health/CI flag enables signing.

Executor status export remains schema 1 with the existing matching-owner state/signingEnabled/observedAt fields; an optional sanitized `runtime` adds process, reference-minute freshness and backup state. Old valid schema-1 exports remain readable. Malformed/stale/wrong-config/unknown-state exports are unavailable. Sharing only the 0640 status file does not grant access to private executor journals/keys.

## Storage migration, backup and rollback

Business directories gain `network-identity.json` (0600, fsynced, exact profile/network digest). Protocol IDs and SQLite schema versions do not change. Empty fresh directories bind before databases open. Existing nonempty pre-W2 directories without this sidecar fail with TESTNET_STORAGE_NAMESPACE_MIGRATION_REQUIRED, preserving all databases/WAL/SHM/history; there is **no automatic adoption**.

An explicit offline migration requires stopping the service, retaining original data/WAL/SHM/logs and verified backup, qualifying the exact original config/manifests/inventory/reference inputs, and comparing preflight's descriptor/digest with the original databases' existing identities. Prepare a distinct restored directory, preserve originals, and write the exact sidecar `{schemaVersion:1, environment:"robinhood-chain-testnet", chainId:46630, profile:<original profile>, digest:<preflight networkDigest>}` followed by newline with 0600 owner permissions only after this comparison. The digest includes profile, config paths and deployed identities: moving/configuring another data path requires an explicit reviewed migration, never blind copying a prior sidecar. Reserved/unknown orders cannot be removed to complete migration. W2 supplies no automatic migration CLI.

Existing backups verify independent SQLite copies, configuration identities, fingerprints, reference replay and evidence. The namespace sidecar and nonce-ownership identity directory are additional operational metadata and must be retained separately with the original config/descriptors; existing SQLite backup manifests are unchanged. `testnet:restore --verify ...` verifies copies and never replaces live data. Restoring into a new directory requires the namespace comparison above. Login sessions remain ephemeral.

Rollback preserves new data/evidence and ownership records. Choose a prior qualified binary only if it supports the retained schemas; never reset nonce/unknown orders, reopen incompatible evidence, restore chain state or auto-delete partial backups. Old binaries do not enforce new sidecar/ownership guards and must not be used to resume signing without explicit recovery review.

## W3/W4/W5 integration contracts

W3: package unchanged server/executor/restore positional CLI; public/executor identities remain separate. Expose only sanitized status reader-group file. Signing requires precreated private host nonce directory; default watch/no signing. Preserve namespace/ownership metadata in backups. Health remains liveness; readiness requires owner session and external evidence.

W4: deterministic transports stay in test fixtures/composition; use optional `now` at public startup/runtime and current existing `createRpc`, capture/reconcile boundaries. The new tests extend existing backend/Testnet files and are already in the root npm test manifest. Tests need fresh independent private data directories or an explicitly derived sidecar; never share D1 or real signing transports.

W5: no dependency/root-script edits requested. Existing test files contain the added cases; root `npm test`/TypeScript discovery already register them. Regenerate shared source inventories/coverage/evidence for the final combined source C, and generate reviewed release/test archive descriptors for operator mounting. Independently review W2 (including permanent signer namespace and explicit legacy-directory migration behavior). Dots must still supply protected historical/canonical RPC, real receipt/inventory/code hashes, owner cohort, token/PASS/pool/roles, reference reviewer+three originals and finite order/grant/deadline/gas/lifetime budgets before external acceptance.

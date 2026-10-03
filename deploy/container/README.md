# AlphaForge one-container Testnet package

This package runs the existing public server, continuous executor **in `--watch` mode only**, and a Node TLS proxy as separate Unix identities inside one application container. Exactly one named business-data volume retains all SQLite/WAL, journals, references, status, namespace/nonce metadata, backups, partial files and recovery copies. Configuration/TLS/protected RPC files are immutable read-only bind inputs. No signing activation, key mounts, transaction retry, mainnet toggle or deployment is supplied.

## Reproducible build and admission

Node24.21.0/npm11.19.1 and the official Linux/amd64 Node manifest are pinned in `image.lock.json`. The runtime measures actual Node/npm paths, binary/CLI bytes, exact versions and effective npm configuration against a build manifest. It rejects Node options, TLS/CA/proxy injection, CI impersonation, arbitrary environment settings and signing credentials. The only libuv setting admitted is `UV_USE_IO_URING=0`, observed on the actual pinned image; it changes no TLS or credential policy. Offline developer admission remains the existing `env:check`; neither gate proves deployed readiness.

From a clean accepted complete-history clone, with the approved fnm Node/npm active:

```sh
npm ci --ignore-scripts
node deploy/container/prepare-offline-inputs.mjs
docker build --platform linux/amd64 --build-context reviewed-artifacts=.checks/container-inputs -f deploy/container/Dockerfile.offline --target runtime -t alphaforge-testnet:reviewed-local .
```

Preparation downloads every existing npm lock entry, checks its SRI, and verifies fixed npm/native/wheel artifacts. Offline install steps use `--network=none`; host node_modules, databases, .git, credentials and temporary evidence never enter the image. Normal-network `Dockerfile` is also supplied for qualified hosts; downloads are still fixed and verified. The default final target and Compose target are production runtime. The separate `verification` target is visibly MOCK, uses the current public CLI with an empty deployment, and includes a harmless test-only executor; it cannot qualify real executor/RPC readiness. Production runtime contains no mock fixture.

Runtime carries the full locked npm graph to preserve existing admission policy rather than removing required development/optional packages during qualification. Native contract tools are in a separate disposable qualification image, never a second application service.

## Boundaries and process lifecycle

| Identity | UID / GID | Access |
| --- | --- | --- |
| public |10001 /10003| `public`0700; group-read `status` only |
| executor |10002 /10003| `executor`0700; owns `status`2750 and file0640 |
| TLS proxy |10004 /10004| protected TLS input; no business private directory access |
| supervisor/PID1 |10005 /10005 after initialization| `recovery`0700 and lease; no private service directory access |

Root initialization has only CHOWN, DAC_OVERRIDE, FOWNER, FSETID, SETUID and SETGID. FSETID is required to create the status setgid directory; the first missing-capability attempt failed closed and was preserved. All service launchers/children and PID1 run without effective capabilities or supplementary groups afterward. The root filesystem is read-only, tmpfs is bounded/noexec/nosuid, and no host Docker socket is mounted. The volume must be local ext4/XFS/Btrfs, never NFS/CIFS/FUSE. Configuration and TLS paths are read-only; the proxy receives the validated public origin as an argument so it cannot read the public user's0700 config directory.

Existing positional CLIs remain `server.ts --serve /etc/alphaforge/public/operator.json 4190`, `executor.ts --watch /etc/alphaforge/executor/operator.json`, and `restore.ts --verify ...`. The public listener remains127.0.0.1:4190. Only the TLS proxy binds0.0.0.0:8443; Compose publishes127.0.0.1:8443 by default for a local outer ingress. Host/Origin/protocol, forwarded header replacement, body/time bounds and secure cookies are exercised through real TLS/current Fastify tests. The proxy exposes no HTTP listener or plain backend port. Luis must review external HTTPS routing and reachability before opening a host firewall; this package does not publish a site.

PID1 uses IPC to ask same-user launchers to forward SIGTERM, waits for graceful database close, and enforces a finite shutdown deadline. Initial storage reports have the same10-second freshness deadline measured from launch; readiness has a separate90-second deadline. Any child death, stale storage report or aggregate storage exhaustion stops every child. Nothing is automatically restarted. Nonzero child exits, signals or start errors remain failures even during a requested stop: PID1 exits1, records outcomes where possible and retains the exclusive `.container-lease`; a new instance refuses it. Only a fully clean graceful stop releases its own lease token. Operators must preserve and reconcile crash leases after proving all holders are stopped; the explicit quarantine command is a stopped-service operator action, never startup recovery.

`/api/health` and Docker health are liveness/storage observations. W2 authenticated `/api/testnet/readiness` remains owner-scoped and cannot be bypassed by a healthcheck. Full valid deployed Vault/reference/RPC/order/deadline/gas/lifetime inputs are still needed by `--watch`. Empty configs fail package startup. No healthy MOCK or fresh heartbeat becomes real-chain readiness.

Optional W2 descriptors may use only `/etc/alphaforge/public/release-identity.json` and `test-results.json`, selected with `AF_RELEASE_IDENTITY_FILE`/`AF_TEST_RESULTS_FILE`. They share the public config read-only mount, are bounded and validated by W2, and remain operator-supplied metadata until W5 binds them to accepted source/build/archive bytes. Missing descriptors remain NOT_CONFIGURED.

## Retention, backup and recovery

The aggregate retained business-volume ceiling is **8,000,000,000 bytes**, including recovery/backups/partial files and metadata. Configured public/executor quotas sum to <=7,500,000,000; at least64MiB operational reserve is required. Service write gates enforce individual quotas; per-owner launchers count their files; root admission counts protected recovery bytes once, then PID1 retains that immutable baseline under the exclusive lease and counts its own lease. Recovery commands refuse the live lease. Total exhaustion pauses by terminating services. No historic record or failed backup is automatically deleted. Backups require free space for another complete copy and verification; the budget can block backup before individual quotas are reached. Files/bytes cannot be silently replaced by symlinks or hardlinks.

`recovery.mjs` is an **offline stopped-volume byte snapshot** supplement to existing application consistency/replay backups. It includes network-identity.json, hidden nonce `.identity.json`/`.lock` files, all DB/WAL/SHM and incomplete files, and records per-file digest, mode and ownership. It verifies the file set and bytes before returning; capacity failures preserve partial evidence. `restore-copy` creates an independent new recovery subtree and never replaces live data, resets unknown orders, rewrites digests or deletes locks. Quotas apply to originals plus snapshots plus restored copies.

```sh
# Service must already be stopped. Reuse exactly its named business volume.
docker run --rm --network none --platform linux/amd64 --entrypoint node -v ACTUAL_BUSINESS_VOLUME:/var/lib/alphaforge alphaforge-testnet:reviewed-local deploy/container/recovery.mjs snapshot
docker run --rm --network none --platform linux/amd64 --entrypoint node -v ACTUAL_BUSINESS_VOLUME:/var/lib/alphaforge alphaforge-testnet:reviewed-local deploy/container/recovery.mjs verify ACTUAL_SNAPSHOT_ID
docker run --rm --network none --platform linux/amd64 --entrypoint node -v ACTUAL_BUSINESS_VOLUME:/var/lib/alphaforge alphaforge-testnet:reviewed-local deploy/container/recovery.mjs restore-copy ACTUAL_SNAPSHOT_ID
```

Application-created SQLite backups still require existing `testnet:restore --verify` independent database fingerprint/evidence/reference replay verification. Cold byte snapshot success alone does not establish coherent application state. W2's namespace digest binds profile/network/config/dataDirectory/deployments; relocating a copy cannot reuse/rewrite the sidecar blindly. Full operational restore or migration requires W2's reviewed namespace/database identity comparison, original config/manifests/reference inputs, canonical receipt/nonce reconciliation and preserved originals. This worker tested sidecar/nonce/unknown bytes retention; combined W2 namespace migration acceptance and live replacement remain NOT_RUN. W5 integrates/reviews that contract.

An image replacement must reuse the same volume and compatible schemas. A failed identity/schema initialization must leave original state intact. Rollback chooses an older **qualified compatible** binary with all new evidence retained; an older binary without W2 namespace/nonce guards cannot resume signing. Never rollback chain state or clear uncertain transactions. Future signing requires a separately authorized/reviewed package and W2's precreated executor-owned0700 shared host nonce directory for every signer of the same addresses; per-process or duplicated-key directories are invalid. This watch package rejects signing environment variables, including that signing-only setting.

## Verification limits

Actual-image checks are separate from ordinary Node tests. They record immutable local image IDs and every raw Docker command/exit:

```sh
node --test test/container-*.test.mjs
node deploy/container/verify-runtime-image.mjs ACTUAL_RUNTIME_IMAGE_ID
docker build --platform linux/amd64 --build-context reviewed-artifacts=.checks/container-inputs -f deploy/container/Dockerfile.offline --target verification -t alphaforge-container-mock:reviewed-local .
node deploy/container/lifecycle.mjs ACTUAL_VERIFICATION_IMAGE_ID
docker build --platform linux/amd64 --build-context reviewed-artifacts=.checks/container-inputs -f deploy/container/Dockerfile.contracts-offline -t alphaforge-contract-qualification:reviewed-local .
mkdir -p .checks/container-contract-results
docker run --rm --network none --platform linux/amd64 --entrypoint bash -v "$PWD/deploy/container/qualify-contracts-linux.sh:/qualification.sh:ro" -v "$PWD/.checks/container-contract-results:/reports" ACTUAL_CONTRACT_IMAGE_ID /qualification.sh
```

Runtime verification uses the actual rendered Compose environment, accepts both fixed RPC paths and optional descriptor paths, rejects signing/CA/proxy/CI/path injections and altered lockfile bytes, checks production contains no MOCK fixture, and confirms empty example configs fail startup. It supplies no real RPC or valid deployment. Lifecycle verification accepts only the explicit MOCK entrypoint, retains disposable stopped containers/volumes and reports seven functional checks. It executes the real public CLI/TLS path and a harmless executor fixture, so chain readiness remains NOT_RUN. The contract adapter mounts `/reports` only, runs the existing full `check-phase1-contracts.sh` entry (including local tests/Slither, published ABI, manifest and rehearsal), and copies outputs after execution; never mount an active Forge out directory that `forge clean` must recreate. The complete native CI source/emitter entry remains `node tools/ci/verify-contracts.mjs` after W5 integration; a platform-policy unit test does not replace that run.

Local Linux x64 execution uses Docker Desktop on ARM with Rosetta, recorded in `/proc` observations. It qualifies these actual Linux binaries and functional boundaries, not physical-x86 production capacity. Short MOCK resource observations are measured samples, never minimum CPU/RAM requirements; 8GB is storage. The24-hour sustained gate is WAIVED_BY_USER and was not executed. External HTTPS/real-chain deployment/current-market/continuous real executor, mainnet, signing/broadcast and Luis/Dots publication remain NOT_RUN.

# AlphaForge W3 Container and Linux Qualification Implementation Plan

> Execute inline in this isolated full clone. The user forbids additional agents. Use executing-plans and failure-first behavioral tests.

**Goal:** Produce a reviewable single-container, watch-only Testnet package with one persistent business volume and honest Linux qualification evidence.

**Architecture:** A minimal root initializer validates and owns volume directories, launches separate public, executor and TLS proxy identities, then drops its own identity. IPC launchers supervise same-user application children and implement bounded graceful shutdown. The public Fastify listener stays on 127.0.0.1:4190; the HTTPS proxy alone binds 0.0.0.0:8443. No signing mode exists in this package.

**Tech stack:** Existing Node 24.21.0/npm 11.19.1, native Node HTTPS/process/FS/SQLite APIs, Docker Linux x86_64, CPython 3.12.9, Forge 1.5.1, native solc 0.8.31, Slither 0.11.3.

**Spec:** release-source-spec.md and task-3-brief.md in the authorized release-manager coordination directory. Fixed source base 3cb9caa810e34d8ff9f9a6c68b5ef674f489689e/tree66edd0027fd2ae564a3a485e6ea5c5bc577fea5c.

## Constraints and source contracts

- Only Dockerfile, compose.yaml, .dockerignore, deploy/container, new container tests, runtime admission, native contract bootstrap/platform/wheel locks and contracts/TOOLCHAIN.md are owned. Root package/CI/shared evidence changes are exact requests to W5.
- Full history and origin refs remain outside image. Read existing AGENTS, DEVELOPMENT-TOOLCHAIN/STATUS, package.json, AF-TESTNET-HANDOFF and AF-TESTNET-PREP before edits.
- tools/testnet/server.ts: `--serve <public/operator.json> 4190`, loopback-only; handles SIGTERM. tools/testnet/executor.ts: `--watch <executor/operator.json>`; real admission/RPC/deployments before private storage. Never copy signing systemd template.
- Both config dataDirectory values must equal their assigned subdirectory and maxStorageBytes quotas sum to <=7.5 GB; all volume bytes including status/recovery/partial files must remain below 8,000,000,000, with 64 MiB reserved. Existing app canWrite gates enforce individual quotas; supervisor stops all processes if aggregate exhausted.
- Bind mounts are immutable config/TLS/protected RPC inputs, not a second business-data volume. 0700 service directories, separate UID ownership, status directory 2750 executor/shared-reader group. No real key mounts.
- No online deployment, master merge, signing, broadcasting, mainnet or shared mock writes. 24-hour gate WAIVED_BY_USER. Missing external inputs remain blocked.

## Task 1: Ingress, environment and configuration boundary

Files: deploy/container/boundary.mjs, runtime-admission.mjs, proxy.mjs; test/container-boundaries.test.mjs.

- [x] Write failing tests: signing/injection variables reject; quota/network/path mismatch reject; valid immutable inputs yield literal fixed watch/server commands.
- [x] Run `node --test test/container-boundaries.test.mjs`, retain RED log.
- [x] Implement strict runtime allowlist, fixed commands, HTTPS origin validation, bounded files and real Node/npm binary/config admission using image provenance manifest. Do not alter offline dev admission or claim runtime readiness from it.
- [x] Implement TLS reverse proxy with exact Host/Origin gates, strip and overwrite forwarded headers/client IP, finite request/body/timeout limits, no HTTP/public-backend port. Run real TLS-to-loopback requests; wrong host/origin reject and spoofed protocol cannot reach app.
- [x] Run focused tests, retain GREEN log and inspect errors.

## Task 2: Volume, cold backup and supervision

Files: deploy/container/volume.mjs, recovery.mjs, worker.mjs, supervisor.mjs; test/container-storage.test.mjs and container-supervision.test.mjs.

- [x] Test real temp directories for retained bytes, symlink/hardlink rejection, exclusive durable lease, over-budget startup, snapshot byte preservation, tamper rejection and independent restore retaining uncertain orders.
- [x] Implement nonrecursive least-privilege initialization, aggregate byte accounting without deletion, lease preservation on abrupt crash and explicit stopped-service lease quarantine.
- [x] Implement cold snapshot into same volume recovery subtree with per-file digests/permissions/ownership; verify manifest and restore into new subtree only. Application replay verification remains a separate existing `testnet:restore --verify` gate for application-created backups.
- [x] Test real processes: SIGTERM forwarded, bounded shutdown, one child exit stops peers, no automatic restart. Implement IPC launchers, root-to-unprivileged supervisor identity drop, process death handling and storage polling.
- [x] Run focused tests and existing Testnet private-storage/backup/startup/executor CLI tests.

## Task 3: Image and lifecycle package

Files: Dockerfile, compose.yaml, .dockerignore, deploy/container/image.lock.json, build-provenance.mjs, healthcheck.mjs, lifecycle.mjs and README.md/LUIS-OPERATIONS.md.

- [x] Obtain official Node image linux/amd64 digest and source binary/npm metadata; retain raw metadata. Build only fixed digest, preserve exact npm and lockfile install, no lifecycle scripts.
- [x] Build web in a build stage; runtime includes only required source/static/dependencies/notices and immutable provenance. Exclude .git, secrets, host dependencies/databases and generated evidence.
- [x] Compose exactly one service, one business-data named volume, read-only root, tmpfs, cap-drop and only initialization capabilities, explicit watch-only environment, no restart, local published HTTPS port, no production credentials.
- [x] Build/run disposable image checks if Docker qualifies. Use separate test composition outside production paths when full RPC/config unavailable. Verify actual UID/GID access, listener topology, TLS, graceful stop/death, replacement persistence, backup/restore, lock/migration rejection and short CPU/RAM stats. Preserve all blocked gates.

## Task 4: Linux native contracts

Files: contracts/toolchain.lock.json, contracts/requirements-slither-linux-x64.lock, contracts/script/bootstrap.py, contracts/script/check-local.sh, contracts/script/tests/test_platform_tools.py, contracts/script/compare_platform_artifacts.py, contracts/TOOLCHAIN.md.

- [x] Read official Forge npm metadata, solc-bin Linux index and PyPI JSON; download authentic fixed assets, verify bytes and generate a complete CPython3.12/manylinux x86_64 wheel lock using exact existing 47 dependency versions. Never choose rolling replacements.
- [x] Test platform selection and rejection of wrong Python patch/unsupported host; preserve Darwin lock and select Linux artifacts explicitly.
- [x] Bootstrap only verified native tools and hash-locked binary wheels into private .checks. check-local selects same platform lock and verifies installed bytes/versions before tests.
- [x] Run offline Forge build/tests/invariants and pedantic Slither with existing finding-specific admission if Linux available; keep all raw JSON and exits. Run Darwin only as the existing allowed native toolchain evidence, not Linux qualification.
- [x] Compare ABI, creation and runtime bytecode in actual same-settings build artifacts; add bounded comparator and negative tests. Missing one build is NOT_RUN, not inferred equality.

## Task 5: Review and handoff

- [x] Format/lint only owned files, run relevant existing tests and package checks, verify scoped diff and no credentials.
- [x] Commit scoped work locally. Provide immutable commit/tree/lock, tool provenance, command/exit/log SHA256, unique counts and all initial failures/skips.
- [x] Record exact W5 root script/CI requests and W2 readiness/status expectations. Luis sheet covers build, read-only inputs, offline verification, local HTTPS start, acceptance, storage, backup/recovery and rollback limits; no real deployment executed here.

## Completion boundaries

Owned implementation and local functional qualification are complete subject to the immutable final handoff report. Checkmarks record work performed, not external acceptance. Full existing npm regression has one stale shared migration-provenance hash to update through W5; independent fixed-head review, combined W2 acceptance, hosted/native physical-x86 capacity, real deployments/RPC/readiness and operational restore remain pending. The24-hour gate is WAIVED_BY_USER. No source push, merge or deployment is included.

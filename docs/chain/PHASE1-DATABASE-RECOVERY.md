# Phase 1 Chain Projection Database Recovery

The chain SQLite database is a reconstructable cache. Robinhood Chain, the trusted deployment manifest, canonical logs, receipts, and contract views remain authoritative. A database backup never grants asset authority and cannot make an operation confirmed without canonical reconciliation.

## Current schema and admission

`ChainStore` accepts a new empty database or exact supported schema versions 1 through 6. It migrates older supported versions transactionally to version 6. It rejects unrelated tables, unsupported versions, malformed operation evidence, unhealthy sync leases, and inconsistent checkpoint/projection evidence.

The database uses WAL mode, `synchronous = FULL`, foreign keys, and a five-second busy timeout. Vault and StrategyPass checkpoints are keyed independently by chain and contract; every product projection also includes owner and projection key.

## Online backup drill

1. Record the running source commit, manifest digest, chain ID, Vault address, current checkpoint height/hash, and `/api/v1/chain/runtime-status` response.
2. Choose a new destination on storage with operator-only permissions. `backupTo` creates mode `0600` and refuses an existing path with `BACKUP_TARGET_EXISTS`.
3. Run `await runtime.store.backupTo(destination)`. This uses Node SQLite online backup and does not copy a live WAL file by hand.
4. Open the result with `new ChainStore(destination)` and require:
   - `health() = { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' }`;
   - the expected checkpoint height/hash;
   - the expected Vault projections and canonical event count;
   - operation evidence still non-READY unless its canonical requirements remain satisfied.
5. Keep the source database unchanged. Never test restore by overwriting the only copy.

The repeatable local drill is:

```sh
node --test --test-name-pattern="local recovery drill measures" test/chain-store.test.ts
```

For an operator-controlled source that is no longer being written, the local CLI creates a new,
non-overwriting backup and verifies schema, integrity, and complete table contents before reporting
success:

```sh
node tools/chain-recovery.ts backup /path/to/source.sqlite /path/to/new-backup.sqlite
```

The restore drill also writes a new path, preserving both the incident database and the selected backup:

```sh
node tools/chain-recovery.ts restore /path/to/verified-backup.sqlite /path/to/new-restored.sqlite
```

Both commands first open the source read-only and require the exact current schema without running
migrations or initializing an empty file. They refuse a missing source, an existing destination, a
source/destination path collision, a legacy or unhealthy schema, or a content mismatch. After
preflight, the command keeps a read transaction open from the source snapshot through target
validation. Concurrent writers may continue in WAL mode, while the backup remains fixed at the
validated recovery point. Still run the commands only after stopping writers for the selected source,
as described below, so operators can identify and retain an unambiguous incident recovery point.

Schema admission compares SQLite's stored table and index definitions against an independent
in-memory database initialized by the repository's canonical migrations. This checks columns,
declared types, primary keys, nullability, defaults, check constraints, unique indexes, index keys and
partial-index predicates; extra application schema objects such as triggers or views also fail.
Version 6 plus the six expected table names is insufficient. Comparison is deliberately exact:
manually reconstructed definitions, even if semantically similar, are not admitted. No migration or
DDL is executed on the input database. SQLite-owned internal objects, such as query-planner statistics,
are excluded from this application-schema comparison.

The test creates three isolated schema-6 databases. Each run synchronizes an empty-log canonical fixture through block 1000, performs an online backup, reopens and checks the copy, advances the observed head to 1128, catches up exactly 128 blocks, and requires a healthy checkpoint at the new head. It emits the measured components as a diagnostic without imposing a machine-speed assertion.

## Recorded local recovery measurement

The following sample was recorded on 2026-09-20 with Node 24.21.0 using the repeatable test above. The backup artifact was 495,616 bytes in each of three runs.

| Component                                       | Three-run median |
| ----------------------------------------------- | ---------------: |
| Online backup at block 1000                     |         1.856 ms |
| Reopen plus schema/integrity health check       |         0.686 ms |
| Read-only catch-up from block 1001 through 1128 |        30.100 ms |
| Reopen through healthy block-1128 checkpoint    |        30.768 ms |

This is a local deterministic fixture measurement, not a Testnet or production SLA. In this fixture, the recovery point gap is intentionally 128 blocks because the backup checkpoint is 1000 and the later observed head is 1128. Operational RPO is the age of the selected verified backup at incident time. Operational RTO also includes artifact selection, process startup, real RPC latency, log volume, and any manual review; those factors were not measured here.

## Restore drill

1. Stop every server process using the target database. Do not restore into a database with active sync leases or writers.
2. Preserve the failed database and its WAL/SHM files as incident evidence. Do not delete or rewrite them.
3. Copy the verified backup to a new path. Configure the runtime to use that new path; do not overwrite the backup artifact.
4. Start `ChainStore` on the new path. Constructor migration and schema checks must succeed, and `health()` must be `HEALTHY`.
5. Start read-only synchronization with the same trusted manifest. The synchronizer checks the remote block hash at the restored checkpoint before advancing.
6. Keep product projections unavailable while either the Vault or its manifest-bound StrategyPass catch-up is incomplete. Require healthy sync, canonical ancestry, expected receipt/event/view reconciliation, and the configured three confirmations before READY.
7. If the restored checkpoint is on a displaced fork, allow automatic recovery only within `reorgSearchLimit = 128`. Beyond that, preserve evidence and use manual recovery.

## Rebuild from chain

If no trusted backup exists, create a new empty database and synchronize from the manifest deployment block. Do not import client state, demo ledger rows, browser localStorage, or unverified tx hashes as protocol truth. A clean rebuild can be slower, but it is safer than promoting a corrupt projection.

## Health and fault interpretation

`GET /api/v1/chain/runtime-status` reports:

- `database.status`, `schemaVersion`, and `integrity`;
- the configured chain, Vault/StrategyPass addresses, manifest digest, ABI hashes, and runtime bytecode hashes;
- the last indexer attempt and fixed public error code.

It intentionally omits filesystem paths, SQL text, RPC URLs, provider errors, and credentials. Generic `/api/health` can remain available while the indexer is degraded; Vault projections must still fail closed.

| Symptom                          | Meaning                                                        | Action                                                                                                |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `UNHEALTHY` / `FAILED` integrity | SQLite cannot prove the open projection healthy                | Stop writers, preserve files, restore a verified copy or rebuild from chain                           |
| `CHAIN_SYNC_INCOMPLETE`          | Bounded catch-up has not reached the observed head             | Continue serialized sync; do not expose READY projection                                              |
| `CHAIN_REORG_DEPTH_EXCEEDED`     | No verified ancestor was found within 128 blocks               | Preserve evidence and perform reviewed manual recovery                                                |
| `CHAIN_REORG_NO_COMMON_ANCESTOR` | Canonical ancestry could not be established                    | Verify RPC/manifest identity, preserve evidence, rebuild only after review                            |
| `M3_INDEXER_SYNC_FAILED`         | Latest read/sync failed                                        | Keep product reads unavailable; retry read-only sync without resubmitting wallet transactions         |
| `M3_DEPLOYMENT_CODE_MISMATCH`    | Live Vault bytecode does not match the trusted manifest        | Stop indexing immediately; verify address, manifest, deployment, and RPC endpoint                     |
| `M3_STRATEGY_PASS_CODE_MISMATCH` | Live StrategyPass bytecode does not match the trusted manifest | Stop indexing immediately; verify the Pass address, deployed runtime hash, manifest, and RPC endpoint |

No recovery step signs, submits, replaces, or retries a wallet transaction.

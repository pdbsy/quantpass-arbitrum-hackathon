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
node --test test/chain-store.test.ts
```

The test creates an isolated database, writes canonical block/event/projection evidence, performs the online backup, proves overwrite refusal, reopens the copy, and checks the preserved identities.

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

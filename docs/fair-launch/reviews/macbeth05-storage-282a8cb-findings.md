# Offline storage-copy review findings

Reviewed new storage snapshot tool and tests at immutable `282a8cb5e8237acbef3fc6385ceddcf4b44764b2`. Review was read-only for product source and limited to offline financial identity, provenance, copy integrity and known-schema admission. Two related P2 engineering/integrity defects were sent promptly to the implementation owner; correction checkpoint remains pending.

## Read-only integrity checks omit CHECK validation

`tools/launch-market/storage-snapshot.ts` opens both the source and newly created destination with `readOnly: true` before calling `PRAGMA integrity_check`. On pinned Node 24.21.0 SQLite this skips CHECK constraint evaluation. Consequently a structurally valid database containing a CHECK-invalid row can be copied and reported as verified.

Executed one isolated temporary-database proof: inserted `market_wallet_challenges.consumed=2` using `ignore_check_constraints`, restored that pragma to its normal value, and ran both forms of integrity check followed by the snapshot tool. Output:

```json
{"writableIntegrity":["CHECK constraint failed in market_wallet_challenges"],"readonlyIntegrity":["ok"],"corruptCheckRowBackupAccepted":true,"rejection":null}
```

No product source or real account/funds changed; temporary proof databases were removed. This establishes a false integrity certification, not a remote ability to alter private registry files. Minimal correction: keep the source read-only, but open only the tool's newly created destination with a write-capable handle, immediately enable `query_only`, and validate integrity/foreign keys there. Existing recovery tooling documents the same pinned-runtime behavior.

## Same-shaped foreign schema is admitted as known

Schema admission compares table/index names, ordered column names, absence of hidden columns and the STRICT suffix. It does not pin table types/nullability, primary/unique keys, CHECK/FK clauses, index uniqueness or partial-index predicates. The digest includes the actual source SQL, but that proves only source-to-copy/manifest equality; initial backup can certify a source schema whose names match while financial constraints differ.

Minimal correction: compare the complete canonical known schema, including table and index SQL, against an explicit pinned digest for each admitted database version. An arbitrary same-shaped database must not become a verified backup merely by receiving its own new manifest. Add focused wrong-DDL and CHECK-invalid-row rejection tests; repeat the valid WAL copy test after changing destination inspection. Broad history or contract tests are unnecessary.

Positive controls retained: exclusive private-storage lease, read-only source snapshot including committed WAL, exact private namespace bytes and expected digest, source retention, new destination only, restrictive file/directory permissions, no source/destination overlap, application/schema versions, copy row/schema digest comparison, restore manifest comparison, and no RPC/signing/broadcast path. The copy cannot reconstruct lost private email/opaque-key mappings and does not clear claim eligibility.

This is a bounded engineering review, not a formal security scan, GitHub approval or authorization to restore a production registry. Await the immutable corrective commit before describing known-schema/CHECK integrity validation as complete.

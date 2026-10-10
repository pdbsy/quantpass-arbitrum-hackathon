# Final bounded review addendum

Reviewed immutable checkpoint `1f482a4f3083b8f4a9be0468d56d94267ba272b1` in `/root/alphaforge/worktrees/macbeth01-fair-launch`, limited to the six-file delta after `282a8cb5e8237acbef3fc6385ceddcf4b44764b2`. Earlier contract, identity, indexer, unsigned preparation, CI and tooling conclusions remain qualified by their existing reports. Product source was not edited. No new confirmed actionable issue was found in this delta.

Both storage integrity findings from `macbeth05-storage-282a8cb-findings.md` are closed for this checkpoint. `tools/launch-market/storage-snapshot.ts:27` pins the complete canonical `sqlite_schema` for each admitted schema version. The query at line 199 includes constraint autoindexes and SQL, orders deterministically with BINARY collation, and rejects a different digest before admitting a copy. This binds CHECK, primary/unique/foreign-key constraints and partial-index predicates, rather than merely comparing names and columns. The new targeted schema test checks the pins against the actual store/indexer constructors and rejects both an altered CHECK and an altered unique-index predicate with unchanged names and columns; it was read during this review, not independently rerun.

At `tools/launch-market/storage-snapshot.ts:415`, only the newly created destination is opened with a write-capable SQLite handle, immediately put into `query_only`, and subjected to the existing integrity/foreign-key and complete-copy comparison. Source connections remain read-only with a transaction covering committed WAL. The pinned-runtime omission of CHECK validation on read-only connections therefore cannot produce a successful verified report for CHECK-invalid copied data. A failed destination remains available for inspection and is not given a success manifest.

Independent focused verification used exact Node `v24.21.0`:

```text
/opt/alphaforge/toolchains/node-v24.21.0-linux-x64/bin/node --test --test-isolation=none --test-name-pattern='target integrity rejects violated CHECK data' test/launch-market-storage-snapshot.test.ts
tests 1; pass 1; fail 0
case duration 325.686344 ms; total duration 1113.354 ms
```

That regression injects a CHECK-invalid canonical claim row under the unchanged schema, requires `SNAPSHOT_DATABASE_INTEGRITY`, verifies source main/WAL bytes remain identical, and confirms the retained target reports the violated CHECK when inspected with a write-capable query-only handle. It creates and removes isolated temporary fixtures. No contract, network or real identity data was changed; no broader matrix was repeated.

The successful quote path at `packages/launch-market/src/service.ts:414` now clears approval metadata only after `chain.simulate` succeeds with a nonzero gas estimate. The RPC adapter's unchanged simulation performs allowance reads, actual `eth_call`, gas estimation and a canonical-block recheck against the same pinned block. The explicit `ALLOWANCE_REQUIRED` branch still retains approval metadata and a null gas estimate, and other failures still propagate. This fixes the mismatch with the client's READY evidence validation without bypassing an approval or changing transaction calldata. The accompanying focused regression asserts both the READY/null-allowance result and the existing deficit/failure boundaries; source reviewed, not rerun here.

The ETH SELL client change at `apps/web/src/launch-market/client.ts:568` is the previously reviewed UI correction: reconstruct reported gross AF-USDC from native output and reported conversion fee, check rounded fee/output coherence, enforce the requested minimum at six-decimal AF-USDC precision, and bind the displayed ETH minimum to the signed USDC minimum. Existing shared transaction validation still binds payer, strategy, router, input/value, reference and signed minima. The test includes the legitimate rounding case and rejects a signed minimum one micro-USDC lower before any send. This is a consistency check against the reported fee and reference, not an independent proof of AMM price or output; the existing server, signed quote, contract checks and wallet simulation remain the relevant trust controls. No recipient, domain, replay or allowance rule is weakened by this delta.

The two new claim recovery strings map bounded known error codes to fixed user-facing text and do not display arbitrary exceptions or private identity records. No signing, RPC broadcast, deployment, silently selected LP owner, or CI-gate alteration was introduced in this delta.

This is an independent bounded engineering/security review, not a formal Codex Security scan, Slither result, GitHub approval, or authorization for live deployment/funding/restoration. Browser end-to-end and long-duration load results are maintained separately by their owners; this report does not substitute for or claim those results. Actual target-network transactions remain outside this review.

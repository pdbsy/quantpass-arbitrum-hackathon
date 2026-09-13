# PR 11 independent-review remediation

Current status: **REMEDIATION IMPLEMENTED — FINAL EXACT-HEAD VERIFICATION PENDING**. This checkpoint supersedes earlier technical-ready conclusions for the reviewed migration. Supplied P1/P2-family findings are authoritative remediation inputs; they are not a GitHub approval.

Baseline PR HEAD: `b1314db250c4639841098d935033150d71d1f86f`. Actual master: `cf2284af320461bb416b17fe4fb00a73f8ffdd68`. Actual reviews and review threads are empty; only author pdbsy is a collaborator. Existing strict five-check and independent CODEOWNER/last-push approval rules remain unchanged. Full local baseline inventory is retained outside public source.

**Latest user override:** The user subsequently said “不用审批了，直接完成”. Human review is no longer an acceptance prerequisite for this task. After all engineering checks pass, update only human-approval rules (count/CODEOWNER/last-push and associated extra-approval settings), record before/after readback, and merge normally. Keep all required CI, strict checks, no bypass actors and other protections. No independent approval will be claimed; GOV-001/SUPPLY-001 external trust remain OPEN.

The original detailed instruction authorizes a normal protected squash merge after every genuine acceptance condition, without another confirmation, followed by exact-master verification and safe cleanup. No bypass, fake review, weakened gate, shared history rewrite, deployment, signing or broadcasting is authorized.

| Findings | Required fix | State |
|---|---|---|
| P1 / P8 | Source identity versus protected provenance; real CLI lifecycle tests | IMPLEMENTED; lifecycle regressions pass; actual master CI pending |
| P2 / P2A-E / P9 / P10 | Request-local complete projection, generation acceptance and atomic commit; all race regressions | IMPLEMENTED; regression checks pass |
| P3 | One transactionally consistent mutable product snapshot | IMPLEMENTED; regression checks pass |
| P4 | Owner/vault/command audit scope | IMPLEMENTED; regression checks pass |
| P7 | Equal-revision divergence rejected, no lower-revision replacement | IMPLEMENTED; regression checks pass |
| P5 | Bounded pagination with truthful incompleteness | IMPLEMENTED; regression checks pass |
| P6 | ACK names one logical message | IMPLEMENTED; regression checks pass |
| L1 | Preserve local strict contract checks; assess contained hosting | DOCUMENTED FOLLOW-UP; final local rerun required |

See [supplied requirements](PR11-REMEDIATION-SPEC.md) and [implementation plan](../superpowers/plans/2026-09-13-pr11-independent-review-remediation.md). Previous passing results remain historical evidence for their exact SHA and test coverage. P1 cannot be considered fully closed until actual post-merge master CI passes.

## Implementation and regression evidence

- P1/P8: `test/agent-identity-lifecycle.test.mjs` executes the CLI in real temporary Git histories and event payloads. Source branches require matching worker/task metadata; master validates provenance without a blanket skip. PR merge refs, worker/master push, rebase/squash, merge queue and dispatch are covered. `test/management-dashboard-sources.test.mjs` also tests dispatch on squash-integrated master, including rejection of a divergent tree.
- P2/P2A-E/P9/P10: `ProductReadTransaction` stages the whole Adapter projection; `ProductClient.load` commits it synchronously only after full validation and generation acceptance. Stale/error reads discard staged state. Previously accepted state remains marked non-ready and command preparation requires refresh. Sixteen real-harness race/integrity tests in `test/ui-product-adapter-races.test.ts` cover every listed delayed component, Alice/Bob, A-B-A, failed refresh, cooldown isolation, version/display consistency and aggregate divergence.
- P3: authenticated `GET /api/v1/product-snapshot` reads vaults and audits inside a SQLite read transaction and derives account/relationships from the same vault states. `test/product-api.test.ts` uses a second SQLite connection to write during the read and proves the first snapshot remains coherent and the next reflects the write.
- P4/P7: audit is keyed by owner/vault/command, with conflicting reused scoped records rejected. Equal revision accepts identical canonical state, rejects divergent state, and lower revisions cannot replace accepted state. Two vaults may reuse one command ID without collision.
- P5/P6: the collector paginates within 40 requests, 200 PRs and 500 total source records. Reaching a cap without proof of completion publishes PARTIAL. An explicit logical Message ID targets exactly one block; ambiguous URL-only ACKs acknowledge none. `test/agent-management.test.mjs` and `test/agent-tooling.test.mjs` cover page 2, record limits and multi-block ACKs.

Failing reproductions and passing reruns are retained in ignored `.checks/pr11-remediation/` with distinct filenames; historical evidence is not rewritten. This source checkpoint describes implementation, not an assertion that final hosted checks or actual master have already passed. Final immutable source C, manifest R, snapshot S, hosted runs and merge readback will be bound in the PR and final delivery report.

## PR11-L1 — contract hosting follow-up

Contract security is verified with the locked local macOS-arm64 toolchain but is not yet a hosted required master check. Follow-up: qualify immutable Linux or hosted macOS artifacts and their hashes, retain original/derived ABI and creation/runtime bytecode equivalence, run Forge tests/fuzz/invariants and strict Slither on hosted CI, then add a required `contract-security` check through a separately reviewed policy change. No tool lock or strict detector gate is weakened in this PR. `VaultIntentPreview` remains a test-only digest-preview foundation, not an audited production Vault. Portable management ENV-06 entries remain NOT_RUN where those tools are not provisioned.

## Merge and reference lifecycle

The user explicitly waived human review for this task. Reviewer/CODEOWNER/last-push approval will be reported USER_WAIVED, never PASS or independent approval. Immediately before protected squash merge, retain all five strict required checks, zero bypass actors, review-thread resolution, deletion/non-fast-forward protection and linear history. GOV-001/SUPPLY-001 external independence remain OPEN.

Retain the PR source remote branch as an intentional evidence reference after squash: management checks prove actual master and source trees match before reconstructing C/R/S. Deleting that reference would break reproducibility. Other references may be cleaned only after proving safe archival/reachability and checking no active or dirty dependent workspace exists.


## Source freeze checkpoint

Preliminary verification: 366 application tests, typecheck, lint, formatting, secrets, privacy, Robinhood metadata guards, governance, supply-chain, threat-model, planning and Forum checks passed. The uncommitted-source management check correctly reported RECORDED_GIT_NOT_CLEAN; final C/R/S generation is required. An initial sandboxed run could not bind loopback servers (EPERM); the authorized local-server rerun passed all tests. These failures remain in their original logs.

Local contract check exited 0: ten Python regressions, twenty Solidity tests including fuzz and invariants, original/derived/Forge equivalence, and Slither analysis success with zero findings. Product browser completed ten scenario groups including thirteen command types; management browser completed five groups. Browser evidence at this checkpoint is a working-tree check, not final-head acceptance. The final PR and master verification must repeat against clean immutable commits.

Forum refreshed from actual GitHub with four logical messages, one thread and source OK. This record is Macbeth01 self-review under the explicit user waiver; no independent approval or production security assurance is implied.

# AlphaForge W5 review ledger

Reviews bind exact immutable commits. Waiting branches remain unaccepted; no author or history is rewritten.

| Worker | Assigned branch | Specification review | Quality review | Exact reviewed head | Decision |
| --- | --- | --- | --- | --- | --- |
| W1 product | codex/alphaforge-w1-product-20261003 | CHANGES_REQUIRED | CHANGES_REQUIRED | 9aa7cdc4dfa55bc9ed91964ea11068f5e7a25d08 | Owner fix requested through manager |
| W2 runtime | codex/alphaforge-w2-runtime-20261003 | PASS_WITH_LIMITS | PASS_WITH_LIMITS | 14d3a613f2a47fde1a74391d80ab79c6b20155b6 | Integrated with original history |
| W3 container | codex/alphaforge-w3-container-20261003 | NOT_RUN | NOT_RUN | Not delivered | WAITING |
| W4 mock E2E | codex/alphaforge-w4-mock-e2e-20261003 | NOT_RUN | NOT_RUN | Not delivered | WAITING |
| W5 integration | codex/alphaforge-release-integration-20261003 | Existing worker required | Existing worker required | Not fixed | WAITING |

## Review procedure

Verify the recorded base `3cb9caa810e34d8ff9f9a6c68b5ef674f489689e` is an ancestor of the exact worker head. Read all scoped diffs and applicable tests, then review specification compliance and code quality independently. Record priority, exact commit/file/line, impact, reproduction, owner, resolution and retest for each actionable finding. W5 does not fix application scope; unresolved findings go to the authorized manager for owner resolution.

W1 review covers all affected routes, stale/failed session display, account shell removal, mobile accessibility, export delivery, units and actual gated Testnet path. W2 review covers every authentication/status/MCP request, sanitizer and freshness boundary, owner isolation, durable ambiguous submission/reorg/restart, backup and namespace identity. W3 review covers pinned base/runtime inputs, image contents, identities/permissions/volume/status, PID1 signals, no-signing enforcement, Linux admission/native artifacts and lifecycle evidence. W4 review covers test-only composition, isolated current production path, browser/API observation validity, transport absence, unique counts and preserved first failures.

Independent W5 review is assigned by the manager to one existing authorized worker. The review ledger does not imply independent security governance or deployment approval.

## W1 review, round 1

Read all 15 changed files against the fixed baseline, including native browser tests, product sessions/navigation, Testnet pending-state parsing and external decision validation. Tree `f499b59666d6d251a951c0e1af744bcf908b2d74` and base ancestry verified.

**P2, owner/read identity mismatch:** `apps/web/src/testnet-ui-state.ts:40` accepts any chain46630 Vault array without binding its snapshot owner to the connected wallet owner. The `TestnetPage` read callback does not provide that binding. If another tab changes the shared session cookie from Alice to Bob, Alice's wallet account event need not fire; the valid owner-scoped API response for Bob can then appear as Alice/READY. A pure isolated reader reproduction retained an Alice state with a Bob snapshot and no error. The real API has `snapshot.owner`; the reproduction uses its field names and omits unrelated snapshot fields. This is misleading personal display/readiness, not evidence of a server write authorization bypass.

Manager confirmed the finding and assigned W1 the fix on the original branch. This head remains unmerged. Resolution must cover response identity, empty Vault responses, hidden personal data and unavailable actions on mismatch, plus a regression and exact fixed-head review. No W1 application code was edited by W5.

## W2 review, round 1

Read all 22 changed files and corresponding existing tests against the baseline. Tree `c60d03475581067418b971f6f2a45fb3ddecaf2e` and base ancestry verified. Specification review checked per-request wallet scope for REST/MCP, bounded explicit projections, current-versus-archived descriptors, 90-second synchronization and 30-second market freshness, per-Vault recovery, unsigned preflight/network identities, durable row/outcome integrity and pre-unlock nonce ownership. Quality review checked ingress/storage-pause behavior, malformed/expired/wrong-owner inputs, file permissions/exclusive locks, crash admission, migration/rollback and CLI compatibility. No blocking defect found in this exact diff.

Acceptance limits remain: MCP is a stateless local compatibility surface requiring specific ingress/authentication headers; actual Codex connection and publication are NOT_RUN. Namespace sidecar and host nonce identity records are outside the existing SQLite-only backup manifest and must be separately retained and verified in the container/operator procedure. Relocation or legacy adoption requires explicit identity comparison; no automatic adoption or stale-lock clearing is allowed. The host nonce guard is not cross-host coordination. Worker tests are source-bound local evidence; W5 must rerun the integrated candidate. Original W2 author/commit was preserved in a local no-fast-forward integration merge.

## Existing-worker review of W5 preparation

Manager assigned existing W2 an independent specification and quality review of exact W5 source `635b2b363616aba890608582820d4c3a1024b606` against the fixed baseline (14 paths, both source commits). The review accepted the pending-state documents, preserved historical task/governance records and additive root command, but required **W5-635B-01 P2**: reject Git grafts before claiming exact ancestry. The original implementation disabled replacements but Git still honored `info/grafts`, allowing a local fake-parent file to make unmerged workers appear included.

W5 added a failing actual-Git graft regression plus replacement-parent negative coverage, then rejects any object at Git's resolved graft path and a `GIT_GRAFT_FILE` override before ancestry queries. Replacement objects remain disabled. Supplemental fixed-head review is pending; the initial review is not upgraded to approval by W5's own fix.

The reviewer also recorded **L1**: the two uncapped preparation diagnostic logs lacked contemporaneous per-run source/tree/pre/post/environment manifests. Keep them as diagnostic output only; their counts cannot certify clean source635b or replace the failed collector. Final candidate runs require new frozen source identities, original commands, before/after state, environment and log hashes. The first failed R/S and truncated original output remain preserved; its unit failure root cause is UNVERIFIED.

# AlphaForge W5 review ledger

Reviews bind exact immutable commits. Waiting branches remain unaccepted; no author or history is rewritten.

| Worker | Assigned branch | Specification review | Quality review | Exact reviewed head | Decision |
| --- | --- | --- | --- | --- | --- |
| W1 product | codex/alphaforge-w1-product-20261003 | PASS_WITH_LIMITS | PASS_WITH_LIMITS | 40d384846c4285f7c598f07ce2dd0e0c4f8f55ca | Fixed owner binding reviewed and integrated |
| W2 runtime | codex/alphaforge-w2-runtime-20261003 | PASS_WITH_LIMITS | PASS_WITH_LIMITS | 7f90b8390a768ce4909d2e89e974b9cd898f7499 | Owner envelope increment reviewed and integrated |
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

## W1 review, fixed owner binding

Read the complete original-to-fix delta `9aa7cdc4dfa55bc9ed91964ea11068f5e7a25d08..40d384846c4285f7c598f07ce2dd0e0c4f8f55ca`, including both original owner-fix `0e1f932aabda7f9f340ac35f2222fe5f84915419` and the explicit recovery regression. Fixed tree `6242ee21845fc33f8ae416e511125ced18b4b6e5`; direct ancestry and worker clean state verified. Specification and quality review found no remaining blocker. Every response requires a valid same-request owner envelope; every non-null snapshot must agree. Empty and unavailable projections remain identity-bound. Mismatch, malformed identity and expired login remove personal data, stop polling and disable new actions. Generation checks reject superseded responses before identity handling.

The existing manual wallet-login button becomes available after the reader clears its owner; its handler performs the explicit login and fresh read. No automatic signature or storage reset was added. The native regression checks that a retained unknown intent survives the mismatch and explicit reconnection. It supplies an additive envelope only on the standalone W1 baseline; the integrated W2 response must make `envelopeFixtureUsed=false` in W5's new browser evidence. Native integrated browser acceptance remains pending. Formal account routes are trades/passes/saved/notes/funds/settings; trial/trials/activity retain the existing Pass fallback. They are not new route contracts.

No-fast-forward merge `f5f34f9927794e5bca93932161e5e96864052961` preserves all W1 authors and commits. A clean fixed-source integrated owner/API/runtime run produced 27/27 pass, zero failures/skips with matching pre/post source, tree and lock and an uncapped raw log. This is focused local evidence, not final candidate acceptance or additional unique main-suite tests.

## W2 review, round 1

Read all 22 changed files and corresponding existing tests against the baseline. Tree `c60d03475581067418b971f6f2a45fb3ddecaf2e` and base ancestry verified. Specification review checked per-request wallet scope for REST/MCP, bounded explicit projections, current-versus-archived descriptors, 90-second synchronization and 30-second market freshness, per-Vault recovery, unsigned preflight/network identities, durable row/outcome integrity and pre-unlock nonce ownership. Quality review checked ingress/storage-pause behavior, malformed/expired/wrong-owner inputs, file permissions/exclusive locks, crash admission, migration/rollback and CLI compatibility. No blocking defect found in this exact diff.

Acceptance limits remain: MCP is a stateless local compatibility surface requiring specific ingress/authentication headers; actual Codex connection and publication are NOT_RUN. Namespace sidecar and host nonce identity records are outside the existing SQLite-only backup manifest and must be separately retained and verified in the container/operator procedure. Relocation or legacy adoption requires explicit identity comparison; no automatic adoption or stale-lock clearing is allowed. The host nonce guard is not cross-host coordination. Worker tests are source-bound local evidence; W5 must rerun the integrated candidate. Original W2 author/commit was preserved in a local no-fast-forward integration merge.

## W2 review, atomic owner envelope increment

Read all three changed files in exact delta `14d3a613f2a47fde1a74391d80ab79c6b20155b6..7f90b8390a768ce4909d2e89e974b9cd898f7499`, tree `4009271ce2a949dd6a08ae8695e7828ea93393cf`. The one production line exposes the owner already authenticated by the same request and already used to filter its Vaults. It applies to nonempty, empty and null-snapshot success responses. Query/header identity hints do not affect it. The fixture's optional owner preserves its old default; regressions cover alternating current cookies, initial/null and stale/empty results, wrong/expired ingress and no chain transaction. Specification and quality review passed with the original W2 limits. The worker's compiled-artifact skip stays explicit. Local no-fast-forward merge `5050aa1372f5e6f55ed086624ed65ae16353511d` preserves history. W5's related integrated route/runtime/public checks passed 16/16, zero failures/skips; the later combined 27-case run overlaps these cases.

## Existing-worker review of W5 preparation

Manager assigned existing W2 an independent specification and quality review of exact W5 source `635b2b363616aba890608582820d4c3a1024b606` against the fixed baseline (14 paths, both source commits). The review accepted the pending-state documents, preserved historical task/governance records and additive root command, but required **W5-635B-01 P2**: reject Git grafts before claiming exact ancestry. The original implementation disabled replacements but Git still honored `info/grafts`, allowing a local fake-parent file to make unmerged workers appear included.

W5 added a failing actual-Git graft regression plus replacement-parent negative coverage, then rejects any object at Git's resolved graft path and a `GIT_GRAFT_FILE` override before ancestry queries. Replacement objects remain disabled. Supplemental fixed-head review is pending; the initial review is not upgraded to approval by W5's own fix.

The reviewer also recorded **L1**: the two uncapped preparation diagnostic logs lacked contemporaneous per-run source/tree/pre/post/environment manifests. Keep them as diagnostic output only; their counts cannot certify clean source635b or replace the failed collector. Final candidate runs require new frozen source identities, original commands, before/after state, environment and log hashes. The first failed R/S and truncated original output remain preserved; its unit failure root cause is UNVERIFIED.

## Independent W5 supplemental root review

Existing W2 independently reviewed exact range `01ba2682a086e6a899043d16c341e358000503cb..0e5560d2480096aa6857ef381d1a6fd3ec6919ce`, tree `53896407b14b3d77bffaac3e1408d2e5032cbb41`, all 11 paths/four original commits in an isolated full-history clone. Review report SHA256 `52afb90aaffb11fbcac93fc3454886a867bfedc03b5174daa3f3c1681b2ed05b`. The manager verified its evidence hashes. W5-635B-01 is CLOSED on that source; specification and quality for the root/CI registration are PASS_WITH_LIMITS with no new blocker. Independent actual Git fixtures and 32 history plus 77+2 disjoint CI/policy tests passed. W5's earlier same-scope counts overlap; manual probes are not repository test counts.

L1 remains DIAGNOSTIC_ONLY/UNVERIFIED_SOURCE_BINDING. L2 required reviewed W3 Linux bootstrap integration and actual execution; no hosted/native Linux execution was approved by the source review. Later root migration/container/mock wiring remains outside this reviewed range and needs another existing-worker review. Independent code review does not grant external security governance or deployment approval.

## Integrated native owner recovery

Fresh exact source `37386b6d5b03205584bc133b11f46214028b048d` passed the actual compiled two-tab owner-recovery case, 1/1, no failures/skips, with clean matching pre/post source/tree/lock and raw log SHA256 `c7fe763d2c7071a9bb7f53ff7f47d5c54cb91fb4ca5e4f317b189074cccd48de`. The actual W2 envelope was used (`envelopeFixtureUsed=false`); mismatch caused DISCONNECTED, no personal Vault content/new preview or automatic signatures/transactions; explicit login restored READY with the unchanged unknown intent. This focused case is not the four-case native suite or final release acceptance. The earlier sandbox Chrome SIGABRT/kill-EPERM failure remains preserved separately with log SHA256 `027516853b6442b3b698d7fa992dcd6b455acec72d4931c9aa53f864f44a8c80`.

## W5 native bootstrap environment adaptation

W3 fixed bootstrap rejects every inherited `PIP_*` value and uses its own isolated/hash-pinned pip flags. The existing W5 CI context constructs three safe pip controls for ordinary CI stages, so forwarding that context unchanged to W3 bootstrap reproduces an immediate rejection before installation. W5 adapts only the bootstrap subprocess environment by removing those three constructed controls, retains PYTHONNOUSERSITE and all other sanitized values, and preserves later-stage pip controls and W3's rejection policy. A real child-environment regression failed before the fix; the complete CI-gate file then passed 15/15 with zero skips. Actual combined native entrypoint execution remains required after W3 integration. This new W5 adaptation is outside the independent 0e5560 review and requires supplemental review.

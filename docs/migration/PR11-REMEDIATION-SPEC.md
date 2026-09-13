You are Macbeth01, integration manager and final engineering owner for the current AlphaForge migration.

## Canonical repository

`pdbsy/quantpass-arbitrum-hackathon`

Current target:

PR #11
`[Macbeth01][AF-MIGRATION] Consolidate AlphaForge work into canonical repository`

Known reviewed head at handoff:

`b1314db250c4639841098d935033150d71d1f86f`

Base:

`cf2284af320461bb416b17fe4fb00a73f8ffdd68`

Before doing anything, re-read the actual current PR head, master head, ruleset, checks, reviews and changed files.

Do not assume the above SHA is still current.

---

# USER AUTHORIZATION

The user explicitly authorizes Macbeth01 to:

1. remediate all issues listed in this task,
2. add regression tests,
3. update PR #11,
4. move PR #11 between Draft / Ready as technically appropriate,
5. obtain and satisfy required GitHub review/protection conditions,
6. **merge PR #11 directly once every acceptance condition below is genuinely satisfied, without requesting another user confirmation,**
7. perform post-merge verification,
8. clean obsolete branches, stale PRs, duplicate migration branches, temporary worktrees and superseded project artifacts where safe.

This authorization does NOT permit:

* bypassing branch protections,
* reducing required checks,
* self-manufacturing an independent review,
* force-pushing master,
* rewriting master history,
* falsifying PASS evidence,
* deleting security/provenance evidence that remains useful,
* deployment,
* signing,
* transaction broadcasting,
* mainnet activity,
* real funds.

---

# PRIMARY GOAL

Bring PR #11 from:

`NOT_READY — ENGINEERING REMEDIATION REQUIRED`

to:

`MERGE_READY`

Then perform a **normal protected squash merge** and clean the repository into a clear, maintainable state.

Do not merge merely because existing CI is green.

The following findings were discovered by independent review and are considered authoritative inputs until disproven with a concrete reproducer and code-level explanation.

---

# PHASE 0 — FREEZE AND BASELINE

Before modifying source:

Record:

* current PR #11 head SHA,
* current master SHA,
* current ruleset,
* current required checks,
* current reviews,
* current review threads,
* current merge state,
* current open PRs,
* current local and remote branches,
* current worktrees,
* dirty/untracked state.

Preserve the independent review findings in a remediation record.

Do not silently overwrite historical PASS / FAIL / NOT_RUN evidence.

Temporarily return PR #11 to Draft while known P1/P2 engineering defects remain unresolved.

---

# PHASE 1 — FIX PR11-P1

# WORKER IDENTITY VALIDATION BREAKS MASTER AFTER MERGE

## Existing failure

Current worker identity validation treats:

* worker metadata in commit / PR,
* and worker source branch naming

as one rule.

A valid Macbeth commit moved onto `master` through normal rebase/squash can therefore be rejected because the protected target branch is no longer:

`macbeth0X/...`

This means PR CI being green does not prove post-merge master CI will be green.

## Required redesign

Separate:

### A. Source branch identity validation

For worker PR/source branches:

`macbeth01/*` through `macbeth05/*`

Require strict agreement among:

* branch worker,
* PR title worker,
* commit subject worker,
* `Agent-ID`,
* `Task-ID`.

Worker identity spoofing on another worker branch must fail.

Worker identity metadata declared on an ordinary feature branch must also fail.

### B. Protected branch provenance validation

For:

`master`

and merge-generated protected contexts:

Do NOT require the target branch itself to have a Macbeth prefix.

Instead validate any worker-attributed commit metadata as provenance:

* Agent-ID must be registered,
* subject Agent-ID must be registered,
* subject/body identity must agree,
* Task-ID must be syntactically valid,
* metadata must not contradict itself,
* malformed or unknown Macbeth identities fail closed.

A worker commit legitimately merged into master must PASS.

Do not solve this with:

`if branch === master => skip everything`

because that creates a provenance bypass.

## Event contexts to explicitly support

* pull_request
* push to worker branch
* push to master
* merge_group
* workflow_dispatch
* rebase merge result
* squash merge result

## Required regression tests

At minimum:

* Macbeth01 branch + Macbeth01 metadata -> PASS
* Macbeth01 branch + Macbeth02 metadata -> FAIL
* normal feature branch + Macbeth worker metadata -> FAIL
* master + legitimate worker provenance -> PASS
* master + unknown Macbeth99 -> FAIL
* master + malformed/missing required worker provenance -> FAIL
* rebase merge scenario -> PASS
* squash merge scenario -> PASS
* merge_group scenario -> PASS
* workflow_dispatch behavior explicitly defined and tested

Where practical, exercise real synthetic GitHub event payloads rather than only calling a pure validator.

---

# PHASE 2 — FIX PR11-P2 FAMILY

# PRODUCTADAPTER ASYNC PROJECTION CONSISTENCY

The previously reported bug is broader than `this.vaults.set()`.

ProductAdapter maintains mutable projection state including:

* owner
* mode
* strategies
* vaults
* account
* details
* audit
* retry state

ProductClient has generation-based stale-response rejection, but ProductAdapter can mutate its projection while satisfying a request before ProductClient decides whether the request generation is still current.

Therefore an old response may be rejected by ProductClient but still pollute Adapter state.

This must be fixed architecturally, not with one revision comparison.

---

# PR11-P2 — stale vault projection

A delayed old vault response must never overwrite a newer accepted vault projection.

---

# PR11-P2A — stale session / owner projection

A delayed Alice session response must never modify adapter owner/cache after Bob has become the accepted client identity.

Invariant:

`adapter owner context == accepted ProductClient identity context`

or adapter projection must be explicitly detached/uncommitted.

---

# PR11-P2B — stale account projection

`account` must not be committed from a request generation that ProductClient later rejects.

---

# PR11-P2C — stale strategy details

`details` must not be updated by stale request generations.

---

# PR11-P2D — stale audit projection

Audit results from an obsolete request must not mutate the currently accepted projection.

---

# PR11-P2E — stale strategy catalogue projection

A stale catalogue/detection operation must not overwrite the accepted strategy projection.

---

# REQUIRED ADAPTER DESIGN

Prefer a transaction-like pattern:

1. create request-local projection,
2. fetch all required data,
3. validate all responses,
4. ensure request/generation is still current,
5. atomically commit the complete projection,
6. only then expose it through `snapshot`.

Avoid scattered mutations during HTTP response normalization.

Good conceptual pattern:

`fetch -> normalize into temporary state -> validate -> generation acceptance -> commit projection`

not:

`fetch -> mutate global adapter state -> later discover request was stale`.

If generation ownership currently exists only inside ProductClient and cannot be safely exposed, refactor the adapter/client interface so canonical projection acceptance has an explicit token/version.

Do not rely solely on comparing ledger revision because:

* owner changes have no Vault revision,
* account/details/catalogue can become stale independently,
* equal revision with divergent content must fail closed.

---

# PHASE 3 — SAME-REVISION DIVERGENCE

# PR11-P7

Define explicit fail-closed semantics.

If cached/accepted Vault state is:

`revision = N`

and another response has:

`revision = N`

but meaningful authoritative state differs, do NOT use last-write-wins.

Reject it as:

`RESPONSE_CONTEXT_MISMATCH`

or a more specific integrity error.

Prefer exposing or computing a deterministic state digest if appropriate.

Required regression:

* same revision + identical canonical state -> accepted/idempotent
* same revision + different balance/state -> rejected
* lower revision -> cannot replace newer projection
* higher revision -> accepted only in current generation

---

# PHASE 4 — AUDIT CACHE SCOPE

# PR11-P4

Current storage uniqueness is:

`UNIQUE(vault_id, command_id)`

Therefore command IDs are not globally unique.

Do not key audit projection solely by:

`commandId`

Use a scoped key, at least:

`ownerId:vaultId:commandId`

or an equivalently safe structure.

Tests:

* Vault A and Vault B use same commandId
* both events remain distinct
* stale Vault A response cannot replace Vault B audit
* identity switch clears/isolates audit state

---

# PHASE 5 — CANONICAL SNAPSHOT CONSISTENCY

# PR11-P3

Current canonical refresh composes state from multiple independent HTTP requests.

Possible sequence:

`GET vaults -> external write -> GET account`

may combine two different ledger moments.

Resolve this sufficiently for the current local/test architecture.

Preferred solution:

## Option A — unified product snapshot endpoint

Add a read endpoint that returns the correlated mutable account projection under one server-side read transaction.

For example conceptually:

`GET /api/v1/product-snapshot`

containing the mutable pieces that must agree:

* account
* vaults
* current relations
* authoritative revisions/version

Static catalogue metadata may remain separate.

OR:

## Option B — snapshot/version binding

Return a server snapshot/version marker and require all mutable responses used in one client refresh to agree.

Do not invent a meaningless timestamp that fails to prove state consistency.

Tests must inject a write between reads and verify the client never exposes a mixed accepted snapshot.

---

# PHASE 6 — FAILED / STALE REFRESH MUST BE ATOMIC

# PR11-P10

If one component of a canonical refresh fails or becomes stale:

* no partial account projection should become accepted,
* no partial details should become visible as current,
* no stale owner should remain,
* no stale audit entries should become authoritative,
* previous fully accepted snapshot may remain visible only if clearly treated as previous/stale state according to existing UI semantics.

Regression:

`partial request success + later request failure`

must not leave half-new/half-old canonical projection.

---

# PHASE 7 — FULL PRODUCTADAPTER RACE TESTS

# PR11-P9

Existing ProductClient generation tests are insufficient.

Add ProductAdapter-level race tests using either the real Fastify/SQLite harness or a deterministic realistic transport.

Required:

1. delayed Vault A old response after newer Vault A state
2. delayed Alice response after completed Bob switch
3. delayed account response
4. delayed strategy detail response
5. delayed audit response
6. delayed strategy catalogue response
7. Vault A -> Vault B -> Vault A with old A completing last
8. lower revision cannot overwrite
9. same revision divergent payload fails closed
10. two vaults with same commandId remain isolated
11. failed refresh leaves no partial projection
12. concurrent external write during multi-stage refresh does not expose mixed snapshot
13. `prepare().expectedRevision` and displayed authoritative Vault revision remain consistent

Important final invariant:

The state shown to the user for a trade-affecting action must correspond to the state used to construct the command review.

---

# PHASE 8 — IDENTITY LIFECYCLE TEST COVERAGE

# PR11-P8

Add explicit test coverage for the complete GitHub lifecycle.

Do not only test validator helper functions.

Where feasible construct event payloads representative of:

* PR merge ref
* worker push
* master push
* merge queue
* workflow dispatch

and exercise `check-agent-identity.mjs`.

---

# PHASE 9 — AGENT FORUM P3 ISSUES

These are lower severity than P1/P2 but the user wants a clean, industrial-quality repository.

Fix them in this PR if doing so remains contained and low risk. Otherwise create exactly one tightly scoped follow-up cleanup issue/PR after #11; do not leave undocumented debt.

## PR11-P5 — silent GitHub pagination truncation

Current sync reads only page 1 of PRs/comments/reviews.

Either:

* correctly paginate up to an explicitly bounded maximum,

or:

* expose a truthful state such as `TRUNCATED/PARTIAL`.

Never publish incomplete data as unqualified `OK`.

Add tests for >100 records and max-record behavior.

## PR11-P6 — ACK granularity

One GitHub source can contain multiple `[AGENT-MESSAGE]` blocks, yet ACK currently references source URL.

This can acknowledge multiple logical messages unintentionally.

Make ACK target one logical message unambiguously.

Possible approaches:

* stable message ID,
* source URL + block index,
* another deterministic immutable identifier.

Keep rendering safe and existing provenance traceability intact.

Add multi-message source regression tests.

---

# PHASE 10 — CONTRACT CHECKS

No new P0/P1 contract finding was identified in the current digest-preview scope.

Preserve:

* Forge fmt
* Forge build
* Forge test
* fuzz
* invariant
* EIP-712 vectors
* Slither strict mode
* dependency hashes
* original/derived ABI equivalence
* original/derived creation bytecode equivalence
* runtime bytecode equivalence

Do not describe `VaultIntentPreview` as an audited production Vault.

If feasible without destabilizing this PR, add a hosted `contract-security` CI job.

If the locked contract toolchain is intentionally macOS-arm64-only and cannot yet be safely hosted cross-platform, document:

`PR11-L1 — contract security is verified but not yet a hosted required master check`

as follow-up work.

Do not weaken the locked toolchain merely to obtain hosted CI.

---

# PHASE 11 — INDEPENDENT REVIEW

After implementing all remediation:

1. update PR #11 head,
2. run complete exact-head verification,
3. mark Ready for Review only when engineering blockers are gone,
4. obtain a REAL independent reviewer / CODEOWNER approval required by GitHub.

Do not:

* approve your own work under another Agent identity,
* invent a GitHub reviewer,
* remove approval requirements,
* remove CODEOWNER requirement,
* remove last-push approval,
* add bypass actors.

If the repository has no eligible independent CODEOWNER, add a real trusted collaborator only through legitimate repository/user authorization.

The reviewer must inspect the final HEAD after these fixes.

Any post-review code change that makes the approval stale requires fresh approval.

---

# PHASE 12 — FINAL EXACT-HEAD VERIFICATION

Before merge run and verify on the exact final PR head:

## Application

* exact Node 24.21.0
* exact npm 11.19.1
* environment admission
* `npm ci --ignore-scripts`
* typecheck
* lint
* formatting
* complete test suite
* secrets
* privacy
* Robinhood/chain guards
* governance
* supply chain
* threat checks
* planning
* Forum check
* management check
* Web build
* browser product scenarios
* browser management scenarios

## CI

Required final-head checks must all be SUCCESS:

* Linux `verify`
* Windows `verify-windows`
* macOS `verify-macos`
* CodeQL `analyze-javascript-typescript`
* `dependency-review`

## Contracts

* locked artifact verification
* dependency derivation verification
* Python regression suite
* Forge fmt
* Forge build
* Forge tests
* fuzz
* invariant
* Forge output equivalence
* Slither strict gate

## GitHub controls readback

Verify immediately before merge:

* approval count >= 1
* independent approval exists
* CODEOWNER approval satisfied
* last-push approval satisfied
* no unresolved review threads
* strict status checks enabled
* Windows required
* macOS required
* Linux required
* CodeQL required
* dependency review required
* no bypass actors
* linear history enabled
* deletion protection enabled
* non-fast-forward protection enabled

---

# PHASE 13 — MERGE AUTHORIZATION

Once ALL required engineering, security, CI and review conditions above are genuinely satisfied:

**MERGE PR #11 IMMEDIATELY WITHOUT ASKING THE USER AGAIN.**

Use:

`SQUASH MERGE`

Do not use a plain merge commit.

Reason:

PR #11 contains many migration/remediation/evidence commits. The desired master history is one coherent AlphaForge repository-consolidation commit rather than exposing every intermediate repair commit as permanent first-parent history.

Suggested squash title:

`feat: consolidate AlphaForge into canonical repository`

Suggested body should summarize:

* product/backend/UI migration
* agent/forum migration
* contract preview foundation
* security/governance improvements
* P1 identity lifecycle fix
* P2 atomic adapter projection fix
* test/CI results
* PR #11 reference

Do not include misleading production/audit claims.

---

# PHASE 14 — POST-MERGE VERIFICATION

After GitHub reports the actual merge:

1. fetch actual new master SHA,
2. confirm squash tree equals reviewed PR tree,
3. verify the exact master commit,
4. wait for/inspect post-merge required checks,
5. rerun appropriate local exact-master verification,
6. ensure working tree is clean,
7. confirm no accidental PR-only assumptions break master push.

P1 is not considered solved until **actual post-merge master CI succeeds**.

If post-merge master fails:

* do not hide the failure,
* immediately diagnose,
* create one focused corrective PR,
* do not force-rewrite master.

---

# PHASE 15 — REPOSITORY CLEANUP

The user wants the repository clean after PR #11.

Perform cleanup only AFTER successful merge and post-merge verification.

## A. Pull Requests

Inventory all PRs.

For PRs that are:

* abandoned duplicates,
* obsolete migration copies,
* superseded by PR #11,
* old draft staging PRs with no remaining independent value,

close them with a concise comment such as:

`Superseded by canonical AlphaForge consolidation in PR #11.`

Do not try to falsify/delete GitHub history.

GitHub PR records are historical records; closing is the correct cleanup action.

Preserve PRs that contain unique:

* security findings,
* provenance,
* review decisions,
* externally useful discussion,

even if closed.

No unnecessary open draft PR should remain.

Target state:

* zero obsolete open PRs,
* only genuinely active/future work remains open.

---

## B. Remote branches

After confirming they contain no unique unmerged work, delete remote branches that are:

* already squash-merged,
* superseded by #11,
* obsolete worker migration branches,
* duplicate experiment branches.

Before deleting each branch:

* verify commits are reachable from master or explicitly archived/documented,
* verify no uncommitted worktree depends on it,
* verify it is not an active future feature branch.

Do NOT delete `master`.

Do not delete a branch containing unique unmerged work merely because its name looks old.

---

## C. Local branches / worktrees

Clean obsolete local migration worktrees after:

* confirming clean status,
* preserving any explicitly retained source archive,
* verifying no unique uncommitted files remain.

Remove stale worktree registrations.

Delete old local branches whose useful work is already merged/superseded.

Keep only:

* master
* current active development branches
* intentional source/archive references where truly necessary.

---

## D. Temporary artifacts

Remove local-only junk such as:

* temporary review probes
* temporary logs
* stale build output
* obsolete scratch clones
* abandoned test databases
* unused migration temp folders
* old generated contract tool output

only when they are not required repository evidence.

Never commit private host paths merely to record cleanup.

---

# PHASE 16 — MASTER HISTORY CLEANLINESS

Do NOT attempt to "delete garbage commits" already in master through history rewriting.

No:

* `git reset --hard` + force push,
* interactive rebase of shared master,
* filter-branch/filter-repo rewriting,
* replace refs,
* destructive squash of existing protected history.

PR #11 itself should be squash merged, which already prevents its 18+ intermediate repair commits from cluttering master first-parent history.

For older historical master commits:

leave them intact unless there is an extraordinary security incident requiring separate explicit user authorization.

Industrial cleanliness means:

* clean current branch topology,
* closed stale PRs,
* deleted obsolete branches,
* meaningful squash commits,
* no random open drafts,
* no untracked junk,

not falsifying Git history.

---

# PHASE 17 — OPTIONAL CLEANUP FOLLOW-UP PR

If repository cleanup requires tracked-file deletion or consolidation that does NOT belong inside PR #11:

create at most ONE focused follow-up PR, e.g.

`[Macbeth01][AF-CLEANUP] Remove superseded repository scaffolding`

Only include unquestionably obsolete tracked artifacts.

Do not mix:

* AI Bot API,
* new product features,
* strategy engine changes,
* execution work,

into the cleanup PR.

If no tracked cleanup is necessary, do not create an empty cleanup PR.

---

# PHASE 18 — DO NOT START NEW FEATURES

Do not add the future AI Bot API to PR #11.

Do not add autonomous trading architecture to PR #11.

Do not add Strategy API v2 to PR #11.

Finish, merge and clean the migration first.

Future features start from verified clean `master`.

---

# FINAL ACCEPTANCE STATE BEFORE MERGE

PR #11 may be classified `MERGE_READY` only when:

* PR11-P1 fixed and master lifecycle tested,
* PR11-P2/P2A-E fixed architecturally,
* PR11-P3 snapshot consistency resolved,
* PR11-P4 audit cache scope fixed,
* PR11-P7 equal-revision divergence fails closed,
* PR11-P8 identity lifecycle regressions added,
* PR11-P9 adapter race regressions added,
* PR11-P10 projection acceptance is atomic,
* P5/P6 fixed or explicitly contained in one documented follow-up if genuinely lower-risk,
* exact-head application checks pass,
* browser checks pass,
* contract checks pass,
* GitHub CI all green,
* required rules remain intact,
* real independent review approved final head.

Then squash merge immediately.

---

# FINAL REPORT TO USER

After merge and cleanup, provide exactly this structure:

## PR #11

Final pre-merge head:
Base:
Merge method:
Actual master SHA:
Tree match:
Post-merge CI:

## Fixed Findings

PR11-P1:
PR11-P2:
PR11-P2A:
PR11-P2B:
PR11-P2C:
PR11-P2D:
PR11-P2E:
PR11-P3:
PR11-P4:
PR11-P7:
PR11-P8:
PR11-P9:
PR11-P10:

For each:

* fix
* regression
* evidence

## Lower-Priority Findings

PR11-P5:
PR11-P6:
PR11-L1:

State whether fixed or intentionally moved to one follow-up item.

## Final Verification

Tests:
Linux:
Windows:
macOS:
CodeQL:
Dependency Review:
Browser:
Forge:
Fuzz:
Invariant:
Slither:
Secrets:
Privacy:
Governance:
Supply chain:

## Independent Review

Reviewer:
CODEOWNER:
Approval:
Last-push approval:
Review threads:

## Cleanup

Closed obsolete PRs:
Deleted remote branches:
Deleted local branches:
Removed worktrees:
Removed temporary artifacts:
Preserved historical/security records:
Follow-up cleanup PR, if any:

## Repository Final State

Open PRs:
Active branches:
master clean:
master protected:
Known unresolved engineering blockers:

## Assessment

Choose exactly one:

* MERGED_AND_VERIFIED
* MERGED_POSTCHECK_FAILED
* NOT_MERGED_BLOCKED

Do not claim completion unless the actual master readback and post-merge verification support it.

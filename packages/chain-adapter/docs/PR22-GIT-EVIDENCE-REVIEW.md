# AlphaForge Git evidence branch review and tests

Reviewer: Macbeth03, task M3-03-PHASE1-RECOVERY. Requested by Macbeth01. The initial review was read-only. A later explicit scope extension authorizes only test/management-dashboard-git-boundaries.test.mjs and this reviewer-owned document. Production Git sources and manager-owned tests/package remain unchanged. No extra workers or Git-output fabrication.

Frozen input: manager candidate `2944819cf0334768e6e7ad6f73b3055a026cf920`, report `report-ed3e085f-7e9a-4955-8c5f-0785fea22d8a.json`, SHA-256 `cc53dd8c1f569b31ebebe5677ccfe8b7b5e377018342aff5aae0e37bb6350d55`. Its sources.mjs source SHA-256 is `5545b31da1a6f89757794f16e3fac2bec8a9cdd389b699fc5c3c144d230664e9`. IDs and line numbers below refer to that exact map, before any new readBoundedFile changes.

Compared current manager and independent 03 copies from `function validateRefName` through the end of collectRecordedGitState: bytes identical, region SHA-256 `8d063978d97fcc94211d0f298bba1ad20831d061cf00865bb9af676c4e191fd8`. Actual context function is named parseGitHubActionsContext. No assumption was made that an equal region implies equal whole-source branch maps.

## Reproduction

Actual command in the independent 03 clone:

`fnm exec --using=24.21.0 -- node --test outputs/pr22-ready-macbeth03/git-review/reproduce.test.mjs`

Final result: 7 tests, 7 passed, exit 0, Node v24.21.0, Git 2.50.1 (Apple Git-155). Final raw log `reproduce-fixed.log`; initial fixture-development failures remain in `reproduce.log`. These are behavioral reproductions, not an instrumented claim of new hits on the manager's source graph. Manager should run the final source's registered test workflow after integrating selected cases.

All repository fixtures are independently initialized beneath the 03 clone's ignored .checks. Histories, corruption and reference updates affect only those disposable fixtures. Fixture commits have disabled signing/hooks locally. Actual Git commands produce every output; the race case merely schedules a real `git update-ref` between two actual child-process calls. Its wrapper preserves the real execFile callback and promisify contracts. It does not rewrite or substitute command output.

## All 16 missing rows in the assigned Git region

| Original ID:arm | Line | Finding / exact scenario | Expected assertion |
|---|---:|---|---|
| 57:1 | 341 | Reachable. Valid push/workflow_dispatch context, recorded branch macbeth/git-review, GITHUB_REF refs/heads/unrelated (neither recorded nor base). | DATA_SOURCE_ERROR / RECORDED_GIT_CI_CONTEXT_INVALID; no commit disclosure; actual HEAD unchanged. |
| 60:1 | 347 | Reachable. Valid pull_request context with GITHUB_REF property **absent**, valid SHA/base/head. `delete missingRef.GITHUB_REF`, not an own property containing undefined: environmentValue rejects own undefined earlier. | CI_CONTEXT_INVALID with no provenance. |
| 63:1 | 361 | Reachable. Valid action marker and SHA with event schedule (or another unsupported event), which is not push/workflow_dispatch/pull_request/merge_group. | CI_CONTEXT_INVALID, HEAD unchanged. |
| 75:1 | 407 | Conditionally inactive. parseRecentCommits receives log output only after successful `git log --max-count=20 --format=%H...` on a validated commit/HEAD. That log must include at least its start commit and the nonempty full %H. An unborn/missing/corrupt start fails before this call. | Retain denominator; do not manufacture empty successful Git log output. |
| 76:1 | 425 | Reachable. Spawn a child with TMPDIR genuinely absent, preserving other environment values; collectGitState reads a real clean repo. | READY with exact real HEAD (no reliance on TMPDIR). |
| 77:0 | 452 | Reachable. Create refs/remotes/origin/master at actual base, remove only the disposable non-current local master branch. Real show-ref --verify --quiet returns 1. | READY via remote fallback; ahead 1 / behind 0. |
| 77:1 | 452 | Reachable. Write a syntactically valid 40-hex nonexistent object ID into the disposable refs/heads/master file. Native show-ref returns fatal status 128 on this Git, not missing-ref status 1. | Recorded query fails generically, no raw ref/path or commit disclosed. Important: a non-hex malformed string returned 1 on this Git and is not a fixture for this arm. |
| 81:1 | 473 | Reachable through the same missing-local-master/real-origin-master fixture as 77:0. | Reconstructed exact source identity and correct ahead/behind, not merely a success flag. |
| 82:1 | 482 | Reachable. Create A -> B -> C as real commits, retain A/C objects, remove only B's loose object in the disposable fixture. resolveExactCommit(A/C) succeeds; native merge-base --is-ancestor A C has a fatal non-1 error (255 observed). | isGitCommitAncestor returns false. Do not assert all fatal errors equal 128. |
| 83:1 | 492 | Reachable in the same physically incomplete history. collectRecordedGitState reaches mergeBase(A,C) with clean index and exact current branch/HEAD; native merge-base has a fatal non-1 error. | RECORDED_GIT_QUERY_FAILED, no READY provenance. |
| 84:0 | 495 | Conditionally inactive. For a stable SHA-1 repository and genuine successful `git merge-base first second` without --all, output is one full 40-hex commit ID. Earlier resolveExactCommit rejects non-SHA1 output. No common ancestor exits 1; missing graph objects fail nonzero. None yields a malformed successful result. | Preserve defensive check and denominator; no fake Git executable/output. |
| 90:0 | 528 | Conditionally inactive. After ancestor verification, distinct descendant is included in `rev-list --reverse --topo-order --parents ancestor..descendant`. The loop requires exactly one parent per item and that each parent equals the preceding accepted commit, starting at ancestor. A topological, continuous chain containing descendant cannot finish elsewhere. Missing/nonlinear graphs fail earlier. | Proof assumes stable graph interpretation; changes to shallow/graft/commit-graph metadata during the multi-command read invalidate the assumption and remain an external concurrency class, not silently impossible. |
| 104:0 | 576 | Conditionally inactive. Genuine successful `rev-list --left-right --count A...B` emits two nonnegative decimal counts separated by whitespace, including 0/0. Refs are resolved full commit IDs; failures reject before parsing. | Keep defensive parse rejection; no malformed-output fixture. This proof says nothing about safe-integer limits for implausibly huge counts. |
| 115:1 | 640 | Reachable. Invalid base '-invalid', or recorded branch '../invalid', makes validateRefName throw ordinary Error before SourceError normalization. Use otherwise genuine recorded commit/tree. | RECORDED_GIT_INVALID with no commit; repository unchanged. |
| 133:0 | 714 | Reachable concurrency. Stable snapshot makes HEAD equal its current branch, but the collector reads them in separate processes. At the actual later `rev-parse refs/heads/macbeth/git-review^{commit}` launch, perform genuine atomic update-ref from recorded C to pre-created same-tree successor D. All queries still run real Git. | RECORDED_GIT_BRANCH_MISMATCH; actual HEAD is D and tree unchanged. Do not classify this as globally unreachable merely because a static checkout aliases HEAD to its branch. |
| 137:1 | 756 | Reachable native error normalization. Bad-reference and incomplete-history fixtures above yield real child-process errors outside SourceError. A missing/non-repo source can additionally exercise this common fallback. | RECORDED_GIT_QUERY_FAILED, no private native diagnostics or READY evidence. |

The four inactivity proofs are conditional, not empirical claims based on missing hits. They assume the actual Git binary, stable SHA-1 object/graph interpretation, and unchanged command flags. Arbitrary monkeypatched Git output or concurrent mutation of Git graph metadata would change that model. No result here grants independent acceptance or removes original branch rows.

## Resolver and restricted-history notes

The latest supplied missing list does not include resolveExactCommit/resolveExactTree format rejection; existing `unsupported Git object identities never produce READY provenance` creates a real SHA-256 repository and already addresses that path. Preserve those assertions. Validly absent refs (status 1), corrupt refs/nonexistent objects (fatal), unsupported formats, and non-ancestor graphs are different cases and should retain their real error semantics.

Existing merge and >16 descendant tests cover the main restricted-history failure arms. The final expectedParent guard is the remaining redundant invariant under the stated model; the ref-race test above is a separate, real reachable race and should not be grouped with that proof.

The seven cases are now implemented in `test/management-dashboard-git-boundaries.test.mjs` under the explicit scope extension. Native fatal status assertions require a numeric code other than 0 or 1 rather than one platform-specific fatal value. Macbeth01 owns package/management registry registration and combined graph measurement; this change does not modify those shared files. The four conditional proofs remain subject to independent review.

The added standalone file was locally executed with `fnm exec --using=24.21.0 -- node --test test/management-dashboard-git-boundaries.test.mjs`; its actual log and outcome are recorded in ignored `outputs/pr22-ready-macbeth03/git-review/registered-test.log`.

Standalone validation: 7/7 tests, exit 0; scoped ESLint with --max-warnings=0, Prettier check and git diff --check each exit 0. This is not a combined instrumentation result or final integration acceptance.

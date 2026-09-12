# Macbeth PR convergence — 2026-09-12

This round is implemented, managed and technically self-reviewed by Macbeth alone under the user's instruction. No Darwin or substitute worker was started. Historical authors and source commits remain intact. Self-review is not an independent approval.

## Startup inventory

All REST pages were enumerated with state=all. The startup inventory contains seven PRs; base was `202e62562b38a62025d35b90056529799b7abdee`.

| PR | Startup state | Startup head | Disposition |
| --- | --- | --- | --- |
| #1 | open | e4b288a0ad5a5861e5fa6d9636fa4b2e9d5e50be | merged and verified |
| #2 | open | 716090c7d73b944e9db22dac88c2fa34bb113951 | merged and verified |
| #3 | closed, unmerged | f6eb22cfad48ddc9e98b12cadb887c156d4bcd5c | retain closed; Node 26 types do not match Node 24 runtime |
| #4 | closed, unmerged | 2efd52f876e782890b69ab7bc57d1872a4e84e8f | retain closed; TypeScript 7 is outside the lint toolchain peer range |
| #5 | open | 59ca7329fffface16445b01c6d28891e92d5c799 | merged and verified |
| #6 | open | bbb3e4b7b40cfd3aa23253866876875f8d98a1fc | merged and verified |
| #7 | draft | 00d565682d1c6df315377859fce7e2b088a3d6e7 | security review and combination validation in progress |

## Completed merge stages

| PR | Actual squash commit | Exact master validation |
| --- | --- | --- |
| #1 | 53eb90f54e2c20fa4352360772160df142e7d74e | Engineering checks and CodeQL SUCCESS |
| #5 | 84cd179e23c4179ed989bf5e118a986cc119475c | Engineering checks and CodeQL SUCCESS |
| #2 | 50e075607cb335ac66e2ee6d47c2f477b37b527e | Engineering checks and CodeQL SUCCESS |
| #6 | 80fc3d9befef7a1749d4991cd6f00e4c604a4a5e | Linux verify, Windows verify and CodeQL SUCCESS |

Each stage was merged through the normal PR flow only after exact-head checks and thread review, then read back and validated before the next merge. Source and squash trees were compared. PR-only dependency review is not misrepresented as a master-push check. The normal source update for #2 used Git Data API with force=false after Git transport timed out; uploaded objects matched the prevalidated local SHA exactly.

Dependabot automatically moved #5 while its first integration was being prepared. Macbeth stopped that push, preserved the local work and reapplied the version-comment correction onto the new remote head. No force update was performed by Macbeth.

## PR #6 review and fixes

The startup diff has 20 changed paths. The YAML parser, workflow/job permission ceilings, locked dependency validation, SPDX rendering and canonical Windows Git-root comparisons were statically reviewed alongside their tests and documentation. Existing Darwin commits remain ancestors. The original SBOM conflict with the globals update was resolved by regeneration from the combined lock, not hand-editing generated package entries. Both CI jobs now use the reviewed checkout v7.0.1 and setup-node v7 pins.

The current public B1 host records retain attribution and outcome but omit operational details. Original public source history still exists; no destructive history cleanup or provider purge is claimed. The reviewed PR #7 metadata scanner passes over this minimized tree.

Two historical A4 gaps were fixed at their shared boundaries: URL parser failures now expose a fixed field diagnostic without the parser's raw input/cause; offline permit expiry is bounded by decision expiry, authorization expiry and policy TTL, with expired grants/decisions rejected at the deadline. These fixes grant no chain, transaction or deployment capability. Focused tests cover fixed error semantics, the actual configuration CLI, valid endpoint behavior and permit deadline enforcement with disposable test keys.

At `0190ce0de0c3c9283769baea543a1d1a9d5855f2`, the required Node 24.12.0 / npm 11.6.2 toolchain completed the full engineering gate with 94 tests, zero failures, synchronized 217-entry dependency lock/SPDX and zero reported dependency vulnerabilities. An earlier restricted-environment HTTP timeout is retained as failed evidence; the authorized loopback rerun passed. This document does not substitute those results for final-head Linux/Windows GitHub checks or post-merge master validation.

## Remaining boundaries

PR #6 merged through the normal PR flow from exact source e936ab63be419c0c5e4001cb1d3267fcc08fe6ad at 2026-09-12T06:31:03Z after all seven head checks passed and unresolved threads were absent. Its signed squash tree equals the reviewed source; all three post-merge master checks succeeded. PR #7 needs combined Windows compatibility, remaining document/generated coverage, refreshed immutable manifest and snapshot, final GitHub gates, actual merge and post-merge verification. Its startup scan is a separate immutable diff review, not a current combined-head verdict.

The active master ruleset has no bypass actors, strict required checks, no force update/deletion, resolved review threads and linear history. Its configured approval count is zero. Existing personal-owner governance and repository-controlled check definitions do not establish an external trust root: GOV-001 and the external SUPPLY-001 acceptance remain incomplete.

No roadmap task or accepted risk was promoted. Foundry, fuzz, invariant and Slither remain NOT_RUN. The discontinued host workflow, native visual acceptance, future chain architecture and independently governed release acceptance remain separately scoped. No protection change, risk waiver, deployment, real-fund operation, rollback, branch deletion or history rewriting was performed.

## PR #7 combination checkpoint

Startup immutable scan 37443e09-820b-46cd-b168-1ad77594e5d2 is sealed with no reportable findings across 74/74 paths at startup head 00d565682d1c6df315377859fce7e2b088a3d6e7. It is a Macbeth static self-review, not an independent approval or a verdict for later integration. Combined master and Dashboard tests now pass 231/231 locally; Windows handle identity regression and privacy/supply gates pass locally. Final immutable evidence, exact combined-head review, GitHub checks and PR #7 merge remain pending.

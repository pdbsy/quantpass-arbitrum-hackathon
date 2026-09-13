# PR 11 Independent Review Remediation Implementation Plan

> Execute inline with executing-plans; AGENTS.md prohibits worker delegation.

**Goal:** Resolve the supplied review findings, establish exact-head evidence under the latest user waiver of human approval, then perform the authorized protected squash merge and post-merge verification before cleanup.
**Architecture:** Separate source-branch identity from protected-target provenance. Give ProductClient an explicit request-local read transaction with acceptance hooks; ProductAdapter stages the entire projection and commits only at generation acceptance. Read correlated mutable product data in one SQLite transaction. Forum collection reports truncation and ACKs target a single logical block.
**Tech Stack:** Node 24.21.0, npm 11.19.1, TypeScript, Fastify, SQLite, existing locked contract tools.
**Spec:** docs/migration/PR11-REMEDIATION-SPEC.md (user-supplied independent-review findings; not itself a GitHub approval).

## Global constraints

- Canonical repo pdbsy/quantpass-arbitrum-hackathon; existing PR #11 and current task branch.
- Preserve original UI, storage envelopes, history, provenance, required CI and exact tools. The subsequent user waiver authorizes only the human-approval policy change.
- No bypass, fake review, force push/history rewrite, deployment, signing or broadcast.
- Normal protected squash merge is authorized only after all actual acceptance conditions pass.
- Cleanup follows successful actual-master verification; never discard unique work or useful evidence.

## 0. Baseline

- [x] Save actual PR/master SHA, rules, reviews/threads, checks, all changed files, PRs, branches/worktrees and dirty state in ignored .checks/pr11-remediation/baseline.
- [x] Preserve supplied findings in docs/migration/PR11-REMEDIATION-SPEC.md.
- [x] Return PR to Draft and record a remediation status overriding earlier technical-ready claims.

## 1. Identity lifecycle (P1/P8)

Files: tools/agent-identity.mjs, tools/agent-identity-set.mjs, tools/check-agent-identity.mjs; new test/agent-identity-lifecycle.test.mjs; package.json and management check registry.

- [x] Add real temporary Git repos and CLI event fixtures for PR merge checkout, worker push, master rebase/squash push, merge_group and workflow_dispatch.
- [x] Assert valid worker provenance passes master, while unknown/incomplete/contradictory provenance and worker labels on ordinary source branches fail.
- [x] Split `validateCommitProvenance({subject,body})` from branch matching; protected target validation inspects worker-attributed commits without requiring a source prefix.
- [x] Resolve event branch/head/base explicitly; malformed event input fails, dispatch validates a defined range, merge_group uses its base/head SHAs.
- [x] Run `node --test test/agent-identity-lifecycle.test.mjs test/agent-identity-bypass.test.mjs test/agent-tooling.test.mjs` and retain failing-then-passing evidence.

## 2. Correlated product snapshot (P3)

Files: apps/server/src/product-routes.ts, product-views.ts, store.ts as needed; test/product-api.test.ts.

- [x] Add endpoint tests against real Fastify/SQLite for authenticated owner isolation and one correlated account/vault/relationship/audit projection.
- [x] Inject an external SQLite write during projection construction; the response must represent one read transaction, with no timestamp-only consistency claim.
- [x] Implement `GET /api/v1/product-snapshot` from one bounded owner state read transaction; derive account and relationships from those same states and read matching audit within that transaction.
- [x] Keep existing endpoint compatibility and error/session controls; no trading execution expansion.

## 3. Atomic client/adapter acceptance (P2/P2A-E/P4/P7/P9/P10)

Files: apps/web/src/product-client.ts, product-adapter.ts; test/ui-product-client.test.ts, test/ui-product-adapter.test.ts and new test/ui-product-adapter-races.test.ts.

- [x] Add deterministic delayed transport tests for old vault/session/account/details/audit/catalogue reads, A-B-A selection, same/lower/higher revisions, duplicate command IDs in two vaults, partial refresh failure, concurrent writes and prepare/display revision equality.
- [x] Introduce a request-local read interface `beginRead()` returning `{request, commit, discard}`; ProductClient accepts a projection only after response validation, pending storage checks and generation comparison.
- [x] ProductAdapter builds temporary owner/mode/strategies/vault/account/details/audit state. Canonical mode reads the unified snapshot; it never commits normalization side effects from writes or rejected reads.
- [x] Scope audit keys by owner, vault and command. Compare canonical authoritative vault state at equal revision and reject divergent/lower revisions.
- [x] Preserve existing client pending recovery, identity clearing and stale/error UI semantics; separate global server rate-limit cooldown from owner projection and never shorten it.
- [ ] Run actual adapter/client tests, API tests and product browser scenarios.

## 4. Forum bounded completeness and ACK targeting (P5/P6)

Files: tools/sync-agent-forum.mjs, tools/agent-forum.mjs, tools/agent-forum-app.js, communication docs and tests.

- [x] Exercise >100 source records and hard record/page bounds with a deterministic collector.
- [x] Paginate bounded collection; expose PARTIAL when completeness is not proven, including records omitted at the cap.
- [x] Add optional `Reply-To-Message` stable logical message ID; an old URL-only ACK can match only a uniquely identified source message, never several blocks.
- [ ] Preserve source URL tracing, bounded validation and inert rendering; regenerate/safely format Forum artifacts.

## 5. Contract boundary (L1)

- [ ] Re-run unchanged locked derivation, Python suite, Forge fmt/build/test/fuzz/invariant/equivalence and strict Slither.
- [x] Document PR11-L1 as verified locally but not yet a hosted required master contract-security check if hosting cannot preserve the existing platform lock without broadening this PR.

## 6. Review, exact-head gates and protected merge

- [ ] Update remediation finding matrix, current status and PR Review Map with exact evidence and remaining limits.
- [ ] Commit source C, collect full checks, commit manifest R and generated snapshot S.
- [ ] At clean final HEAD run locked install/admission/full application checks, browser and contracts; push existing PR and verify all exact-head CI.
- [ ] Apply the latest user waiver to only human-approval rules; preserve all required CI and other protections, record before/after actual readback, and claim no independent approval.
- [ ] Immediately before merge read actual head/master/rules/checks/reviews/threads; squash merge with one valid worker-provenance subject/body, no protection bypass.
- [ ] Fetch actual master, compare reviewed tree, validate master lifecycle and complete local/post-merge hosted checks.

## 7. Cleanup and report

- [ ] Only after successful master checks, compare inventories and preserve unique/security/source evidence before closing obsolete PRs and deleting obsolete refs/worktrees/temp artifacts.
- [ ] At most one focused tracked cleanup PR if needed; never rewrite shared master history.
- [ ] Final report uses the specified sections and exactly one truthful assessment: MERGED_AND_VERIFIED, MERGED_POSTCHECK_FAILED or NOT_MERGED_BLOCKED.

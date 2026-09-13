# PR 11 Quality Closeout Implementation Plan

> Execute inline with executing-plans. Repository AGENTS.md prohibits worker delegation.

**Goal:** Close controllable PR 11 engineering blockers while retaining independent review and release boundaries.
**Architecture:** Preserve canonical UI, CSP, ledger and immutable source provenance. Adapt only reviewed read-only Worker reporting; keep GitHub PR messages as the write/audit channel. Strengthen actual repository protection.
**Tech Stack:** Node 24.21.0, npm 11.19.1, TypeScript, Fastify, SQLite, Foundry 1.5.1, solc 0.8.31, Slither 0.11.3.
**Spec:** User supplied PR 11 closeout instruction, 2026-09-13; requirements and results retained in docs/migration/PR11-CLOSEOUT.md.

## Global constraints

No merge, deployment, broadcast, signatures, real funds, history rewrite, source deletion, original UI replacement or weakened gates. GOV-001 and SUPPLY-001 remain open external trust boundaries. Agent-ID validation is workflow/process identity consistency, not cryptographic identity assurance.

## 1. Resolve the eleven source files

- [x] Read and hash each uncommitted source; retain exact local copies outside runtime.
- [x] Record per-file classification and UI/runtime/write/Forum/security effects in docs/migration/dashboard-disposition.json; full local paths only in a local report.
- [x] Add focused tests for read-only Worker activity projection, bounded search, safe rendering, explicit provenance and no write route.
- [x] Adapt pure Worker activity projection into the existing Forum; preserve canonical page/layout/server and CSP.

## 2. Repository protection and identity

- [x] Save original rules; add verify-windows, one approving review, CODEOWNER and last-push approval; read back actual GitHub rules.
- [x] Add explicit sensitive CODEOWNERS routes without inventing collaborators.
- [x] Review existing metadata tests and add missing negative cases; run on Windows CI.

## 3. Runtime and UI assurance

- [x] Review backend owner/session/vault/cursor/revision/idempotency/SQLite controls and mapped regression tests.
- [x] Review durable pending commands, identity races, corrupt storage and Retry-After; add regressions for each actual gap before fixing it.
- [x] Preserve original UI SHA and imported provenance; run real browser reload, mobile and loss/retry journeys.

## 4. Contracts

- [x] Independently install hash-locked toolchain and dependencies in ignored local directories.
- [x] Extend isolated digest-only tests for malformed calldata, integer endpoints and dedicated state invariants.
- [x] Run Forge build/fmt/test/fuzz/vector/domain and Slither with unchanged strict settings. Record actual failures and NOT_RUN precisely.

## 5. Defensive review and documentation

- [x] Complete fixed-base security review with explicit coverage and remaining uncertainty; no offensive reproduction.
- [x] Publish six-slice Review Map, disposition, protection readback, contract and governance limitations; preserve historical failures.
- [x] Refresh hashes for intentionally adapted artifacts and remove obsolete current USER_ACTION_REQUIRED claims.

## 6. Exact-head delivery (must execute after source commit)

- [ ] Commit source C, run management checks, commit manifest R, build and commit snapshot S.
- [ ] At final clean HEAD rerun locked install, full checks, browser and contracts; push the existing branch.
- [ ] Verify Linux, Windows, macOS, CodeQL and dependency review on that HEAD; update PR body.
- [ ] Keep Draft if any engineering blocker remains; otherwise mark technically ready with external review required. Never merge.

## 7. User-requested continuation to merge readiness

- [x] Preserve the strict gate and original upstream bytes; derive only ten pragma lines with a closed before/after hash manifest and retained license.
- [x] Add regression-first derivation/equivalence tests and require original/derived/Forge ABI and bytecode equality; run strict Slither and all contract tests.
- [ ] Repeat source C / manifest R / snapshot S and all final-head gates; update the existing PR and mark Ready for Review only after PASS.
- [ ] Obtain real independent CODEOWNER/last-push approval; retain external blockers until actual evidence exists. Never merge.

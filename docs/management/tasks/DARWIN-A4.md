# DARWIN-A4 Task Record

Task ID: DARWIN-A4

Title: Bounded remediation of actual gaps

Worker: Darwin

Start: 2026-09-09

Finish: NOT FINISHED

Status: IN_PROGRESS

Disposition: Historical IN_PROGRESS; assessment completion does not satisfy full task acceptance.

## Import context

> Historical local checkpoint imported on 2026-09-12. Its results apply only to the stated 2026-09-09 PR #6 candidate. Worker B findings, publication, CI and scan activity described below are historical; CURRENT-STATUS.md records the newer remote readback. No current scan status or finding closure is inferred. Superseded Worker B object IDs are omitted.

## Branch

darwin/project-reality-audit

## Summary

Reproduced NET redaction failure and recorded independent hardening observations; no runtime fix applied in this documentation branch.

## Files changed

this task record; docs/management/PROJECT-REALITY-AUDIT.md, CURRENT-STATUS.md, WORK-QUEUE.md, DECISIONS.md, CHANGELOG.md, workers/worker-a.md and branch/plan records as applicable.

## Commands executed

Synthetic marker-only child-process valid URL and malformed port/userinfo cases; source trace of URL parser to stderr

## Tests executed

existing 11-file npm test suite via npm run check; targeted coverage/probe only where stated above. Evidence details in PROJECT-REALITY-AUDIT.md E1–E7; this does not claim a distinct rerun per task.

## Results

Valid config hides marker; malformed input rejects but stderr contains raw synthetic URL.

## Validation evidence

immutable source bbb3e4b7b40cfd3aa23253866876875f8d98a1fc; source anchors and acceptance outcomes in PROJECT-REALITY-AUDIT.md; no raw credentials or host identifiers copied here.

## Security impact

read-only source review and management documentation; no authority, deployment, chain write or risk acceptance.

## Architecture impact

none; canonical planning and dashboard remain separate.

## Decision IDs

DEC-001, DEC-002, DEC-003; DEC-004 for official name only.

## Known limitations

this is a local/mock candidate, not merged master or deployed software; automated checks do not establish full global DoD.

## Not fully resolved

NET fix and regression, permit expiry reproduction, strict enum/risk metadata, exit-at-limit design, public build allowlist and coverage remain.

## Deferred work

Level 3 deployment/authority changes require user approval; history rewrite and host cleanup separately scoped.

## Blockers

no blocker to bounded local work; integration is NOT READY.

## Residual risks

incomplete external governance, broader coverage/reproducibility and future chain trust boundaries; see audit.

## Commit

source bbb3e4b7b40cfd3aa23253866876875f8d98a1fc; record commit resolved by git log -- docs/management/tasks/DARWIN-A4.md (no self-referential guessed hash).

## Next recommended action

Use dedicated darwin/network-error-redaction branch, TDD and independent review.

# M3-05 Phase 1 acceptance

Agent: `Macbeth05`

Task: `M3-05-PHASE1-ACCEPTANCE`

Branch: `macbeth05/m3-phase1-acceptance`

BASE_SHA: `18f5352070910a867b9729b031aa2e3951785e01`

This directory is Macbeth05's versioned QA record for the AlphaForge Phase 1 closeout. It separates the intake baseline, requirement matrix, historical-version mapping, execution evidence, findings, and the later final-candidate conclusion.

Current status: `WORKER_REVIEW_CHANGES_REQUIRED / NOT_READY_TO_MERGE`. The latest Macbeth03 recovery and Macbeth06 local-runner deliveries pass 66/66 and 14/14 existing regressions but have four independently reproduced findings (two P1, two P2); see [Worker Delivery Review](WORKER-DELIVERY-REVIEW.md). Those exact worker sources are not a new unified candidate. Historical candidate status follows. Macbeth05 independently reran exact integration candidate `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`, tree `6f1a21845a99e16a0ba171612cd97e9bf3439294`: the complete `npm run check` passed with 711/711 tests, environment and identity admission passed, candidate-bound C/R/S validated, base-to-candidate `git diff --check` passed, and exact local Gitleaks 8.30.1 passed with its immutable one-row historical disposition. Security scan `6688c259-6db5-4c46-b087-761e6d9722ca` found no reportable issue only in the bounded `639ffd8...3a78e34...` range; it is not a full PR #22 or final independent-security result. The newly reproduced Vault-selection confirmation race passes Macbeth05's independent retest at Macbeth04 fix `aa6c764...`, including 72/72 focused and 717/717 full local tests; that fix is not yet part of candidate `3a78e34...`. Overall coverage remains `NOT_MEASURED` because the reviewed method is not admitted. Hosted execution and status reads are user-paused, the saved Windows file-process failure remains unexplained, and final integration, independent security, governance, approval and Testnet conditions remain separate blockers.

## Records

- [Task Intake](TASK-INTAKE.md)
- [Acceptance Matrix](ACCEPTANCE-MATRIX.md)
- [Historical Findings Version Map](FINDINGS-VERSION-MAP.md)
- [Execution Log](EXECUTION-LOG.md)
- [Findings](FINDINGS.md)
- [Coverage Gaps](COVERAGE-GAPS.md)
- [Complete Coverage Collection Method](COVERAGE-COLLECTION-METHOD.md)
- [Coverage Method Admission Review](COVERAGE-METHOD-ADMISSION-REVIEW.md)
- [Windows Saved-Log Review](WINDOWS-SAVED-LOG-REVIEW.md)
- [Vault-Selection Race Retest](VAULT-SELECTION-RACE-RETEST.md)
- [Worker Delivery Review](WORKER-DELIVERY-REVIEW.md)
- [Final Candidate Acceptance Preparation](FINAL-CANDIDATE-ACCEPTANCE-PREP.md)

Generated or temporary evidence remains isolated from source records and is referenced by exact path and hash. Base results are not an approval of a later candidate; every applicable item will be rerun or explicitly inherited against the exact final candidate supplied by Macbeth01.

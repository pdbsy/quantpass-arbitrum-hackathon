# M3-05 Phase 1 acceptance

Agent: `Macbeth05`

Task: `M3-05-PHASE1-ACCEPTANCE`

Branch: `macbeth05/m3-phase1-acceptance`

BASE_SHA: `18f5352070910a867b9729b031aa2e3951785e01`

This directory is Macbeth05's versioned QA record for the AlphaForge Phase 1 closeout. It separates the intake baseline, requirement matrix, historical-version mapping, execution evidence, findings, and the later final-candidate conclusion.

Current status: `LOCAL_UNIFIED_CANDIDATE_GATE_PASS / FINAL_COVERAGE_AND_EXTERNAL_EVIDENCE_BLOCKED`. Macbeth05 independently reran exact integration candidate `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`, tree `6f1a21845a99e16a0ba171612cd97e9bf3439294`: the complete `npm run check` passed with 711/711 tests, environment and identity admission passed, candidate-bound C/R/S validated, base-to-candidate `git diff --check` passed, exact local Gitleaks 8.30.1 passed with its immutable one-row historical disposition, and a complete security-diff scan reported no finding. Functional product, Chain/API and contract source is unchanged from the previously accepted `639ffd8...` candidate, so the real browser and independently gated contract results remain applicable by exact source equivalence. Final acceptance remains blocked by overall JS/TS coverage remaining `NOT_MEASURED`, hosted required checks and independent approval, the historical restricted-service limitation, and unauthorized Testnet writes.

## Records

- [Task Intake](TASK-INTAKE.md)
- [Acceptance Matrix](ACCEPTANCE-MATRIX.md)
- [Historical Findings Version Map](FINDINGS-VERSION-MAP.md)
- [Execution Log](EXECUTION-LOG.md)
- [Findings](FINDINGS.md)
- [Coverage Gaps](COVERAGE-GAPS.md)
- [Complete Coverage Collection Method](COVERAGE-COLLECTION-METHOD.md)
- [Final Candidate Acceptance Preparation](FINAL-CANDIDATE-ACCEPTANCE-PREP.md)

Generated or temporary evidence remains isolated from source records and is referenced by exact path and hash. Base results are not an approval of a later candidate; every applicable item will be rerun or explicitly inherited against the exact final candidate supplied by Macbeth01.

# PR22 reachable-branch review

Date: 2026-09-23. Project AlphaForge / Robinhood Chain Testnet / Hackathon.
Repository `pdbsy/quantpass-arbitrum-hackathon`; Macbeth05 / `M3-05-PHASE1-ACCEPTANCE`.

## Scope and exact source

Baseline `f966dd2e0772f6953e7315816b52aa53316c7eae`, tree
`1f8fc02c81d82b54877423d54e9aae1958d88cea`. Independent complete clone and
`macbeth05/m3-pr22-reachable-closeout`; independent dependency copies and no shared
SQLite data. Node 24.21.0 / npm 11.19.1 / fnm 1.39.0 / Apple Git 2.50.1.

The inherited report SHA-256 is
`a64e205c9344a4666902f5d1e1abc55527a8fcf9d3595828a9583e7947b06adc`.
Its 1,069 missing branches include the 74 coverage-tool branches assigned to05.
The earlier `6148305` baseline has 1,502 gaps; its 433 net reduction is historical,
not this delivery's increment. The complete change against master `18f5352` and the
smaller `6148305` delta have been reviewed separately.

## Initial findings and method admission

- The earliest-sensitive-assignment fix has a meaningful negative control. All49
  existing input pairs pass at `f966dd2`; the same inputs leak9 pairs at `6148305`.
  Another1,372 three-assignment combinations across space, tab, LF and CRLF pass,
  alongside3 safe-text preservation controls. The original assertion checks both
  secret absence and preservation of the public `result=PASS` prefix.
- The baseline's42 focused evidence/inventory/artifact/toolchain/prototype and
  qualified preparation/Node-hook tests pass independently. The copied tool graph
  is byte-verified with descriptor
  `380b1ba55eb71082f9b76cb6e7cc577d0c4a4d68fdd60a216d5342619357cbc0`.
- Method admission remains **PENDING_INDEPENDENT_REVIEW**. A functional workflow
  PASS, a coverage floor, and a critical semantic assertion are separate claims.
  Final admission needs the exact combined candidate and raw replay. Changes
  authored by05 require06 review; this document is not independent approval of
  those changes or a GitHub approval.
- Missing source positions are implicit Istanbul branches. They require their
  complete branchMap and control-flow proof; absence of hits proves neither
  unreachability nor platform exclusion. All such branches remain in the denominator.
-04 reported a reproduced connect/refresh late-result bug after a silent wallet
  chain change. This is a **worker-reported finding, pending05 independent retest**
  of the exact fix.04 owns the fix;05 will verify account/chain re-read, rejection
  of stale authorization, and zero submission. No business code is changed here.

## First bounded test batch

`test/coverage-cli-boundaries.test.mjs` checks malformed/duplicate CLI arguments,
signalled-child failure, type-only export classification, and real CLI orchestration.
Only expensive subordinate workflow execution is substituted in the orchestration
fixture. Assertions check actual argument selection, workflow order, prerequisite
construction, receipt persistence, scope, and process exit. They do not establish
that any scanner or application workflow passed.

`test/coverage-lifecycle-boundaries.test.mjs` controls CDP and realm-loss timing at
the external boundary. Actual lifecycle code persists and independently replays
raw artifacts. It verifies setup failure, snapshot/reset races, zero contribution,
ignored subframe/late navigation, closed-page behavior, caller-visible navigation
failure, and failure aggregation. It does not replace real browser qualification.

The two files pass25 tests with no skips. Focused ESLint and `git diff --check`
pass. Initial formatting diagnostics were corrected using the pinned formatter.
Production source graphs are unchanged. Manager owns registration of these two
files in the shared `package.json`; this branch does not edit that file.

Ignored local evidence is under `outputs/macbeth05-pr22-reachable/`, including
the baseline copy, redact review and TAP logs. Subsequent diagnostic receipts must
report original-gap hits only when both source SHA-256 and branchMap are identical;
changed graphs require separate measurement. No full check/dashboard/package or
external publication is performed by this batch.

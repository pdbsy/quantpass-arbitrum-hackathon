# Overall coverage method admission review

Reviewer: `Macbeth05`

Task: `M3-05-PHASE1-ACCEPTANCE`

Candidate under review: `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`

Candidate tree: `6f1a21845a99e16a0ba171612cd97e9bf3439294`

Decision: `METHOD_NOT_ADMITTED / OVERALL_COVERAGE_NOT_MEASURED`

This is an independent review of the manager qualification package and the Macbeth03 and Macbeth04 reports already present on disk. No hosted check, remote status API, security service, installation, push, signing, broadcast or Testnet write was used.

## Requirement basis

`docs/TASK-BOARD.md:108-109` contains the frozen project requirements:

- critical authorization and accounting paths require 100% branch coverage;
- overall automated coverage has a target of at least 90%.

The current closeout specification additionally requires separate disclosure of Istanbul lines, statements, functions and branches and forbids selecting the most favorable dimension. The original text does not itself say that every one of those four dimensions is threshold-bearing. Therefore the report must always expose all four values, while the applicable threshold dimensions must come from the current approved acceptance interpretation rather than a worker choosing one after seeing the result. Critical optional-chain, short-circuit, default-parameter, switch/fallthrough and implicit-constructor semantics remain a separate explicit case list even when Istanbul reports 100% branch coverage.

## Evidence reviewed

The manager package is under the manager checkout's ignored `.checks/source-coverage-qualification/instrumentation` directory. Its candidate and tree bind to the values above. All 58 paths listed by `checkpoint-hashes.json` were recomputed and matched. Principal immutable records are:

| Record                         | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `MANAGER-CHECKPOINT.md`        | `263b9981ce9272999e59f4bf4cf8254d39ddcc8532e2a64a38b9bd7a9dbb5e47` |
| `QUALIFICATION.md`             | `3bcf405709af513859f823a4d1da4fac9c91c58697a327d7e954f47a9b5c5320` |
| `manager-inventory.json`       | `b9bd2444d74aa9c4daecc995f90213e273d6930b0efba75b5397a487ab8ebdbb` |
| `candidate-probe-summary.json` | `734c2554808c5bb181022ac47acb820db4be1a6a6a15ff8cd3ae89dd84fadd82` |
| `checkpoint-hashes.json`       | `e0cd0d7a94ffdab257b5acb3054448ec4ebb833c3cfc0d61275576ef383d45c0` |

The independent Macbeth03 lifecycle analysis was reviewed at source `a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`. Its investigation report hash is `d328a5c976e9ea69ed902ab9f197f9000f144cb8640f8e7ed498d0ba82810d43`; its prototype qualification report hash is `104267c80bf04c19124230ec345835ffa7f53327e4b248f6bf45f2dae9a70cd5`. It proves synchronous hook reachability for ESM, CommonJS, TypeScript, workers and ordinary inherited child processes, and separately proves that replaced child environments and `SIGKILL` can omit coverage artifacts.

The independent Macbeth04 syntax review hash is `45772502d81fcffaa34d31aee8d6b01d3ac12222db42023d0b16c07d250ae6ee`; its syntax result hash is `7a257b5b4a07890bc22fdb86377d501dd4bb132701425200a40f70c5e6f2bfc4`. It proves identical Node/browser Istanbul counter graphs for its fixture and documents the semantic limits of the fixed graph.

## What is qualified

The package provides strong evidence for these bounded properties:

- a candidate-bound manifest supplies deterministic zero-count Istanbul graphs for the tracked source inventory;
- source bytes, generated instrumentation, source maps, tool digest and counter maps are checked before observations are accepted;
- the merger rejects candidate, tree, tool, source, graph, path, counter-ID, branch-length and unsafe-counter mismatches, rejects duplicate lifecycle IDs, and gives missing or incomplete observations zero contribution;
- the prototype HTML mapping preserves the demonstrated coordinates and the mixed Node/browser fixture uses one canonical counter graph;
- the fixed package graph and license/advisory review are recorded without changing product dependencies;
- real Node and browser workflows completed successfully in the exploratory candidate run.

These properties repair the earlier minified-V8 branch-identity defect and support use of a single standard Istanbul graph.

## Remaining admission conditions

The following conditions remain mandatory before Macbeth05 will accept an overall result:

1. **Versioned, candidate-bound entrypoint.** Move the runnable inventory, collection, strict merge and reporting entry into tracked project source with versioned tests. The current executable package and raw observations live only in ignored manager `.checks` paths and do not satisfy the specification's reproducible-entry and persistent-delivery requirements.
2. **Exact source and tool identity.** The entry must fail closed on candidate commit, candidate tree, dirty state, source hashes, instrumentation options, package lock/tool digest and runtime versions. The final summarizer must verify the tree directly, not only `HEAD`.
3. **Explicit lower-bound lifecycle contract.** Register each root workflow and the expected browser page/navigation capture boundaries. Every observed process and worker uses distinct started/complete identity. Missing, late, abruptly terminated and `SIGKILL` lifecycles, children with deliberately replaced environments, and any started observation without a valid completion contribute zero and remain visible in the lifecycle report; unknown, damaged or identity-mismatched records fail closed. The complete static denominator makes those zero contributions conservative. An admitted lower-bound result does not require an uncatchable `SIGKILL` process or every possible child to fabricate a completion artifact.
4. **Browser lower-bound accounting.** Record the expected product pages, navigations, close and error boundaries used by the accepted real browser workflow. A missing or empty capture contributes zero and is disclosed rather than making the functional workflow fail retroactively. The functional browser exit/assertion evidence remains separate from the coverage lower bound. Because the complete source denominator begins at zero, an unobserved browser interval can only reduce the reported result.
5. **Canonical inventory and alias policy.** Rebuild the inventory from the exact candidate. Pure-type classifications require AST proof. Executable zero-counter modules remain disclosed. Both forum copies may remain as a conservative tracked-artifact denominator, or one may be treated as an alias only after byte identity, generator provenance and stale-copy failure checks are versioned. The label must state which denominator was used.
6. **Syntax and semantic contract.** Retain the Macbeth04 qualification matrix and its limitations. Report standard Istanbul lines/statements/functions/branches, and keep the approved critical semantic cases separate; do not equate branch 100% with decision, MC/DC or every short-circuit outcome.
7. **Raw-to-report auditability.** Persist the manifest, observations, incomplete-lifecycle list, exact commands, exits, logs and final report in the project delivery area with hashes. The result must be reproducible from those retained inputs without mutable temporary directories.
8. **Real workflow execution.** Measure the accepted test, CLI, management, recovery and browser journeys. Import-only or assertion-free execution cannot be used to increase coverage.
9. **Threshold decision and remediation.** Disclose all four Istanbul dimensions. Apply the approved current interpretation of the overall ≥90% target and the separate 100% critical authorization/accounting branch and semantic requirements. List concrete source/line/branch gaps and rerun after 02/03/04 remediation.
10. **Independent final replay.** Macbeth05 must execute the admitted entry against one exact clean final candidate and compare the output to the frozen inventory and critical semantic list before closing `M3-05-P1-001`.

## Current exploratory result

The manager package records 175 observations and two incomplete Node lifecycles. With both forum copies retained as tracked artifacts, the exploratory lower bound is 78.76% lines, 73.27% statements, 77.29% functions and 70.34% standard Istanbul branches. These numbers are useful gap diagnostics. They are below 90% in every disclosed dimension, but they are not a formal candidate result because the method is not admitted.

The correct current status remains `OVERALL_COVERAGE_NOT_MEASURED`; `M3-05-P1-001` stays open. The next engineering work is to version the collector/report entry, make lifecycle and browser lower-bound accounting explicit, decide and test the forum alias policy, remediate the reported source gaps, and then perform one independent exact-candidate replay. If the conservative lower bound reaches the applicable threshold, missing or incomplete lifecycles do not need to be reclassified as complete; the report must retain the `LOWER_BOUND` label and the separate functional evidence.

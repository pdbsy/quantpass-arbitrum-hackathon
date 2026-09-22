# AlphaForge Robinhood PR22 concentrated branch closeout

**Goal:** Maximize meaningful coverage of reachable normal, failure, recovery and concurrent behavior, then produce one final acceptance and dashboard closure. The numeric minimum is a gate, not a stopping point. Keep platform-only, unsupported and proven unreachable paths visible in the full denominator.

**Owner:** Macbeth01 / M3-01-PHASE1-CLOSEOUT. Xlayer is excluded. Work executes inline under the user instruction not to start workers.

**Baseline:** 61483052bda9db73378eed1ab767601411047ee9. Verified full report: 9,241 / 10,743 branches; 1,502 uncovered; 428 additional hits needed for 90%. Other three dimensions already exceed 90%. Complete branch IDs, source hashes and locations: outputs/phase1-local-closeout/branch-closeout/baseline-6148305.json.

**Architecture:** Preserve all source counters and exclusions. Use the existing qualified preparation, Node collector and replay against clean local source commits for targeted diagnostics. Compare only unchanged source hashes and exact branch ID/index/location pairs with the baseline. Diagnostic hit union is planning evidence, never final candidate acceptance. Do not regenerate dashboard per batch.

**Toolchain:** Node 24.21.0; npm 11.19.1; existing locked Istanbul toolchain and actual local SQLite/browser fixtures. No package additions.

**Spec:** User instruction, 2026-09-23: enumerate remaining branches, prioritize risk and gaps, target checks before full acceptance, report branch reductions.

## Constraints

- Local delivery only; publication remains declined. No push, hosted CI, merge, rules edits, deployment or signing.
- No denominator changes, coverage ignore directives, counter writes, generated PASS edits, or unreachable-path invocation just to increase the percentage.
- Preserve original author/history and migration provenance. A discovered defect gets a failing regression test before a production fix.
- Overall numeric coverage, critical semantic acceptance and independent approval remain distinct.

## Execution

- [x] Inventory every missing branch with its baseline source digest and risk group.
- [ ] P0: malformed restored SQLite state, canonical event replay/conflicts and client snapshot owner/revision/account relationships. Append assertions to test/chain-store.test.ts and test/ui-product-adapter-races.test.ts. Assert rejection plus unchanged stored/published state; test legal controls too.
- [ ] P1: malformed CI identity, bounded/encoded privacy data, missing source and check evidence. Extend management-dashboard source/schema/build tests. Assert no false READY/PASS or sensitive output.
- [ ] Run only the affected assertion-bearing tests under the existing collector after each coherent source commit; preserve failing logs. Record exact newly covered baseline branch IDs and remaining gap. Do not count predicted hits.
- [ ] Inspect remaining reachable paths after measured batches; prioritize unresolved P0/P1 before presentation paths. Record unreachable/platform-only cases without excluding their counters.
- [ ] Once local coverage is converged, run the existing complete nine-workflow collection, native contract/Slither gate, Semgrep and environment/identity checks. Repair actual failures before regenerating final evidence.
- [ ] Close C/R/S using real management checks, then update the dashboard and isolated preview once. Report actual Ready limits, including publication hold and independent admission.

## Measured batches and defect found

- eda6f70: 102 previously uncovered baseline branches observed by targeted collection.
- e59da4b: 78 additional branches; cumulative 180.
- 2626eaa: 37 additional branches; cumulative 217. These are unchanged-source diagnostic unions, not final candidate coverage.
- Mixed quoted assignments and CLI flags exposed an actual redaction defect: the first matcher to return could preserve an earlier credential. New failing regressions are preserved locally; choosing the earliest sensitive assignment across grammars fixes the leak. Seven assignment forms are checked in all 49 ordered pairs, with safe-prefix preservation and both fixture payloads absent.
- Since the redactor source changed, earlier hits in that file are retired from the unchanged-source union. Final acceptance must recollect the new graph; no old coverage is transplanted onto it.

## Current measured closure

See docs/management/phase1/BRANCH-CLOSEOUT-2026-09-23.md for the complete measured batch table, actual defect and remaining-path policy. Final acceptance keeps all counters and checks the new candidate rather than reusing diagnostic unions.

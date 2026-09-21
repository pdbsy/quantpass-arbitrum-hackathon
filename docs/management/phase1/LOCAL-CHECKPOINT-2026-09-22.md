# PR22 local checkpoint — 2026-09-22

Manager: Macbeth01. Repository: pdbsy/quantpass-arbitrum-hackathon. Status: NOT_READY_TO_MERGE.

## Exact completed checkpoint

- Source C: `3005b4007509cb5c0f40b42a6a0936c8f13e2320`.
- Manifest-only R: `2dd51c8e4f64aac7e47665936ba9861990151021`.
- Snapshot-only S: `5dc6da79b4a669cc1daa94b371c0482dac46195c`.
- Node 24.21.0 / npm 11.19.1. Current candidate full `npm run check` passed, including 827 tests, privacy, consistency and build. The collector recorded 11 PASS, 0 FAIL and 4 unregistered NOT_RUN; separate contract evidence is not inserted as fabricated collector PASS.
- The bounded M3, legacy and management browser workflows all passed at S. The earlier C workflow's `RECORDED_GIT_GRAPH_MISMATCH` failure is retained; actual C/R/S regeneration resolved it.
- Canonical whole-source lower bound at S: lines 84.13%, statements 79.32%, functions 84.03%, branches 75.51%. None reaches the conservative 90% threshold. Method admission remains PENDING_INDEPENDENT_REVIEW; critical semantic acceptance is not inferred from these percentages.

Report file: `report-c7942f8d-a313-4d63-b44f-090a3777e8ac.json`. SHA-256: `f02b4c710e6acef795a16247624de0fac57fe55916c7f33461bf1a5dae5a15cb`. Raw workflows remain in the ignored local coverage output for this run. This checkpoint is not inherited by subsequent code or evidence changes.

## Browser method repairs and independent review

`28013f86f84325b2bd8ed6799133197fe1568d9b` preserves independent full Git history in runtime copies, rejects dirty or mismatched source and excludes ignored private files. Its six Git isolation regressions passed.

Macbeth05 independently retested that exact commit with qualified tools on 2026-09-22: 11/11 browser qualification tests passed, including location/reload incomplete intervals and hash/history preservation. `M3-05-P1-BROWSER-NAV-01` passed within those four specified scenarios. Its relevant source is unchanged at S. The review's browser log SHA-256 is `c36cfe2727ca6ee16316c325e0d85b038a9f4316e731968b00dbc03f906b9117`; tool verification log SHA-256 is `b1e331187c1b26288625bea92047fdf6247ef58c4651d62343bd7ffc4f8ffc7d`. This is independent functional review, not independent GitHub identity or security approval.

The next manager change binds legacy/management Node child counters, logs, process exit and exact driver identity into report replay. These previously collected child hits were omitted conservatively. Child artifact mutation, missing completion, wrong workflow/candidate/command and killed processes have explicit failure regressions. New code requires fresh C/R/S and whole-workflow verification; the S percentages above remain a historical measured checkpoint.

## Active boundaries and remaining work

- 03 continues only necessary chain/recovery behavioral gaps; 04 expands real product interactions; 06 verifies available native environment evidence. Questions return to 01.
- Public repository status restores normal PR validation; final-head hosted checks are still pending publication. Old remote-head success does not admit this local candidate.
- Unpublished QA history contains operational machine paths and an earlier PNG. Current-tree sanitization preserves that history and does not remove its publication implications. An exact outgoing-history disposition is required before publishing; no rewrite or force push is authorized.
- Final coverage, independent functional/method review, final security disposition, external governance, eligible review and applicable merge authorization remain distinct.
- Local/mock/NOT_DEPLOYED. No new chain writes, deployment, signature, broadcast, service, credential or rule change.

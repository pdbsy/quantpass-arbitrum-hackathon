# AlphaForge quant integration acceptance

Scope: local/mock Hackathon infrastructure. No chain deployment, signature, broadcast or real funds.

## Immutable sources

- Stage 2 reviewed source: `2a41a343625dd3eac13dc2ac9be502b4faa363a3`, original branch `macbeth01/AF-QINFRA-STAGE-2`, PR #36.
- Actual master after PR #36: `44823f084a56226b9b3bbe316c47bea2c0c9fa37`. Its complete tree equals the reviewed source tree `36409bf1f6c22c19f81d77795d3780a5cd14dca6`.
- EMA closeout source: `8d8791b629a95c4eaebffd1b29b5c601dd7e3f61`, original branch `macbeth01/AF-QINFRA-CLOSEOUT`, PR #37. Original source changes were authored by Macbeth01 in `f0eec6425eaf2042983135f68f360e23a521c7e2` and `09575035`; exact original commits remain reachable through the original branch and their evidence refs.
- Vault source remains separate: `cb160573068336e43004b20857d78bdfa29209c0`, PR #38. This integration does not include its implementation.

## Why a replacement branch

The protected repository requires linear history. Squashing #36 preserved its code but changed ancestry. Retargeting stacked #37 to master therefore produces conflicts; its old stage-2 commits also fail the single-task PR identity rule. This branch starts at actual master and applies exactly the source delta from the reviewed stage-2 tree to the EMA closeout tree, excluding the three generated management evidence files. Original branches and commits are retained; nothing is force-pushed or rebased. Fresh source C, report R and snapshot S must be generated on this branch.

## Historical failure retained

The default squash message for #36 concatenated four copies of the Agent-ID and Task-ID trailers. Macbeth01 did not override that default at merge time. Post-merge Engineering run [36590039638](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/36590039638) failed verify, verify-windows and verify-macos at identity validation with `commit body Agent-ID must appear exactly once`. Six other jobs passed. That exact master run remains FAILED; a subsequent successful source or PR run must not be reported as repairing that historical run. No required check, provenance validator or branch protection is changed here.

At actual master, a fresh independent dependency installation and all 1528 tests completed: 1522 passed, six skipped, zero failed. The initial detached local check stopped at `RECORDED_GIT_BRANCH_MISMATCH`; checking out and fast-forwarding the unused local master without changing HEAD allowed management verification and web build to pass. This does not replace the failed GitHub identity gate.

## Local page acceptance

On the separate Vault source above, browser interaction verified exact 100.000001 principal/Pass freezing; insufficient Pass rejection without balance change; pending withdrawal and cancellation retaining locks; principal confirmation unlocking exactly 30; two-asset execution; insufficient running cash refusing to sell positions; open positions blocking principal withdrawal; running cash addition and withdrawal; manual stop clearing both positions; loss close releasing all remaining Pass; account isolation; percentage and price upper-limit liquidation; profit withdrawal retaining principal and Pass; and 390px layout without horizontal overflow. These results are source-specific and do not claim Vault functionality is on master. External strategy decision submission, restart recovery, lower-limit and liquidity-blocked cases were not repeated through the browser in this pass.

## Next merge procedure

This replacement requires its own reviewed permission before merge. Preserve original source branches. Bind merge to the reviewed head and supply an explicit commit title and body containing exactly one Agent-ID and one Task-ID trailer. Read back the resulting master SHA and commit message, compare the tree against the reviewed source, and run all required checks on actual master. Any failed historical run remains visible. Do not merge PR #38 under permission granted for #36.

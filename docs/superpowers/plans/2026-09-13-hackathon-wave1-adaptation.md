# AlphaForge repository consolidation implementation plan

Authority: current user AF-MIGRATION instruction. Canonical repository pdbsy/quantpass-arbitrum-hackathon, default master, base cf2284af320461bb416b17fe4fb00a73f8ffdd68. Migration branch macbeth01/AF-MIGRATION-repository-consolidation, Draft PR #11. Independent checkout; no delegation, merge, history rewrite, deployment or funds operations.

- [x] Discover source branches, worktrees, PRs in all states and stash metadata; create per-file inventory before bulk migration.
- [x] Adapt existing backend/API work while preserving target error, statistics and domain contracts; run regression and HTTP tests.
- [x] Preserve original UI bytes; migrate frontend adapters and actual build/browser checks with target task-board assets intact.
- [x] Migrate worker identity, registry, protocol, bootstrap, Forum parser/collector/renderer/tests; canonical-only trust and external assets under target CSP.
- [x] Migrate optional local contract source and locks; rerun offline build/tests; keep target chain/governance authority.
- [x] Archive historical API/QA/specification evidence with privacy transformations and source hashes; no historical PASS reuse.
- [x] Bind existing project/task directory origins to independent canonical checkouts, preserving old source trees.
- [x] Repeat missing-work audit; record the discovered protected uncommitted Dashboard refresh separately.
- [ ] Receive the user's explicit choice for those 11 uncommitted Dashboard files; do not silently activate their write API.
- [ ] Finish exact source C → manifest R → snapshot S, actual CI and review report. Current check results are linked from PR #11.

See docs/migration/INVENTORY.md, CONFLICTS.md and REPORT.md. The latest migration scope includes archival of historical QA/management evidence, superseding the earlier narrow Wave 1 plan that omitted those records. It still prohibits reimplementation or treating historical reports as current acceptance.

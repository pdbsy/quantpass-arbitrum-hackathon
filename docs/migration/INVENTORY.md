# ALPHAFORGE MIGRATION INVENTORY

Canonical repository: `pdbsy/quantpass-arbitrum-hackathon`. Default branch: `master`.

Target base: `cf2284af320461bb416b17fe4fb00a73f8ffdd68`. Source baseline: `0a813de422a02a2b3f0ade7eee693f0d2491ec33`.

Status: migration in progress. No merge, deployment, broadcast or funds operations.

| ID | Source | Agent | Branch/Commit | Content | Target Location | Status | Conflict | Evidence |
|---|---|---|---|---|---|---|---|---|
| MIG-01 | PR #1-5 | Macbeth01 integration; source owners in JSON | See inventory.json | Worker protocol / registry | `docs/management/agents/` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-02 | PR #1 | Macbeth01 integration; source owners in JSON | See inventory.json | Agent Forum | `tools/agent-*; docs/agent-forum.html` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-03 | Target master | Macbeth01 integration; source owners in JSON | See inventory.json | Dashboard | `tools/management-dashboard/; docs/management/dashboard/` | ALREADY_PRESENT | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-04 | PR #9 | Macbeth01 integration; source owners in JSON | See inventory.json | User UI | `apps/web/prototype/AlphaForge_v3_EN.html` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-05 | PR #9/#8 | Macbeth01 integration; source owners in JSON | See inventory.json | Frontend adaptation | `apps/web/; test/ui-*` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-06 | PR #7/#8 | Macbeth01 integration; source owners in JSON | See inventory.json | Backend APIs | `apps/server/; test/product-api.test.ts` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-07 | PR #10/#8 | Macbeth01 integration; source owners in JSON | See inventory.json | Contract foundation | `contracts/` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-08 | PR #6/#8 | Macbeth01 integration; source owners in JSON | See inventory.json | QA review | `docs/migration/legacy-quantpass/` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-09 | Target master | Macbeth01 integration; source owners in JSON | See inventory.json | Planning | `planning/; docs/TASK-BOARD.md` | ALREADY_PRESENT | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-10 | Target master | Macbeth01 integration; source owners in JSON | See inventory.json | Security | `planning/security-boundary.json; docs/security/` | ALREADY_PRESENT | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-11 | Target master | Macbeth01 integration; source owners in JSON | See inventory.json | CI | `.github/workflows/` | ALREADY_PRESENT | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-12 | All public source PRs | Macbeth01 integration; source owners in JSON | See inventory.json | Documentation | `docs/migration/legacy-quantpass/` | NEEDS_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |
| MIG-13 | Five existing task directories | Macbeth01 integration; source owners in JSON | See inventory.json | Task repository binding | `Canonical origin; independent clones` | VERIFIED_AFTER_MIGRATION | See CONFLICTS.md | Immutable SHA/blob in inventory.json |

The exhaustive per-file/version inventory is [inventory.json](inventory.json). Historical QA PASS statements apply only to their original source commit. Every artifact is compared with target master before migration. The target dashboard, governance, supply-chain, threat model, platform checks, money model, SQLite ledger and network policy remain authoritative.

Discovery includes all 10 old PRs (OPEN), all 10 target PRs (merged/closed), local and remote branches, registered worktrees, safely accessible project clones and stash metadata. No stashes were found in the three top-level candidate clones. One stale worktree registration points to an absent directory; its baseline commit is still available. An old UI integration scratch worktree has staged/uncommitted files and is protected pending byte comparison with committed UI fix. Private chat contents were not used as source.

Task binding: the existing project path and Macbeth01–05 cwd paths now resolve to independent clones with canonical origin. Old worker checkouts were preserved using Git worktree moves. Task IDs and conversations were not recreated. Saved directory strings are unchanged; no Codex private database was edited. Local path mapping is retained outside this public repository.

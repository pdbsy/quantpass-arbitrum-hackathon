# Macbeth03 Task Intake — M3-03-PHASE1-RECOVERY

Status: ACKNOWLEDGED / IN_PROGRESS  
Date: 2026-09-20  
Agent: Macbeth03  
Task: M3-03-PHASE1-RECOVERY

## Repository and isolation

- Repository: `pdbsy/quantpass-arbitrum-hackathon`
- Remote: `git@github.com:pdbsy/quantpass-arbitrum-hackathon.git`
- Default branch: `master`
- Verified base: `18f5352070910a867b9729b031aa2e3951785e01`
- Branch: `macbeth03/m3-phase1-recovery`
- Worktree: `work/m3-phase1-recovery`
- Starting HEAD: `18f5352070910a867b9729b031aa2e3951785e01`
- Starting tree: `a4b1cf782f6e5f2aaa90c955cfffb629ee5231ba`
- Starting state: clean; isolated `node_modules` installed with `npm ci --ignore-scripts`
- Toolchain: fnm `1.39.0`; Node `24.21.0`; npm `11.19.1`; Git `2.50.1`; Darwin arm64
- Registration source reviewed without integration: `48cccb8743d2e77ec8001187c00e95044a3d2f40`

The checkout was created from the verified base after fetching `origin/master`. No manager registration commit, prior Macbeth03 adapter branch, or other worker branch was merged or cherry-picked. Existing branches, worktrees, evidence refs, authorship, and history remain unchanged.

## Goal and authorized scope

Audit the merged Phase One chain surface before adding code. Preserve same-semantics implementations and add only evidence-backed recovery or isolation fixes. The assigned implementation boundary is:

- `packages/chain-adapter/**` (corrected path supplied by Macbeth01)
- `apps/server/**`
- `test/chain-*.test.ts`
- `test/m3-deployment-template.test.mjs`
- new `docs/chain/PHASE1-*`
- own `docs/management/phase1/Macbeth03-*` reports

The work covers manifest chain/address/ABI/bytecode validation; target, spender, calldata, owner, strategy, Vault, and wallet identity; rejection, revert, replacement, drop, disconnect, duplicate callback, and ambiguous submission recovery; reorg/checkpoint/restart/cross-process ownership/bounded catch-up; same-block and multi-Vault/multi-wallet/multi-strategy isolation; database migration/backup/restore/health guidance; and a non-broadcast Testnet smoke procedure. It must support initial Pass allocation/transfer, Vault selection, and post-close rescue without adding paid sales, real Buy/Sell, pricing, fees, AMMs, matching, or strategy execution.

## Protected files and authority boundary

- Macbeth04 owns shared wallet and product files under `apps/web/**`; this task supplies exact API requirements and does not edit them concurrently.
- Macbeth01 serializes `package.json`, lockfiles, CI/workflows, registry/bootstrap, roadmap, environment/supply-chain policy, shared migration provenance, and generated management snapshots.
- No merge, ruleset change, review bypass, deployment, external Testnet write, wallet signing, transaction broadcast, secret addition, purchase, permission expansion, force push, reset, clean, or history rewrite is authorized.
- Runtime remains Local / Mock / NOT_DEPLOYED until separately approved deployment evidence exists.

## Dependencies

- Frozen Phase One decisions and the merged base ABI/deployment template.
- Macbeth02's versioned Phase One contract/ABI/bytecode handoff for any interface delta.
- Macbeth04 consumption of exact adapter APIs for Pass allocation/transfer, Vault selection, direct live reads, exits, and post-close rescue.
- Macbeth01 for shared-file changes and consolidated decisions.
- Macbeth05/06 for final-candidate acceptance and gate verification; their results cannot be inferred from this worker's tests.

Open dependency records at intake include manager Draft PR #22, historical protocol Draft PR #18, historical adapter Draft PR #17, and product Draft PR #16. Their existence is not acceptance evidence for this new branch.

## Initial risks and blocked evidence

- A same-semantics implementation may already be present through the PR #21 squash; source ancestry alone cannot determine coverage, so tree and behavior must be compared before changes.
- Contract interface changes from Macbeth02 may invalidate adapter assumptions and must be bound to an exact artifact before use.
- `SUBMISSION_AMBIGUOUS` must remain non-retryable; any recovery design that resends automatically is a duplicate-funds risk.
- Indexer degradation must fail product readiness closed without removing an owner's independently verified direct exit path.
- Multi-process SQLite lease, backup, and recovery behavior can produce false readiness if checkpoint and projection ownership are not tested together.
- Real Testnet deployment/signing/broadcast remains NOT_RUN. Smoke work is preparation only.
- `npm run env:check` passed inputs/tools/platform/repository/history/workspace/index/identity/files/isolation/ports/overrides/npm-config/local-mock but returned exit `2`: manager status is BLOCKED because the task registration is intentionally only in manager Draft PR #22, and contracts are NOT_RUN. Current explicit user assignment authorizes work despite that historical-base registration state; this is not reported as environment PASS evidence.

## Acceptance criteria

1. Produce a gap matrix mapping every assigned recovery/identity/isolation scenario to existing evidence, a new regression/fix, or an explicit BLOCKED/NOT_RUN disposition.
2. Validate manifest chain ID, contract address, ABI version/digest, runtime bytecode identity, target/spender/calldata, immutable nonzero owner, strategy, Vault, and wallet bindings.
3. Demonstrate deterministic lifecycle handling for rejection, revert, replacement, drop, disconnect, duplicate observation, reorg, and ambiguous submission without automatic resend.
4. Demonstrate persistent checkpoint/restart/cross-process lease recovery, bounded catch-up, manual degradation beyond the 128-block recovery limit, and same-block plus multi-identity projection isolation.
5. Add testable database migration/backup/restore/health procedures and a non-broadcast Testnet smoke checklist.
6. Provide exact API requirements to Macbeth04 and interface findings to Macbeth01/02 with immutable source references.
7. Report exact source/candidate/tree, tool versions, commands, PASS/FAIL/BLOCKED/NOT_RUN results, limitations, and unexecuted external-chain steps.
8. Finish at READY FOR REVIEW on a Draft PR; no self-merge or deployment claim.

## ACK

Macbeth03 accepts `M3-03-PHASE1-RECOVERY` on the verified base and has started the read-only gap audit. Questions and blockers will be returned to Macbeth01 for resolution under the current user instruction.

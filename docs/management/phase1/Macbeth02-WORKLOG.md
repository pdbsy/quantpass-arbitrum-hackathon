# Macbeth02 Phase One Contracts Worklog

## Additive acceptance-entry closure after bbf54cc

Final integration preparation identified that the final standalone rehearsal in
`check-phase1-contracts.sh` inherited the caller directory. The entry now explicitly selects its
contract project. A new regression failed first for two caller locations and then passed for all
three; the real pinned, offline targeted rehearsal subsequently passed 2/2 with unchanged Solidity
and skipped compilation. Full unchanged contract suites were not repeated. See
`Macbeth02-ENTRYPOINT-CLOSURE.md` for source-equivalence limits, the historical standalone-stage
evidence correction and preserved original failure-log hashes. No remote operation was performed.

- Task: `M3-02-PHASE1-CONTRACTS`
- Base: `18f5352070910a867b9729b031aa2e3951785e01`
- Branch: `macbeth02/m3-phase1-contracts`
- Draft PR: `https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/24`
- Public ACK: `https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/24#issuecomment-5747141328`
- Status: `READY FOR REVIEW / LOCAL / NOT_DEPLOYED`
- Initial verified implementation source C: `e5eff6805d9705745bc0b4483de83466e5693ffa`
- Corrected implementation source C: `2ad816200e7edfbfad96d765b4a696bc8b838c2d`

## Intake and baseline

The branch was created directly from the fixed base after a fresh fetch. The prior Macbeth02
branch and Draft PR #18 were preserved. Approved versions were verified as Node `24.21.0`, npm
`11.19.1`, Forge `1.5.1`, solc `0.8.31` and Slither `0.11.3`.

The exact-base contract gate passed with 121 Solidity tests, 20 Python dependency/ABI mutation
tests, Slither with no findings, and compiler/published Vault ABI equality. The initial root
`npm run check` passed all 591 Node tests and every preceding check, then stopped at
`management:check` with `RECORDED_GIT_BRANCH_MISMATCH`. Generated management evidence is owned by
Macbeth01 under this assignment, so Macbeth02 did not alter the shared report or snapshot. The
result remains an explicit manager-owned integration item rather than a worker PASS.

## Gap determination

Tree and semantic comparison found that PR #21 already contains the core Strategy Pass, Vault,
PassLocker, frozen ABI and extensive custody/accounting/rescue/invariant tests. This task does not
reimplement those contracts. Remaining work is limited to missing delivery evidence, local
deployment rehearsal, adverse-transfer atomicity regressions and Testnet preparation.

## Added evidence

- deterministic eight-contract ABI/selector/topic/error/constructor/immutable/bytecode manifest;
- clean-environment manifest equality and Phase One contract wrapper;
- isolated Forge EVM deployment and owner lifecycle rehearsal;
- atomic rollback regressions for a short Pass deposit, short AF-USDC withdrawal and failed Pass
  unlock after AF-USDC movement;
- Phase One contract delivery and Testnet deployment-plan documents.

Manager review found that the first manifest described immutable offsets without actually storing
the compiler `start`/`length` locations. The correction records every compiler reference ID and
location, marks the reference IDs as not source-field-mapped, and adds four negative/unit
regressions. The deployment plan now distinguishes the eight-contract compiled inventory from the
five-contract minimum candidate; TestVenue and SwapAdapter require separate scope and approval.

Coverage review also found real untested branches in terminal state, withdrawal bounds, rescue
bounds, identity validation, accounting overflow, tracked-position funding and Pass escrow
deficits. Eight business boundary tests close those paths without changing production code or any
threshold. `AlphaForgeVault`, `PassLocker` and `StrategyPass` now each report 100% lines,
statements, branches and functions under the pinned Forge coverage tool.

No external RPC, signature, deployment, transaction or broadcast was performed.

## Current verification

- `bash contracts/script/check-phase1-contracts.sh`: PASS; 134 Solidity tests, 24 Python
  dependency/ABI/manifest mutation tests, fuzz and invariants, Slither with no findings, frozen
  Vault ABI equality, eight-contract manifest equality and two deployment-rehearsal tests.
- Pinned Forge coverage: PASS for the frozen core; `AlphaForgeVault`, `PassLocker` and
  `StrategyPass` each report 100% lines, statements, branches and functions. Full totals and scope
  limits are preserved in `Macbeth02-COVERAGE.md`.
- Manifest negative mutation: PASS; changed manifest content is rejected, and malformed,
  out-of-bounds, overlapping or non-placeholder immutable references are rejected.
- Root formatting, privacy and secret checks: PASS.
- Root `npm run check`: 591/591 tests and all checks before management passed; final command remains
  FAIL at manager-owned `management:check` with `RECORDED_GIT_BRANCH_MISMATCH`.
- `npm run build:web`: PASS when run separately after the management-owned stop.

## Exact manager-candidate binding — 2026-09-20

The user assigned a new local-only review against manager source
`3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`, tree
`6f1a21845a99e16a0ba171612cd97e9bf3439294`. Macbeth02 fetched only that exact commit and did not
query or execute GitHub Actions/Checks, push, update a remote PR, alter repository policy, deploy,
sign or broadcast.

Git object comparison proves that the complete `contracts/` subtree is identical between the
manager source and PR24 head `a130529`: both resolve to
`0fa7e3e471f32a6d6b742e42540add6e047b536a`. Source, tests, scripts, deployment files, Forge
configuration and both dependency locks also match individually. The only reviewed protocol-doc
delta removes two trailing-space pairs from the Testnet plan headings and changes no semantics.

After this mapping, a targeted offline forced compile rebuilt 55 files. Fresh compiled/published
Vault ABI comparison and schema-2 manifest equality both passed. The full unchanged test, fuzz,
invariant, Slither, coverage and local VM rehearsal suites were deliberately not repeated; their
PR24 and Macbeth05 independent checkpoint results remain bound through the exact contract-tree
identity rather than being relabelled as a new execution.

The detailed conclusion and collector boundaries are in `Macbeth02-CANDIDATE-REVIEW.md` and
`Macbeth02-EVIDENCE-INDEX.md`; raw logs are under `docs/management/phase1/evidence/`. The management
collector's `foundry`, `fuzz`, `invariant` and `slither` records remain
`NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR` even though the separate locked contract entry
has real source-checkpoint evidence.

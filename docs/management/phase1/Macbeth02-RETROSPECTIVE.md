# Macbeth02 Phase One Contracts Retrospective

- Agent: `Macbeth02`
- Task: `M3-02-PHASE1-CONTRACTS`
- Base: `18f5352070910a867b9729b031aa2e3951785e01`
- Initial verified implementation source C: `e5eff6805d9705745bc0b4483de83466e5693ffa`
- Corrected implementation source C: `2ad816200e7edfbfad96d765b4a696bc8b838c2d`
- Draft PR: `https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/24`
- Delivery state: `READY FOR REVIEW / LOCAL / NOT_DEPLOYED`

## What changed

The base already contained the Phase One Pass and Vault implementation. This task kept the
production contracts and frozen Vault ABI unchanged, and added the missing reproducible delivery
layer:

- a deterministic manifest for eight contract artifacts, including constructors, immutables,
  methods, events, errors, ABI hashes and bytecode hashes;
- one clean-environment gate that rebuilds and compares that manifest after the historical full
  contract and frozen ABI gates;
- an isolated Forge EVM deployment and owner-lifecycle rehearsal;
- three atomic rollback regressions for adverse Pass/AF-USDC settlement behavior;
- a versioned contract handoff and a real Testnet parameter/evidence plan.

Manager review correctly identified two evidence gaps in the first delivery: the immutable
reference locations were described but not serialized, and the Testnet plan treated the complete
compiled inventory as one deployment order. The correction preserves raw compiler reference IDs
and all `start`/`length` locations without claiming an unproved source-field mapping. It also makes
the minimum Phase One candidate explicit and excludes TestVenue/SwapAdapter unless separately
reviewed and authorized.

An exact coverage rerun also found meaningful boundary gaps in the core lifecycle. Added tests
cover terminal state, withdrawal bounds, empty rescue, missing Strategy Pass identity, asset
aliasing, accounting overflow, unfunded tracked positions and escrow deficit. Production Solidity
and the frozen ABI remain unchanged.

This avoided duplicating the prior implementation after confirming PR #21's squash tree and
semantics.

## Verification on source C

- Phase One contract gate: 134/134 Solidity tests, 24/24 Python tests, fuzz and invariant suites,
  Slither with no findings, frozen Vault ABI equality, eight-contract manifest equality and two
  deployment-rehearsal tests.
- Pinned Forge coverage: `AlphaForgeVault`, `PassLocker` and `StrategyPass` each reach 100% lines,
  statements, branches and functions. Repository-total coverage remains reported separately and
  is not represented as 100%.
- Negative manifest mutation: rejected as expected.
- Agent identity, formatting, diff, privacy and secret checks: passed.
- Root test suite: 591/591 passed, as did every root gate before management evidence.
- Web build: passed separately.

## Preserved failure and NOT_RUN items

`npm run check` stops at `management:check` with `RECORDED_GIT_BRANCH_MISMATCH`. This assignment
reserves generated management reports and snapshots for Macbeth01, so the worker did not rewrite
them to manufacture a pass. Macbeth01 must bind unified management evidence to the integrated
candidate.

Hosted CI on the final PR head, independent functional/security acceptance, external Testnet RPC,
deployment, wallet signing, transaction broadcast, receipts, actual deployed runtime hashes and
finality remain `NOT_RUN` at this source commit.

## Downstream handoff

The `AlphaForgeVault` ABI remains the base ABI already consumed by Macbeth03/04: 25 methods, seven
events and 18 custom errors. No encoder, decoder, selector, topic or constructor migration is
required. Consumers can additionally pin the hashes and complete machine-readable interface from
`contracts/deployment/phase1-contract-artifacts.json`.

The Testnet plan keeps initial allocation and ordinary Pass transfer in scope, excludes paid
issuance and real Buy/Sell, and retains explicit owner, exact 6/18 conversion, profit-first,
loss/no-auto-unlock, close/rescue, soft-ready `3` and reorg-search `128` semantics.

## Remaining coordination

Macbeth01 owns the unified C/R/S management evidence, downstream source pinning and final
candidate. Macbeth03/04 should confirm the unchanged Vault ABI against source C. Macbeth05/06 must
state their actual coverage and limits on the unified candidate. Any external Testnet write still
requires the separate authorization listed in the deployment plan.

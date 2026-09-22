# Macbeth02 Phase One Contracts Task Intake

- Agent: `Macbeth02`
- Task: `M3-02-PHASE1-CONTRACTS`
- Repository: `pdbsy/quantpass-arbitrum-hackathon`
- Worktree: isolated Macbeth02 local checkout; host path withheld from tracked public metadata
- Branch: `macbeth02/m3-phase1-contracts`
- Base and intake HEAD: `18f5352070910a867b9729b031aa2e3951785e01`
- Registration source read-only reference: `48cccb8743d2e77ec8001187c00e95044a3d2f40`
- Intake state: `ACTIVE / LOCAL / NOT_DEPLOYED`

## Environment

The worktree was clean when this task started. The prior
`macbeth02/M3-02-PROTOCOL` branch and its history remain unchanged.

| Tool | Actual version |
| --- | --- |
| Node.js | `24.21.0` |
| npm | `11.19.1` |
| Git | `2.50.1 (Apple Git-155)` |
| Forge | `1.5.1-v1.5.1` (`b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`) |
| solc | `0.8.31+commit.fd3a2265` |
| Slither | `0.11.3` |

## Goal and scope

Audit the contracts already integrated by PR #21 before changing them, then close only verified
Phase One gaps in:

- fixed Strategy Pass supply, initial allocation, nonzero strategy binding and unrestricted
  18-decimal ERC-20 transfer precision;
- explicit nonzero immutable Vault owner and the approve, deposit, withdraw, close and post-close
  rescue lifecycle;
- exact 6/18 principal-capacity conversion, profit-first withdrawal, loss behavior, Pass lock and
  release, tracked positions, unsolicited dust and reserved balances;
- adverse-token, failed-transfer, reentrancy and settlement-atomicity regressions;
- reproducible compiler ABI, selector, event, error, constructor, immutable and bytecode evidence;
- an isolated local deployment rehearsal and a real Robinhood Chain Testnet parameter plan that
  performs no external signing, deployment or broadcast.

Files are limited to `contracts/**`, `docs/protocol/PHASE1-*` and this worker's
`docs/management/phase1/Macbeth02-*` records.

## Frozen boundaries

Initial allocation and ordinary Pass transfer are in Phase One. Paid issuance, real Buy/Sell,
pricing, fees, AMMs, platform liquidity and matching are outside Phase One. Strategy execution
remains deferred. AF-USDC uses 6 decimals and Pass uses all 18 decimals; only capacity conversion
requires multiples of `10^12`. The Vault owner is explicit, nonzero and immutable. Withdrawals use
profit first, losses do not automatically unlock Pass, and close plus post-close rescue preserve
the frozen tracked/reserved asset boundary. Soft readiness depth `3` and recovery limit `128` are
consumer semantics and are not changed by this contract task.

## Dependencies and protected files

Macbeth03 and Macbeth04 consume the versioned contract interface and must receive any exact ABI
change before integration. Macbeth01 owns shared package metadata, CI, registry/bootstrap,
roadmap, environment and supply-chain policy, migration hash lists and generated management
artifacts. This branch will report a minimal requirement rather than edit those files.

External Testnet deployment, wallet signing, transaction broadcast, merge, protection changes,
new secrets, purchases and permission expansion remain unauthorized. Final acceptance depends on
Macbeth01's unified candidate plus Macbeth05/06 evidence within their actual available scope.

## Risks

- PR #21 used a squash merge. Source commits not being ancestors of `master` does not prove their
  implementation is absent; tree and semantic evidence must be compared before adding code.
- The old Draft PR #18 remains a historical source and is not the branch for this task.
- Local VM execution proves reproducibility only and cannot be presented as Testnet evidence.
- ABI changes can invalidate downstream encoders, decoders, manifests and product actions.

## Acceptance criteria

1. Record exact source, candidate, tree, environment, commands, results, failures and `NOT_RUN`.
2. Demonstrate the frozen lifecycle and adverse cases with reproducible tests.
3. Prove published ABI equality against the pinned compiler artifact and publish complete
   selectors, topics, errors, constructor, immutables and bytecode hashes.
4. Provide a repeatable isolated local deployment rehearsal with no RPC, key, signing or
   broadcast, plus an explicit Testnet parameter and authorization checklist.
5. Publish a versioned handoff to Macbeth01/03/04 and a worker retrospective.
6. Stop at `READY FOR REVIEW`; do not merge or claim independent approval.

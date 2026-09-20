# Macbeth04 Phase One Worklog

## Sources

- Task: `M3-04-PHASE1-PRODUCT`
- Fixed base: `18f5352070910a867b9729b031aa2e3951785e01`
- Intake/plan commit: `9c3a16eb2bfe9c3c3ad2af72d4aae09c5aa69485`
- Initial product source candidate: `86f2f9036657eeda3a7357943b6fcac6de3e5dbe`
- Initial product candidate tree: `ae90be8d3411d921bdaf37cf15d3fdea01ce22b3`
- Macbeth02 contract implementation source consumed read-only:
  `2ad816200e7edfbfad96d765b4a696bc8b838c2d`
- Macbeth02 evidence head: `a13052993b6f408b7be835ecd6f4b13ef6df367d`
- Macbeth05 coverage-gap source consumed read-only:
  `49432db158bdee6f4130bcb5c8c9d9fd6cd65a1f`
- Macbeth03 formal Chain/API source consumed read-only:
  `a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`
- Macbeth03 source tree: `bf9726cd560c51a7c60e320e1bdfe45501c9a91b` (Draft PR #26)

The branch contains no Macbeth02 commit. PR #24 was fetched to a read-only remote reference only to
verify the exact manifest and delivery document. The corrected handoff retains the production
Solidity, Vault ABI, selectors, topics, and constructor parameters consumed by the product; no UI
consumer migration was required. Its changes are limited to reproducible immutable compiler-reference
offsets, deployment-boundary documentation, and business-boundary tests. `TestVenue` and
`SwapAdapter` are outside the default minimal deployment candidate.

The branch also contains no Macbeth03 commit. Its corrected PR #26 source is consumed read-only by
exact source and tree identity. The UI implements its contract-qualified Vault/Pass routes, manifest
fields, live runtime-code checks, and submission-registration contract without importing the
unmerged backend history.

## Completed

- Added exact 18-decimal Pass transfer preparation and runtime review/confirmation.
- Added live Pass balance read and honest initial constructor allocation presentation.
- Added owner-only token/native rescue after close through canonical and degraded live reads.
- Kept open-Vault rescue rejected and closed-Vault deposit/withdraw/close disabled.
- Added session, network, simulation, fixed-target, single-use review, and duplicate-submit guards.
- Bound both contracts to exact reviewed ABI identifiers, nonzero deployment blocks, and runtime
  bytecode hashes before review and confirmation.
- Consumed canonical StrategyPass balance through the contract-qualified API and disabled transfer
  when the Pass projection conflicts with the Vault strategy.
- Registered returned Pass transaction hashes with the backend operation evidence path; missing or
  conflicting registration stays explicitly ambiguous.
- Added complete reviewed deployment-set selection keyed by `(chainId, vaultContract)` without
  deriving trust from backend status or product labels.
- Cross-checked the selected backend runtime's Vault, manifest, ABI/runtime hashes, and shared
  StrategyPass identity before canonical writes.
- Preserved two Vault Owners, PassLockers, allowance spenders, sessions, and operation states while
  allowing both Vaults to bind the same manifest-identical StrategyPass.
- Invalidated action, approval, and Pass-transfer reviews when Vault selection changes before or
  during simulation.
- Added production-page dialogs for Pass transfer and both rescue paths.
- Marked paid Buy/Sell explicitly outside Phase One.
- Extended the deterministic mock runtime and completed browser acceptance on loopback port `5194`.
- Preserved the protected prototype and active six-page warm English UI.

## Verification summary

- Typecheck: PASS
- Lint: PASS
- Format: PASS
- Focused multi-Vault product tests: `86/86` PASS
- Focused multi-Vault product coverage: `93.53%` lines, `87.64%` branches, `91.15%`
  functions; the new runtime-set module is `98.35%` lines, `90.57%` branches, `95.65%`
  functions
- Web build: PASS
- Secrets check: PASS
- Privacy check: PASS after removing a personal absolute worktree path from intake evidence
- Agent identity: PASS for every committed Macbeth04 provenance record
- Browser acceptance: PASS within local mock scope. The two reviewed Vaults retained independent
  owners, spenders, allowances, and operation state while displaying the same Pass. Switching from
  Vault A with a prepared withdrawal closed the review before Vault B became selected. Vault A
  retained its one-base-unit AF-USDC allowance while Vault B remained zero. A one-raw-unit Pass
  transfer reduced the Owner B balance from `1000000000000000000` to `999999999999999999`, and the
  wrong-network fixture disabled every Vault write and Pass transfer.
- Full test suite: `642/643` PASS; shared migration provenance hash update required

The first full test run inside the default sandbox also produced only `EPERM` failures when tests
attempted to create `.checks` directories. The same command was rerun with the required worktree
write permission; those environmental failures disappeared. The remaining single failure is the
intentional shared provenance mismatch described above.

## Integration requests and blockers

1. Macbeth01 must update the shared migration provenance entry for `apps/web/src/product-ui.ts` to
   SHA-256 `dd368d5033b1d30dc7c4707c18523976e3fc37f6a746b4101c7a674ec94d7f99` when integrating the
   candidate. Macbeth04 did not edit the out-of-scope shared evidence.
2. The product now selects multiple reviewed Vaults from explicit complete configuration. Factory,
   self-service deployment, and onchain discovery remain outside this task; adding a new deployment
   record still requires reviewed configuration.
3. Macbeth03's final Chain/API source and tree are recorded and consumed without merging its history.
   Its deterministic shared-Pass runtime ownership is compatible with the contract-qualified client.
4. Real Testnet browser acceptance remains blocked on a separately authorized deployment and real
   manifest addresses.
5. Draft PR #27 and the worker Forum ACK exist. Merge, deployment, signing, and broadcast remain
   outside this worker's authorization.
6. The remote full-history Gitleaks job reports the Git tree identity in the final product evidence
   commit as a `generic-api-key` because the original evidence label contained `API` on the same
   line. The current tree separates the Git evidence label and value. The flagged ancestor remains
   immutable under the worker's no-history-rewrite rule, so Macbeth01 and the security gate owner
   must select the authorized repository-level remediation before integration.

## Retrospective

The base already contained most of the difficult wallet and canonical-evidence boundary. Extending
that boundary with small typed requests kept ordinary Pass transfer separate from Vault capacity
accounting and made rescue behavior auditable. The most useful browser check was the one-raw-unit
transfer because it exposed any accidental `10^12` capacity conversion immediately.

The remaining integration friction is evidence ownership rather than product behavior: changing the
real entry file necessarily changes the historical migrated-artifact hash. Keeping that update with
the integration owner avoids a worker silently rewriting shared provenance.

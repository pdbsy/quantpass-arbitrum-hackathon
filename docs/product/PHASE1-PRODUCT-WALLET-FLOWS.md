# Phase One Product Wallet Flows

## Evidence boundary

- Task: `M3-04-PHASE1-PRODUCT`
- Product source candidate: `86f2f9036657eeda3a7357943b6fcac6de3e5dbe`
- Candidate tree: `ae90be8d3411d921bdaf37cf15d3fdea01ce22b3`
- Fixed base: `18f5352070910a867b9729b031aa2e3951785e01`
- Contract handoff consumed read-only: `2ad816200e7edfbfad96d765b4a696bc8b838c2d`
- Contract handoff evidence head: `a13052993b6f408b7be835ecd6f4b13ef6df367d`
- Chain handoff source consumed read-only:
  `a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030`
- Chain handoff tree:
  `bf9726cd560c51a7c60e320e1bdfe45501c9a91b`
- Chain/API review: Draft PR #26
- Runtime boundary: `LOCAL / MOCK / NOT_DEPLOYED`

The contract handoff confirms that `StrategyPass`, `AlphaForgeVault`, and `PassLocker` retain the
base ABI. It also confirms that initial Pass allocation is performed only by the Strategy Pass
constructor and that ordinary transfers retain all 18 decimal places. The corrected handoff changes
only reproducible immutable compiler-reference offsets, deployment-boundary documentation, and
business-boundary tests; production Solidity, constructor inputs, selectors, topics, and the Vault
ABI consumed by this UI are unchanged. `TestVenue` and `SwapAdapter` are outside the default minimal
deployment candidate. No Macbeth02 commit is part of this worker branch; integration remains a
Macbeth01 responsibility.

The formal Macbeth03 handoff is consumed as a source reference without merging its history. The
configured client now uses contract-qualified Vault and StrategyPass reads. Deployment metadata
must bind nonzero Vault and StrategyPass addresses and deployment blocks, the exact reviewed Vault
ABI version and both ABI hashes, plus both runtime bytecode hashes. Before every review and again
before confirmation, the browser reads the relevant runtime bytecode and compares its EVM Keccak
hash with the reviewed manifest. A missing provider response, empty bytecode, or changed hash stops
the write.

The product accepts an explicit set of complete reviewed deployment records and selects one Vault by
`(chainId, vaultContract)`. It cross-checks the selected Vault's backend runtime status against the
allowlisted chain, Vault, manifest, ABI/runtime hashes, and StrategyPass identity. Runtime status does
not add an address or fill missing deployment fields. Multiple Vault records may bind the same
manifest-identical StrategyPass. Each selected Vault retains its own immutable Owner, PassLocker,
allowance spender, accounting projection, and owner-operation state; the shared Pass balance remains
keyed by the connected holder address.

## User-visible behavior

The active `apps/web/index.html` entry continues to load the protected warm English prototype and
`apps/web/src/product-ui.ts`. The unused React entry remains outside this delivery.

The Phase One panel now presents:

- the connected wallet and Robinhood Chain Testnet identity;
- a selector containing only complete reviewed Vault deployment records;
- the selected immutable Vault address;
- reviewed initial Pass supply and recipient when both constructor values exist in deployment
  metadata;
- the fixed Pass address and the connected wallet's full 18-decimal balance;
- exact finite AF-USDC and Pass deposit approvals to the selected Vault;
- deposit, withdraw, close, post-close token rescue, and post-close native rescue states;
- transaction review, simulation, wallet confirmation, submission, and canonical evidence states.

Ordinary Pass transfer accepts a nonzero recipient and a positive canonical 18-decimal amount. The
review binds the wallet owner, fixed Pass contract, recipient, raw amount, and operation ID. Review
and confirmation each recheck the wallet session and simulate the exact transaction. A review is
single-use, so a repeated confirmation cannot send another transaction. A returned transaction hash
is also registered through the same backend operation route used by Vault writes. Missing or
conflicting registration remains an explicit non-retryable ambiguous result and does not claim
canonical evidence.

Every action, approval, and Pass-transfer review is bound to the selected Vault generation. Changing
Vault before or during simulation invalidates the old review, even if the user later switches back,
so a prepared action for Vault A cannot be confirmed against Vault B.

The `10^12` conversion is used only for AF-USDC principal capacity and deposit approval. It is not
applied to ordinary Pass transfer. A transfer of `0.000000000000000001` Pass therefore prepares one
raw unit.

Initial allocation is display-only deployment evidence. It does not mint, sell, or redistribute a
Pass. If the reviewed deployment metadata omits either supply or recipient, both are rejected or
shown as unavailable rather than inferred.

## Closed and degraded states

An open Vault exposes deposit, withdraw, and close according to ownership, chain health, allowance,
and simulation state. Rescue is rejected while the Vault is open.

A closed Vault disables deposit, withdraw, close, and deposit approval. Its immutable owner retains
the two independent rescue actions. Both canonical projection reads and live-RPC fallback reads
support these actions. A non-owner, disconnected wallet, account change, or wrong network disables
them.

When the index API is degraded, deposit stays disabled. A verified owner can still withdraw, close,
or use post-close rescue through live reads and simulation. This does not turn degraded evidence
into `READY`.

## Explicit exclusions

- Paid issuance, Buy Pass, Sell Pass, pricing, fees, AMM, matching, and platform liquidity are
  `OUT OF PHASE ONE`.
- No real wallet signature, external RPC write, deployment, or broadcast was performed.
- No arbitrary token target is accepted for Pass transfer; the target is the reviewed manifest's
  StrategyPass, and the current Vault projection must bind the same address and strategy ID.
- No Vault factory, self-service deployment, or onchain discovery interface was invented. The current
  product selects only from the complete allowlisted deployment set injected by reviewed
  configuration. Real creation/deployment and adding a new record remain separate reviewed actions.

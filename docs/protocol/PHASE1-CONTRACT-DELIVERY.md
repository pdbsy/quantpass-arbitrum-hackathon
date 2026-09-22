# Phase One Contract Delivery

- Task: `M3-02-PHASE1-CONTRACTS`
- Agent: `Macbeth02`
- Fixed base: `18f5352070910a867b9729b031aa2e3951785e01`
- Status: **LOCAL COMPILED REVIEW DRAFT / NOT DEPLOYED**
- Target for a separately authorized future deployment: Robinhood Chain Testnet `46630`

## Gap audit result

PR #21 already integrated the Phase One Pass and Vault core. Tree and semantic review confirmed
that the current base already provides:

- a constructor-only, fixed-supply, freely transferable 18-decimal Strategy Pass with a nonzero
  immutable Strategy ID;
- an explicit nonzero immutable Vault owner that is independent of the deployer, factory and
  strategy creator;
- exact 6-decimal AF-USDC to 18-decimal Pass capacity conversion without truncation;
- owner-only deposit, profit-first withdrawal, principal-linked Pass release, full close and
  post-close rescue;
- loss without automatic Pass release, tracked AF-ETH/AF-BTC positions, per-token raw-unit
  reserves, and unsolicited token/native dust isolation;
- exact received-amount checks, reentrancy guards and atomic rollback when required settlement or
  Pass return fails;
- the complete frozen Vault ABI: 25 function selectors, seven event topics and 18 custom errors.

The production contracts and frozen Vault ABI therefore do not change in this task. Repeating the
same implementation would create downstream drift without closing a real gap.

## Added Phase One evidence

This task adds evidence that was not previously packaged as one repeatable delivery:

1. `contracts/deployment/phase1-contract-artifacts.json` records the complete eight-contract
   compiler inventory. For each contract it includes the constructor, source-declared immutable
   fields, compiler immutable reference IDs with every runtime `start`/`length`, complete method
   selectors, event topics, custom-error selectors, canonical ABI hash, creation bytecode hash and
   compiler runtime-template hash. The compiler reference IDs are deliberately not claimed as a
   mapping to immutable field names because the pinned artifacts do not carry enough AST context
   to prove that association.
2. `contracts/script/build_phase1_contract_manifest.py` deterministically rebuilds that manifest
   from the pinned Forge artifacts. Check mode rejects any source, ABI, selector, event, error,
   constructor, immutable or bytecode drift.
3. `contracts/test/Phase1DeploymentRehearsal.t.sol` deploys the Pass, test assets, Vault and its
   automatically created PassLocker in the isolated Forge EVM. It performs exact finite approvals,
   deposit, partial principal withdrawal, close, token rescue and native rescue, and proves that
   the deployer and creator do not gain owner authority.
4. Additional regressions prove that a short Pass deposit, short AF-USDC withdrawal, or failed
   Pass unlock rolls back the entire transaction, including transfers that occurred earlier in
   the same call.
5. `contracts/script/check-phase1-contracts.sh` runs the immutable historical contract gate, the
   frozen Vault ABI equality gate, full Solidity/fuzz/invariant/Slither verification, manifest
   equality and the explicit local deployment rehearsal under a clean environment.

## Core compiler identities

Hashes are Keccak-256. ABI hashing uses canonical JSON with sorted object keys and compact
separators. Creation bytecode hashes cover the compiler creation object. Runtime hashes below are
the compiler templates with immutable placeholders; an actual deployed runtime hash must be
recorded separately after constructor values are embedded.

| Contract | ABI | Creation bytecode | Runtime template |
| --- | --- | --- | --- |
| `StrategyPass` | `0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f` | `0x0fe405ceaf14c653995f488031f5e5efd3e9e11ecb946792ddb4f24d5d365541` | `0x1ecd66286e0c94cb5f8d98308f59f086103b5c95f2b07dc524bc5e2919b1435e` |
| `AlphaForgeVault` | `0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977` | `0x377b3ad4ed5a804d202d3461c2a6dc59045762351ce74086f7870a2def71b190` | `0x84ba496c3b70467dda328768dc78e53820a94db9e19127b7d63f4b167f0c4908` |
| `PassLocker` | `0x3cd4ab8da2123200b3e4b931cb94a5cc11b5662360c4ed70d6643f173ff53b21` | `0xacc5aca165af774f0292aa7249567376e434e09712983be29dcfa33b0b9d2d68` | `0x3a23133c185856bb68e825ae1ecac929de131bdcbaf2154c3c7e4e24098bc494` |

The machine-readable manifest is authoritative for the remaining five test-environment contracts
and for complete constructor, declared-immutable, compiler-reference, selector, topic and error
lists. It is a compiler inventory, not an authorization to deploy every listed artifact.

## Rebuild and verify

From the repository root:

```bash
bash contracts/script/check-phase1-contracts.sh
```

The corrected candidate result is 134 passing Solidity tests, 24 passing Python dependency/ABI/
manifest mutation tests, fuzz and invariant suites, Slither with no findings, Vault ABI equality,
manifest equality and two passing isolated deployment-rehearsal tests. Forge coverage reports
100% line, statement, branch and function coverage for the Phase One authorization/accounting
core: `AlphaForgeVault`, `PassLocker` and `StrategyPass`.

To intentionally rebuild the manifest after an authorized contract change, first run the pinned
contract build, then from `contracts/` run:

```bash
env -i PATH=/usr/bin:/bin PYTHONNOUSERSITE=1 \
  ../.checks/af-chain01/toolchain/slither-venv/bin/python \
  script/build_phase1_contract_manifest.py \
  --artifact-root ../.checks/af-chain01/out \
  --output deployment/phase1-contract-artifacts.json
```

The rebuild command performs no network request and no chain action.

## Product boundary

Initial allocation happens only through the Strategy Pass constructor. Ordinary ERC-20 transfers
retain every one of the 18 decimal places. No paid issuance, Buy/Sell, pricing, fee, AMM, platform
liquidity, matching, fixed redemption, strategy runtime, arbitrary target or upgrade authority is
added. One Pass per AF-USDC of principal is a capacity relationship and is not a sale price.

## Limits

- No contract address, transaction hash, receipt, deployment block or finality evidence exists.
- No external RPC, wallet key, signature, deployment or broadcast was used.
- The isolated Forge rehearsal is local execution evidence and cannot satisfy Testnet acceptance.
- Hosted CI, independent functional acceptance and security acceptance must bind the final unified
  candidate rather than this worker's local result alone.

# Macbeth02 PR22 reachable Solidity closeout

- Agent / task: `Macbeth02` / `M3-02-PHASE1-CONTRACTS`
- Repository: `pdbsy/quantpass-arbitrum-hackathon`
- Original implementation branch: `macbeth02/m3-pr22-reachable-closeout`
- Draft publication branch: `macbeth02/M3-02-PHASE1-CONTRACTS`
- Fixed source: `f966dd2e0772f6953e7315816b52aa53316c7eae`
- Initial contracts tree: `9574b06ef54bf1de6eb062128ca47b87c4f74393`
- Scope: local/offline contract tests and this worker's evidence. Publication is coordinated by
  Macbeth01. No X Layer changes or additional workers.

## Baseline and method

The manager's complete Forge report has 122/164 branches, 595/622 lines, 765/803 statements and
110/115 functions. Its LCOV SHA-256 is
`9ce57b8e2af8280b8f26ee5b344b9b95a5a1732aafbcfeb426c25cccba143422`.
The three core contracts' four-dimensional 100% is a subset, not a whole-report result.
The separate JavaScript report's 1069 gaps are not Solidity branches; no Macbeth02 JSON partition
was present at intake. Solidity gap IDs preserve the baseline file/line/block/branch tuple and
source digest. Missing coverage does not establish unreachability.

## Execution plan

Use `executing-plans` inline. Existing behavior needs assertions, not artificial production
changes to create a RED. If a real defect is found, retain its failing reproduction before fixing.

- [x] Verify clean independent checkout, exact source, locked tools and manager evidence hashes.
- [x] Add constructor and settlement rollback assertions for the nine optional Venue/Adapter gaps.
  New file: `contracts/test/AlphaForgeOptional.reachable.t.sol`; one minimal test-only sender-debit
  token models a venue output that removes more than the promised amount.
- [x] Add permission, terminal-state, zero/oversize/overflow and funding assertions for reachable
  test-harness gaps; exercise configured token failures through the real Vault lifecycle.
  New file: `contracts/test/AlphaForgeHarness.reachable.t.sol`.
- [x] Classify remaining guards from exact token implementations, arithmetic bounds and fixture
  entry points. Do not mutate token implementations just to make a test's own assertions fail.
- [x] Run focused tests, relevant fuzz/invariant/local rehearsal, and one focused LCOV diagnostic.
  Compare unchanged source maps with the manager baseline; report new graphs separately.
- [x] Preserve raw commands, exit codes and per-gap evidence in ignored local output; provide a
  concise reviewed document and local commit for Macbeth01 and independent Macbeth05 review.

The offline evidence directory is `.checks/af-chain01/evidence/pr22-reachable-closeout/`.
No root scripts, dependency locks, thresholds or generated management PASS records are changed.

## Observed result and graph comparison

Production Solidity, the frozen ABI, constructor parameters, both original deployment manifests,
existing tests and all compiler/dependency settings are byte-for-byte unchanged. The new tests
run real contracts and verify exact rejection data, unchanged balances/accounting/allowances,
rollback of token burns, and valid retry/authorized behavior where applicable.

| Original graph metric | Manager baseline | Newly hit original entries | Baseline plus focused hits |
| --- | --- | --- | --- |
| Branches | 122/164 | 27 | 149/164 |
| Lines | 595/622 | 13 | 608/622 |
| Functions | 110/115 | 0 | 110/115 |
| Statements | 765/803 | Not derived from LCOV | Not aggregated |

Every original source digest and every LCOV branch, line and function key was compared before
forming these unions. This table combines the exact manager baseline with a focused run; it is
**not a new full-suite execution or final candidate acceptance**. No denominator was removed.
The new sender-debit fixture adds 6/6 lines, 5/5 statements, 2/2 functions and 0/0 branches as a
separate graph. Test-contract assertions themselves are not measured as production coverage.
Macbeth01's unified final run remains responsible for all four complete current dimensions.

The 27 newly verified original gaps comprise:

- all nine missing `src/` branches: zero/duplicate constructor inputs, adapter minimum-output
  enforcement, zero swaps, empty reserves, short incoming liquidity/swap amounts, and excess
  output debit after reserve updates;
- fourteen harness guards: controller authorization, terminal and zero operations, profit
  overflow/funding, excessive loss, and unsupported/excess position settlement;
- two test-only factory/holder permission guards; and
- two configured external token failures, asserted through actual Vault deposit and retry.

The per-gap ledger uses `solidity:<SF>:<line>:<block>:<branch>`. All 42 rows, their source digests,
conditions, focused hit counts, test source locations or proof references, assumptions and
reassessment conditions are in ignored `report.json`. `build_report.py` reproduces the ledger
from preserved `baseline.lcov` and `focused.lcov`; this classification is pending Macbeth05 review.

## Fifteen remaining branches and exact scope of classification

All rows below have block/branch coordinates retained in the full ledger. None is counted as hit.

| Source and baseline line(s) | Missing branches | Evidence and bounded conclusion |
| --- | --- | --- |
| `test/AlphaForgeTestVenue.invariant.t.sol`: 29, 30, 31 | 3 | Concrete fixed test-token `approve` returns true or reverts; it cannot return false into the handler's `require`. |
| `test/AlphaForgeVault.accounting.invariant.t.sol`: 52, 53, 54, 55, 105, 108 | 6 | Same pinned ERC-20 true-or-revert semantics for approvals and dust transfers; immutable fixture tokens have no false-return override. |
| `test/StrategyPass.invariant.t.sol`: 15, 33 | 2 | Concrete StrategyPass inherits ERC-20 transfer's true-or-revert behavior. Failed transfer reverts before these boolean guards. |
| `test/StrategyPass.t.sol`: 13 | 1 | Concrete StrategyPass `transferFrom` returns true after allowance/balance checks or reverts; no false result reaches the spender guard. |
| `test/VaultIntentPreview.invariant.t.sol`: 19, 21 | 2 | The immutable, view-only previewer is sampled under a fixed chainId and verifier. Identical inputs/domain are deterministic and earlier calls cannot mutate the empty-intent baseline. This proof does not extend to a changing chainId or replacement code. |
| `test/harness/AlphaForgeVaultHarness.sol`: 89 | 1 | For the concrete constructor-minted, burn-only fixture tokens, the bound is the initial minted supply S0, not the current totalSupply. The tracked amount plus all balances outside this Vault stays at most S0 under the fixture's ordinary operations, so a funded incoming amount cannot overflow the tracked amount. The detailed argument and its limits follow below. |

These assumptions come from the exact sources and the consumed, pinned OpenZeppelin ERC20
implementation. The guards remain in source and in the denominator. New mutable/false-return/
inflationary token implementations, arbitrary storage rewrites or domain-changing fixture actions
would invalidate the applicable classification and require reassessment.

### Macbeth05 review correction: initial supply bound

The original explanation incorrectly used current totalSupply. Macbeth05 identified a valid
counterexample to that explanation: open a position of 10 units, then call ConfigurableAsset's
forceBurn on one Vault unit. The tracked position is unchanged while totalSupply decreases.
This disproves that current-supply invariant; it does not demonstrate an overflowing position.
The original review evidence remains retained, and this correction supersedes that row's reason.

For one concrete fixture asset, let T be this Vault's tracked position, E the sum of balances
outside this Vault, and S0 the total amount minted by its constructor. ConfigurableAsset has no
post-construction mint entry point; fees and forceBurn only destroy units. S0 is at most uint256.max.
The bound needed here is T + E <= S0 over the following ordinary operations:

- Initially T is zero and E is at most S0. An explicit setTrackedPositionForTest call must pass
  _setTrackedPosition's funded-balance check, so resetting T to an amount at most the Vault's
  actual balance reestablishes the bound against the current total supply, itself at most S0.
- An incoming ordinary transfer reduces E by its nominal amount A before openPosition adds A
  to T. Any receiver fee only burns units. The sender must own A before transfer, hence A <= E
  before that transfer and T + A <= S0 when evaluating the overflow guard. A later deficit
  rejection rolls back the entire transaction.
- settlePosition decreases T by A before returning at most A units outside the Vault. A failed
  transfer reverts both changes. Direct transfers between outside holders preserve E; transfers
  into this Vault reduce E without increasing T.
- Burning inside the Vault leaves T and E unchanged; burning outside reduces E. Thus the
  current total supply may fall below T + E without violating the initial-supply bound.
- Vault rescue can return only actual excess above the reserved tracked position; in that case
  T plus E plus the rescued amount is at most the current total supply. Closing and the owner
  USDC/Pass lifecycle cannot release a reserved ETH/BTC position; constructor guards keep those
  assets distinct. The Vault exposes no other ordinary outward transfer of a tracked asset.

This is limited to the exact constructor-minted, non-inflationary token fixtures and their ordinary
transfer/accounting paths. Arbitrary storage or sender impersonation cheatcodes, replacement
token code, fabricated balances, or post-construction minting are outside this argument and would
require fresh review. No uncovered counter, source guard or denominator is changed by this correction.

## Verification and retained failures

- Focused new tests: **19/19**, also executed under the focused coverage run.
- Relevant regression: **49/49 across eight suites**, covering the new assertions, existing
  adapter/venue fuzz, venue/accounting/Pass invariants, and both local deployment rehearsals.
- Commands use the repository's pinned contract tools, an empty child environment,
  offline mode and private checkout outputs. Fuzz remains 256 runs; invariants remain 64 runs,
  depth 32. No thresholds or settings were lowered.
- The first focused run had **18 PASS / 1 FAIL** because the new factory fixture used a Strategy
  ID different from that factory's frozen `trend` ID. The fixture was corrected, not production
  code; `focused-initial.log` preserves the actual failure. It is not presented as a fixed
  production defect.
- An initial ABI CLI invocation omitted its required artifact argument and exited 1. The corrected
  invocation passed. After coverage, the manifest checker also correctly reported a difference:
  thirteen raw compiler-reference IDs differed, while ABI, bytecode hashes and offset locations
  matched. `manifest-diff.json` preserves this diagnostic.
- Rebuilt artifacts using the same production-only compilation context as locked `crytic_compile`:
  `forge build --offline --build-info --skip './test/**' './script/**' --force`. Frozen Vault ABI
  and complete eight-contract manifest equality both passed. No manifest field was edited or
  comparison weakened. Coverage compiler artifacts must not be mistaken for that publication
  context's reference IDs.
- Full contract/Slither/root/hosted suites and management C/R/S generation were not repeated here.
  Unchanged core semantics, precision extremes, reentrancy and rescue history retain the manager's
  exact-baseline evidence; new failure/retry paths and the relevant invariants/rehearsal have fresh
  targeted execution. This author report is not independent review or a Ready-to-Merge claim.

The source tests need no root package change: the existing Forge discovery includes `*.t.sol`.
Next gate: Macbeth05 independent review, then Macbeth01's unified frozen-source validation and
centralized publication.

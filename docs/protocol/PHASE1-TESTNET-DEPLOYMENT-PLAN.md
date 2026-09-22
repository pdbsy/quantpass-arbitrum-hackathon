# Phase One Robinhood Chain Testnet Deployment Plan

Status: **PLAN READY / NOT AUTHORIZED / NOT DEPLOYED**  
Chain: Robinhood Chain Testnet, chain ID `46630` (`0xb626`)  
Contract source: the exact candidate that passes `contracts/script/check-phase1-contracts.sh`

This plan prepares the real Testnet parameters and evidence sequence. It does not authorize an
RPC write, key use, signature, deployment, initialization or transaction broadcast.

## Parameter set to freeze before authorization

| Parameter | Constraint | Current value |
| --- | --- | --- |
| Network | Exact chain ID `46630`; HTTPS RPC selected outside the repository | Unset |
| Deployer | Funded Testnet wallet; does not gain Vault owner authority implicitly | Unset |
| Vault owner | Explicit, nonzero and immutable; authorizes deposit/withdraw/close/rescue | Unset |
| Strategy creator | Explicit nonzero identity; may equal owner but has no custody permission | Unset |
| Strategy ID | Nonzero `bytes32`; identical in Strategy Pass and Vault | Unset |
| Strategy reference | Nonzero `bytes32` version reference | Unset |
| Pass name/symbol | Human-readable deployment metadata | Unset |
| Pass fixed supply | Positive 18-decimal raw amount selected before deployment | Unset |
| Initial Pass recipient | Nonzero address receiving the whole constructor supply | Unset |
| Test-asset supplies | Explicit AF-USDC/AF-ETH/AF-BTC raw amounts and recipients | Unset |
| Soft readiness | Three confirmations by default; not L1 finality | `3` |
| Reorg search | Bounded canonical recovery window | `128` |

Private keys, seed phrases, RPC credentials and signed transactions must never be written to this
table, the repository, PR comments, logs or chat.

## Compiled inventory and minimum deployment boundary

The artifact manifest contains eight compiled contracts so every reviewed constructor, ABI and
bytecode identity remains reproducible. Inclusion in that compiler inventory does not approve or
require Testnet deployment.

The minimum candidate for the Phase One transfer/deposit/withdraw/close/rescue lifecycle contains
the three distinct test assets, Strategy Pass and Vault. Its exact deployment order is:

1. `AlphaForgeTestUSDC(uint256 fixedSupply_, address recipient_)`.
2. `AlphaForgeTestETH(uint256 fixedSupply_, address recipient_)`.
3. `AlphaForgeTestBTC(uint256 fixedSupply_, address recipient_)`.
4. `StrategyPass(string name_, string symbol_, bytes32 strategyId_, uint256 fixedSupply_, address recipient_)`.
5. `AlphaForgeVault(address owner_, address strategyCreator_, bytes32 strategyId_, bytes32 strategyRef_, address pass_, address afUsdc_, address afEth_, address afBtc_)`.

`AlphaForgeVault` constructs its `PassLocker(address vault_, address owner_, IERC20 pass_)`
internally. A separate PassLocker deployment is invalid for this lifecycle. All token addresses
must be nonzero and distinct. Pass must report 18 decimals, AF-USDC must report 6 decimals, and
the Pass `strategyId()` must equal the Vault `strategyId_`.

`AlphaForgeTestVenue` and `AlphaForgeSwapAdapter` remain in the compiled inventory but are excluded
from the minimum deployment candidate. Vault construction does not reference either contract, and
Phase One excludes strategy execution, swaps, AMMs and liquidity operations. Deploying either one
would require a separately reviewed scope, parameter set and explicit authorization; this plan
does not default to those extra deployments.

## Offline preflight

1. Fetch the authorized candidate into a clean isolated checkout and record commit and tree.
2. Run `bash contracts/script/check-phase1-contracts.sh` with the pinned local toolchain.
3. Compare `contracts/deployment/phase1-contract-artifacts.json` with the candidate compiler
   artifacts and the consumer ABI used by Macbeth03/04.
4. Fill a private operator worksheet with the parameter set above. Review addresses by checksum
   and raw values by decimal/base-unit conversion; never infer owner from the deployer.
5. Rehearse the exact values in an isolated local EVM. Record local addresses separately and mark
   them `LOCAL_ONLY`; do not copy them into the Testnet manifest.
6. Obtain explicit authorization for external Testnet RPC access, wallet signing and broadcast.
   Lack of any one authorization leaves all external write steps `NOT_RUN`.

## Authorized Testnet execution sequence

These steps remain blocked until Macbeth01 obtains and records the applicable authorization.

1. Read `eth_chainId` and reject any value other than `0xb626` before preparing a transaction.
2. Confirm the selected account equals the reviewed deployer and has only Testnet funds.
3. Simulate each approved minimum-candidate constructor transaction and record sanitized gas
   estimates without secret or RPC metadata. Do not infer approval for other compiled artifacts.
4. Present the exact chain, sender, constructor, argument values, value and expected artifact hash
   for human wallet review before each signature.
5. Broadcast once. An ambiguous submission is recorded and reconciled by transaction identity;
   it is never automatically resent.
6. Require a successful receipt, exact block/hash/parent identity, deployed code and the configured
   three-block soft-ready depth. Preserve the 128-block reorg recovery boundary.
7. Read back every immutable, token name/symbol/decimals/total supply, Pass recipient balance,
   Vault/Pass Strategy ID equality, owner, creator, token addresses and auto-created PassLocker.
8. Hash the actual deployed runtime bytes. Because constructors embed immutables, compare against
   a runtime rebuilt with the exact constructor values rather than the zero-placeholder compiler
   template hash.
9. Publish the deployment manifest only after address, source, ABI, creation/runtime identity,
   receipt and canonical block evidence agree.

## Authorized functional smoke sequence

Each state-changing step requires its own wallet review and separate recorded result:

1. Verify initial Pass allocation and transfer one non-round 18-decimal raw amount between two
   controlled Testnet wallets.
2. Approve the exact finite AF-USDC and Pass amounts to the Vault address. PassLocker is never the
   allowance spender.
3. Deposit a bounded AF-USDC principal amount and read back principal, tracked AF-USDC and locked
   Pass.
4. Withdraw a bounded principal amount and verify the exact AF-USDC and Pass deltas.
5. Send bounded untracked token/native dust, prove it does not change accounting or block close,
   then close.
6. Use owner-only post-close rescue and verify `actual - reserved` in each asset's raw units.
7. Reconcile transaction, receipt, canonical event and direct contract reads independently in the
   chain adapter and product UI.

Paid issuance, Buy/Sell, pricing, fees, AMMs, matching, platform liquidity and strategy execution
are excluded from this smoke sequence.

## Evidence required for completion

- authorized candidate commit and tree;
- sanitized parameter digest and human review record;
- chain ID, sender and transaction hashes;
- successful receipts and canonical block identities;
- deployed addresses and actual runtime hashes;
- constructor/immutable readback;
- full event identities and direct state reads;
- soft-ready and reorg-recovery evidence;
- exact failures, ambiguous results and `NOT_RUN` items;
- Macbeth03/04 integration evidence and Macbeth05/06 conclusions on the same unified candidate.

Until those records exist, status remains `NOT_DEPLOYED` and no Testnet completion is claimed.

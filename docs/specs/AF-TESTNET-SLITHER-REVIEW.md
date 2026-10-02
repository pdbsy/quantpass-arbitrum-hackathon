# AlphaForge Testnet Slither Finding Review

State: **USER_APPROVED_TESTNET_ONLY**. The user directly confirmed this exact nine-finding scope on 2026-10-02, through 2026-11-01. This is Macbeth01 self-review with actual local behavioral tests; it is not independent security approval. No detector is suppressed. This document records a concrete proposal for the isolated Testnet-only contracts, through 2026-11-01. Mainnet remains excluded.

## Exact proposed scope

| ID | Detector | Severity | Function |
| --- | --- | --- | --- |
| `86cafb9de5f8` | reentrancy-no-eth | Medium / Medium | `AlphaForgeTradingVault.execute` |
| `9cda1796d6b4` | reentrancy-benign | Low / Medium | `AlphaForgeTradingVault.execute` |
| `36b37c863dc3` | timestamp | Low / Medium | `AlphaForgeTradingVault._beginLiquidation` |
| `3aac34772f19` | timestamp | Low / Medium | `AlphaForgeTradingVault._validateAuthority` |
| `92e9196be500` | timestamp | Low / Medium | `AlphaForgeTradingVault.checkRisk` |
| `96f19323b824` | timestamp | Low / Medium | `AlphaForgeTradingVault.execute` |
| `f26b5d023868` | timestamp | Low / Medium | `AlphaForgeTradingVault.authorizeExecutor` |
| `f95399654a69` | timestamp | Low / Medium | `AlphaForgeTestReferenceFeed.update` |
| `f95f7b27409e` | timestamp | Low / Medium | `AlphaForgeTradingVault._price` |

The full IDs and exact source/test SHA-256 values are in `contracts/deployment/slither-admissions.json`. Any source/test change, new finding, metadata change, unknown finding, expiry or missing user approval blocks admission. The original scanner report remains unchanged in `.checks/market-data/testnet-slither-third-findings.json`; its SHA-256 is `6f7dc7b1764dd9bf4c18f95cbd535168118e424cb636030c6700e7eabd508ca1`. A fresh report is required on the final source; this dirty-tree diagnostic is not release C/R/S evidence.

## Two reentrancy findings

The scanner identifies post-router accounting and tracked-position count updates. Actual output is unknown until the swap, so it must be checked against real balance changes. Every mutable Vault entry uses the same OpenZeppelin nonReentrant guard; owner-only custody and typed single-pool routes constrain external effects. The local malicious-router tests attempt public risk reentry and malformed return/output/input movements, verifying rollback of cash, positions, approvals and state version. The official Factory/SwapRouter02/QuoterV2 test checks three real fee-3000 pools and full close.

Residual boundary: public read getters can expose pre-booking values during the router call. This Testnet version must not be used as a collateral/NAV oracle by another protocol. Offchain published values are read at committed canonical blocks. Platform automation still requires the exact owner grant; no withdrawal or arbitrary call is exposed. This proposal accepts that constrained read-only boundary; it does not claim zero risk.

## Seven timestamp findings

Comparisons enforce grant expiry, liquidation-window caps, order deadlines and feed staleness. They do not supply randomness or trading alpha. Tests cover rejected expired grants/past deadlines, forbidden buys at expiry, allowed final-second sells, blocked post-window execution, stop repetition that cannot extend authority, and stale/future/duplicate/zero prices. Chain timestamp and sequencer liveness remain dependencies. A stop latches sell-only intent; it cannot guarantee immediate fills when data or liquidity is unavailable.

## Actual diagnostics and approval state

The last full suite passed 174 tests. Three additional exact-time behavior cases subsequently passed in the 16-test trading suite, including 256 fuzz inputs. Logs and the earlier failed history remain under `.checks/market-data/`; a fresh full suite and all existing hosted gates are still required. Unoptimized trading runtime is 24,074 bytes (below EIP-170's 24,576-byte limit); the artifact gate must keep checking the limit. External-chain deployment, external wallet signing and public-chain execution are NOT_RUN.

The direct user confirmation changed only these nine entries to APPROVED_BY_USER. New, changed or expired findings remain blocked; this is explicit user risk acceptance, not independent security certification.

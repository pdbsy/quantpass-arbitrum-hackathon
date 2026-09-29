# AlphaForge initial Uniswap scope

Recorded 2026-09-30. Status: user selection recorded; execution integration NOT_RUN.

The user selected Robinhood Chain only, then Uniswap as the first venue. This settles the protocol family, not a specific version, router, pool, settlement token or numeric trading permission. No other venue or cross-chain aggregation is implied.

## Confirmed Route C decisions

- Public Testnet may use explicitly labeled test substitutes driven by verified real reference prices. These are not canonical Robinhood Stock Tokens, executable mainnet quotes or mainnet performance evidence.
- AlphaForge manages a restricted executor key. The owner retains their private key and grants the permitted onchain scope; the executor cannot withdraw Vault funds.
- Authorization expiry enters a previously authorized, time-limited liquidation phase. The owner must explicitly set its duration and bounds. Outstanding positions do not imply permission to extend expiry.
- Mainnet compatibility is tested in an isolated, fixed-block local fork. This selection does not enable mainnet signing or broadcasting.

## Official documentation findings

Reviewed 2026-09-30:

- [Uniswap V3 Robinhood Chain deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments) lists chain-specific V3 deployment contracts.
- [Uniswap V4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) lists Robinhood Chain mainnet 4663, including PoolManager and router contracts.
- [Uniswap V3 deployment guidance](https://developers.uniswap.org/docs/protocols/v3/deployments) warns against assuming identical contract addresses across chains and identifies Universal Router as its preferred entry point.

These are documentation findings, not RPC/code-hash verification, proof of Stock Token pool liquidity, or successful fork execution. A mainnet address must not be reused as a Testnet deployment merely because it appears in these sources.

## Qualification required before execution implementation is enabled

1. Resolve candidate token identities through the official Robinhood registry. Keep common-stock classification, exchange, ACTIVE status and oracle qualification separate from registry membership.
2. Inspect candidate Uniswap pools and settlement tokens read-only. Record the queried chain, block number/hash, deployment sources and bytecode evidence. A pool must support both entry and liquidation quotes at explicit test sizes; reference prices alone cannot establish executable liquidity.
3. Present version/router and settlement choices with the observed liquidity evidence to the user before freezing them. Do not silently choose V3, V4, UniswapX, intermediate tokens, hooks or arbitrary router commands.
4. Map the approved execution ABI and behavior to test substitutes. Test substitution must preserve the selected protocol behavior; the existing constant-product AlphaForgeTestVenue is not proof of V3/V4 compatibility.
5. Require owner-bound assets, venue/router, recipients, spend limits, slippage, expiry and liquidation permissions. All acquired assets and unused funds return to the same Vault; the executor cannot choose a withdrawal recipient.
6. Verify quote-to-execution bounds, revert handling, transaction identity, finality/reorg handling and fill/position reconciliation in offline tests and the pinned fork. Public Testnet broadcast remains a separately gated action under the repository rules.

## Current implementation boundary

The existing read-only Robinhood reference capture is implemented separately. The Solidity swap adapter currently targets AlphaForgeTestVenue through ITestVenue; it is not a Uniswap adapter. No runtime whitelist, router address, allowance, wallet authorization or deployment was changed by this scope record.

This document and the Route C plan are source notes. Previously generated C/R/S evidence retains its original commit scope; it does not certify these notes or a future execution implementation. No new CI result is claimed.

## Read-only qualification attempt, 2026-09-30

The frozen [Underlying Asset Whitelist V1](QINFRA-ASSET-WHITELIST-V1.md) governs all underlying-asset candidates. No runtime eligibility is inferred from an exploratory sample.

The official Registry returned HTTP 200 with 195 assets. AAPL, MSFT and NVDA sample records were ACTIVE with chain 4663 deployments. These samples are research candidates, not selected strategy assets or approved whitelist entries.

The public mainnet RPC returned HTTP 403 to `eth_chainId`; the official explorer smart-contract API also returned HTTP 403 for the documented Uniswap V3 factory. Thus chain identity, deployed bytecode, pools, liquidity, executable buy/sell quotes and fixed-block fork execution remain BLOCKED/NOT_RUN. No bypass, credentials, signing or broadcasting was used. Robinhood's oracle documentation identifies Chainlink's directory as the feed mapping source; the directory could not be retrieved in this environment (web response-size limit, direct HTTP 403), so exact feed mappings were not inferred from ticker names.

Raw responses, SHA-256 hashes, endpoint URLs, requests and timestamps are retained locally in `.checks/market-data/uniswap-qualification-nassbv8q/`. HTTP failures are preserved as failures. This is a research observation, not generated PASS evidence. A reachable read-only archive RPC will be required for the outstanding block-bound checks; do not ask for or accept private keys to solve this read-only prerequisite.

# AlphaForge Underlying Asset Whitelist V1

Frozen product rule: user instruction, 2026-09-30. Status: pure offline evidence consistency evaluator implemented; runtime admission, evidence authentication and onchain enforcement remain unimplemented. Initial execution venue: Uniswap on Robinhood Chain.

## Identity and mandatory admission conditions

Every condition must be satisfied before enabling a strategy underlying asset:

1. It is an official Robinhood Stock Token. Bind its asset ID and deployment contract address to the official Robinhood Registry / `/rhj/assets`; a matching ticker or token name never proves identity.
2. Its underlying is the common stock of a publicly listed company: `underlyingType = COMMON_STOCK`.
3. The underlying is listed on NASDAQ, NYSE or NYSE American only.
4. Robinhood status is `ASSET_STATUS_ACTIVE`.
5. Its canonical deployment exists on the selected chain: mainnet 4663 or Testnet 46630. Addresses and evidence must be independently bound to each chain.
6. A supported, verifiable onchain price feed exists for that token on that chain. The feed must be usable when execution relies on it, not merely a syntactically valid address.

Execution identity is `(chainId, lowercase(contractAddress))`. Symbol is display metadata and cannot resolve ambiguity or override an address mismatch. Registry membership is necessary but cannot establish security classification, listing exchange or feed availability by itself.

## Explicit exclusions

ETF, ETP, ETN, ADR, preferred shares, warrants, closed-end funds, other funds, indices, crypto assets, private/pre-IPO company assets, bonds, other RWA, and synthetic/non-Robinhood copies are excluded. An unknown classification is not COMMON_STOCK. No inference from ticker, name or an ISIN country prefix may admit an asset.

## Allowed underlying asset projection

```ts
type AllowedUnderlyingAsset = {
  assetId: string;
  symbol: string;
  robinhoodTokenAddress: `0x${string}`;
  chainId: 4663 | 46630;
  underlyingType: 'COMMON_STOCK';
  exchange: 'NASDAQ' | 'NYSE' | 'NYSE_AMERICAN';
  robinhoodStatus: 'ACTIVE';
  oracleAddress: `0x${string}`;
  enabled: boolean;
};
```

This is a projection of verified evidence, not a self-certifying request payload. A strategy cannot acquire permission by submitting these fields or setting `enabled: true`. Keep the originating registry snapshot, classification/listing evidence, oracle mapping, chain/block identity and review record separately so the result is reproducible. Missing, conflicting, stale or unverified evidence cannot produce an enabled record. The verifier and owner-granted trading permissions remain separate controls.

## Oracle qualification

Robinhood documents Chainlink AggregatorV3Interface proxy feeds. Verify the token/feed mapping and chain independently; record feed decimals and heartbeat from the authoritative directory. Check positive answer, completed/non-future timestamp, freshness, corporate-action pause status, and L2 sequencer availability/recovery as applicable. Do not choose heartbeat, maximum age or sequencer grace-period values implicitly.

The documented onchain feed already prices one Stock Token including the corporate-action multiplier. Do not multiply that feed again. The REST reference-price conversion implemented in the market-data package is a different path and cannot substitute for an onchain feed or an executable Uniswap quote.

## Test substitutes and settlement assets

The user separately approved real-reference-price-mapped test substitutes. Keep these in a distinct test-only mapping with their own deployment identity and canonical reference identity. They must never be emitted as official AllowedUnderlyingAsset entries, included in a mainnet official-token allowlist, or described as actual mainnet execution/performance. Missing official Testnet deployment remains missing; a mainnet address cannot fill it.

This whitelist covers strategy underlying assets. It does not select or authorize a settlement stablecoin, intermediate swap token, Uniswap router, pool, hook or allowance. AF-USDC remains the existing test Vault accounting asset; USDG or another mainnet settlement asset requires a separate explicit decision and verified deployment.

## Confirmed evidence-source decision

The user selected a versioned, manually reviewed issuer/exchange official-source list. Bind each review to the asset ID and exact deployment; record source URL/content digest, reviewer, review time and explicit validity interval. No production asset has been admitted by this specification. Do not represent self-review as independent approval.

## Acceptance cases for implementation

- Same ticker at a different contract address: deny.
- Mainnet address supplied for Testnet without a matching official deployment: deny.
- Official ACTIVE ETF/ADR/preferred/private asset: deny despite registry membership.
- COMMON_STOCK with an unsupported exchange or missing listing evidence: deny.
- Missing, zero, wrong-chain or incorrectly mapped oracle: deny.
- Paused, stale, invalid or unavailable oracle: execution remains unavailable.
- Test substitute with matching symbol/reference asset ID: cannot enter the official-token allowlist.
- A complete verified record with `enabled: false`: deny execution.
- A complete enabled record: still requires venue qualification and owner-granted execution permission.

## Product terminology and distribution boundary

Use **Robinhood Stock Tokens referencing U.S.-listed equities**. PASS represents strategy principal capacity, not ownership of Vault assets; this asset whitelist does not change Vault ownership or capacity accounting.

Robinhood describes Stock Tokens as RHJ-issued debt securities providing economic exposure to underlying securities, without legal or beneficial ownership of those underlying securities. Its documentation states restrictions on offers, sales and delivery in the United States or to U.S. persons. Record that product boundary for any future real-trading launch; this local/Testnet specification is not a legal eligibility determination or a production launch authorization.

## Primary references

Reviewed 2026-09-30:

- [Canonical token identity](https://docs.robinhood.com/chain/contracts/)
- [Registry and reference APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [Network identities](https://docs.robinhood.com/chain/connecting/)
- [Stock Token structure and restrictions](https://docs.robinhood.com/chain/stock-tokens/)
- [Onchain feed semantics and qualification](https://docs.robinhood.com/chain/oracles-and-price-feeds/)

## Implemented offline evaluator

`packages/market-data/src/whitelist.ts` exports `assessUnderlyingAsset(input: unknown)`. The complete synthetic input fixture is in `test/asset-whitelist.test.ts`. It accepts explicit candidate identity, a raw registry body and receipt time, versioned manual review records, and a block-bound oracle observation. All timestamps and policy durations are milliseconds; integer oracle amounts/rounds/block numbers are decimal strings.

`BLOCKED` includes a bounded reason code; `ELIGIBLE` projects the requested AllowedUnderlyingAsset shape. This checks evidence consistency only: the integration must obtain registry/RPC data from authenticated official sources, verify stored source bodies against their digests, verify canonical block/deployment/feed mapping, and load reviewed records from trusted operator-controlled storage. An HTTPS URL and digest field are not proof of authenticity. This function must not be exposed as an authorization endpoint accepting arbitrary strategy/client claims. No such endpoint or runtime integration exists in this slice.

Registry maximum age, review expiry, oracle maximum age and sequencer grace are explicit inputs with no production defaults. Oracle prices are validated but never multiplied again. A successful assessment does not grant a trading allowance or replace owner authorization, venue qualification, runtime revalidation or transaction reconciliation. No live asset has been enabled. Source-specific collector/authentication and onchain gates remain required before real execution.

Twelve behavior tests cover the rule boundary; together with existing registry/capture tests the focused run passed 27 tests before source freeze. The default test suite and management unit collector include these tests. Final full-check results must be read from the subsequent source-bound evidence, not inferred from this statement.

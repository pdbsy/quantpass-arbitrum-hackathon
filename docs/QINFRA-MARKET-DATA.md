# AlphaForge Route C: reference market data

The user selected Route C: real reference-market paper trading, public Testnet workflow validation, and fixed-block mainnet fork compatibility tests. Selection does not authorize production deployment or settle the remaining choices about Testnet substitutes, executor key custody, authorization expiry, numerical risk limits, or the target trading venue.

## Implemented slice

`packages/market-data/src/robinhood.ts` validates registry/deployment identity and normalizes official REST reference quotes. `capture.ts` performs fixed-host HTTPS GET requests and records exact UTF-8 bodies, SHA-256 digests, receipt times, and normalized observations in a dedicated SQLite journal. `tools/automata/capture-market.ts` captures one observation; it is not a continuous paper worker or an order executor.

The CLI requires five explicit arguments:

```text
node tools/automata/capture-market.ts SYMBOL CHAIN_ID CONTRACT_ADDRESS MAX_AGE_MS DATABASE_PATH
node tools/automata/capture-market.ts --help
```

Use the repository-approved Node version. The database parent must already exist at its canonical filesystem path. Existing non-collector SQLite files, symlinks and hard-linked files are rejected; this command must use its own data directory. A rejected observation exits 1 and is retained when the journal is available. Invalid arguments exit 2 before network access. There is no background process, recurring schedule, credential input, RPC call, signing or broadcasting. The default test suite exercises offline HTTP fixtures, not public endpoints.

An `ACCEPTED` capture means a reference observation passed the supplied freshness bound and structural checks. It never grants asset trading admission. The HTTP reader has a ten-second request timeout and four-MiB per-response bound and refuses redirects. Network failures remain rejected observations; no stale fallback fabricates a fresh observation.

## Price and identity semantics

- `(chainId, lowercased contractAddress)` identifies a deployment; ticker is only a URL/display field and must agree with the registry and returned quote.
- Registry membership does not prove COMMON_STOCK, approved exchange, feed availability, or trade eligibility. The whitelist requires separately verified evidence; no automatic whitelist admission exists in this slice.
- REST underlying USD bid/ask is multiplied by the registry's shares-per-token multiplier using integer arithmetic. Output prices use 18 fractional decimal places per whole token; these values are not token quantities or AF-USDC raw amounts.
- Bid rounds down and ask rounds up only at the explicit 18-place reference-price boundary. The frozen exact USDC/PASS capacity conversion is untouched.
- Original nanosecond timestamp text is retained in raw evidence; normalized observation times are milliseconds, discarding sub-millisecond precision. No sequencing guarantee is inferred at sub-millisecond resolution.
- Halts, inactive assets, malformed values, pending multiplier transitions, observed registry changes, inverted prices, expired or future quotes fail closed. Two registry reads detect visible changes around the quote; they do not establish an atomic upstream snapshot.
- Extra fields such as tokenBid/tokenAsk are retained in the raw response but not silently substituted for the documented underlying-price channel.
- Raw reference prices are not executable DEX quotes. Fees, depth, latency, market impact, gas and actual fill evidence remain separate inputs.

Official references checked 2026-09-30:
- https://docs.robinhood.com/chain/stock-token-apis/
- https://docs.robinhood.com/chain/contracts/
- https://docs.robinhood.com/chain/stock-tokens/

## Qualification evidence before source freeze

The first default Node HTTPS probe failed with ECONNRESET. Python diagnostic reads subsequently returned HTTP 200 for registry/quote/registry. The initial parser rejected the real nine-digit fractional timestamps; a failing regression preceded the fix. An additional failing test caught accidental access to an unrelated SQLite database; the collector now requires its own application identity before opening an existing database for writes.

After those repairs, the default Node CLI captured AAPL successfully, bound to its registry-provided mainnet deployment, as REFERENCE_ONLY. No RPC or mainnet transaction was used. Evidence lives in the ignored `.checks/market-data/` directory, including prior failures. This is one live sample, not continuous-service reliability or completed real-time paper trading.

Focused qualification contains 15 passing tests. The first pre-freeze full check ran 1,564 tests (1,558 pass, six skips) and then stopped at the expected management evidence clean-source prerequisite. This predates the three new regression tests and is not final acceptance. Final source-bound management evidence and final-head checks must be generated through source C, manifest-only R, snapshot-only S without modifying this source note to prefill PASS.

## Still pending

Continuous paper trading, executable quotes, authoritative common-stock classification and oracle admission, chain-enforced limited strategy permissions, public Testnet deployment and fills, target venue selection, and mainnet-fork execution are not delivered by this slice. Current synthetic replay limits and Vault accounting are unchanged. Owner decisions must precede the dependent implementation.

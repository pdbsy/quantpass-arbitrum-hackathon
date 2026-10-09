# Preserved website and live stock references

The original home and Trade layout is retained. The catalogue now contains only All in TSLA and All in AMZN. The original 123,345-byte product stylesheet is unchanged (SHA-256 `8b0996e01403be0d0fbf555e03151973cdfe1118ad20f4423324538a32e4aff6`).

Without actual indexed PASS swaps, the upper chart shows a flat 0.5 AF-USDC/PASS initial reference. It does not create candles, volume or historical trades. Once configured, indexed swaps and current pool reserves supply the PASS view. Missing balances and incomplete aggregate windows remain unknown; local financial methods refuse mutation and browser research records are retained.

The lower chart reads the corresponding stock through server API routes:

- `GET /api/stock-reference/quote?symbol=TSLA|AMZN`: Nasdaq primary reference quote, provider trade time, market status and `isRealTime` flag. Browser refresh: 15 seconds; server cache: 10 seconds.
- `GET /api/stock-reference/candles?symbol=TSLA|AMZN&range=1Y`: real daily OHLCV for historical context. Browser/server refresh: five minutes. Daily timestamps represent the reported session date, not a precise closing time.

Quotes use the provider's actual timestamp, converted from America/New_York with daylight saving rules. A minute quote is a price point, never fabricated OHLCV. Failed updates stay visibly unavailable; retained prices keep their original source time. Hidden tabs pause reads and page exit cancels pending requests. Fixed HTTPS upstream paths, two-symbol allowlists, no redirects, response bounds, timeouts and shared caches limit provider access. The UI labels source freshness and distinguishes stock references from PASS prices and funded Vault PnL.

This feed is only a private, noncommercial whitelist test display reference. It has no signer, credentials, order execution, keeper or Vault valuation dependency. Trusted execution still requires the separately configured stock execution adapter. The public website keeps its existing Google access gate on both API prefixes. No login or database migration is introduced.

## Focused validation

- 25 related checks passed: native strategy views and refusal of old local financial operations; provider parsing/cache/timeout/DST/invalid inputs; API Host/Origin/schema boundaries; fifteen-second browser polling, same-minute updates and failure recovery.
- Both TypeScript projects, scoped lint and production web build passed.
- Actual local desktop/mobile browser verification passed for TSLA and AMZN: original terminal containers, flat PASS reference, real Nasdaq stock data, automatic quote refetch, no wallet calls, no HTTP writes and no horizontal page overflow.
- Actual provider reads returned 251 daily records for each stock and changing TSLA/AMZN pre-market quote values. Source times and fetch times remain distinct.
- An authenticated production Google browser journey is **NOT_RUN**. Local browser evidence is not target-chain acceptance.

The earlier replacement-layout web publication was rolled back after the user requested preservation of the original UI. Its historical publication receipt remains unchanged; a separate rollback receipt records the restoration. The corrected release uses a new hashed original-template script and a new runtime release, retaining previous assets for rollback. Publication receipts are kept outside the repository on the server.

These changes do not deploy, fund or sign Testnet transactions. The corrected web reader remains `NOT_DEPLOYED`, without a manifest, RPC, signers or a production identity bridge. Required contract security admission remains unresolved and this PR stays draft. Testnet deployment and reserve configuration are separate from this website update.

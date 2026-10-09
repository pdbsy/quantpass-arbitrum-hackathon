# Preserved website and live stock references

The original home and Trade layout is retained. The catalogue now contains only All in TSLA and All in AMZN. The original 123,345-byte product stylesheet is unchanged (SHA-256 `8b0996e01403be0d0fbf555e03151973cdfe1118ad20f4423324538a32e4aff6`).

Without actual indexed PASS swaps, the upper chart shows a flat 0.5 AF-USDC/PASS initial reference. It does not create candles, volume or historical trades. Once configured, indexed swaps and current pool reserves supply the PASS view. Missing balances and incomplete aggregate windows remain unknown; local financial methods refuse mutation and browser research records are retained.

The lower chart reads the corresponding stock through server API routes:

- `GET /api/stock-reference/quote?symbol=TSLA|AMZN`: Nasdaq primary reference quote, provider trade time, market status and `isRealTime` flag. Browser refresh: 15 seconds; server cache: 10 seconds.
- `GET /api/stock-reference/candles?symbol=TSLA|AMZN&range=1Y`: real daily OHLCV for historical context. Browser/server refresh: five minutes. Daily timestamps represent the reported session date, not a precise closing time.

Quotes use the provider's actual timestamp, converted from America/New_York with daylight saving rules. A minute quote is a price point, never fabricated OHLCV. Failed updates stay visibly unavailable; retained prices keep their original source time. Hidden tabs pause reads and page exit cancels pending requests. Fixed HTTPS upstream paths, two-symbol allowlists, no redirects, response bounds, timeouts and shared caches limit provider access. The UI labels source freshness and distinguishes stock references from PASS prices and funded Vault PnL.

This feed is only a private, noncommercial whitelist test display reference. It has no signer, credentials, order execution, keeper or Vault valuation dependency. Trusted execution still requires the separately configured stock execution adapter. The public website keeps its existing Google access gate on both API prefixes. No login or database migration is introduced.

## Stock detail inspection

The original crosshair and readout are preserved. Hovering the lower stock line now opens an English detail panel with the selected real price, change from the first visible point and source time. Historical daily points show matching open, high, low, close and actual share volume, labelled by session date. Quotes show only recorded quote data, time precision and applicable source/market/feed state; they never acquire invented daily OHLCV. Cached quotes and historical quote points remain explicitly identified.

The floating panel does not resize the chart. SVG screen transforms select the correct point, including scaled mobile charts. Touch input passes through the display panel for subsequent selection. Stock updates and unrelated product renders rebind an active selection to the new SVG in the next frame; touch focus loss during replacement does not erase it. Leaving the chart, changing range, Escape, outside touches and page exit clean up the panel. Indexed PASS candle inspection uses AF-USDC price/turnover units while historical mock fixtures retain their original defaults.

Exact prototype provenance admits only the immutable native source at `6aab8af781100c5156ee5126c36cad486fd35704` with its real parent, byte count and hash. Historical source records and generic unknown-edit/orphan/rollback denials remain intact. Historical mock wallet tests now use an explicitly pinned, hash-verified historical fixture instead of the current on-chain UI. Coverage mapping follows the actual sixteen style insertions without weakening byte/offset assertions.

## Focused validation

- 25 related checks passed: native strategy views and refusal of old local financial operations; provider parsing/cache/timeout/DST/invalid inputs; API Host/Origin/schema boundaries; fifteen-second browser polling, same-minute updates and failure recovery.
- Nine chart detail checks passed: four stock selection/source/render-observer cases and five PASS inspection cases. The new stock checks are included in the default test list.
- Exact source provenance/import checks: 48 passed. Historical mock wallet/fund checks: 12 passed. Source/coverage mapping checks: 14 passed. These retain historical expectations and negative admission cases; they are not current Testnet acceptance.
- Both TypeScript projects, scoped lint, formatting and production web build passed. Supply-chain inventory remains unchanged.
- Actual local desktop/mobile browser verification passed for TSLA and AMZN: original terminal containers, flat PASS reference, real Nasdaq stock data, automatic quote refetch, no wallet calls, no HTTP writes and no horizontal page overflow.
- Actual hover browser verification passed for four desktop/mobile TSLA/AMZN views: daily OHLC values and session dates match the live provider response; quote points omit OHLCV; ordinary product rerenders rebind the detail panel; mouse leave and outside touch remove it. Mobile touch can select the next point through the panel. Fifteen-second quote polling, zero HTTP writes and zero wallet calls were confirmed. Initial touch overlay/focus failures were fixed and the affected paths retested; screenshots and separate desktop/mobile reports are stored on the server.
- The historical qualified mock browser matrix was **NOT_RUN** for this update; its pinned historical semantics are not current native market browser coverage.
- Actual provider reads returned 251 daily records for each stock and changing TSLA/AMZN pre-market quote values. Source times and fetch times remain distinct.
- An authenticated production Google browser journey is **NOT_RUN**. Local browser evidence is not target-chain acceptance.

The earlier replacement-layout web publication was rolled back after the user requested preservation of the original UI. Its historical publication receipt remains unchanged; a separate rollback receipt records the restoration. The corrected release uses a new hashed original-template script and a new runtime release, retaining previous assets for rollback. Publication receipts are kept outside the repository on the server.

These changes do not deploy, fund or sign Testnet transactions. The corrected web reader remains `NOT_DEPLOYED`, without a manifest, RPC, signers or a production identity bridge. Required contract security admission remains unresolved and this PR stays draft. Testnet deployment and reserve configuration are separate from this website update.

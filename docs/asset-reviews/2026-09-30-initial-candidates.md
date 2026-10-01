# AlphaForge initial underlying-asset review notes

Reviewed: 2026-09-30 (Asia/Shanghai). Document reviewer: Macbeth01. This is a research/source review, not independent approval or a production enabled-asset manifest. The user approved issuer/exchange official-source manual review as the V1 classification method. The three assets below are exploratory samples, not a selected trading universe.

| Candidate | Official issuer evidence inspected | Classification review state | Enabled |
| --- | --- | --- | --- |
| MSFT | [Microsoft investor FAQ](https://www.microsoft.com/en-us/investor/faq) explicitly describes common shares trading on Nasdaq as MSFT | Common-stock and exchange statement found; remaining identity/source approval and oracle/venue qualification pending | false |
| NVDA | [NVIDIA investor FAQ](https://investor.nvidia.com/investor-resources/faqs/) describes its common-stock CUSIP and Nasdaq ticker NVDA | Source content inspected through web retrieval; direct raw-source capture returned 403, so the archive is incomplete | false |
| AAPL | [Apple investor FAQ](https://investor.apple.com/faq/default.aspx) identifies Nasdaq and ticker AAPL | Exchange statement found; obtain explicit current security-class evidence before accepting COMMON_STOCK. Direct raw-source capture returned 403 | false |

Official Robinhood Registry capture returned HTTP 200 with these ACTIVE mainnet deployments:

| Symbol | Asset ID | Chain | Canonical token address |
| --- | --- | --- | --- |
| MSFT | 0x00000000000000000000000000000000307bb0113ca54f93adf80f4ff2bf681a | 4663 | 0xe93237C50D904957Cf27E7B1133b510C669c2e74 |
| NVDA | 0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5 | 4663 | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC |
| AAPL | 0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649 | 4663 | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 |

Captured registry SHA-256: `00098c00bb461a2117e8b94fb491e961602a9ee162107fc692846ca85fec6415`.
Microsoft issuer HTML capture SHA-256: `bd9ec22291e1c7cb0bb9784b1a81ffb8cb5708830c743c99e614eb37067979cc`.

Local raw responses and exact UTC receipt times are in `.checks/market-data/uniswap-qualification-nassbv8q/registry.body`, `report.json`, `microsoft.html` and `issuer-sources.json`. Failed Apple/NVIDIA raw requests are saved as HTTP error bodies; their digests must never be presented as archived issuer content. The observed addresses above are research data, not runtime configuration. The registry observation is historical and must be refreshed before a future eligibility decision.

For every candidate, feed proxy mapping, feed health, canonical deployed code, Uniswap pools, executable quotes and fork execution remain unverified. Review expiry, operational freshness/grace limits and execution permissions have not been set. Therefore none can be loaded as an approved, enabled operational record. Preserve these notes when later adding a complete versioned review rather than rewriting this research state as a historical PASS.

## Additional selected-universe source inspection, 2026-09-30

The user subsequently selected MSFT, NVDA and AAPL for real-reference-price-mapped test substitutes. This changes their test-candidate status, not enabled trading-whitelist status; preserve the earlier exploratory findings above.

Apple’s [FY2025 Form 10-K, cover page](https://s2.q4cdn.com/470004039/files/doc_financials/2025/ar/_10-K-2025-As-Filed.pdf) was inspected through web PDF text and a cover-page screenshot. Its registered-securities table identifies AAPL as common stock on The Nasdaq Stock Market LLC. This adds issuer-filed historical classification evidence to the earlier FAQ finding; it is not a current review-expiry decision, a local raw-file archive, independent approval, or token/oracle/venue qualification. No whitelist entry is enabled.

Current official Uniswap V3 deployment guidance continues to require chain-specific address confirmation. The attempted Robinhood V3 chain-specific document did not load through the web tool in this inspection. No official 46630 router or pool was established and no address was substituted from 4663.

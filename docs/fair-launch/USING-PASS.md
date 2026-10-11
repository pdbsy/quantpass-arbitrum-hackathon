# Using PASS in the test market

Open the [app](https://www.ikol.top/alphaforge/) with your Robinhood Chain Testnet wallet (chain ID 46630).

1. Connect your wallet. If the primary action says **Start test session to continue**, review and sign the ownership message. Email verification is disabled during this test phase. Connecting a wallet alone reads balances; an ownership session enables account operations. Sessions expire after one hour and can be renewed without moving assets.
2. Mint TSLA PASS or buy AMZN PASS. Review the quote, approve the exact token amount if needed, then review a fresh quote and confirm the asset transaction. Token approval alone does not complete a purchase.
3. In **My Account**, choose **Use PASS** for the desired strategy. Create your own Vault and deposit AF-USDC. Depositing 10 AF-USDC locks 10 PASS. Purchasing those PASS and funding the Vault are separate payments.
4. Refresh the stock price and session. **Review invest available cash** uses the Vault's available tracked AF-USDC to purchase its fixed test stock. The owner reviews the exact amounts and signs the transaction. Funding a Vault does not automatically place a stock trade.
5. **Review sell stock holdings** sells tracked test stock back to AF-USDC inside the Vault. After the sale, withdraw eligible cash to your wallet. Unrealized gains are not withdrawable cash. Profit withdrawals retain locked PASS; principal withdrawals release corresponding PASS. Closing after settling positions releases all remaining capacity, including after a realized loss.

The owner can execute the fixed strategy directly; configuring a separate executor is optional. Stock trades use a 1% minimum-output tolerance in the UI and are restricted by the deployed contracts to verified regular US market sessions, fresh prices, the fixed stock route and actual reserve liquidity. Each review binds the Vault version and expiry. Pending transactions have a recovery journal; recovery verifies an existing hash and does not resend a trade.

## Current stock execution prerequisite

The deployed TSLA and AMZN stock reserves each contain 100,000 AF-USDC and 500,000 test stock units. A read on October 11, 2026 found that both reference feeds had never been initialized: price, observation timestamp and session metadata were zero. Their immutable feed keeper is `0x86767116cd40bf6b4f8cf88e08d11e38b04364cf`.

Until that keeper publishes verified prices and session metadata, stock investment and sale cannot execute. Cash deposits, permitted cash withdrawals and PASS locking remain available. The page displays **UNINITIALIZED**, **MARKET CLOSED**, stale-data or paused status instead of inventing a price or a return.

The existing `npm run fair-launch:stock-reference -- VERIFIED_MANIFEST.json HTTPS_RPC PRIVATE_DATA_CREDENTIALS.json TSLA NEW_OUTPUT.json` command prepares unsigned updates from Alpaca clock, calendar and IEX data. It does not sign or broadcast. The credential file must have private permissions; do not commit credentials. Updates must be signed by the actual feed keeper and included while their observation is fresh. An initial update is insufficient for sustained trading: price and calendar observations must remain at most 60 seconds old. A continuously signing keeper is not configured in the current runtime. Changing the immutable keeper requires a separately reviewed deployment.

The chart's stock reference API is for display and is not used for Vault settlement. Historical closing prices cannot initialize a fresh execution feed during a weekend. Tests of stock execution in a local EVM or controlled fixture do not establish that real Testnet stock execution has completed.

These two All-in strategies and their stock units are engineering tests. The developer is not a professional quantitative researcher. AF-USDC and native test ETH have no promised real-money value; the platform does not trade real shares or guarantee returns.

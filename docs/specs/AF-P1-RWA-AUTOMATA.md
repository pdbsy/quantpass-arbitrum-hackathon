# AlphaForge RWA automata phase one

Status: local implementation completed; final source-bound validation and external acceptance tracked separately. User assigned implementation on 2026-09-29.

Approved: Robinhood Stock Tokens first; synthetic fixtures only; threshold rebalance bot; quote-driven spot swap simulator; existing local Vault and allocated capital; built-in bot UI. No real token address, RPC, wallet, signing or broadcast is introduced. No worker delegation.

Stop means immediately latch whole-run liquidation. Percentage limits use cash-flow-adjusted whole-portfolio unit return relative to the starting unit NAV. Price limits use a specified token's executable sell quote. Either limit liquidates the whole run, never other Vaults or idle balances. Limits are inclusive. Liquidation does not unlatch when prices recover; partial fills and failures retain outstanding positions and explicit reasons. Only zero holdings and no pending execution permits stopped. No automatic restart or withdrawal.

Confirmed follow-up: allocated capital can change during a run. Contributions come from existing idle balance and obey Pass allowance. Withdrawals return only available Bot cash to idle balance; excess requests fail without selling holdings. Exact rational units preserve unit NAV through both flows, including complete cash withdrawal and later refill. Liquidating/stopped runs do not accept capital changes; stopped settlement cash is released through the existing Vault command.

All units are exact integers; fixtures clearly identify synthetic assets rather than impersonating official deployed tokens. Every run binds engine version, immutable parameters and dataset digest. Replay uses a virtual clock and only observed quotes. No historical result represents investable performance.

First venue executes synchronously inside one local database transaction. It can partially fill or reject an intent, but does not create unknown external submissions. Future asynchronous adapters require explicit reconciliation before enabling that capability.

Deliverables: deterministic engine, synthetic data replay, rebalance bot, independent liquidation supervisor, local Vault funding integration, SQLite restart recovery, API and product entry, behavioral tests and source-bound evidence. Self-review is not independent approval; hosted checks remain NOT_RUN until actually executed.

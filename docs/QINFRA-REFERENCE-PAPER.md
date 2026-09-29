# AlphaForge one-minute reference paper trading

## Confirmed first-run policy

MSFT, NVDA and AAPL use sampled one-minute closes and the existing Apache-2.0 QuantConnect-derived EMA 15/30 with its original 15 bps entry hysteresis. Each asset may use at most one third of current virtual NAV, inclusive of entry fees. Inactive signals keep cash. Price appreciation or cash withdrawal can make an existing position overweight; this blocks additional buying without an automatic sale.

The owner confirmed 1,000 virtual AF-USDC, manual stop liquidation initially, a 30 bps simulated fee, and 10 bps adverse simulated slippage. Buy uses the reference ask; sell uses the reference bid. These are configurable research assumptions, not observed Uniswap fees, executable pool prices or actual trading costs. Virtual AF-USDC is valued at one USD by construction; this is not verification of a deployed settlement token's peg.

Collection waits 5 seconds after each completed round. Quote age is limited to 30 seconds and cross-source generation skew to 10 seconds. Network time makes the observed sampling interval longer than 5 seconds. The most recent sample inside a minute must be at most 30 seconds from its end for every asset.

The source chain/address identities in the examples are canonical chain 4663 REST reference identities. They do not request Mainnet RPC or grant trading authority. Testnet execution is separately chain 46630 and requires its own qualified test token, pool and router addresses. No execution address is enabled here.

## Implemented boundary

This increment is a separate REFERENCE_PAPER virtual account, not a Vault deposit, PASS lock, wallet authorization, authenticated public performance track record or onchain order.

- Minute closure waits until the slowest source clock crosses the minute end. Closing samples come only from within that minute. Subsequent accepted reference quotes price simulated fills; the candle close is not used as an immediately executable quote.
- Identical quote generation times and prices do not add periods. Conflicting prices at the same time, regressions, changed asset IDs or multipliers reject the input diagnostically. Corporate-action transitions require new reviewed data handling; they are not silently applied to a warmed strategy.
- Missing or inadequate minutes produce compact gap events. The confirmed retain policy keeps prior EMA state and skips the gap without forward-filled prices. The optional explicit reset policy is supported but not selected in the example.
- EMA seeds at 15 and 30 valid closes, then uses the original integer recurrence with bounded state. The old synthetic simulator's history/sequence limits remain unchanged.
- Cash uses 6 decimal raw units, quantities and USD prices use 18. Cash value is quantity18 × priceUsd18 ÷ 10^30. Purchases and fees round upward; sale proceeds and mark values round downward. A binary search enforces one third using exact integers and prospective NAV including costs.
- Fills update cash, quantity, cost basis, accumulated fees and realized PnL. A failed order cannot partially debit cash or leave an unrecorded holding. Positions too small to settle remain tracked; they are never silently erased to complete a stop.
- Exact rational unit values separate external virtual cash flows from returns. Withdrawals use cash only and report the maximum available amount on insufficient cash. Fresh holdings valuations are required for funding. Full cash exit retains prior unit value for a later deposit; zero equity with outstanding units cannot be reset by adding money.
- Manual stop latches immediately. Fresh quotes permit liquidation; unavailable quotes keep liquidation pending and forbid new buying. Percentage unit-return and identity-bound USD price upper/lower limits are implemented, checked on accepted batches and after transaction costs. They are disabled in the confirmed first-run example.
- The public-facing virtual unit-return metric and personal virtual net contribution/cost basis/PnL are separate fields. No virtual metric is published as verified real or Mainnet strategy performance.

## Durability and consumption

BatchJournal adds a read-only reader with ordered, verified entries and canonical uncompressed-payload hashes. New batch rows are stored as AFG1 gzip/base64 without dropping any original receipt text. Decode is bounded to 48 MiB and rejects corrupt/oversized expansion. New readers also read historical plain-JSON rows; old collector readers are not compatible with newly compressed rows. Existing evidence rows are not rewritten. SQLite read-only mode forbids data/schema updates but may use WAL coordination sidecars; it is not a promise of zero filesystem metadata writes.

PaperJournal is a separate SQLite application with immutable configuration/source anchor metadata and append-only, hash-linked transitions. Each transition atomically contains its input reference or control, full resulting bounded strategy/account state and events. On opening it replays all transitions using the original verified batches and compares the result, detecting fabricated balances even when an outer checksum is refreshed.

Cursor advances exactly once only on committed inputs, including rejected diagnostic rows. Concurrent writers must match the recorded revision; failed persistence rolls back and preserves the cached state. The consumer refreshes appended cash/stop controls before further work, and retries a revision conflict using the refreshed state. Controls and market inputs are serialized by ledger revision. Inputs captured before a newer control are consumed as PAPER_INPUT_BEFORE_CONTROL diagnostics, without rewinding state or placing historical orders.

Use one continuous consumer per ledger. A separate short-lived control command can add/withdraw virtual cash or request stop. SIGINT/SIGTERM cancels the consumer and exits 130/143; cancelling a process is distinct from the explicit stop command that latches portfolio liquidation. Stop cannot guarantee settlement when the provider has stopped producing valid quotes.

Restart retains the same source database, configuration and paper ledger. A changed source anchor, cost model or liquidation policy is rejected; start a new explicitly configured research account rather than editing history. State is bounded; full evidence history is not. Archive/retention, disk quotas, supervisor, automatic recovery after process failure and long-duration operational acceptance are not delivered.

## Commands

Run in an isolated checkout using the approved toolchain. Create a dedicated data directory. The checked-in collection example is a bounded 16-round research run with a one-rejection shutdown guard; it is not an unattended service policy.

```text
node tools/automata/collect-portfolio-market.ts docs/examples/reference-paper-collection.json SOURCE_DB
node tools/automata/reference-paper.ts run docs/examples/reference-paper.json SOURCE_DB PAPER_DB 16 1000
node tools/automata/reference-paper.ts status docs/examples/reference-paper.json SOURCE_DB PAPER_DB
node tools/automata/reference-paper.ts fund-in docs/examples/reference-paper.json SOURCE_DB PAPER_DB 100000000
node tools/automata/reference-paper.ts fund-out docs/examples/reference-paper.json SOURCE_DB PAPER_DB 100000000
node tools/automata/reference-paper.ts stop docs/examples/reference-paper.json SOURCE_DB PAPER_DB
```

Start the consumer after the source has its first immutable batch. In bounded mode, if collection stops early, pass the actual new-row count, not the originally planned count; otherwise the consumer intentionally waits. Explicit continuous consumer mode replaces the count with continuous. An independently configured collector can use maxBatches: null and an explicit positive rejection limit. No supervisor is installed and no background service is enabled by these examples.

POLL_MS controls how often an idle consumer checks its local database; it does not change the chosen one-minute strategy or source sampling policy. Amounts are AF-USDC raw units: 100000000 means 100 virtual AF-USDC. Invalid arguments fail before creating a paper ledger. Run summaries distinguish processed, accepted, rejected and simulated-fill counts. COMPLETED means the explicit input count was consumed; a bounded CLI run with any rejected input exits 1, not a successful-market-quality claim. Status marks current NAV/return unavailable when holdings prices have expired; the saved snapshot is historical.

The source and paper database must remain available together for deterministic replay. These commands have no executor key, wallet connection, signing or broadcast capability. They are not exposed in the current web demo; page acceptance is not claimed.

## Validation observations

Behavior tests cover causal minutes, long gaps, repeated/conflicting quotes, 160 closed minutes, exact purchase/sale money, one-third entry costs, runtime cash controls, preserved unit return, manual/percentage/price liquidation, cost-triggered stop, stale valuations, immutable real-SQLite restart, rollback, optimistic conflicts, forged results, CLI preflight and bounded compression. The actual management manifest and generated snapshot bind applicable check results to the source commit; self-review is not independent review or hosted CI.

A bounded live official-REST probe in .checks/market-data/reference-paper-live-Kd2Ur3/ captured 4 rounds: 3 ACCEPTED and 1 REJECTED. The last round had 13,962 ms quote skew, exceeding the confirmed 10,000 ms bound, so the configured one-rejection guard stopped collection. The virtual consumer persisted all four inputs and reopened deterministically with 1,000 virtual AF-USDC, zero closed minutes and zero fills. No complete minute or 30-valid-minute live warmup was accepted in that short probe. This is input/diagnostic/restart evidence, not end-to-end live strategy acceptance.

The first raw batch occupied 1,080,532 bytes; gzip was 119,496 bytes before base64 overhead. This observed reduction does not make history storage bounded. The four original probe rows remain in their original plain-JSON encoding.

## Remaining execution work

Live warmup and prolonged collection/recovery acceptance remain outstanding. Uniswap V3 execution still requires qualified protocol artifacts/router ABI, three distinct Testnet pools and deployment evidence, liquidity/fees, explicit owner-bound spend/slippage/expiry/liquidation permissions, signing/broadcast authorization and receipt/position reconciliation. Neither this paper account nor canonical REST membership enables the underlying whitelist or any chain order.

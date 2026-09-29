# AlphaForge three-asset market input

## Confirmed scope

The user selected option 3: AF-USDC / test MSFT, AF-USDC / test NVDA and AF-USDC / test AAPL, each a fixed direct Uniswap V3 pair on Robinhood Chain Testnet. The user also confirmed reusing the existing open-source dual-EMA strategy. Portfolio weights and candle interval remain pending. Pool fee, initial liquidity, router/deployment, spend/slippage/expiry/liquidation limits and public broadcast are not configured.

This increment supplies complete reference batches, their dedicated durable journal and a continuous collection CLI. It does not run the EMA, create paper fills, submit V3 orders or enable any underlying whitelist record.

## Batch contract

- Configuration explicitly supplies 1..3 selections on one source chain, maxAgeMs, maxQuoteSkewMs and maxCaptureSpanMs. Canonical chain/address identity is required; duplicate identities/symbols and extra fields are rejected before network work.
- Each selection reuses registry → quote → registry capture, concurrently with the other selections. A three-asset round makes up to nine fixed official HTTPS GETs; this is a completion-relative poller, not an exchange tick feed.
- Every selected member must be accepted. Quote age is rechecked at batch completion; generated timestamps must remain within the explicit cross-asset skew limit and receipts within the recorded capture window. A complete round is temporally bounded, not an atomic provider snapshot.
- Any halted, missing, stale, future, excessively skewed or rejected member makes the whole round unavailable. REJECTED always exposes observations: null; its complete or partial receipts remain diagnostic evidence.
- External cancellation and the explicit batch deadline interrupt even uncooperative transports at the caller boundary. HTTP 401/403 terminates collection without retries or bypass.
- Accepted projections are recomputed from original receipts on journal append and read. Refreshed outer hashes cannot legitimize fabricated prices. Checksums verify consistency, not independent source authenticity.

## Persistence and runtime

BatchJournal stores an entire round in one immutable SQLite row, including all member receipts. SQLite insert failure leaves no partial row or committed-progress count. IDs remain stable across process restarts. Its application identity differs from MarketJournal and the Vault ledger; unrelated databases, unsafe links and linked parents are refused. The existing single-reference database format remains unchanged.

The continuous worker adds explicit intervalMs, maxBatches (positive or null) and maxConsecutiveRejections. An accepted complete round resets the rejection streak. Collection waits after completion and persistence, without catch-up bursts. The CLI closes on SIGINT/SIGTERM, returns 130/143 and retains an interrupted diagnostic if the attempt had begun. Invalid input exits 2 before database or network work. Other rejected/failed runs exit 1; only a completed bounded run containing no rejected rounds exits 0.

```text
node tools/automata/collect-portfolio-market.ts --help
node tools/automata/collect-portfolio-market.ts explicit-policy.json batches.sqlite
```

Input is bounded regular-file UTF-8 JSON, with no final symlink, FIFO or device. The worker needs no executor credentials and uses no RPC. One active writer per dedicated database remains an operator requirement; supervisor, lease, retention and automatic restart are not delivered. Repeated quote timestamps are separate evidence captures, not fresh market periods. Consumers must deduplicate and form verified complete candles before driving the chosen EMA.

Reference identities may be canonical chain 4663 identities fetched through official REST. They do not request Mainnet RPC, constitute Testnet canonical deployments or grant trade eligibility. Each test token needs a separate 46630 execution identity and explicit substitution mapping. V3 pool quotes and test fills will be recorded separately from source equity references and paper performance.

## Bounded live research result

A single three-asset research round queried official reference endpoints and persisted batch ID 1 in .checks/market-data/three-asset-live-HMnIw9/. All three individual captures were accepted. At round completion, their ages were MSFT 14,360 ms, NVDA 10,831 ms and AAPL 9,265 ms; quote generation skew was 5,095 ms and elapsed capture time 2,524 ms.

The explicit research policy allowed 30,000 ms age, 5,000 ms skew and 30,000 ms capture span. Therefore the round correctly remained REJECTED with BATCH_QUOTE_SKEW and no usable observations. The CLI returned 1 and the planned subsequent live restart probe was not performed. Original receipts, policy, output and report are preserved. These research values are not strategy defaults and were not relaxed to manufacture a passing result. Offline real-SQLite restart and replay tests cover the implemented restart contract.

## Remaining trading delivery

The next paper slice requires durable capital/fill/checkpoint events, a confirmed candle/weight policy, fees/slippage, cashflow-neutral NAV and separate public strategy versus personal performance. It must not silently carry forward absent prices or drive EMA from duplicate polls. The old synthetic limits remain until their replacement is verified.

V3 execution requires qualified protocol artifacts/router ABI, separate token/pool deployment evidence, owner-bound grants, quote-to-fill bounds, expiry/liquidation enforcement and receipt/position reconciliation. No public test deployment, approval transaction, restricted execution key or actual order has been created. New publication, merge and broadcast are separately gated; self-review and local test results do not constitute independent or hosted CI approval.

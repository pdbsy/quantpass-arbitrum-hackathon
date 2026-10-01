# AlphaForge continuous reference collection

## Delivered scope

The market-input worker calls the existing official registry → quote → registry collector repeatedly and commits each completed attempt to its own append-only MarketJournal. It accepts one canonical reference selection per process; use separate database files for separate active workers. It does not allocate Vault capital, run strategies, create paper fills, authorize an executor or submit orders.

Every configuration field is explicit: canonical `selection`, `maxAgeMs`, `intervalMs`, `maxCaptures`, and `maxConsecutiveRejections`. No operational sampling or stale-price policy is silently selected. The interval is measured after capture/append completion, so delayed providers do not cause catch-up bursts. `maxCaptures: null` explicitly requests collection until cancellation or a rejection limit; a positive integer requests a bounded run.

Each accepted capture is recomputed from its source receipts by the journal. Rejected captures are retained, count toward the configured consecutive rejection limit, and never become accepted prices. An accepted sample resets that counter. HTTP 401/403 stops immediately regardless of that limit. Journal failure stops without counting uncommitted progress. COMPLETED describes a completed capture-count request, not proof that every capture was accepted; the CLI exits nonzero if any capture was rejected.

SIGINT/SIGTERM interrupts waiting or active requests, records a completed cancellation diagnostic when the attempt had started, and closes the journal. Per-request fetch/body reads have a ten-second deadline and the entire capture has a thirty-second deadline. Injected uncooperative transports are cut off at the caller boundary; production fetch also receives the AbortSignal. A second process must not use an active worker's database. This slice does not introduce a process supervisor, single-writer lease, disk-retention policy or automatic restart daemon.

## Command

```text
node tools/automata/collect-market.ts --help
node tools/automata/collect-market.ts explicit-policy.json observations.sqlite
```

Use the pinned Node version. Input must be a regular file without a final symlink, is bounded to 128 KiB, and must parse as UTF-8 JSON and must include all policy fields; invalid configuration is rejected before opening the database or making requests. The existing journal rejects unrelated databases and unsafe data-file links/parents. Exit codes: 0 for a bounded run containing only accepted captures; 1 for rejection, persistence failure or unavailable journal; 2 for invalid input; 130/143 for SIGINT/SIGTERM.

The following is a three-sample research smoke-test configuration, not a selected trading asset or production Bot policy:

```json
{
  "selection": {
    "chainId": 4663,
    "contractAddress": "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    "symbol": "AAPL"
  },
  "maxAgeMs": 30000,
  "intervalMs": 1000,
  "maxCaptures": 3,
  "maxConsecutiveRejections": 1
}
```

That chain/address identifies the canonical source of offchain reference prices. It does not connect to a Mainnet RPC or perform Mainnet transactions. An AlphaForge Testnet substitute needs its own execution identity, separately recorded mapping and explicit labels; never overwrite the source identity with a test address. Registry membership remains insufficient for trading-whitelist admission.

## Recovery and consumer contract

Restart with the same inactive journal to append new SQLite IDs without replacing earlier evidence. `MarketJournal.read(id)` validates saved receipts and recomputes accepted observations. A future paper worker can persist its last processed ID and resume consuming from that durable input; atomic paper-ledger/checkpoint integration is not implemented here.

Repeated polls can return the same quote timestamp. Each is a separate evidence capture, not a guaranteed distinct market tick. Consumers must deduplicate appropriately; sampling does not manufacture missing historical prices or certify tick-complete history. Multi-asset synchronized observations, fees/slippage, performance attribution and real orders remain separate work.

## Testnet qualification

The locally configured Alchemy Testnet endpoint has passed chain ID 46630, block consistency and canonical-hash RPC-method probes. The observed official Stock Token registry lists only 4663 deployments; no official 46630 Stock Token or Uniswap mapping has been verified. See [Uniswap scope](QINFRA-UNISWAP-SCOPE.md) for the confirmed V3 single-pool scope and unresolved deployment choices. Those findings do not block building the approved real-reference-price-mapped test substitutes and do not enable a real asset.

CI and the behavior tests use offline fixtures. Actual provider probes and research runs remain separately saved local evidence. Self-review is not independent approval; no hosted CI, public deployment or transaction is claimed by this document.


## Bounded live research result, 2026-09-30

The explicit three-sample AAPL reference smoke run completed with three accepted captures and no rejected captures. The journal was then reopened, all three prior captures were recomputed, and a one-sample restarted worker appended ID 4 successfully. Original configuration, receipts and restart result are retained in `.checks/market-data/continuous-live-1Pe4Ws/`. This was a bounded research run; no persistent daemon, trading whitelist entry, paper order or Testnet deployment was created.

# Phase 1 Robinhood Chain Testnet Smoke Procedure

Status: **PREPARED / NOT RUN**
Network target: Robinhood Chain Testnet, chain ID `46630`
Current repository state: Local / Mock / NOT_DEPLOYED

This procedure prepares evidence without authorizing deployment, signing, initialization, or transaction broadcast. Stop at the explicit authorization gate.

## Required immutable inputs

Before any external-chain step, record and review:

- exact repository source commit and clean tree;
- locked tool versions and successful local checks;
- Macbeth02 deployment handoff commit;
- canonical Vault and StrategyPass ABI JSON and Keccak-256 hashes;
- compiled and deployed Vault/StrategyPass runtime bytecode and Keccak-256 hashes;
- deployment manifest digest, chain ID, Vault and StrategyPass addresses, and both deployment blocks;
- explicit immutable Owner, strategy creator, strategy ID/ref, StrategyPass, AF-USDC, AF-ETH, and AF-BTC addresses;
- StrategyPass fixed supply and initial recipient;
- approved RPC endpoint supplied outside the repository and browser bundle;
- separate authorization identifying who may deploy, sign, initialize, or broadcast.

Any null, zero, unreviewed, or contradictory value stops the procedure.

## Non-broadcast preparation

1. Run the environment admission check under Node 24.21.0 and retain its JSON result.
2. Run the full local contract and application gates required by the final candidate. Preserve failures and NOT_RUN results.
3. Recompute canonical ABI and runtime Keccak-256 hashes from the exact compiled artifact; compare them to the manifest.
4. Validate the manifest strict field set, digest, network `robinhood-chain-testnet`, chain `46630`, distinct nonzero Vault/StrategyPass addresses, both deployment blocks, both ABI hashes, and both deployed runtime bytecode hashes.
5. Prepare read-only RPC requests for `eth_chainId`, `eth_getCode`, block lookup, logs, receipts, and `eth_call`. Do not configure a signing method.
6. For each selected Vault, read at one canonical block: Owner, strategy creator, strategy ID/ref, Pass, asset addresses, PassLocker, accounting values, tracked positions, and closed state. Read `StrategyPass.strategyId()`, `decimals()`, and relevant `balanceOf` values; require the same nonzero strategy ID and exactly 18 decimals.
7. For deposit preparation, compute AF-USDC base units without decimal rounding, calculate `passRaw = usdcRaw * 10^12`, and read both allowances with the selected Vault as fixed spender.
8. Build the exact zero-value calldata for the intended owner action and run `eth_call` simulation from the selected Owner. Recheck wallet account and chain after simulation.
9. Record the expected Vault or StrategyPass event topic, indexed Owner/sender/recipient/token fields, exact raw amount fields, contract views, confirmation depth 3, and reorg recovery limit 128.

## Authorization gate

Without separate written deployment/signing/broadcast authorization, stop here. The prepared transaction must not be passed to `eth_sendTransaction`, a signer, deployment script, wallet confirmation, or broadcast tool.

`SUBMISSION_AMBIGUOUS` is non-retryable. If a later authorized wallet flow begins submission but cannot determine whether a transaction was accepted, do not resend automatically. Recover account/chain session and query wallet/provider history for the original tx hash.

## Evidence for a later authorized write

If authorization is later granted, each operation record must include:

- source commit/tree and reviewed manifest digest;
- wallet address, chain ID, target, zero native value, calldata, and fixed spender/amount where applicable;
- wallet simulation result and user confirmation;
- tx hash without treating it as success;
- receipt status, target, sender, block number/hash, transaction index, and logs;
- expected event identity and decoded values;
- canonical contract views at the receipt block;
- confirmation count, checkpoint height/hash, reconciliation result, projection identity, and product readiness;
- any replacement, drop, reorg, RPC failure, or manual recovery evidence.

The first real Testnet smoke remains `NOT_RUN` until those inputs and authorizations exist.

# Phase 1 Macbeth04 Chain API Handoff

Status: implementation-ready interface handoff; product consumption remains owned by Macbeth04. Runtime is still Local / Mock / NOT_DEPLOYED.

## Trusted deployment input

The browser and backend must consume one allowlisted deployment record per Vault with:

- network `robinhood-chain-testnet` and chain ID `46630`;
- nonzero Vault contract and deployment block;
- ABI version `m3-vault-db620d6`;
- ABI Keccak-256 `0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977`;
- reviewed runtime bytecode Keccak-256;
- nonzero StrategyPass contract and deployment block;
- StrategyPass ABI Keccak-256 `0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f` from source commit `2ad816200e7edfbfad96d765b4a696bc8b838c2d` and evidence head `a13052993b6f408b7be835ecd6f4b13ef6df367d`;
- reviewed deployed StrategyPass runtime bytecode Keccak-256;
- manifest digest covering every field.

Product strategy labels never replace this identity. The selected strategy must resolve to one reviewed Vault manifest, and live reads must verify that Vault's strategy ID and StrategyPass identity.

Multiple Owner/Vault records for the same strategy may bind the same StrategyPass. Every Vault address and chain database remains unique. Repeated `(chainId, StrategyPass)` entries must agree on the Pass deployment block, ABI hash, and deployed runtime bytecode hash or startup fails closed with `M3_SHARED_STRATEGY_PASS_IDENTITY_CONFLICT`. The runtime whose Vault address sorts first owns that shared Pass's synchronization, projection storage, operation registration, and Pass routes; the other Vault runtimes still verify Pass bytecode and their own `Vault.pass()` / `Vault.strategyId()` binding at the canonical block.

## Backend routes

| Method and path                                                  | Purpose                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/chain/runtime-status`                               | One runtime returns its status directly; multiple runtimes return `{ runtimes: [...] }`.                               |
| `GET /api/v1/chain/runtime-status/:contract`                     | Status for the exact configured Vault or StrategyPass contract.                                                        |
| `GET /api/v1/chain/vaults/:contract/:owner`                      | Canonical projection for one selected Vault and wallet.                                                                |
| `GET /api/v1/chain/passes/:contract/:owner`                      | Canonical `strategyId`, decimals, and exact raw balance for one manifest-bound StrategyPass and wallet.                |
| `GET /api/v1/chain/vaults/:owner`                                | Compatibility route for a one-Vault server only; multi-Vault servers reject it as `INVALID_REQUEST`.                   |
| `POST /api/v1/chain/operations`                                  | Register a concrete wallet tx hash for independent backend tracking. Target and chain must match a configured runtime. |
| `GET /api/v1/chain/operations/:operationId/evidence?owner=0x...` | Server-computed receipt/event/view/projection evidence.                                                                |

For a shared Pass, the Pass-qualified status, balance, submission, and evidence routes resolve to its single deterministic owner runtime. Vault-qualified routes and Owner exit operations continue to resolve to each selected Vault's independent runtime and SQLite file.

The backend registration body is exactly:

```json
{
  "operationId": "client-generated-stable-id",
  "chainId": 46630,
  "owner": "0x...",
  "target": "0x-configured-vault-or-strategy-pass",
  "calldata": "0x...",
  "txHash": "0x..."
}
```

Do not send client-computed state, success, receipt, confirmation, projection, account identity, or strategy labels. The backend rejects extra authority fields.

## Pass allocation and transfer

Initial Pass allocation is a deployment action, not a recurring product mint:

```text
StrategyPass(name_, symbol_, strategyId_, fixedSupply_, recipient_)
```

The constructor is the only mint path. Until deployment is authorized and the fixed supply/recipient are recorded in the trusted handoff, show this capability as NOT_DEPLOYED. Do not add a faucet, admin mint, initial sale, price, Buy/Sell, AMM, matching, or fee behavior.

Ordinary Pass transfer uses inherited ERC-20:

```text
transfer(address recipient, uint256 passRaw)
selector 0xa9059cbb
```

`passRaw` is an exact positive unsigned 18-decimal base-unit integer. Ordinary transfer permits the full 18-decimal precision; the `10^12` divisibility rule applies only when converting Pass capacity back to AF-USDC principal units. The backend accepts the transfer only for the manifest-bound StrategyPass and a nonzero recipient, verifies deployed code before indexing, reconciles one exact `Transfer` event, and reads sender/recipient balances at the canonical receipt block. It does not infer a price, fee, capacity trade, or new authority.

## Vault selection and live rights

Selection key is `(chainId, vaultContract)`. After selection, read the immutable Owner, strategy ID, Pass, and asset addresses directly from that Vault at one canonical block. Require:

- wallet chain `46630`;
- connected account equals immutable Vault Owner for owner-only actions;
- `Vault.strategyId() == StrategyPass.strategyId()`;
- provider account/chain unchanged after reads and simulation;
- exact contract-qualified backend route.

Two selected Vaults may therefore expose the same Pass and strategy ID while retaining different immutable Owners, PassLockers, accounting state, and owner-only operation histories. A shared Pass balance is keyed by holder address and is not treated as Vault ownership.

An AlphaForge account, demo cookie, strategy card, URL label, or client body never grants authority.

## Approvals and owner actions

Deposit for `usdcRaw` requires two finite approvals to the selected Vault:

- AF-USDC approval amount `usdcRaw`;
- StrategyPass approval amount `usdcRaw * 10^12`.

Do not approve an arbitrary spender or default to unlimited allowance. Re-read token identities and allowances from the selected Vault before review.

Supported owner calldata is:

| Action                                | Selector     | Rule                                                                          |
| ------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| `deposit(uint256 usdcRaw)`            | `0xb6b55f25` | Active Vault, positive AF-USDC raw units, both exact approvals                |
| `withdraw(uint256 usdcRaw)`           | `0x2e1a7d4d` | Active Vault, profit-first rules and tracked-position constraints             |
| `close()`                             | `0x43d726d6` | Active Vault; releases remaining accounted Pass and USDC under contract rules |
| `rescueUntrackedToken(address token)` | `0x45f5030f` | Owner-only after close; selected token must have unreserved excess            |
| `rescueNative()`                      | `0xfc82f084` | Owner-only after close; rescues native excess                                 |

Every prepared action has target equal to the selected Vault and native value zero. Rescue remains available after close even though deposit/withdraw/close and their approvals are disabled.

## Submission outcomes

- Wallet rejection: explicit rejected state; no tx hash and no backend registration.
- Concrete tx hash: register once as `SUBMITTED`; it is not confirmed.
- Disconnect/account/chain change or provider failure after submission begins: `SUBMISSION_AMBIGUOUS`, non-retryable, no automatic resend.
- Duplicate callback with the same operation/tx/calldata identity: idempotent.
- Conflicting callback: display conflict and require a fresh canonical read.
- Backend/indexer degraded: never show cached READY. Preserve withdraw/close only when direct live Owner and contract simulation independently succeed.

The UI should display submitted, mined/confirming, confirmed, reverted, replaced, dropped, reorged, and reconciliation-failed states from the canonical evidence response rather than raw provider objects.

## Current dependencies

- Macbeth02/01: concrete deployed StrategyPass address, deployment block, and deployed runtime hash for the final manifest.
- Macbeth04: product controls and browser validation in `apps/web/**`.
- Macbeth01: shared deployment configuration and final integration.
- Testnet signing/broadcast: separate user authorization; currently NOT_RUN.

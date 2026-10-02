# AlphaForge Testnet Preparation

Assigned to Macbeth01 by the current user on 2026-10-01. Prepare the project for a later Dots-operated server deployment and Robinhood Chain Testnet test, excluding strategy encryption. The user explicitly authorizes a gated merge to master after verification. This assignment does not authorize this agent to deploy a server, use keys, sign, broadcast, change live account funding or enable mainnet. Do not start additional workers.

## Product scope and fixed decisions

- Robinhood Chain Testnet 46630; future mainnet compatibility uses separate identities and deployment evidence.
- Three explicitly labeled test substitutes referencing MSFT, NVDA and AAPL; AF-USDC has 6 decimals, PASS has 18; conversion is exactly `passRaw = usdcRaw * 10^12`.
- Real-reference capture and one-minute EMA 15/30; each position may use at most one third of runtime equity including costs. Missing minutes retain indicators without fabricated prices; an overweight holding blocks new buys and waits for strategy exit.
- Platform-managed restricted executor; immutable Vault owner retains custody and withdrawal authority. No owner private key is handed to the platform.
- Runtime capital additions and cash-only withdrawals; insufficient cash must not trigger an unrequested sale. Vault withdrawals realize profit first; only exited principal unlocks PASS. Tracked positions block principal withdrawal; full loss close still releases all remaining PASS after liquidation.
- Owner stop and configured percentage/price limits latch liquidation immediately; unavailable prices or liquidity retain the blocked state and holdings rather than claiming completion.
- Expiry enters an explicitly preauthorized liquidation interval. Numeric spend, slippage, duration, oracle-age and liquidation limits must be provided by the owner/operator, never inferred from paper assumptions.
- Official-token Whitelist V1 and test-substitute mappings remain separate. Test fills and PnL are never published as mainnet performance.
- Preserve original phase-one Vault ABI, authors, source refs, successful and failed reports, and the original 24-hour soak. New contracts and evidence get distinct identities.
- Node 24.21.0, npm 11.19.1, Python 3.12.9, Forge 1.5.1, solc 0.8.31 and existing qualified tools remain fixed unless the user approves a reviewed change.

## Confirmed implementation choices

The user approved SwapRouter02 exactInputSingle, all three pools at fee 3000 (0.3%), and public HTTPS access with wallet login. Public mode is a dedicated server/profile and must not expose local Alice/Bob impersonation. The read-only loopback profile remains separately available. The user approved ethers 6.17.0 and the exact reviewed locked dependency graph on 2026-10-01.

The user confirmed deployer-created independent Vaults for explicitly confirmed test owner addresses; public self-service creation is outside this cohort. The user subsequently confirmed official bid/ask midpoint reference valuation, with one test token corresponding to one official Stock Token unit: midpoint multiplied by the current corporate-action multiplier. A pending or changed multiplier pauses execution until a separately reviewed mapping is supplied. Actual V3 pool quotes and fills remain separate evidence; a midpoint never becomes a fabricated execution. The user confirmed that pool/reference price divergence beyond the owner-authorized slippage pauses execution; no funded price-adjustment service is introduced. First public testing covers trading and performance. Builder sales, rent, performance fees and buybacks remain explicitly labeled simulation rather than Testnet onchain commercial settlement.

The user approved a finding-specific Slither review workflow: retain every raw finding and report, record rationale and attack tests, and admit only concrete findings subsequently confirmed by the user. The user additionally confirmed the exact nine Testnet-only findings recorded in AF-TESTNET-SLITHER-REVIEW.md through 2026-11-01. This does not approve any new finding. New, changed, expired or unreviewed findings continue to block. No detector is suppressed and no required gate is removed.

Additional third-party wallet/Uniswap dependencies require an exact reviewed release, artifact digest, license disposition and existing supply-chain/advisory gates. Do not install rolling versions or silently admit an excluded license.

## Deliverables and evidence boundary

1. Strict operator-controlled Testnet configuration loading and admission, separate application/index databases, no embedded RPC secrets, and source/deployment/hash identity checks.
2. Three-asset custody, owner-granted restricted trading, stop/expiry liquidation, exact PASS accounting and tests against the selected V3 protocol behavior.
3. Durable order preparation/submission identity, restart recovery, ambiguity handling, canonical receipt/fill/position reconciliation and truthful test performance.
4. Wallet pages and the selected server access model, with demo and real-chain evidence visibly separated.
5. Dots handoff: release/build inputs, server configuration, secrets placement, deployment/initialization worksheets, diagnostics, backup/restore, rollback and operational smoke acceptance. No automatic deployment or key provisioning in bootstrap/CI.
6. Fresh source C/report R/snapshot S, all applicable local/security/contract/hosted checks, protected merge and actual-master validation. Missing real-chain/fork/independent-review results remain BLOCKED or NOT_RUN.

Preparation completion is distinct from public-chain deployment and live functional acceptance. The latter will be performed by Dots only after the required operational inputs and authorizations are available.

首轮 Vault owner 仅限普通 EOA 钱包，智能合约钱包后续适配。链上快照拒绝带代码的 owner（包括委托代码账户）；ERC-1271 登录能力不构成交易支持。池价超出 owner 授权滑点时暂停成交，不启动调价服务。

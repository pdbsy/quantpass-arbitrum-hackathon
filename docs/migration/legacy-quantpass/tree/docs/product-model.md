# QuantPass Product Model

Status: discussion draft, reconciled at M00 on 2026-09-05. The [decision register](PRODUCT-DECISIONS.zh-CN.md) overrides this document. [M00 glossary and scenarios](specs/glossary.md) distinguish confirmed semantics from examples. Object names and lifecycle mechanisms below are proposals, not approved contract schemas.

## Product definition

QuantPass is a quantitative strategy token issuance and execution platform. A builder publishes a private strategy that must not be changed after upload and declares capacity. One Strategy Pass represents permanent SaaS usage rights for 1 USDT of running allocation, not an ETF share or a 1 USDT market price. Buying a Pass and depositing running capital are separate actions. Token standard, divisibility, supply formula and exact immutable boundary remain unresolved (D1/D2/D4). A consumer may hold a Pass without using it; binding to a user-owned strategy-isolated Vault is the candidate enforcement path.

The Strategy Pass price, strategy performance, and an individual user's realized return are separate concepts and must never be combined into one metric.

## Core objects

- `StrategyFamily`: candidate identity tying declared capacity, supply records and complete performance history together; supply and lineage rules require confirmation.
- `StrategyRelease`: candidate artifact identity and cryptographic commitment; it does not grant permission to replace published strategy code, model or configuration.
- `StrategyPass`: permanent SaaS usage right carrying 1 USDT allocation per Pass; no assumed access-to-new-version or unilateral upgrade entitlement.
- `UserStrategyVault`: user-owned execution account to which a Pass may be bound.
- `ReferenceVault`: proposed live reference instance, not yet approved as the sole performance source.
- `FeePolicy`: proposed representation of approved fees; no assumed right to change fees merely because a timelock exists (D5).
- `PerformanceLedger`: append-only performance and release history that cannot be reset by publishing a new version.
- `PassMarket`: primary issuance and secondary trading venue for unbound Passes.

## Pass lifecycle

Candidate lifecycle only: exact locking quantities, cooldown conditions, settlement and ownership rules must be confirmed before contracts. This diagram does not authorize forced liquidation or a fixed exit delay.

```text
FREE ──bind to vault──> BOUND ──request exit──> COOLDOWN ──settled──> FREE
```

- A `FREE` Pass can be transferred or traded but does not represent active capital.
- A `BOUND` Pass reserves capacity for one Strategy Vault and cannot be transferred.
- `COOLDOWN` means positions are being closed or reconciled before the Pass becomes transferable again.
- Holding an inactive Pass must not be interpreted as a zero-return investment account.

## Strategy capacity

Each Pass represents 1 USDT of running allocation, independent of its market price. With 1,000 eligible Passes a user may deposit 1,500 and explicitly allocate at most 1,000; the remaining 500 stays idle and separately withdrawable. Losses do not silently draw idle funds into the strategy. Unrealized gains may temporarily raise running asset value above the allowance; after the strategy itself sells/settles, excess is isolated as idle funds. Unrealized gains are not idle cash. Exact buffer/settlement policies remain unresolved (D2/D5); no default 80/20 issuance, forced selling or automatic compounding is approved.

Public capacity metrics are reported separately from performance:

- total declared capacity;
- issued capacity;
- bound capacity;
- active deployed capital;
- utilization of declared capacity;
- number of active vaults;
- number of inactive Passes.

Inactive Passes affect scarcity and utilization, not strategy return.

## Builder commitment — TO BE COMPLETED

The current proposal mentions a builder commitment equal to 10%, but its meaning and calculation are not yet agreed.

Open questions:

1. Is the 10% a co-investment running the same strategy, a slashable protocol bond, or two separately funded obligations?
2. Is it calculated from declared maximum capacity, bound capacity, or actual deployed capital?
3. How does the obligation change when users enter and exit?
4. What prevents the builder from exiting before users?
5. Which objectively provable violations permit slashing?
6. What minimum reference capital is required to maintain a continuous verified track record when few users activate their Passes?

No contract or economic implementation should encode the 10% rule until these questions are resolved.

## Public performance model

### Candidate primary metric: verified Strategy Reference Performance

The headline daily, weekly, monthly, yearly, and since-inception returns belong to the `StrategyFamily`, not to Pass holders as a group.

One proposal is to calculate them from a continuously running `ReferenceVault`. This mechanism, funding, cash-flow adjustment and fee treatment need D5 confirmation. A simplified example with no intervening external cash flows is:

```text
Reference NAV starts at 100
Period return = ending NAV / starting NAV - 1
```

The reference calculation must include real execution costs, protocol fees, realized and unrealized PnL, corporate actions, and the exact Strategy Release active during each interval. Publishing a new release cannot reset the curve.

The Reference Vault must continue producing a track record independently of how many Pass holders activate the strategy. Its funding source, minimum size, scaling rules, and relationship to the unresolved builder commitment remain to be decided.

### Secondary metric: live execution quality

Active user vaults may be aggregated only to measure execution quality, such as:

- median and percentile slippage versus the Reference Vault;
- tracking error versus the reference strategy;
- rejected or partially filled intent rate;
- execution latency;
- performance dispersion among active vaults.

Only vaults that were actually active during the measurement interval belong in this cohort. Inactive Pass holders are never included.

### Private metric: individual realized return

An individual user's realized return remains useful to that user for account reporting, fees, tax records, and diagnosing execution divergence. It is not a meaningful headline marketplace metric because users enter at different times, deploy different amounts, and may hold Passes without using them.

### Separate market metric: Strategy Pass price

Pass market price reflects expected future utility, scarcity, capacity demand, transferability, and market liquidity. It is not strategy NAV and must not be presented as strategy performance.

## Required strategy page separation

The marketplace UI should display four independent panels:

1. `Strategy performance`: approved measurement-source return, drawdown, volatility, live age and complete artifact history; Reference Vault remains a candidate.
2. `Execution quality`: active-vault slippage, tracking error, rejection rate, and dispersion.
3. `Capacity`: declared, bound, deployed, and available capacity.
4. `Pass market`: floor/last price, volume, liquidity, and bid-ask spread.

This separation prevents inactive Passes, speculative Pass prices, or user-specific funding choices from distorting the strategy's reported record.

# ADR-0001 机器约束附录

> 自动生成文件。唯一事实源为 `planning/security-boundary.json`；禁止手工修改。

- Schema：2
- 决策状态：`review`
- Chain ID：`46630`
- 执行模式：`user-confirmed-single-intent`
- 无人值守执行：禁止
- 语义摘要：`b4d6640068666d94b26945977a8426012f0157391269313d96c55849e2bed9fa`

## 写平面

| 写平面 | 当前 | 激活方式 | 任务门禁 | Gate |
| --- | --- | --- | --- | --- |
| `deployment` | 关闭 | `manual-one-time-reviewed` | `GOV-001`<br>`THREAT-001`<br>`CONFIG-001`<br>`ASSET-001`<br>`TRUST-001`<br>`TOOL-001`<br>`SPEC-001`<br>`SPEC-002`<br>`ABI-001`<br>`SUPPLY-001`<br>`CON-001`<br>`CON-002`<br>`TST-001`<br>`TST-002`<br>`SEC-002`<br>`KEY-001` | `G1`<br>`G2` |
| `application` | 关闭 | `explicit-reviewed-feature-flag` | `PRIV-001`<br>`WALLET-001`<br>`ADAPTER-001`<br>`TX-001`<br>`INDEX-001`<br>`BACKEND-001`<br>`RPC-001`<br>`WEBSEC-001`<br>`DEPLOY-001`<br>`VERIFY-001`<br>`OBS-001`<br>`IR-001` | `G1`<br>`G2`<br>`G3` |

## 角色与唯一能力

| 角色 | 凭证/信任来源 | 唯一能力 |
| --- | --- | --- |
| `owner` | `wallet-signature` | `deposit_test_asset`<br>`withdraw_test_asset`<br>`revoke_pending_intent`<br>`sign_single_execution_intent` |
| `strategy-runtime` | `release-manifest-pinned-ed25519-key` | `propose_bounded_decision` |
| `risk-signer` | `deployment-manifest-pinned-evm-key` | `sign_bounded_execution_permit` |
| `snapshot-signer` | `deployment-manifest-pinned-ed25519-key` | `sign_confirmed_account_snapshot` |
| `executor` | `untrusted-relay-low-balance-account` | `relay_dual_signed_execution` |
| `pause-guardian` | `immutable-separate-guardian-address` | `irreversibly_pause_risk_increase` |
| `deployer` | `one-time-low-balance-deployment-account` | `deploy_immutable_contract` |
| `indexer` | `read-only-rpc-no-signing-key` | `read_confirmed_events`<br>`reconcile_state` |

## 签名与域绑定

| 签名 | 方案 | 签名者 | 消费方 | 绑定字段 |
| --- | --- | --- | --- | --- |
| `owner-execution-intent` | `EIP-712` | `owner` | `vault-contract` | `chainId`<br>`verifyingContract`<br>`vault`<br>`owner`<br>`asset`<br>`target`<br>`selector`<br>`calldataHash`<br>`value`<br>`amountIn`<br>`minimumAmountOut`<br>`nonce`<br>`deadline`<br>`policyHash` |
| `risk-execution-permit` | `EIP-712` | `risk-signer` | `vault-contract` | `chainId`<br>`verifyingContract`<br>`vault`<br>`owner`<br>`asset`<br>`target`<br>`selector`<br>`calldataHash`<br>`value`<br>`amountIn`<br>`minimumAmountOut`<br>`ownerIntentHash`<br>`decisionCommitment`<br>`accountSnapshotCommitment`<br>`nonce`<br>`deadline`<br>`policyHash` |
| `strategy-decision` | `Ed25519-canonical-json` | `strategy-runtime` | `risk-service` | `decisionId`<br>`strategyFamilyId`<br>`strategyVersionId`<br>`codeMeasurement`<br>`policyHash`<br>`accountSnapshotCommitment`<br>`targetIntentHash`<br>`nonce`<br>`issuedAt`<br>`expiresAt` |
| `account-snapshot` | `Ed25519-canonical-json` | `snapshot-signer` | `risk-service` | `snapshotId`<br>`chainId`<br>`vault`<br>`owner`<br>`blockNumber`<br>`blockHash`<br>`capturedAt`<br>`balancesCommitment`<br>`positionsCommitment` |

## 秘密清单

| 秘密 | 持有者 | 允许存储 | 禁止存储 |
| --- | --- | --- | --- |
| `owner-private-key` | `user-wallet` | `user-wallet-only` | `repository`<br>`server`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |
| `strategy-runtime-private-key` | `isolated-strategy-runtime` | `runtime-key-provider` | `repository`<br>`server-filesystem`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |
| `risk-signer-private-key` | `isolated-risk-signer` | `hardware-or-managed-key-provider` | `repository`<br>`server-filesystem`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |
| `snapshot-signer-private-key` | `isolated-snapshot-signer` | `managed-key-provider` | `repository`<br>`server-filesystem`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |
| `executor-private-key` | `untrusted-low-balance-relay` | `managed-key-provider` | `repository`<br>`server-filesystem`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |
| `deployer-private-key` | `one-time-low-balance-deployer` | `hardware-wallet-or-managed-key-provider` | `repository`<br>`server-filesystem`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |
| `pause-guardian-private-key` | `separate-guardian-wallet` | `hardware-wallet-or-managed-key-provider` | `repository`<br>`server-filesystem`<br>`plaintext-env`<br>`browser-storage`<br>`logs`<br>`ci` |

## 信任边界

| ID | 来源 → 目标 | 数据 | 强制控制 |
| --- | --- | --- | --- |
| `TB-01` | `web-ui` → `user-wallet` | `transaction-request`<br>`human-readable-eip712` | `explicit-chain-address-amount-deadline-display`<br>`one-intent-one-confirmation`<br>`wallet-native-review` |
| `TB-02` | `strategy-runtime` → `risk-service` | `signed-strategy-decision` | `pinned-release-key`<br>`policy-hash`<br>`decision-expiry`<br>`durable-decision-nonce` |
| `TB-03` | `confirmed-chain-state` → `snapshot-signer` | `vault-state`<br>`block-number`<br>`block-hash` | `chain-id-check`<br>`confirmation-policy`<br>`signed-snapshot-commitment` |
| `TB-04` | `risk-service` → `executor` | `risk-execution-permit`<br>`owner-execution-intent` | `dual-signature`<br>`full-call-binding`<br>`independent-nonce`<br>`short-deadline` |
| `TB-05` | `executor` → `vault-contract` | `signed-transaction`<br>`dual-signed-execution` | `contract-revalidation`<br>`atomic-nonce-consumption`<br>`typed-call`<br>`fixed-target-selector` |
| `TB-06` | `rpc-provider` → `adapter-and-indexer` | `chain-id`<br>`bytecode`<br>`receipt`<br>`logs`<br>`block-hash` | `untrusted-rpc`<br>`runtime-hash-check`<br>`bounded-retry`<br>`reorg-rollback` |
| `TB-07` | `vault-contract` → `fixed-token-or-venue` | `erc20-transfer`<br>`typed-allowlisted-call` | `non-proxy-target`<br>`exact-approval`<br>`balance-delta-equality`<br>`return-value-check`<br>`reentrancy-guard` |
| `TB-08` | `confirmed-chain-events` → `application-view` | `confirmed-state`<br>`confirmation-level`<br>`reorg-status` | `pending-not-success`<br>`event-identity`<br>`block-hash-checkpoint`<br>`contract-state-reconciliation` |
| `TB-09` | `deployment-and-release-manifest` → `web-adapter-risk-service` | `trusted-addresses`<br>`runtime-hashes`<br>`abi-hash`<br>`release-key`<br>`policy-hash` | `content-addressed-manifest`<br>`build-provenance`<br>`clean-rebuild`<br>`cross-component-hash-check` |

## 当前资产策略

- Active allowlist：空；`ASSET-001` 完成前没有任何可写入 Testnet 的资产。
- 候选：`project-deployed-fixed-supply-clearly-labelled-test-token`
- Deposit：`reject-unless-balance-delta-equals-requested-amount`
- 拒绝：`fee-on-transfer`、`rebasing`、`erc777-or-callback-hooks`、`unknown-or-changing-decimals`、`unverified-runtime-bytecode`、`hidden-transfer-tax`、`admin-mint-to-vault`、`confiscation-or-blacklist`、`burn-from-vault`、`proxy-or-mutable-implementation`

## 暂停、退出与迁移

- Pause：`irreversible-for-address`；不允许 unpause。
- Pause 后 owner 始终可执行：`revoke_pending_intent`、`withdraw_test_asset`。
- 外部异步托管：禁止。允许执行必须在同一交易中原子结束并把资产留在 Vault。
- 迁移：`owner-withdraws-to-wallet-then-explicitly-deposits-new-address`。

## 禁止项

- `mainnet-or-unknown-network`
- `real-value-assets`
- `unattended-or-autonomous-trading`
- `application-custody-of-user-keys`
- `automatic-hidden-or-batch-wallet-signing`
- `arbitrary-target-calldata-or-delegatecall`
- `proxy-upgrade-path`
- `non-owner-withdrawal-or-arbitrary-recipient-transfer`
- `unlimited-token-approval`
- `caller-supplied-trust-root`
- `in-memory-only-replay-protection`
- `pending-transaction-presented-as-success`
- `local-simulation-role-promotion-reaching-testnet`
- `async-external-custody-or-pending-position`
- `admin-mint-confiscate-blacklist-or-burn-from-vault`
- `admin-bulk-migration-or-silent-address-replacement`

# Vault v1 Contract Specification — REVIEW DRAFT

Agent: Macbeth04 · Task: AF-CHAIN01
Status: REVIEW DRAFT，未冻结 ABI、产品规则或链执行权限。
Testnet Writes = CLOSED。AF-M01 [Interface Contract v1](https://github.com/pdbsy/quantpass/blob/73230c43e464cd1b579fa16a6425756291ef9e8e/docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md) 已 FROZEN，exact SHA `73230c43e464cd1b579fa16a6425756291ef9e8e`。本文件的未来 Vault 提案仍未冻结，不改变 Wave 1。

## 1. 依据、范围和身份

依据 `docs/specs/domain-ledger.md`、`packages/domain/src/vault.ts`、`docs/security-model-v0.md`、`docs/PRODUCT-DECISIONS.zh-CN.md` 和 M05–M07 路线图。现有 `ownerId → strategyId → vaultId` 不变：会话认证得到 owner，服务端按 owner/strategy 查询其 Vault；客户端声称 owner 不构成授权。

本地 `VaultState.id/ownerId/strategyId` 是字符串；未来 EVM `address` 和 registry commitment 不能靠强制类型转换、截短字符串或默认 hash 得到。链注册表必须给出可核验、版本化映射，同一地址/链上的归属也需验证。映射协议由 Macbeth01/03 协调冻结。本示例保留冻结的字符串 ownerId/strategyId/vaultId；每对 (ownerId, strategyId) 最多一个当前 Vault。没有 Vault 时 AccountStrategy.status = not_started、vaultId = null，不能创建同名 Vault 状态。

v1 候选是 owner 所有的独立 Vault；策略、Builder、平台、relayer 不能随意转走资金。工程中的 `VaultIntentPreview` 仅计算摘要：无资产转移、状态机、授权验证或部署脚本，不是本节所描述 Vault 的实现。其 ABI/domain 专用于预览，不应被钱包用于签署真实授权。

## 2. 金额和账本

金额接口沿用规范十进制整数字符串，不接受 Number 浮点、负数金额、科学计数法或隐式舍入。合约金额为显式资产最小单位的 uint256；金额范围、正值与溢出逐项验证。现有 `TEST_ONLY_USDT_UNIT` 的 6 位精度和每 Pass 1 USDT 额度仅保持本地语义，不等于已批准结算 token、精度或 Pass 标准。

| 现有字段 | 候选链上含义 / 不变量 |
| --- | --- |
| idle | 用户可申请提取的闲置现金；不得下单、作抵押、补亏或付发行者租金 |
| activeCash | 运行现金；可用量为 activeCash − feeLiability，不包括订单预留 |
| orders | 已隔离订单现金；异步订单未证实取消前不能再次使用 |
| positionCost / positionValue | 当前模型的聚合持仓；浮盈不是可提现金，实际合约不能信任客户端估值 |
| pendingWithdrawals | 从 idle 隔离而尚未付出的款项；取消只可返还未支付预留 |
| feeLiability | 已计提且现金支持的负债；生产计费规则未决，不能从 fixture 推导 |
| deposits / withdrawalsPaid | 已确认入账 / 实际支付的累计值，网络广播不计已支付 |
| revision | 本地领域转换版本；链上 stateVersion 是候选协议字段，映射必须经协调冻结 |

对现有单资产样例，权益 = deposits − withdrawalsPaid + realizedPnl + unrealizedPnl − feesAccrued；同时 = idle + activeCash + orders + positionValue + pendingWithdrawals − feeLiability。feesAccrued = feesPaid + feeLiability。失败动作不消费资金或版本；成功动作与事件、nonce 消费在同一原子交易内完成。

链上 token 实际余额还必须与现金分区对账；未请求的直接 token 转入/强制 ETH 不自动增加用户策略额度，也不自动决定其经济归属。处理规则未批准前将差异隔离并关闭新增执行。资产带手续费、rebasing、回调、冻结/黑名单、非标准返回值或精度变化均需单独批准；不得自行扩展为任意资产支持。

## 3. 状态与权限矩阵

跨层 `Vault.status` 继续只有 `stopped / running / stopping`。不创建链侧替代词汇。`pause` 是候选合约风险开关，必须与运行状态分开；在 AF-M01 冻结前不添加到共享 DTO。pause 不代表 stop、清仓、撤销已广播交易或完成提款。

| 操作 | 授权来源 | paused 下 | stopping 下 | 边界 |
| --- | --- | --- | --- | --- |
| deposit | owner 直接交易或 owner 精确 Intent | 拒绝新增入金（候选 fail-closed 规则） | 可存为 idle；不能自动恢复运行 | 不改变可交易额度 |
| allocation | owner；当前 Pass/额度证据 | 拒绝 | 拒绝新增分配（候选退出规则） | 不能消费浮盈例外扩大新授权 |
| deallocation | owner | 允许已结算、未预留且无负债现金 | 允许 | 不要求策略或风险签名方配合 |
| requestWithdrawal / finalize | owner 精确授权，固定 owner 接收 | 允许安全可用 idle | 允许 | 不动运行资金，不允许任意 receiver |
| cancelWithdrawal | owner，且确认尚未支付 | 允许 | 允许 | pending 只能被消费一次 |
| pause / revoke | owner；可选 guardian 仅限收紧权限 | 允许 | 允许 | guardian 的存在/选取本轮不确定 |
| resume / start | owner，重新检查当前授权/配置/额度 | 只允许 owner 显式解除 pause 后 | 必须先达到 stopped | 不能复活旧签名 |
| owner exit (`stop`) | owner 直接可达，不依赖 relayer | 允许 | 可幂等重试 | 无强制即时清仓承诺 |
| 策略执行 | 完整授权和风险检查 | 拒绝增加风险 | 禁止新增买入 | 仅未来固定语义 Adapter，不在本工程实现 |

以上 pause/stopping 新限制是候选合约规则，与当前纯本地模型允许部分操作的差异必须单列测试和冻结，不能悄悄改变现有 LocalAdapter。未知或过期价格应阻止新增风险；闲置提款、撤销和不依赖估价的确定性撤回不应依赖在线 oracle。任何第三方不能暂停 owner 的撤销权；底层资产本身冻结时需报告实际限制。

## 4. 操作契约、事件与错误

以下是候选行为接口，不是已发布 Solidity ABI。全部状态事件带 `vaultAddress, owner, strategyRef, commandRef, stateVersion`；外部索引器还记录 chainId、blockHash/number、txHash 和 logIndex。事件不得含策略源码、权重、秘密或凭据。

| 操作 | 前置条件与原子变化 | 候选事件 | 领域/候选合约错误 |
| --- | --- | --- | --- |
| deposit(amount) | owner；批准结算资产；amount > 0；验证实际入账增量；idle/deposits 增加实际确认额；不自动 allocate | Deposited(asset, amount) | FORBIDDEN / NonPositiveAmount / AssetNotApproved / TransferFailed / BalanceDeltaMismatch / Paused |
| allocation(amount) | amount ≤ idle；当前 Pass 归属/绑定 epoch 有效；activeNet + amount ≤ 授权额度；idle 减、activeCash 加；总容量规则缺失即关闭该链功能 | Allocated(amount, authorizationEpoch) | INSUFFICIENT_IDLE / ALLOWANCE_EXCEEDED / StaleAuthorization / ConfigurationMissing / Paused |
| deallocation(amount) | amount ≤ activeCash − feeLiability；不计订单预留和未结算仓位；activeCash 减、idle 加 | Deallocated(amount) | INSUFFICIENT_ACTIVE_CASH / NonPositiveAmount / FORBIDDEN |
| requestWithdrawal(amount) | amount ≤ idle；receiver 固定已认证 owner；idle 减、pending[requestId] 加 | WithdrawalRequested(requestId, amount, owner) | INSUFFICIENT_IDLE / DuplicateRequest / InvalidReceiver |
| finalizeWithdrawal(requestId) | 只消费存在且未付 pending；执行固定资产向 owner 转移；成功才 pending 减、withdrawalsPaid 加；失败整笔回滚，仍可重试 | WithdrawalPaid(requestId, amount, owner) | WITHDRAWAL_NOT_PENDING / TransferFailed / BalanceDeltaMismatch / FORBIDDEN |
| cancelWithdrawal(requestId) | 必须确定请求未支付，pending 减、idle 加；与 finalize 原子竞态下只允许一个胜出 | WithdrawalCancelled(requestId, amount) | WITHDRAWAL_NOT_PENDING / FORBIDDEN |
| pause() | 仅 owner，或未来批准的只可暂停 guardian；阻断新增风险并使旧风险授权 epoch 失效 | PauseChanged(true), AuthorizationRevoked(epoch) | FORBIDDEN / EpochOverflow |
| resume() | owner 显式确认；当前依赖齐全；只清 pause，不隐式 start 或恢复旧 grant | PauseChanged(false) | FORBIDDEN / ConfigurationMissing / StaleAuthorization |
| ownerExit() / stop | 先撤销新执行授权；有订单/仓位则 stopping；没有则 stopped；允许撤回自由现金/闲置提款；以后收到有效结算后才可 stopped | ExitRequested, StatusChanged, AuthorizationRevoked | FORBIDDEN；外部结算不可用时保留 stopping，不假报失败或完成 |
| revokeAuthorization() | owner 无需风险签名；epoch 单调增加，旧 grant 和预先签名 intent 均失效 | AuthorizationRevoked(epoch) | FORBIDDEN / EpochOverflow |

错误还包括 NonceAlreadyUsed、IntentExpired、StateVersionMismatch、WrongDomain、InvalidSignature、PolicyMismatch、UnsupportedAction、UnsupportedAsset、UnsettledOrders。领域错误名沿用已有值；合约 custom error 到 API 的映射必须遵循冻结的 `{ error: APIErrorCode }` 闭合列表；候选合约错误不能直接新增 public code。内部/配置/存储错误映射 LOCAL_OPERATION_FAILED，未来新增链 code 必须先有 AF-M01 决策。本地 `confirmWithdrawal` 的 executor 信任不能迁移到链上：relayer 最多提交已有 owner 权限的固定动作，不能自行指定收款人、确认假的支付或绕过实际 token 转移。

request/finalize 两阶段只用于明确区分预留与支付，并不批准提款等待期。是否要求分两笔交易、允许同笔请求+支付及 Gas 承担为 PRODUCT DECISION REQUIRED；在没有链原子性设计前不能把本地 confirm 命令暴露为真实到账入口。

## 5. Authorization、nonce、deadline、state version

- 直接 owner 调用依赖 `msg.sender == owner`；转发调用不能把 relayer 当 owner，也不能信任客户端 role。
- relayer 是传输服务，不持有策略/Builder/平台业务权限。owner 的安全退出路径应能绕开离线 relayer 和风险服务。
- EVM 授权候选遵循 [EIP-712](https://eips.ethereum.org/EIPS/eip-712)，未来兼容 EOA 与 [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)；本地 Ed25519 模型仅参考语义。
- domain 只用标准 `name, version, chainId, verifyingContract`；nonce、deadline、Vault 状态及政策放在 typed message。链 ID 从执行链取得，不能接受浏览器覆盖；verifyingContract 必须是实际负责验证的 Vault，不能复用测试 preview 地址。
- `nonce` 为 Vault 内授权空间的一次性 uint256，`authorizationEpoch` 为 owner 可撤销版本。不能用交易 nonce 或 HTTP commandId 替代；原子验签/检查/消费，失败整体回滚。重发已完成 Intent 返回已有 receipt 或拒绝，不再执行一次。
- `deadline` 使用链秒时间，条件为 block.timestamp ≤ deadline；测试临界等号。客户端毫秒需显式转换和范围校验，不能混用。链时间不是离线时钟，不承诺绝对秒级最终性。
- `stateVersion` 绑定授权时快照；候选严格等于当前版本，每次成功资金/权限变更递增。并发不同 nonce 也不能基于旧状态双花。失败不推进版本；撤销与 pause 应推进 epoch/version，使旧 Intent 失效。长时间退出可由 owner 读取新版本再直接提交，不被旧授权锁住。
- chain reorg 会回滚链上 nonce/version/事件；索引器撤回旧分支 receipt，不在离线数据库永久标记已完成。是否重发必须重读 nonce、epoch、版本、deadline 和请求最终状态；不能自动补签。

### 5.1 本轮 preview 的明确边界

本地 preview 固定字段：`ownerId, strategyId, vaultId, commandId, commandType, assetId, decimals, amount, expectedRevision, nonce, deadline, authorizationEpoch, policyHash`。六个字符串依 EIP-712 先 keccak256(UTF-8 bytes)，再与整数/bytes32 逐个编码成 32 字节；不使用 JSON hash 或 packed 动态拼接。commandId 对应现有 envelope.id，expectedRevision 为本地安全整数在 ABI 中的无损 uint256 编码；未来链 stateVersion 只在规格中定义，不加入 Wave 1 DTO。preview 不决定钱包地址、收款地址或真实资产映射，未来真实授权须在专项冻结后显式加入这些绑定。

preview 域：`name = AlphaForgeVaultFoundationPreview`，`version = 0.1`，当前本地 EVM chainId，preview 实例地址。该域故意与未来真实 Vault 区分。assetId/decimals 为 hash 输入并不表示资产已被允许；preview 对任何输入给出摘要并不授予权限。它不检查 deadline、nonce 或 owner，也不消费状态，不能作为授权验收。

合约测试只验证字段/domain 绑定和不接收普通 ETH 调用，不签名。完整验签、nonce store、撤销、权限、重入、退出和 token 会计都 NOT IMPLEMENTED，不能把摘要测试数量写成生产 Vault 安全通过。preview 不校验 Identifier 正则、MoneyString 范围或 commandType 白名单；不能作为 API validator。本地示例 ABI 的数值类型不是对公开 JSON 金额类型的修改。

### 5.2 双签/风险签名候选（不实施）

若采用 runtime decision + independent risk permit，两者必须承诺同一个 exact typed execution intent：owner、strategy/release commitment、Vault 地址、chain/domain、policy/config hash、authorizationEpoch、nonce、deadline、stateVersion、可信 account snapshot commitment、固定 operation、唯一批准 venue/asset pair、amountIn、minAmountOut、固定接收 Vault、费用/预算上限。域名/版本可区分角色，但两份签名要引用同一 intentHash；不能让风险签名签 A 而执行 B。

链验证当前 signer registry、明确独立角色、owner grant/Pass 绑定和固定 adapter；不把持有一个风险签名当万能授权。signer rotation、配置改变不能扩大已有授权，旧 epoch 必须失效。风险方不能签提现，策略执行不能消费 idle。任何 `target/calldata/value` 透传、delegatecall、外部 arbitrary call、proxy 升级入口都不在许可面。具体风险引擎、角色选择/轮换/恢复、预算公式仍待安全和产品决策；本轮不会生成或保存任何签名密钥。

## 6. Owner exit 的现实边界

owner 可直接撤销新执行、请求 stop、撤回自由运行现金并提取 idle。已预留订单可能成交，必须获得实际取消/退款或结算证据后释放。未结算仓位不按预估市值直接兑付；流动性中断、资产发行者冻结、RPC 不可用和价格失效都可能延迟最终退出，界面必须如实显示 stopping/receipt 状态。

不能为了保证“即时退出”增加任意外部调用、平台代提款、强制亏损清仓或管理员转移资金。强制平仓、实物转出、长期滞留资产恢复与费用清算需专项规格和明确授权。无静默 upgradeability；修复后的新版本/新地址迁移须 owner 明确同意，旧 Vault 的安全退出权不能由升级管理员任意收回。

## 7. PRODUCT DECISION REQUIRED

| 决策 | 不确认时的边界 |
| --- | --- |
| 结算/现金/Gas 资产、官方 Stock Token 地址、venue、精度、资产发行者冻结语义 | 不启用链交易；46630 仅目标元数据 |
| Pass 标准/可拆分性/绑定、供应与总容量、缓冲计算及耗尽策略 | 不发行 token，不实现链 allocation 额度来源 |
| 收益提成、HWM、计提时点、费用分账、租金与备用额度 | 不实现费用模块，fixture 费率不是默认值 |
| 策略/参数/依赖不可变范围及版本引用 | 不设计静默升级、模型替换或 grant 自动迁移 |
| 两阶段提款、Gas 支付、停运时流动性/实物退出和欠费处理 | 不承诺即时退出，不加资金恢复后门 |
| owner 是否允许变更收款地址、wallet recovery、guardian/signer governance | 默认讨论固定 owner 接收，不赋予平台恢复提款权 |
| chain finality/reorg 阈值、RPC quorum、真实资产/venue 风险核验 | 不把 included 当到账；Testnet Writes = CLOSED |

DEC-019/ASK-006 和回购价格 ASK-011 按用户意愿保留，不在本任务追问或制定公式。市场 Pass 销售、利润分配、token 发行/收入分成不在本工程。

## 8. 下一阶段冻结与验收

由 Macbeth01 冻结跨层字段和映射；Macbeth03 确认 receipt/idempotency；Macbeth05 对确切提交做独立复核；产品决策由用户确认。本轮不代替这些结论。

实现 Vault 前必须补充：逐操作权限矩阵、owner/relayer/guardian 负向测试；EOA/ERC-1271 跨域向量与签名绑定；nonce/epoch/deadline 临界值和并发；失败交易的原子回滚；全部账本守恒；pause 下退出与 oracle 离线；固定 token 的行为与重入保护；异步订单/退出/重组和索引去重；无代理升级与无任意调用的审查。仅本地摘要示例通过不能满足上述验收。

# QuantPass 历史工作域清单（归档）

本文件保留个人开发计划重排前的工作域清单，不再作为执行顺序或已批准产品规范。原复选框仅保留历史状态。当前入口为[个人开发 TODO](../TODO.md)，具体任务见[顺序开发计划](DEVELOPMENT-PLAN.zh-CN.md)，产品含义以[决策登记](PRODUCT-DECISIONS.zh-CN.md)为准。

最后更新：2026-09-05

项目定义：**量化策略代币发布以及运行平台**

当前阶段：产品与协议设计

以[产品决策登记](PRODUCT-DECISIONS.zh-CN.md)区分需求与候选方案；原[设计评审](REVIEW-2026-09-05.zh-CN.md)问题仍未全部关闭，下文任务存在不代表产品方案已获批准。

## 项目目标

QuantPass 允许量化策略 Builder：

1. 将私有量化策略登记为永久的 Strategy Family；
2. 发布永久使用权的可交易策略 SaaS 代币；每枚对应 1 USDT 运行额度，发行数量待确认；
3. 用策略代币分配策略 SaaS 使用额度，而不是发行 ETF 或资金池份额；
4. 在不向消费者交付源代码、模型或参数的情况下运行策略；
5. 定义策略容量，按约定从实际运行用户的自身策略利润中获得分成；具体规则与其他收入权利待确认，不默认允许任意收费。

QuantPass 允许消费者：

1. 发现并比较有连续实盘记录的策略；
2. 购买、持有和出售未绑定的策略代币；
3. 将策略代币绑定到自己控制的 Strategy Vault；
4. 在明确的容量和风险上限内运行策略；
5. 随时撤销策略权限、减仓和提取自己的资产。

QuantPass Protocol 与 Market Maker 可以通过明确披露的发行费、二级交易费、执行基础设施费、LP fee 和 bid-ask spread 获得收入。

## 当前已完成

- [x] 确定项目为量化策略代币发布与运行平台
- [x] 确定 Robinhood Chain 为第一优先部署网络
- [x] 完成白皮书 v0.2 discussion draft
- [x] 初步定义 Strategy Family、Strategy Release、Strategy Pass 和 Strategy Vault
- [x] 初步定义 `FREE -> BOUND -> COOLDOWN -> FREE` 的代币生命周期
- [x] 将策略业绩、用户个人收益、容量和代币市场价格分开
- [ ] 确认公开业绩的核算机制；持续运行的 Reference Vault 为候选，尚非用户已批准需求
- [x] 将 Builder 10% commitment 标记为待完善
- [x] 完成签名、重放保护和风险限制的 TypeScript 实验性 reference core

## P0 — 产品定义与未决策事项

这些事项会影响所有后续合约和后端设计，必须优先确定。

### 产品术语

- [ ] 确定面向用户的正式名称：`Strategy Token`、`Strategy Pass` 或二者的关系
- [ ] 明确定义策略代币代表的权利和不代表的权利
- [x] 用户确认策略使用权期限永久（不代表永久运营、维护和升级义务已定稿）
- [ ] 明确永久使用权对应的持续服务义务、运行成本及哪些升级需要消费者重新授权
- [ ] 明确代币与 Strategy Family、Release、Capacity Unit 的映射
- [x] 用户确认一枚 SaaS 代币对应 1 USDT 策略运行额度；代币价格与额度单位分开
- [x] 用户确认允许多存资金，策略运行金额受代币额度限制，其余为可自行提取的闲置余额；替代超额自动退回方案
- [x] 用户接受浮盈临时超过 SaaS 额度，待策略自身卖出/结算后将超额收益转入闲置余额
- [x] 用户要求 Builder 发布最大容量时预留 10%–20% 的运行容量缓冲，与 Builder 资金 commitment 分开
- [ ] 【用户暂缓，待完善】确认缓冲计算基数、比例选择权限，以及最大总容量、可分配 SaaS 额度与代币供应的公式；不将助手示例当作已批准规则
- [ ] 【用户暂缓，待完善】定义缓冲接近/耗尽时的动作与恢复条件；验证连续浮盈、相关持仓同步上涨及市场容量收缩，不默认强制平仓
- [ ] 确认部分成交/再平衡时的收益归集边界、费用顺序和额度恢复规则
- [ ] 隔离运行资金、闲置余额、订单预留和结算负债；验证策略无法消费或抵押闲置余额
- [ ] 设计闲置余额独立提款权限、限定收款钱包、对账与失败重试；是否自动补足策略亏损须用户另行授权
- [x] 用户确认策略上传后不可更改
- [x] 用户确认首版先不支持训练、在线学习和通过训练自动调参；可运行发布前已训练好的固定模型
- [ ] 明确不可变范围是否包含参数、模型、依赖、外部配置及同一 Pass 的执行版本；据此修订原升级/回滚设计
- [ ] 明确策略停止运营、Builder 消失或 Family 被暂停时的处理方式

### 首个交易场景

- [ ] 确定 Robinhood Chain 首个 Venue Adapter
- [x] 用户确认首版只支持链上美股 RWA，排除 meme coin
- [x] 用户确认仅允许 Robinhood 官方发行、公布合约地址的美股 Stock Tokens
- [ ] 核实首批合约地址、ETF 范围，以及是否仅允许现货
- [ ] 确定首批支持资产和 denomination asset
- [ ] 确定是否允许杠杆、做空、借贷和外部头寸
- [ ] 明确底层市场关闭、暂停或流动性不足时的行为

### Builder commitment — 待完善

- [ ] 确定 Builder 10% 是 co-investment、slashable bond，还是两项独立义务
- [ ] 确定 10% 基于最大容量、绑定容量还是实际部署资金
- [ ] 设计 Builder commitment 随消费者进入和退出的调整机制
- [ ] 设计 Builder 不得早于消费者退出的规则
- [ ] 定义可以客观证明并触发 slashing 的违规行为
- [ ] 区分正常策略亏损与协议违规
- [ ] 确定 Reference Vault 的最低资本和资金来源

### 收费与市场结构

- [x] 用户确认发行者向平台租用策略运行资源，平台同时参与收益分成；相对低价为目标，尚无已批准报价
- [x] 用户确认平台与 Builder 分配同一笔已约定总收益提成，不向消费者额外叠加平台收益提成；发行者租金另计
- [ ] 明确总提成率、平台分配比例、计费利润和结算规则；验证消费者、Builder、Protocol 的金额守恒与无重复扣费，示例数字不作为默认费率
- [ ] 定义发行者租费的计量、资源额度、账期、付款及包含的数据/Gas/存储服务；不默认从消费者本金或闲置余额扣除
- [ ] 定义发行者欠费/失联时的通知、运行连续性、已有持仓处置与续费责任；不默认锁资、删除策略或取消永久使用权
- [x] 用户确认发行者正常从钱包支付运行费用，锁定额度仅作备用保障；接续时公开通知市场并竞价转移控制权
- [ ] 确认备用锁定额度的资产性质、启用条件、扣费范围、最低余额/服务期限、补缴和返还；与容量缓冲及 Builder commitment 分账
- [x] 用户确认竞得者承接运营责任、租费与原发行者后续分成权，不能修改策略、单方提高消费者费用或动用用户资金
- [ ] 在策略保护系统中确定接手者的源码访问权与知识产权安排；不因运营权转移默认交付明文
- [ ] 定义钱包日常付款、备用费用扣取和分成切换的授权、审计与对账规则，不默认无限扣款
- [ ] 定义接续触发、公开通知、竞价与原发行者补缴的状态机、竞价资金托管、退款及原子交接
- [ ] 定义过渡期与无人竞价时的运行费用、已有仓位处置及持有人权利；测试接手失败和重复交接
- [x] 用户确认发行者可通过回购 Pass 自主结束策略
- [ ] 【用户指定待处理】确定回购 Pass 的定价方法，不使用默认价格或示例参数代替决策
- [ ] 确认回购结束所需范围、持有人同意、活跃仓位及费用结清、未回购 Pass 的权利；不默认强制回收或直接停服
- [ ] 分别记录租费账本和绩效分成账本，验证重复扣费、失败重试、费用上限和租费对账
- [ ] 确定首次发行定价方式：固定价格、拍卖、bonding curve 或其他机制
- [ ] 确定二级市场使用 order book、AMM 或混合模型
- [x] 用户确认实际运行者从自身策略利润向 Builder 支付收益分成，未运行持有人不参与这笔分配
- [ ] 确认分成规则的定制范围、精确利润核算、费率、费用结晶与其他收入权利
- [ ] 确定 Protocol issuance、secondary、execution 和 infrastructure fee 参数
- [ ] 确定 Market Maker 收入、库存限制和风险预算
- [ ] 设计 Protocol 与 Market Maker 的利益冲突隔离和披露规则
- [ ] 定义消费者 Vault 的 high-water mark 与 performance fee crystallization

### 完成标准

- [ ] 所有未决策项形成 ADR，并由产品、技术、安全和法律共同确认
- [ ] 白皮书中不存在会被误解为已确定的临时经济参数
- [ ] v1 明确限制为一条链、一个资产类别和一个 Venue Adapter

## P1 — 协议规范与系统架构

### 状态机

- [ ] 编写 Strategy Family 状态机
- [ ] 编写 Strategy Release 发布、激活、暂停、回滚和废弃状态机
- [ ] 编写 Strategy Token/Pass 铸造、购买、绑定、冷却和转让状态机
- [ ] 编写 User Strategy Vault 存款、授权、运行、暂停和退出状态机
- [ ] 编写 Intent 创建、提交、验证、执行、部分成交和过期状态机
- [ ] 编写 Capacity reservation 与释放状态机
- [ ] 编写费用累积、结晶、领取和退款状态机
- [ ] 编写 Reference Vault 和 Performance Ledger 状态机

### 数据与接口规范

- [ ] 定义所有链上实体的唯一 ID 和事件 schema
- [ ] 定义 EIP-712 User Policy schema
- [ ] 定义 EIP-712 Strategy Intent schema
- [ ] 在签名 domain 中绑定 chain ID、Vault、verifying contract、nonce 和 deadline
- [ ] 定义固定精度金额、价格、权重、百分比和时间格式
- [ ] 定义 Strategy Release Manifest 与 artifact commitment 格式
- [ ] 定义 Strategy Builder SDK 接口
- [ ] 定义 Venue Adapter 接口
- [ ] 定义 Oracle Adapter 与 corporate-action data 接口
- [ ] 定义链上事件到后端索引模型的映射
- [ ] 定义 API error code、幂等键和审计字段

### 信任边界

- [ ] 完成 Builder、Consumer、Protocol、Keeper、Market Maker 和基础设施威胁模型
- [ ] 列出 Robinhood Chain sequencer、validator、bridge、oracle 和 RPC 信任假设
- [ ] 明确 on-chain、公开聚合、加密链下和永不收集的数据分类
- [ ] 定义 key ownership、key rotation 和 key revocation
- [ ] 明确 Protocol admin、emergency role 和治理权限上限

### 完成标准

- [ ] 形成版本化协议规范和 architecture decision records
- [ ] 每个状态转换都有前置条件、后置条件和失败行为
- [ ] 所有高风险信任假设均在白皮书和用户界面可见

## P2 — Monorepo 与开发基础设施

### 仓库结构

- [ ] 确定 monorepo 工具和 package manager
- [ ] 创建 `apps/web` 前端应用
- [ ] 创建 `apps/api` 后端 API
- [ ] 创建 `apps/indexer` 链上索引服务
- [ ] 创建 `apps/keeper` Intent relayer/keeper
- [ ] 创建 `apps/performance` 业绩计算服务
- [ ] 创建 `packages/contracts` Solidity 合约
- [ ] 创建 `packages/sdk` Builder/Consumer TypeScript SDK
- [ ] 创建 `packages/protocol` 共享 schema 与 canonical encoding
- [ ] 创建 `packages/ui` 共享前端组件
- [ ] 创建 `packages/config` chain、asset、oracle 和 adapter 配置
- [ ] 创建 `infra` 部署与监控配置

### 工程标准

- [ ] 配置 TypeScript strict mode
- [ ] 配置 Solidity Foundry 工程
- [ ] 配置 lint、format、typecheck 和 unit test
- [ ] 配置 pre-commit checks
- [ ] 配置 CI build、test、fuzz、coverage 和 dependency scanning
- [ ] 配置分支保护和必须通过的检查
- [ ] 创建 `.env.example`，禁止提交任何真实 secret
- [ ] 建立 semantic versioning 和 release note 规则
- [ ] 建立 threat-model、ADR 和 incident 文档模板

### 完成标准

- [ ] 新开发者可以根据 README 在本地启动完整测试环境
- [ ] 每个 package 都有明确 owner、接口和测试入口
- [ ] CI 在干净环境中可重复通过

## P3 — Robinhood Chain 智能合约

### Registry

- [ ] 实现 `StrategyFamilyRegistry`
- [ ] 实现 Builder 身份、签名密钥和 metadata commitment
- [ ] 实现固定 Pass supply 与 Declared Maximum Capacity
- [ ] 实现 `StrategyReleaseRegistry`
- [ ] 实现 release activation、timelock、pause、rollback 和 deprecation
- [ ] 实现 Strategy Family lineage 和不可重置历史
- [ ] 发出完整、可索引的链上事件

### Strategy Token/Pass

- [ ] 评估 ERC-1155、ERC-721、ERC-20 或定制 token 模型
- [ ] 实现固定供应和禁止未授权增发
- [ ] 实现 Capacity Unit 计算
- [ ] 实现 `FREE / BOUND / COOLDOWN` 状态约束
- [ ] 禁止 BOUND 或 COOLDOWN 代币转移和重复绑定
- [ ] 实现 Pass 转移后的访问撤销
- [ ] 实现 metadata versioning，避免 metadata 被静默替换
- [ ] 实现 primary sale 和 royalty 接口

### Strategy Vault

- [ ] 实现 `StrategyVaultFactory`
- [ ] 实现用户自有、单策略隔离的 `UserStrategyVault`
- [ ] 实现 deposit、withdraw、bind、unbind 和 emergency exit
- [ ] 确保 Protocol、Builder 和 Keeper 不能任意提取用户资产
- [ ] 禁止 arbitrary call 和 delegatecall
- [ ] 实现 owner 永久保留的 revoke 权限
- [ ] 确保 pause 不阻止安全减仓和退出
- [ ] 设计不可升级 Vault 或用户主动迁移机制

### Policy Kernel

- [ ] 验证 Pass ownership 和 BOUND 状态
- [ ] 验证 Family、Release、Vault 和 Adapter binding
- [ ] 验证 EIP-712 签名，并支持 EOA 与 ERC-1271
- [ ] 实现 nonce、deadline 和跨链重放保护
- [ ] 实现 asset、protocol、selector 和 receiver allowlist
- [ ] 实现 SaaS 运行资金额度、单笔、单资产和总敞口限制；不得把 SaaS 额度误写为账户总存款上限
- [ ] 实现最大滑点、换手率、频率和费用限制
- [ ] 实现 oracle freshness 和价格偏离检查
- [ ] 实现异常状态下 reduction-only 模式
- [ ] 实现 user policy revoke 和 release revoke

### Capacity

- [ ] 实现 Operational Capacity 计算和存储模型
- [ ] 保证 Operational Capacity 不超过 Declared Maximum Capacity
- [ ] 实现容量绑定、预留、释放和冷却
- [ ] 防止并发绑定导致容量超卖
- [ ] 定义容量降低时对现有 Vault 的处理
- [ ] 为后续跨链 capacity sharding 预留 domain 字段

### Venue 与 Oracle Adapter

- [ ] 实现 mock adapter 并证明不能调用任意目标
- [ ] 实现首个 Robinhood Chain Venue Adapter
- [ ] 处理 approve、swap、partial fill、refund 和 token dust
- [ ] 为 fee-on-transfer、rebase 和非标准 ERC-20 设置明确策略
- [ ] 集成主价格源与独立 sanity-check price source
- [ ] 实现 oracle stale、deviation 和 outage circuit breaker
- [ ] 正确处理 Robinhood Stock Token corporate-action multiplier
- [ ] 为 Venue/Oracle 地址变化设计版本化配置

### Fee 与治理

- [ ] 实现用户签署的最大 Fee Policy
- [ ] 实现 Builder、Protocol 和 Market Maker 收费拆分
- [ ] 实现 high-water mark 所需的链上或混合结算状态
- [ ] 实现 timelock、multisig 和 emergency roles
- [ ] 确保 emergency role 无法提取用户资金
- [ ] 实现参数变更事件和链上审计记录

### 完成标准

- [ ] 单元测试覆盖所有 public/external functions
- [ ] 核心不变量通过 Foundry invariant tests
- [ ] 关键数学通过 fuzz tests 和边界测试
- [ ] 完成至少一次独立智能合约审计
- [ ] 所有审计 High/Critical 问题关闭后才能进入 limited mainnet beta

## P4 — Confidential Strategy Runtime

### Builder SDK

- [ ] 将首版限定为固定策略执行/模型推理，不提供训练入口，不允许外部训练服务替换已发布模型
- [ ] 定义可变运行状态与固定模型/策略配置的边界；正常行情指标和持仓更新不得误判为训练
- [ ] 为固定模型推理制定 CPU、内存、执行时限及可支持硬件的资源准入标准，不默认所有模型都能低成本运行
- [ ] 定义标准策略入口：initialize、onMarketData、onExecution、onTimer
- [ ] 定义策略允许读取的 market data 和账户摘要
- [ ] 定义语义化 target allocation/position Intent
- [ ] 禁止策略直接生成任意 calldata
- [ ] 提供本地回测、paper trading 和 deterministic replay 工具
- [ ] 提供策略资源限制、timeout 和 memory limit
- [ ] 提供 Builder 本地签名和 artifact 加密工具
- [ ] 提供 release manifest 生成和验证工具

### Build 与发布

- [ ] 创建 reproducible build pipeline
- [ ] 锁定 compiler、runtime、依赖和 base image
- [ ] 生成 source、dependency、model 和 container commitments
- [ ] Builder 在本地加密 artifact 后再上传
- [ ] 实现 malware、network access 和 dependency policy scanning
- [ ] 实现 release approval、canary、rollback 和 revocation
- [ ] 禁止把 secret、source 或 model 写入普通日志

### Confidential Compute

- [ ] 确定首个 TEE/confidential compute provider
- [ ] 构建 enclave/runtime image
- [ ] 实现 remote attestation verification
- [ ] 让 artifact 解密权限绑定 approved measurement
- [ ] 让 runtime signing key 绑定 approved measurement
- [ ] 限制 outbound network，只允许明确的数据与服务端点
- [ ] 隔离不同 Builder、Family、Release 和消费者任务
- [ ] 实现 attestation expiry、rotation 和 emergency revoke
- [ ] 完成 host compromise、rollback 和 side-channel threat analysis

### Intent 生成

- [ ] 对输入数据进行 canonical validation
- [ ] 将策略输出转换为固定精度语义化 Intent
- [ ] 将 Intent 绑定到 Family、Release、Vault、Policy 和 chain ID
- [ ] 设置短 deadline 和唯一 nonce
- [ ] 对 Intent 签名，不暴露 features、parameters 或 confidence
- [ ] 实现 per-Pass/per-Vault query budget，降低模型抽取风险
- [ ] 实现 retry 的幂等和去重语义

### 完成标准

- [ ] 平台普通应用服务器无法读取 Builder 明文 artifact
- [ ] 未通过 attestation 的 runtime 无法获得解密或签名权限
- [ ] Runtime compromise 不会获得用户主钱包或 arbitrary-call 权限
- [ ] 固定模型正常推理与状态恢复通过测试；模型替换、未授权配置改变及外部模型注入按规范被拒绝
- [ ] Builder SDK 示例策略可以完成本地回测、testnet 运行、停止和退出；版本升级另待产品确认

## P5 — 后端服务

### API Gateway 与身份

- [ ] 实现 wallet challenge-response 登录
- [ ] 支持 EOA 和 ERC-1271 wallet authentication
- [ ] 实现短期 session、refresh、logout 和 session revoke
- [ ] 实现 request schema validation、body limit 和 rate limit
- [ ] 实现 idempotency key
- [ ] 实现 RBAC：consumer、builder、market-maker、operator、auditor
- [ ] 建立 API versioning 和 OpenAPI 文档

### Strategy Service

- [ ] 创建和查询 Strategy Family
- [ ] 管理 Builder profile、signing key 和 reputation
- [ ] 处理 encrypted artifact upload
- [ ] 生成并验证 Release Manifest
- [ ] 协调 release review、attestation、activation 和 rollback
- [ ] 管理 strategy metadata、风险披露和版本说明
- [ ] 实现 lineage/fingerprint 数据接口

### Token 与 Marketplace Service

- [ ] 索引 Strategy Token/Pass ownership 和状态
- [ ] 创建 primary issuance order
- [ ] 索引 secondary orders、trades、liquidity 和 fees
- [ ] 计算市场深度、成交量和 bid-ask spread
- [ ] 管理 Market Maker inventory 与风险限制
- [ ] 检测 wash trading、self-trading 和异常价格行为
- [ ] 将 Pass 市场数据与策略业绩数据完全分离

### Vault 与 Execution Service

- [ ] 创建并索引 User Strategy Vault
- [ ] 处理 Pass bind、unbind、cooldown 和 exit workflow
- [ ] 校验用户 SaaS 运行额度与资金分配，允许存款超过额度并将未分配部分计入隔离闲置余额
- [ ] 接收 confidential runtime Intent
- [ ] 在提交链上前完成第二层 policy simulation
- [ ] 实现 private relay/transaction submission
- [ ] 跟踪 pending、confirmed、finalized、reverted 和 replaced 交易
- [ ] 处理 partial fill、refund、reconciliation 和 retry
- [ ] 实现 keeper failover 和 nonce coordination

### Indexer

- [ ] 运行 Robinhood Chain archive/read node 或可靠 provider
- [ ] 实现多个 RPC provider 的健康检查和切换
- [ ] 索引 Registry、Pass、Vault、Intent、Adapter 和 Fee 事件
- [ ] 处理链重组、重复事件、漏块和 backfill
- [ ] 分别记录 seen、confirmed 和 finalized 状态
- [ ] 定期与链上状态进行全量 reconciliation

### Performance Service

- [ ] 索引 Reference Vault 资产、成交、费用和 Release
- [ ] 计算日、周、月、年和 since-inception Reference NAV
- [ ] 计算最大回撤、波动率、Sharpe、换手率和运行天数
- [ ] 处理 realized/unrealized PnL
- [ ] 处理 Stock Token corporate actions 和 multiplier
- [ ] 计算 active-vault slippage、tracking error 和 execution dispersion
- [ ] 排除未启用 Pass 和非活跃 Vault
- [ ] 生成 append-only performance epochs 和 commitments
- [ ] 确保新 Release 不会重置历史曲线

### Notification 与运营后台

- [ ] 实现交易、失败、容量、费用、版本和安全通知
- [ ] 实现 Builder release 管理后台
- [ ] 实现 Consumer support 和 dispute timeline
- [ ] 实现 Market Maker inventory dashboard
- [ ] 实现暂停、撤销和 incident 操作面板
- [ ] 所有管理操作写入不可篡改审计日志

### 数据库与存储

- [ ] 设计 users、builders、families、releases、passes、vaults schema
- [ ] 设计 intents、executions、performance epochs 和 fee ledger schema
- [ ] 使用随机 public ID，避免可枚举自增 ID
- [ ] 加密敏感 metadata 和对象存储 artifact
- [ ] 密钥只保存 handle，不保存明文 private key
- [ ] 定义 retention、backup、restore 和 data deletion policy
- [ ] 完成数据库迁移、回滚和灾难恢复演练

### 完成标准

- [ ] 所有写操作幂等且可审计
- [ ] Chain indexer 能从 genesis/checkpoint 重建状态
- [ ] Runtime、API、Keeper 和 Performance Service 可独立扩缩容
- [ ] 故障不会导致重复执行或越过 Policy

## P6 — 前端产品

### 公共市场

- [ ] 首页：产品解释、风险提示和主要策略入口
- [ ] Strategy discovery：搜索、筛选、排序和 watchlist
- [ ] Strategy detail：简介、Builder、风险、版本和 lineage
- [ ] `Strategy Performance`：Reference NAV 和不可重置历史
- [ ] `Execution Quality`：滑点、tracking error、延迟和失败率
- [ ] `Capacity`：最大、运行、绑定、部署和可用容量
- [ ] `Pass Market`：价格、深度、成交量、价差和流动性
- [ ] 明确区分回测、paper、reference live 和 consumer live 数据
- [ ] 显示数据更新时间、oracle、Release 和异常事件

### 购买与交易 Strategy Token

- [ ] 钱包连接和 Robinhood Chain 网络切换
- [ ] Token 首次发行购买流程
- [ ] 二级市场买入、卖出、订单或 AMM 交互
- [ ] 清楚展示代币权利、容量、费用和不提供的权利
- [ ] BOUND/COOLDOWN Pass 禁止出售并解释原因
- [ ] 显示价格影响、滑点、手续费和交易最终状态
- [ ] 提供交易历史和成本基础记录

### 策略运行

- [ ] 一键创建或选择 User Strategy Vault
- [ ] 将 FREE Pass 绑定到 Vault
- [ ] 设置存入资金和容量
- [ ] 配置用户 Risk Policy
- [ ] 使用人类可读方式展示签名内容
- [ ] 显示当前 Release、授权期限和风险上限
- [ ] 启动、暂停、恢复和停止策略
- [ ] 显示 Vault 仓位、执行记录、费用和个人收益
- [ ] 提供始终可访问的 revoke、reduce-risk 和 withdraw
- [ ] 实现 cooldown 和退出进度页面

### Builder 控制台

- [ ] Builder onboarding 和身份/地址设置
- [ ] 创建 Strategy Family
- [ ] 设置 Pass supply、Declared Capacity 和费用
- [ ] 上传加密 artifact
- [ ] 预览并签署 Release Manifest
- [ ] 运行回测、paper、shadow 和 canary
- [ ] 发布、暂停、回滚和废弃 Release
- [ ] 查看 Reference Performance、容量和执行质量
- [ ] 查看 primary sale、royalty 和 fee 收入
- [ ] 查看 Builder commitment 状态（规则确定后实现）

### Market Maker 控制台

- [ ] 策略代币市场和流动性概览
- [ ] 库存、成本、PnL 和风险预算
- [ ] 报价、spread 和 LP position 管理
- [ ] 单策略和组合级库存上限
- [ ] 异常成交、流动性撤出和 circuit breaker
- [ ] 区分做市收入与 Protocol 收入

### 管理与安全体验

- [ ] 风险披露、地区限制和适当性确认
- [ ] 合约地址、Release hash 和审计报告可验证展示
- [ ] 防钓鱼 domain、合约和签名提示
- [ ] 交易 pending/finalized/reorg 状态展示
- [ ] Accessibility、mobile responsive 和国际化
- [ ] 错误信息不泄露内部状态、策略或 secret

### 完成标准

- [ ] 新消费者能够在不了解合约细节的情况下安全完成购买、绑定、运行和退出
- [ ] 每次签名都明确展示最大资金、资产、期限、费用和撤销方式
- [ ] 用户永远不会把 Pass 价格误认为策略净值
- [ ] 核心流程通过真实用户可用性测试

## P7 — 数据、业绩与策略声誉

### Reference Performance

- [ ] 确定 Reference Vault 资金和标准名义规模
- [ ] 定义 Reference NAV methodology
- [ ] 同时发布 gross 和 net-of-cost performance
- [ ] 锁定时区、cutoff、估值频率和异常数据处理
- [ ] 定义 corporate action、delisting 和 market halt 处理
- [ ] 定义版本升级日的收益归属
- [ ] 防止 Builder 选择性停止或遗漏亏损区间

### Verified Track Record

- [ ] 保存连续 performance epochs
- [ ] 将 epoch commitment 锚定到链上
- [ ] 显示策略实盘年龄和数据完整度
- [ ] 区分 backtest、paper、shadow 和真实资金
- [ ] 显示所有暂停、回滚、oracle outage 和 adapter incident
- [ ] 设计第三方审计/证明接口

### Capacity 与 Execution Quality

- [ ] 建立真实资金规模下的 slippage/capacity 模型
- [ ] 监测 capacity utilization 对收益的影响
- [ ] 监测 Reference Vault 与 active user vault 的 tracking error
- [ ] 计算执行延迟、失败、partial fill 和 price impact
- [ ] 在不泄露实时 alpha 的情况下延迟或聚合发布统计

### Reputation 与 Lineage

- [ ] Builder reputation 包含策略寿命、连续性、违规和事故
- [ ] Strategy reputation 不因更换 Release 重置
- [ ] 研究 position、signal、PnL 和 trade-overlap fingerprint
- [ ] 定义疑似 clone 的人工审核和申诉流程
- [ ] 防止 Builder 通过新地址轻易清除失败历史

## P8 — 安全工程

### 应用安全

- [ ] 完成每个服务的 threat model
- [ ] 所有外部输入使用严格 schema validation
- [ ] 实现认证、授权、CSRF/CORS 和 rate-limit 策略
- [ ] 禁止 stack trace、secret、token、策略和账户数据泄露
- [ ] 实现 SSRF、command injection、path traversal 和 unsafe upload 防护
- [ ] 实现 dependency pinning、SBOM 和供应链扫描
- [ ] 为 artifact upload 建立隔离扫描环境

### 密钥与 Secret

- [ ] 用户私钥永不进入 QuantPass 服务
- [ ] Runtime、Keeper、Protocol 和 Market Maker 使用不同密钥域
- [ ] 使用 KMS/HSM 管理服务密钥
- [ ] 实现 key rotation、revoke、backup 和 break-glass 流程
- [ ] 所有 secret access 产生审计事件
- [ ] 禁止在日志、错误、analytics 和 tracing 中记录 secret

### 智能合约安全

- [ ] 建立资产流和权限图
- [ ] 检查 reentrancy、signature replay、front-running 和 griefing
- [ ] 检查精度、舍入、overflow、fee accounting 和 share inflation
- [ ] 检查 oracle manipulation、stale price 和 flash-loan path
- [ ] 检查 malicious token、adapter 和 callback
- [ ] 检查 pause、upgrade、governance 和 timelock bypass
- [ ] 使用 static analysis、fuzzing、invariant 和 formal verification
- [ ] 至少两套独立审计或一套审计加公开竞赛后再扩大额度

### 隐私与策略保护

- [ ] 明确 TEE 能保护和不能保护的范围
- [ ] 建立 artifact encryption 和 attestation policy
- [ ] 禁止公开实时 signal、target 和非必要 order metadata
- [ ] 使用 private transaction path 降低 pre-trade 泄露
- [ ] 建立 query budget 和反模型抽取监控
- [ ] 对公开统计采用时间延迟、最小 cohort 和聚合阈值

### Incident Response

- [ ] 建立安全事件等级与联系人
- [ ] 建立 contract pause、release revoke 和 adapter disable runbook
- [ ] 建立 sequencer、RPC、oracle 和 venue outage runbook
- [ ] 建立用户通知和公开事后报告模板
- [ ] 进行 tabletop exercise 和恢复演练
- [ ] 启动漏洞披露和 bug bounty

## P9 — 合规、法律与市场规则

- [ ] 分析 Strategy Token/Pass 的权利结构和司法辖区分类
- [ ] 分析自动执行、performance fee、跟单和资产管理要求
- [ ] 分析 Robinhood Stock Token 的地区和用户资格限制
- [ ] 明确 KYC/KYB、制裁筛查和地域封锁范围
- [ ] 制定 Builder 上架协议、消费者条款和风险披露
- [ ] 定义市场操纵、wash trading 和内幕信息规则
- [ ] 定义 Builder marketing 和业绩宣传标准
- [ ] 设计数据隐私、保存、导出和删除流程
- [ ] 确定 Protocol 与 Market Maker 是否需要组织隔离
- [ ] 在主网公开销售前获得正式法律意见

## P10 — DevOps、SRE 与生产运营

### 环境

- [ ] 建立 local、test、testnet、staging 和 production 环境
- [ ] 每个环境使用独立账户、密钥、数据库和 RPC 配置
- [ ] Infrastructure as Code
- [ ] 可重复、可回滚和有审批记录的部署流程
- [ ] Production deploy 使用 artifact digest，不使用 mutable tag

### 可观测性

- [ ] API、Runtime、Keeper、Indexer 和 Performance Service metrics
- [ ] 分布式 tracing 使用脱敏字段
- [ ] 链上交易 pending、revert、reorg 和 finality dashboard
- [ ] RPC、oracle、venue 和 attestation health checks
- [ ] Vault asset reconciliation 和 capacity invariant alerts
- [ ] SLO、error budget、on-call 和 escalation policy

### 可靠性

- [ ] Keeper active-active 或安全 failover
- [ ] RPC/provider 自动切换且不降低 finality 标准
- [ ] 数据库 point-in-time recovery
- [ ] 定期备份恢复演练
- [ ] 模拟 sequencer downtime、oracle outage 和链重组
- [ ] 确保重复消息和服务重启不会重复交易

## P11 — 测试与质量保证

### 测试层级

- [ ] 共享协议 schema unit tests
- [ ] Solidity unit/fuzz/invariant tests
- [ ] Backend unit、integration 和 contract tests
- [ ] Frontend component、accessibility 和 E2E tests
- [ ] Runtime deterministic replay tests
- [ ] Testnet end-to-end execution tests
- [ ] Robinhood Chain fork tests
- [ ] Load、stress、soak 和 chaos tests
- [ ] Security regression tests

### 必测异常

- [ ] 重复 Intent 和并发 nonce
- [ ] 过期签名、错误 chain ID 和错误 Vault
- [ ] Pass 在执行过程中转移或解绑
- [ ] Release 在执行过程中暂停或回滚
- [ ] Oracle 过期、价格跳变和 feed 不一致
- [ ] Partial fill、revert、replacement 和 dropped transaction
- [ ] Sequencer/RPC/Indexer 不一致
- [ ] Corporate action 在持仓期间发生
- [ ] Capacity 在用户进入或退出时下降
- [ ] Fee 舍入、极小金额和 token decimal 差异
- [ ] Builder、Keeper、Protocol 或 Market Maker 密钥泄露

### 完成标准

- [ ] 核心路径覆盖率目标确定并达到
- [ ] 所有安全不变量都有自动测试
- [ ] 测试能够在 CI 和本地确定性重现
- [ ] 主网前完成灾难恢复和 incident simulation

## P12 — 分阶段发布

### Phase 0：Specification

- [ ] 完成 P0 与 P1
- [ ] 白皮书、ADR、threat model 和接口规范评审通过

### Phase 1：Robinhood Chain Testnet

- [ ] 完成 Registry、测试 Pass、Vault、Policy Kernel 和 mock Adapter
- [ ] 完成 Builder SDK、paper runtime 和 Reference Vault
- [ ] 完成最小前端、API、Indexer 和 Performance Service
- [ ] 完整 testnet 端到端演示

### Phase 2：Limited Mainnet Beta

- [ ] 单一 Venue Adapter
- [ ] 小额 hard cap 和 allowlisted 用户
- [ ] 无公开二级 Pass 市场或仅有限测试市场
- [ ] 通过外部审计和生产 readiness review
- [ ] 完成监控、on-call、incident 和 rollback 演练

### Phase 3：Strategy Token Marketplace

- [ ] Builder 自助发布
- [ ] 固定供应 Strategy Token/Pass
- [ ] 二级市场和 Market Maker 流动性
- [ ] Verified Performance、Capacity 和 Execution Quality 完整展示
- [ ] 分阶段提高策略和协议容量

### Phase 4：多策略与多链

- [ ] 增加更多 Robinhood Chain Adapter
- [ ] 增加 perps 或其他复杂策略类型
- [ ] 接入 BNB Smart Chain
- [ ] 实现 domain-separated capacity/risk budget
- [ ] 在没有安全跨链状态时禁止共享同一即时风险额度

## 全项目 Definition of Done

QuantPass v1 只有在满足以下条件后才视为完成：

- [ ] Builder 能发布加密策略和固定供应策略代币
- [ ] 消费者能购买、绑定、运行、停止和出售策略代币
- [ ] 用户主钱包资产不会进入策略权限范围
- [ ] Builder 和平台无法任意转移用户 Vault 资产
- [ ] 策略源代码、模型和参数不会交付给消费者
- [ ] 公开策略收益来自连续 Reference Vault，而非 Pass 持有人平均值
- [ ] 未启用 Pass 不会被计为零收益
- [ ] Strategy Performance、Execution Quality、Capacity 和 Pass Market 清晰分离
- [ ] 策略版本升级不会重置历史
- [ ] Market Maker 收入与 Protocol 收入独立披露
- [ ] 核心安全不变量通过 fuzz、invariant、fork 和外部审计
- [ ] 用户可以在故障和暂停状态下安全退出
- [ ] 生产监控、事故响应、备份和恢复流程经过演练
- [ ] 产品结构完成适用司法辖区的法律与合规评估

## 相关文档

- [QuantPass 白皮书](WHITEPAPER.zh-CN.md)
- [Product Model（历史实验）](product-model.md)
- [Security Model v0（历史实验）](security-model-v0.md)

# QuantPass 白皮书

版本：0.2.1 Clarification Draft  
日期：2026-09-05  
状态：产品与协议设计草案，不构成最终技术、经济或法律承诺

修订说明：本轮仅同步用户已确认的产品意图，并未关闭工业级评审风险。产品解释以[产品决策登记](PRODUCT-DECISIONS.zh-CN.md)为准。下文固定供应机制、Reference Vault、TEE 选型和部分治理规则仍为候选设计，不代表用户已经批准。永久使用权已经确认，但永久运营义务及成本安排尚待确认。用户进一步要求策略上传后不可更改：下文原有 Release 升级/回滚和未来版本访问机制待重新审议，不得当作已批准权限；不可变范围见 ASK-004。

M00 阅读边界（2026-09-05）：[术语与规范优先级](specs/glossary.md)、[可验收样例](specs/core-scenarios.md)及[冲突/技术债清单](specs/baseline-review.md)是实施入口。下文历史章节中的“升级”“回滚”、Reference Vault、HWM、固定供应及 TEE 机制均不得仅凭确定语气被视为批准；涉及 D1/D2/D4/D5 的机制仍待决定。M00 文档自测不关闭原评审问题，也不构成生产许可。

## 摘要

QuantPass 是一个量化策略代币发布以及运行平台，首版只支持 Robinhood 官方发行、公布合约地址的美股 Stock Tokens，排除 meme coin。具体资产地址、ETF 范围、结算资产、交易场所和交易方式尚待确认。

策略 Builder 发布上传后不可更改的私有策略并定义容量，使用权期限永久。收益分成由实际运行策略的用户从其自身策略利润中支付给 Builder，未运行者不参与这笔分配；Builder 可定义分成规则的范围、费率及核算方式仍待确认。策略以 `Strategy Family` 标识，通过 `Strategy Pass` 表达使用权与容量。发行数量、同质化与可拆分规则由协议如何确定，以及不可变策略与版本身份的关系，仍待确认；不得默认交给 Builder 自由修改。使用策略不需要向消费者交付源代码、模型权重、参数、特征工程或中间信号。

消费者可以只持有或交易 Pass，也可以将 Pass 绑定到自己控制的 `User Strategy Vault`。用户允许存入超过 Pass 额度的资金，但参与策略运行的资金受 SaaS 额度限制；未参与的部分保留为用户可自行提取的闲置余额，不自动退回钱包。策略只能生成受约束的语义化交易意图，链上 Policy Kernel 负责执行最终风险检查，策略本身不能获得闲置余额的任意动用权、任意调用权或用户主钱包控制权。

QuantPass 将策略业绩、Pass 市场价格、策略容量和单个用户收益严格分离。市场公开日、周、月、年及成立以来的策略收益，不因部分 Pass 未启用而被稀释。持续运行的标准 `Reference Vault` 是候选核算机制，其资金来源、可比性与用户认可尚待确定；真实业绩记录不得通过发布新版本选择性重置。

Robinhood Chain 被选为第一优先部署网络。协议核心保持 EVM 可移植性，BNB Smart Chain 等网络可在后续阶段通过独立风险额度与执行适配器接入。

## 1. 愿景

优秀量化策略通常面临一个无法同时解决的三角问题：

- 直接出售源码会失去知识产权和长期收益；
- 中心化跟单平台要求用户信任平台和不透明的风险管理；
- 公开链可以验证资产和交易，却会公开策略行为，并且无法天然保护私有计算。

QuantPass 的目标不是把策略代码公开上链，而是把以下内容变成可验证、可组合和可交易的协议对象：

1. 策略使用权；
2. 稀缺策略容量；
3. 不可重置的真实业绩；
4. 不可变发布身份与完整运行历史；
5. 用户明确授权的风险边界。

最终目标是让 Builder 像软件开发者销售软件使用权一样销售策略能力，同时让消费者始终控制自己的资产，并让市场依据真实业绩、容量、执行质量和策略寿命对使用权定价。

## 2. 核心问题

### 2.1 Builder 面临的问题

- 源代码、模型和参数一旦交付便容易被复制；
- 信号服务可能被转售或高频探测；
- 缺少长期、可信且不能选择性删除的实盘记录；
- 同一个低容量策略可能被重复出售，导致滑点和收益衰减；
- 小幅修改参数后重新包装，可能割裂业绩历史；现有 Pass 是否具有未来版本访问权尚未确认。

### 2.2 消费者面临的问题

- 很难验证截图、回测或自报收益；
- 无法确认 Builder 是否超卖策略容量；
- 跟单执行可能获得过宽的钱包或账户权限；
- Builder 可以改变策略版本或风险，而用户难以及时发现；
- 策略、平台、执行协议、预言机和跨链桥的风险通常被混为一谈。

### 2.3 市场面临的问题

- 策略收益、用户收益和策略使用权价格没有统一口径；
- 缺少容量利用率、版本历史和执行偏差等可比较数据；
- 做市、平台排序和业绩计算可能产生利益冲突；
- 链上透明性有助于验证，却可能造成抢跑、MEV 和策略行为泄露。

## 3. 设计原则

### 3.1 使用权不等于资产控制权

`Strategy Pass` 证明用户有资格使用策略，但不能单独授权任何交易。实际交易必须同时满足 Pass、用户 Vault、当前 Policy、有效 Strategy Release 和单次 Intent 的全部条件。

### 3.2 策略输出不等于可执行 calldata

策略只能输出目标仓位或目标配置等语义化 Intent。审计过的 Venue Adapter 负责构造具体协议调用。Builder 无法要求 Vault 调用任意合约、任意函数或任意收款地址。

### 3.3 以隔离资金建立硬风险边界

每个消费者通过用户自有 Strategy Vault 存入愿意承担风险的资金。Vault 之外的主钱包资产永远不在策略权限范围内。

### 3.4 策略历史属于 Family

发布身份、暂停和异常记录不应被选择性删除。此历史完整性要求不授予修改已发布策略的权限；Family/Release 关系及是否允许任何版本迁移仍受 D1/D4 约束。

### 3.5 链上验证边界，不公开私有算法

链上验证所有权、容量、授权、风险、费用和状态转换；策略代码、模型权重和中间信号保留在保密运行环境中。

### 3.6 明确承认残余信任

QuantPass 不宣称能够证明策略一定盈利，也不宣称完全阻止用户通过长期成交行为推断策略。系统追求的是最小化信任、限制损失边界、提高复制成本并提供可审计证据。

## 4. 参与者

### Builder

开发并发布上传后不可更改的私有策略，定义策略容量。按约定从实际运行用户的自身策略利润中获得分成；分成规则的定制边界尚待确认。不能默认 Builder 可以自定发行数量、使用期限、任意收费或事后单方修改规则。首次发行收入、二级市场 royalty 和其他策略服务费的具体权利结构仍需确认。

### Consumer

购买或持有 Strategy Pass。消费者可以选择不启用 Pass，也可以将其绑定至自己的 Strategy Vault，并在容量和风险 Policy 范围内使用策略。

### Protocol

维护 Registry、Pass 生命周期、Vault、Policy Kernel、Adapter、Performance Ledger 和费用结算。Protocol 不应持有能够任意转移用户资产或读取 Builder 明文策略的通用权限。

### Market Maker

为 Strategy Pass 的一级或二级市场提供流动性，通过明确披露的 bid-ask spread、LP fee 或交易手续费获得收入。做市库存、做市收入和协议收入必须独立核算。

### Keeper / Relayer

提交策略 Intent、支付或代付 gas，并跟踪执行状态。Keeper 不具备修改 Intent 或突破 Vault Policy 的能力。

### Attestation / Infrastructure Provider

提供 confidential runtime、密钥管理、RPC、索引、预言机或私有交易传输。每项基础设施依赖必须作为独立信任假设披露。

## 5. 系统架构

```text
                         Builder
                            │
               encrypted strategy artifact
                            │
                            ▼
                  Confidential Runtime
                 strategy code + weights
                            │
                   signed semantic Intent
                            │
                            ▼
Consumer ──bind Pass──> User Strategy Vault
   │                        │
   │ owner / emergency      ├─ Pass ownership
   │ withdrawal             ├─ Release authorization
   │                        ├─ nonce + deadline
   │                        ├─ asset / adapter allowlist
   │                        ├─ exposure / slippage limits
   │                        └─ circuit breakers
   │                                │
   │                                ▼
   │                          Venue Adapter
   │                                │
   └────────────────────────> Robinhood Chain venue

Strategy Registry ──> Release / lineage / capacity
Performance Ledger ─> Reference NAV / execution quality
Pass Market ────────> primary issuance / secondary liquidity
```

## 6. 协议对象

### 6.1 Strategy Family

Strategy Family 是策略的永久身份，至少包含：

- Family ID；
- Builder 身份与签名密钥；
- Pass 供应记录（供应规则待 D1/D2 确认）；
- Declared Maximum Capacity；
- 容量单位；
- Fee Policy；
- Release lineage；
- Reference Performance 起始时间；
- 暂停、处罚和治理历史。

Builder 不应通过轻微修改模型或参数创建新 Family 来重置历史或再次发行容量。未来可以使用信号相关性、持仓相关性、PnL 相关性、交易重叠和持有周期等行为指纹辅助判断 lineage。

### 6.2 Strategy Release

以下为完整可运行构建承诺的候选字段，不是已批准 schema。D4 需要确认不可变对象和允许变化的运行状态；候选设计不应仅依赖单个源代码 hash：

```text
StrategyRelease {
  familyId
  releaseId
  semanticVersion
  encryptedArtifactHash
  containerImageHash
  dependencyLockHash
  modelWeightsCommitment
  parameterSchemaHash
  marketDataAdapterVersion
  executionProtocolVersion
  runtimeSigningKey
  releaseTimestamp
}
```

Hash 只能证明内容没有变化，不能独立证明实际运行了该内容。生产环境需要让 confidential runtime 的 attestation measurement 与登记的 Release Commitment 绑定。

### 6.3 Strategy Pass

Strategy Pass 是策略 SaaS 使用额度代币，不是 ETF 或基金份额。一枚代币对应 1 USDT 的策略运行额度；这个换算不代表代币售价为 1 USDT。购买代币与向个人 Vault 投入策略运行资金是两笔独立行为。

Strategy Pass 提供：

- 策略 SaaS 的永久使用资格；
- 每枚 1 USDT 的策略运行额度；
- 未绑定状态下的二级市场转让权。

上传后不可更改的策略如何对应 Family/Release，以及是否存在未来版本访问权，尚待确认，不自动授予替换执行版本的权限。

Strategy Pass 默认不代表：

- 对 Builder 公司或 QuantPass 协议的所有权；
- 对其他消费者利润的分红权；
- 固定收益、保本或收益保证；
- 对 Reference Vault 资产的赎回权。

### 6.4 User Strategy Vault

每个“用户 × 策略”使用独立 Vault。Vault 所有者始终是消费者，而不是 Builder、Keeper 或 Protocol。

Vault 必须保证：

- 只有 owner 可以改变核心授权或提取资产；
- 策略只能通过允许的 Adapter 交易；
- 不允许任意 `call`、`delegatecall` 或任意收款地址；
- 暂停状态仍允许撤销、减仓和退出；
- Fee 不能超过用户已签署的上限；
- 策略停止、Pass 转移或 Release 失效不会锁死用户资产。

### 6.5 Reference Vault

Reference Vault 是候选的持续运行标准实例，可用于形成公开、不可选择性重置的实盘收益曲线。是否采用它以及完整计量方法仍待 D5 确认；已确认的是未运行 Pass 不应被计作零收益。

Reference Vault 的最低规模、资金来源、容量缩放规则以及与 Builder commitment 的关系仍待完善。

## 7. Pass 与容量模型

### 7.1 SaaS 额度与发行数量

一枚 Pass 对应 1 USDT 的策略运行额度。用户持有并用于启用服务的 N 枚 Pass 对应 N USDT 的使用额度，不是持有某个资金池的 N 份资产。未投入资金的持有人不获得策略投资收益。

发行数量、是否允许增发、总使用额度如何与 Builder 声明容量对应，仍待确认。不能沿用旧版未定义的“市场授权后增发”作为既定规则。

### 7.2 运行额度与闲置余额

用户最新确认：允许存入超过 SaaS 额度的资金；分配给策略的运行资金受额度限制，其余保留为闲置余额，由用户自行提取。持仓上涨造成的临时浮盈适用下述容量缓冲规则，因此运行额度不是严格的实时持仓市值上限。这一决定替代此前的“超额自动退回钱包”，不默认自动买入 Pass。

示例（暂无持仓和待结算负债）：用户持有 1,000 枚 Pass，存入 1,200 USDT，最多分配 1,000 USDT 给策略；另 200 USDT 为闲置余额，可由用户申请提取，无需为了这部分提款退出运行中的策略，也不赎回或销毁 SaaS 代币。

闲置余额必须与运行资金、订单预留和待结算负债分开核算；策略不得将闲置余额用于下单、抵押或绕过额度。是否允许闲置资金自动补足策略亏损，尚待用户明确授权，不能默认启用。用户可随时申请提取真实可用的闲置余额，不应受策略停止或 Pass 解绑定流程限制；停链或外部资产转账受限时不承诺即时到账。

持仓市值从 1,000 上涨至 1,200 USDT 与“多存了 200 USDT 闲置现金”不是同一种状态。用户接受此类浮盈暂时超过使用额度，待策略自身卖出/结算后，将超额收益隔离为闲置余额，不为了普通浮盈立即强制卖出。具体部分成交/再平衡的结算边界、费用顺序和归集时点仍需定义。不能只修改账本标签就把仍承担价格风险的持仓称为不参与策略的可提现现金。

Builder 发布最大容量时预留 10%–20% 的运行容量缓冲，用于容纳这类临时增长。这是容量预留，不是实际资金储备，不是 Builder 的“10%”投入或赔付承诺，也不自动增加每枚 Pass 的基础运行额度。比例的计算基数、具体比例的决定方式，以及总容量与可发行/分配额度的公式仍待用户确认。

有限缓冲不能保证覆盖任意幅度的上涨、连续浮盈或市场容量收缩。接近或耗尽缓冲时的新增资金准入、交易限制、告警与恢复措施仍待决策；目前未授权以缓冲耗尽为由自动强制平仓，不得将该风险标记为已解决。

用户已决定暂时保留此问题，继续考虑。缓冲计算方式、具体比例和耗尽处理均维持待完善；讨论中的“总容量内扣除 20%”及“极端超限受限减仓”只是未批准建议，不作为发行或执行规则。

策略总容量是否随收益调整、流动性变化导致的安全运行上限及存量超额处理仍待设计。原有 Declared Maximum Capacity / Operational Capacity 分层仅为候选风控模型，不得用“同比例份额”默默改写每枚 1 USDT 的 SaaS 权利。权利额度、实际运行资本与市场可承受风险须分开核算。

### 7.3 Pass 状态机

```text
FREE ──bind──> BOUND ──request exit──> COOLDOWN ──settle──> FREE
                 │
                 └──────── emergency close ────────────────┘
```

- `FREE`：可交易，不占用实际执行容量；
- `BOUND`：绑定至一个 Vault，不可转让；
- `COOLDOWN`：正在撤销策略、平仓或结算；
- `FREE` Pass 的未使用状态不构成零收益记录。

v1 不建议出售仍带有用户仓位的 BOUND Pass。用户应先完成平仓和结算，再使 Pass 恢复可转让状态。

### 7.4 容量展示

市场必须分别展示：

- Declared Maximum Capacity；
- 当前 Operational Capacity；
- 已发行容量；
- 已绑定容量；
- 实际部署资金；
- 可用容量；
- 活跃 Vault 数量；
- 未启用 Pass 数量。

## 8. 策略执行协议

### 8.1 Intent

Confidential Runtime 只输出语义化 Intent，例如目标资产权重、目标名义敞口或允许的再平衡范围。Intent 至少绑定：

```text
familyId
releaseId
vault
venueAdapter
targetsHash
policyHash
nonce
validAfter
deadline
chainId
verifyingContract
```

用户授权和 Intent 应采用 EIP-712 typed structured data。链上必须另外消费 nonce，因为 EIP-712 本身不提供 replay protection。

### 8.2 Policy Kernel

Policy Kernel 在执行前验证：

- Pass 当前属于用户并处于 BOUND；
- Vault 与 Pass、Family 和 Release 匹配；
- Release 未暂停或撤销；
- Intent 签名、nonce、时间窗口和 chain domain 有效；
- Adapter、资产和函数在 allowlist 中；
- 价格源有效且没有过期；
- 单笔交易、单资产、总敞口和滑点在上限内；
- 当前状态没有触发 circuit breaker；
- 扣除费用后仍满足用户 Policy。

### 8.3 Venue Adapter

Adapter 把目标仓位转换为具体协议操作。一个 Adapter 只服务于一个清晰的外部协议和有限调用集合。外部协议升级、地址变化或资产行为变化必须产生新的 Adapter 版本和审计记录。

### 8.4 退出优先

任何 emergency pause、Builder suspension、Release revocation 或 Keeper outage 都不能取消用户退出权。系统应始终保留不增加风险的撤销和减仓路径。

## 9. Builder 策略保护

### 9.0 首版运行范围：不支持训练

用户确认首版先不支持平台训练、在线学习或通过训练自动调参。Builder 可在发布前自行训练模型，将固定模型与策略一起发布；QuantPass 首版负责保密运行和推理，不提供训练服务，也不接受借助外部训练服务动态替换已发布模型。

根据固定算法计算行情指标、更新持仓和执行状态仍属于正常运行，不应与模型训练混为一谈。模型权重和策略配置的完整性、允许写入的运行状态边界以及资源预算需要在发布规范中明确并验证。禁用训练入口不等于能够证明任意上传代码不含训练逻辑；必须在选定运行模型后落实相应约束和审查。

固定模型推理仍可能消耗较多计算资源，不能据此承诺无需 GPU 或固定低成本。后续训练支持仅作为待议扩展，不属于当前交付范围，也不改变已经发布策略的不可变要求。

### 9.1 Artifact 保护

Builder 上传加密 artifact。解密密钥只提供给满足指定 measurement 的 confidential runtime。平台普通应用服务器、消费者和 Keeper 都不应获得明文 artifact。

### 9.2 输出最小化

以下数据不应进入链上 Intent、公共 API 或普通日志：

- 源代码和模型权重；
- 特征工程和输入贡献度；
- 参数和阈值；
- 原始信号、置信度和模型解释；
- 非执行用途的连续查询结果。

### 9.3 行为泄露边界

消费者必然能够看到自己 Vault 的最终成交，公开链也会在交易确认后暴露调用和资产变化。Private relay 可以降低入块前抢跑和 MEV，但不能隐藏已经上链的结果。

QuantPass 能通过限制查询、延迟或聚合公开统计、控制容量和最小化输出提高复制成本，但不能承诺从策略行为中实现完美保密。

## 10. 消费者安全模型

主要控制包括：

- 独立 User Strategy Vault；
- 用户签署的风险 Policy；
- Pass 与 Vault 的一对一绑定；
- 禁止 arbitrary calldata；
- 审计过的 Adapter allowlist；
- 短时 Intent 与一次性 nonce；
- 价格和 corporate-action 数据新鲜度检查；
- 最大资金、敞口、滑点、换手率和费用限制；
- 用户随时 revoke；
- 亏损或异常状态下只允许减仓；
- 不可绕过的 owner emergency exit。

这些控制限制 Builder 能做什么，但不能保证策略盈利，也不能消除市场、预言机、外部协议、资产发行人或 Robinhood Chain 自身风险。

## 11. Verified Performance

### 11.1 公开主指标

市场公开的策略收益不等于 Pass 持有人平均收益。持续 Reference Vault 是候选来源，待 D5 确认；下面仅为无外部入金/出金条件下的简化展示，不是完整现金流调整算法：

```text
Reference NAV 起始值 = 100
期间收益率 = 期末 NAV / 期初 NAV - 1
```

公开时间尺度包括：

- 日；
- 周；
- 月；
- 年；
- 成立以来。

同时展示：

- 最大回撤；
- 波动率和风险调整后收益；
- 换手率；
- 实盘运行天数；
- 当前及历史 Release；
- 交易成本前后收益；
- 异常、暂停和回滚记录。

若采用 Reference NAV，设计须处理真实成交成本、协议费用、已实现与未实现 PnL、资产事件和运行身份；现金流调整、估值和费用处理仍待 D5 确认。不得用迁移或重新发布选择性重置曲线，也不据此授予升级权限。

### 11.2 活跃 Vault 执行质量

用户 Vault 的聚合数据只用于衡量实际执行质量：

- 相对 Reference Vault 的滑点分布；
- tracking error；
- 执行延迟；
- rejected/partial fill 比例；
- 活跃 Vault 间收益偏离。

只有测量周期内实际启用策略的 Vault 才进入 cohort。未启用 Pass 不计为零收益。

### 11.3 用户个人收益

个人收益对用户自己的账户记录、费用、税务和执行诊断仍然有用，但不作为市场判断策略质量的 headline 指标。

### 11.4 Pass 市场价格

Pass 价格反映市场对未来策略效用、稀缺性、容量需求、可转让性和流动性的预期。Pass 价格不是 Strategy NAV，也不是策略收益率。

### 11.5 策略页面信息隔离

策略页面应使用四个独立区域：

1. `Strategy Performance`：Reference NAV、收益、回撤、风险和版本；
2. `Execution Quality`：滑点、tracking error、延迟和失败率；
3. `Capacity`：声明、运行、绑定、部署和可用容量；
4. `Pass Market`：价格、成交量、深度、价差和流动性。

## 12. 经济模型

已确认的持续运营模式为：策略发行者向平台租用策略运行资源，平台同时参与策略收益分成。消费者购买的是永久 SaaS 使用额度，不因该租赁模式自动变成需要续费的订阅；发行者承担的资源租金不能默认转嫁为从消费者本金或闲置余额扣款。

### 12.1 Builder 收入

候选收入来源包括：

- Strategy Pass 首次销售；
- Pass 二级交易 royalty；
- 按实际策略服务收取的 performance fee；
- 经用户明确授权的固定服务费。

已确认只有实际运行用户从自身策略利润支付约定提成，未运行持有人不支付该提成。每 Vault 使用 high-water mark 是候选方法；利润、亏损恢复、结晶周期及费率仍待 D5 确认，不能将 HWM 写成已批准默认值。

### 12.2 Protocol 收入

已确认的收入方向：

- 向策略发行者收取运行资源租赁费，以相对低成本为产品目标；具体价格需经资源计量与成本验证，不承诺无限算力或固定低价；
- 与发行者分配消费者已经约定支付的同一笔策略收益提成，不额外向消费者叠加一笔平台收益提成；总提成率、平台分配比例、利润核算和结算规则仍待确认。

分配关系为：总绩效提成 = Builder 所得 + Protocol 所得。示例中，用户利润为 100 USDT、约定总提成为 20 USDT、平台从中分得 5 USDT，则用户保留 80 USDT、Builder 获得 15 USDT、平台获得 5 USDT。数字仅说明资金路径，不是已批准费率；发行者租金另外记账，不从该用户的 80 USDT 中再次扣除，也不重复计入这笔 20 USDT 总提成。

其他候选收入来源尚待确认，包括：

- Family 注册或发行服务费；
- Pass 一级和二级市场协议费；
- 实际执行产生的有限交易服务费。

租赁费与绩效分成分别计量、记账和披露。租赁服务是否包含行情数据、Gas、RPC、存储和恢复保障，以及租金账期、预付/后付、资源超额、欠费通知、续费与停服安排均待明确。发行者欠费不自动授权平台提取消费者资金或撤销用户永久使用权；已有持仓的安全处置与长期服务连续性必须另行制定，不能仅凭收入模式确认就标记风险已解决。

#### 运行费用保障与策略接续

用户确认正常运行费用由发行者通过自己的钱包支付；锁定额度支付仅作为备用保障，不是默认的日常预付租金模式。备用锁定额度的资产性质、启用条件、扣费授权、数量及补足仍待确认，不自动等同于容量缓冲或 Builder“10%”资金承诺；钱包支付也不等于已授权无限自动扣款。需要接续运营时向全市场通知，并通过竞价获得策略控制权。

已确认接手者承接运营责任、支付租费，并取得原发行者对应的后续分成权；不能修改已发布策略、单方提高消费者费率或动用用户资金。接手者能否读取源码由后续策略保护系统设计决定，目前既不自动授予，也不将永久禁止读取当成用户已确认规则。运营权、收益权、源码访问权和知识产权必须分别定义。竞价触发、公告期、原发行者补缴情形、竞价保证金与结算、分成切换时点、无人接手、过渡期运行及永久使用权保障均须进一步设计。

#### 发行者通过回购结束策略

用户确认发行者可通过回购 Pass 自主结束策略。**回购价格如何确定：待处理。** 当前不确定价格公式，不默认强制回购、销毁他人代币或允许在尚有持有人权利及运行仓位时直接停服。结束所需回购范围、持有人同意、资金与费用结清以及未回购 Pass 的处置仍待确认；回购 SaaS 代币与提取消费者运行本金是不同资金流程。

### 12.3 Market Maker 收入

Market Maker 可以通过以下方式盈利：

- Pass 买卖价差；
- AMM 或其他流动性机制的交易手续费；
- 明确披露的流动性激励；
- 承担 Pass 库存和波动风险的风险溢价。

如果 Protocol 运营方同时担任 Market Maker，应公开费用、库存、利益冲突和市场干预规则。策略排名和 Reference Performance 计算不得由做市库存利益决定。

### 12.4 Builder commitment — 待完善

关于 Builder 托管或投入“10%”的机制尚未确定，不应在当前版本写入智能合约或最终 tokenomics。

待确定问题包括：

1. 10% 是跟随同一策略的 co-investment、可罚没 bond，还是两项独立义务；
2. 计算基础是 Declared Maximum Capacity、BOUND Capacity 还是实际部署资金；
3. 用户进入和退出时，Builder 义务如何变化；
4. 如何防止 Builder 比用户提前退出；
5. 哪些客观可证明行为可以触发 slashing；
6. Reference Vault 在消费者未启用 Pass 时需要多少最低资金；
7. 正常策略亏损与协议违规如何严格区分。

## 13. Robinhood Chain 优先部署

Robinhood Chain 是 QuantPass 的第一优先网络。它是 EVM-compatible Arbitrum L2，主网 chain ID 为 `4663`，使用 ETH 作为 gas token，并面向链上金融和 tokenized real-world assets。

### 13.1 初始机会

- Stock Tokens 使用标准 ERC-20 接口；
- 链上 price feed 和 Data Streams 可用于估值与风险验证；
- 适合构建现货组合、轮动、再平衡和未来的结构化策略；
- EVM 兼容性允许 Solidity、Foundry、Hardhat 和主流钱包工具复用。

首版准入已确定为 Robinhood 官方发行、公布合约地址的美股 Stock Tokens，排除 meme coin。具体地址、是否含 ETF、结算资产、首个 Venue Adapter，以及现货/杠杆/做空边界仍待确认。链上存在某资产不等于它符合该准入规则；不得自动纳入策略交易范围。

### 13.2 Robinhood Stock Token 特殊处理

风险引擎和 Reference NAV 必须正确处理：

- corporate-action multiplier；
- 股票拆分、合并、分拆和现金事件；
- 交易时段与 underlying market 状态；
- token、发行人和 underlying asset 的不同风险；
- price feed 过期、失效和异常偏离；
- 地区和用户资格限制。

Stock Tokens 提供 underlying 股票或 ETF 的经济敞口，但不等同于对 underlying 证券的法律或受益所有权。具体产品开放地区和费用模型需要独立法律设计。

### 13.3 链级风险

Robinhood Chain 当前依赖 sequencer、permissioned validation、Security Council 和 Arbitrum L2 退出机制。协议必须为以下场景设计：

- sequencer downtime；
- RPC 或索引器故障；
- L2 soft finality 与 L1 finality 差异；
- canonical withdrawal challenge period；
- bridge、oracle 或外部 Venue 暂停；
- 治理或紧急升级。

生产环境至少使用多个独立 RPC/data provider，并尽可能运行自己的只读节点。链异常时系统停止新增风险，但保留安全退出路径。

## 14. 链上与链下边界

### 链上

- Strategy Family 和 Builder 身份；
- Pass 所有权、供应和状态；
- Capacity reservation；
- Release Commitment 与激活历史；
- 用户 Policy 与撤销状态；
- Vault 资产和 Adapter 调用；
- Intent nonce；
- Fee 结算；
- Performance Commitment 和治理记录。

### 保密链下

- 策略源代码；
- 模型权重、特征和参数；
- 明文 artifact；
- 非执行所需的中间信号；
- 详细日志和争议证据；
- attestation 与密钥管理工作流。

### 公开但延迟或聚合

- Reference Performance；
- Strategy version timeline；
- 容量和 AUM；
- 执行质量分布；
- 处罚和系统异常。

## 15. 治理与升级

以下为协议基础设施的候选治理约束，须与用户要求的策略上传后不可更改严格区分。任何 timelock、投票或迁移机制都不自行构成用户授权：

- Registry、Vault Kernel、Adapter 和统计组件分离；
- 核心 Vault 尽量不可升级；
- 新实现通过版本化部署和用户主动迁移采用；
- Adapter 增加或修改需要 timelock 和独立审计；
- Emergency role 只能暂停新增风险，不能提取用户资产；
- 运行历史不得选择性重置；该要求不授予 Builder 更新 Release 的权限；
- Pass 已确认具有永久 SaaS 权利；未来版本访问、替换执行或回滚权限未获批准，待 D1/D4 确认；
- 所有 admin 操作、签名者变更和 emergency action 链上可审计。

## 16. 主要风险

| 风险 | 主要缓解措施 | 无法消除的残余风险 |
|---|---|---|
| Builder 恶意提高风险 | 用户 Vault、Policy Kernel、Adapter allowlist | 授权范围内仍可能亏损 |
| Builder 策略泄露 | 加密 artifact、confidential runtime、输出最小化 | 最终成交可被行为分析 |
| 平台读取策略 | attestation-bound 解密、职责与密钥分离 | TEE 和供应链漏洞 |
| 任意合约调用盗取资金 | 语义化 Intent、无 arbitrary call、专用 Adapter | Adapter 或外部协议漏洞 |
| 重放与跨链重放 | nonce、deadline、chainId、verifying contract | 链重组和实现错误 |
| 虚假业绩 | 不可重置记录与待确认的真实业绩来源；Reference Vault 为候选 | 预言机和估值模型错误 |
| 容量超卖 | 待确认供应约束、链上绑定和容量状态 | 缓冲规则未定，市场冲击模型可能失准 |
| Pass 市场操纵 | 业绩与 Pass 价格分离、市场监控 | 低流动性资产固有波动 |
| Sequencer/RPC 故障 | 多供应商、停止新增风险、退出路径 | L2 可用性和退出延迟 |
| 合规风险 | 地域限制、披露、独立法律设计 | 不同司法辖区规则变化 |

## 17. 协议安全不变量

在进入主网前，至少需要通过单元测试、property testing、fuzzing、fork testing 和独立审计证明以下不变量：

1. Builder、Keeper 和 Protocol 无法将用户资产发送至非允许目标；
2. Vault owner 在任何暂停状态下都能撤销授权并执行允许的安全退出；
3. BOUND 或 COOLDOWN Pass 不能转让或重复绑定；
4. 已绑定容量不能超过 Operational Capacity；
5. 同一 Intent 不能执行两次，也不能在其他链、Vault 或 Adapter 重放；
6. 无效、过期或未授权 Release 不能产生新增风险；
7. Strategy Family 的历史不能因升级、迁移或 Builder 操作而重置；
8. 实际收取的任何费用不能超过用户授权和 Family Fee Policy；
9. Emergency pause 不能成为冻结用户资金的管理后门；
10. 预言机失效或数据过期时系统 fail closed，但允许经过定义的减仓路径。

## 18. 路线图

当前执行顺序以 [M00–M16 单人计划](DEVELOPMENT-PLAN.zh-CN.md)为准，以下替代旧的先主网 Beta 再补产品市场路线。

1. M00–M03：基础规格、工程检查、领域模型与本地模拟闭环。
2. M04–M08：真实依赖验证、合约、单一获准 Adapter 与测试网交易闭环。
3. M09–M15：保密发布、Builder/Consumer、业绩/收费、租费、市场及接续的产品测试网闭环。
4. M16：独立安全、法律、运维与可用性验收，另获用户授权后才允许真实资金发布。

训练、BSC/多链、perps 与更复杂资产、跨域容量和高级隐私机制均不属于首版已批准交付；未来扩展需要重新确认。未决容量、供应、计费和回购机制不得用测试参数越过发布关口。

## 19. 待完善事项

当前白皮书有意保留以下未定项：

1. Builder 10% commitment 的性质、计算基础和退出规则；
2. Reference Vault 的最低资本与资金来源；
3. Robinhood Chain 首个获准资产及交易 Venue Adapter；perps 不在首版已批准范围；
4. Strategy Pass 的具体 token standard；
5. Operational Capacity 的更新模型和治理权限；
6. Builder performance fee、royalty 和 protocol fee 的精确参数；
7. Pass Market 使用 order book、AMM 或混合模型；
8. Protocol 与 Market Maker 的组织和利益冲突隔离；
9. 上传后不可更改的精确对象、Family/Release 关系及是否允许任何版本迁移；不能默认自动升级或 rollback；
10. 司法辖区、用户资格、产品披露和合规结构。

这些事项在达成明确决策前，不应被写死在生产合约中。

## 20. 结语

QuantPass 的核心价值不只是发行一个可交易的策略代币，而是建立一套可信的策略商业化基础设施：Builder 保留策略知识产权，消费者保留资产控制权，策略容量无法被隐性超卖，策略业绩不能被选择性重置，市场能够独立定价长期使用权。

一个可持续的 QuantPass 必须同时处理策略保密、用户风险、执行质量、容量稀缺、版本升级、真实业绩和市场流动性。白皮书 0.2 定义了这些系统之间的边界，但不会用尚未解决的经济假设替代安全保证。

## 参考资料

- [Robinhood Chain Documentation](https://docs.robinhood.com/chain/)
- [Robinhood Chain — Connecting](https://docs.robinhood.com/chain/connecting/)
- [Robinhood Chain — Governance](https://docs.robinhood.com/chain/governance/)
- [Robinhood Chain — Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/)
- [Robinhood Chain — Bridging](https://docs.robinhood.com/chain/bridging/)
- [EIP-712: Typed structured data hashing and signing](https://eips.ethereum.org/EIPS/eip-712)
- [ERC-1271: Standard Signature Validation Method for Contracts](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337: Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [AWS Nitro Enclaves cryptographic attestation](https://docs.aws.amazon.com/enclaves/latest/user/kms.html)
- [Darwinex Risk Engine](https://help.darwinex.com/risk-manager)
- [Numerai model privacy](https://docs.numer.ai/numerai-tournament/faq)
- [Enzyme Protocol architecture](https://docs.enzyme.finance/enzyme-blue-protocol/architecture/release)

## 免责声明

本文档仅用于产品和协议设计讨论，不构成投资建议、收益承诺、证券发行文件或法律意见。Strategy Pass、performance fee、做市、自动执行和 tokenized assets 在不同司法辖区可能受到不同监管要求，正式产品设计需要独立法律、合规、税务与安全审查。

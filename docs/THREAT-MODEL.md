# QuantPass 威胁模型与风险登记

> 自动生成文件：唯一事实源为 `planning/risk-register.json`。完成本模型不表示风险已修复。

- 模型版本：1.0
- 日期：2026-09-06
- 目标网络：Robinhood Chain Testnet · Chain ID `46630`
- 风险数：22
- Open Critical：14
- Open High：8

## 强制假设

- **ASM-01** 钱包、RPC、Sequencer、Token、Venue、浏览器扩展和依赖均可能失效或被恶意控制。 失败策略：任何身份、字节码、签名或最终性证据不确定时停止写入。
- **ASM-02** Testnet 资产没有经济价值保证，也不能代表主网上线安全性。 失败策略：界面和文档持续标明 Testnet/模拟；检测到真实价值资产时拒绝。
- **ASM-03** 策略运行时、风险服务、执行器、部署者和 guardian 可能分别被攻陷。 失败策略：合约独立验证最小权限；任何单一角色都不能提取用户资产。
- **ASM-04** 链可发生延迟、交易替换、短重组、日志重复或 RPC 视图分叉。 失败策略：状态保持 pending，按 block hash 回滚并从安全 checkpoint 重放。
- **ASM-05** 比赛 MVP 的不可升级合约可能包含必须停用的缺陷。 失败策略：暂停风险增加、保留 owner 退出、发布新地址并由用户主动迁移。

## 安全目标

- **OBJ-01 · 资产安全**：除 owner 外没有角色可提取或任意转移 Vault 资产。
- **OBJ-02 · 授权完整性**：每次执行均绑定链、合约、账户、策略、目标、金额、nonce 和时效。
- **OBJ-03 · 会计守恒**：余额由实际转移差和链上状态决定，整数、decimals、手续费与舍入显式。
- **OBJ-04 · 安全退出**：暂停和服务故障不能永久阻止 owner 撤销与退出。
- **OBJ-05 · 状态真实性**：模拟、pending、confirmed、reorged 和 failed 状态不可混淆。
- **OBJ-06 · 可追溯发布**：源码、依赖、构建、ABI、字节码、配置和部署证据可复现。

## 资产

| ID | 资产 | 最坏影响 |
| --- | --- | --- |
| `AST-01` | Vault 测试资产与份额 | 未授权转移、永久锁定或错误归属 |
| `AST-02` | Owner 授权与 nonce | 跨链、跨合约或重复执行 |
| `AST-03` | 策略、政策与 release 信任根 | 恶意代码或宽松政策被当作可信 |
| `AST-04` | 会计状态、账户快照与事件 | 虚假余额、超额交易或对账失真 |
| `AST-05` | 安全退出可用性 | 用户资产被暂停、外部依赖或管理员永久锁定 |
| `AST-06` | 部署、密钥与供应链完整性 | 恶意字节码、权限接管或秘密泄露 |
| `AST-07` | UI 与链状态真实性 | 用户被诱导签名或把未确认状态当成功 |
| `AST-08` | 审计证据与隐私 | 无法追责、日志泄密或证据被覆盖 |

## 攻击者与故障主体

| ID | 攻击者/故障主体 | 能力 | 不可信任事项 |
| --- | --- | --- | --- |
| `ACT-01` | 恶意或受骗用户 | 提交畸形输入；签署或重放消息；切换钱包网络 | 提供系统信任根；声明链上最终性 |
| `ACT-02` | 受控策略运行时或作者 | 产生极端仓位提案；重放旧决策；伪造 release 元数据 | 风险批准；持有用户密钥 |
| `ACT-03` | 受控风险服务或签名者 | 尝试签发越权许可；泄露或滥用服务密钥 | 提取资产；单方面改变 allowlist |
| `ACT-04` | 受控 Executor | 抢跑、延迟、重复或替换交易；选择 gas 与 RPC | 提现；改变政策或角色 |
| `ACT-05` | 恶意 Token、Venue 或回调合约 | 重入；异常返回；改余额语义；消耗 gas | 报告实际到账金额；维持静态行为 |
| `ACT-06` | 恶意或故障 RPC/Sequencer | 返回错误链、字节码或状态；隐藏/重复日志；重排交易 | 单独证明链身份；单独证明最终性 |
| `ACT-07` | 受控前端、扩展或依赖 | 替换地址和 calldata；诱导签名；泄露页面数据 | 定义权限；代替钱包确认 |
| `ACT-08` | 恶意或误操作管理员 | 错误部署；错误暂停；泄露 deployer/guardian 密钥 | 移动用户资产；静默升级 |
| `ACT-09` | 外部网络攻击者 | 扫描 API；供应链投毒；资源耗尽；窃取公开构建信息 | 任何身份或输入 |

## 入口与信任边界

| ID | 入口 | 信任边界 | 输入 |
| --- | --- | --- | --- |
| `EP-01` | 钱包连接、切链、交易和 EIP-712 请求 | `TB-01` | `provider events`<br>`address`<br>`chainId`<br>`signature`<br>`transaction` |
| `EP-02` | 策略决策与 release 注册 | `TB-02` | `decision`<br>`policyHash`<br>`codeMeasurement`<br>`runtime signature` |
| `EP-03` | 账户快照与风险许可 | `TB-03` | `snapshot`<br>`block reference`<br>`permit`<br>`deadline`<br>`nonce` |
| `EP-04` | Executor 到 Vault 的交易入口 | `TB-04` | `calldata`<br>`value`<br>`permit`<br>`gas`<br>`replacement` |
| `EP-05` | RPC、receipt、logs 与区块头 | `TB-05` | `chainId`<br>`bytecode`<br>`receipt`<br>`logs`<br>`blockHash` |
| `EP-06` | Vault 到 Token/Venue 的外部交互 | `TB-06` | `transfer`<br>`approval`<br>`return data`<br>`callback` |
| `EP-07` | Indexer、缓存与 UI 状态 | `TB-07` | `pending state`<br>`confirmed state`<br>`reorg`<br>`checkpoint` |
| `EP-08` | HTTP API 与本地 Demo 会话 | `TB-01` | `cookie`<br>`origin`<br>`command`<br>`owner identifier` |
| `EP-09` | 配置、CI、依赖与部署工件 | `TB-05` | `environment`<br>`lockfile`<br>`workflow`<br>`artifact`<br>`deployment manifest` |

## 风险总览

| ID | 风险 | 等级 | 状态 | 负责人 | 截止 | 缓解任务 |
| --- | --- | --- | --- | --- | --- | --- |
| `R-001` | 调用方控制信任根 | Critical | open | `security-architecture` | `G1` | `TRUST-001`<br>`SPEC-002` |
| `R-002` | 许可跨链、跨合约或参数替换重放 | Critical | open | `contract-security` | `G2` | `TRUST-001`<br>`SPEC-002`<br>`CON-001`<br>`TST-001` |
| `R-003` | Demo 隐式角色提升进入 Testnet | Critical | open | `adapter-platform` | `G1` | `PRIV-001`<br>`ADAPTER-001`<br>`BACKEND-001` |
| `R-004` | 输入驱动余额被当作链上事实 | Critical | open | `accounting-and-indexing` | `G2` | `SPEC-001`<br>`CON-001`<br>`ADAPTER-001`<br>`INDEX-001` |
| `R-005` | 任意外部调用或 allowance 导致资产被抽走 | Critical | open | `contract-security` | `G2` | `SPEC-002`<br>`CON-001`<br>`CON-002`<br>`TST-001` |
| `R-006` | Token 或 Venue 回调重入破坏状态 | Critical | open | `contract-security` | `G2` | `CON-001`<br>`TST-001`<br>`TST-002` |
| `R-007` | 异常 Token 语义破坏会计 | Critical | open | `asset-and-accounting` | `G2` | `ASSET-001`<br>`SPEC-001`<br>`CON-001`<br>`TST-001` |
| `R-008` | 暂停或外部故障永久阻止用户退出 | Critical | open | `contract-and-operations` | `G2` | `SPEC-002`<br>`CON-002`<br>`TST-002`<br>`IR-001` |
| `R-009` | 错误网络、地址或 RPC 身份欺骗 | Critical | open | `rpc-and-release` | `G3` | `CONFIG-001`<br>`RPC-001`<br>`DEPLOY-001`<br>`VERIFY-001` |
| `R-010` | 重组、交易替换或重复日志造成重复执行 | Critical | open | `transaction-and-indexing` | `G3` | `TRUST-001`<br>`TX-001`<br>`INDEX-001`<br>`E2E-001` |
| `R-011` | 前端或钱包扩展替换交易 | Critical | open | `frontend-security` | `G3` | `WALLET-001`<br>`WEBSEC-001`<br>`SUPPLY-001`<br>`E2E-001` |
| `R-012` | 特权密钥泄露或角色集中 | Critical | open | `key-operations` | `G3` | `KEY-001`<br>`SECRET-001`<br>`CON-002`<br>`IR-001` |
| `R-013` | 整数、decimals、舍入或手续费错误破坏守恒 | Critical | open | `accounting-and-contracts` | `G2` | `SPEC-001`<br>`CON-001`<br>`TST-001`<br>`TST-002` |
| `R-014` | 部署或供应链工件被替换 | High | open | `release-engineering` | `G3` | `TOOL-001`<br>`SUPPLY-001`<br>`SEC-002`<br>`VERIFY-001` |
| `R-015` | 过期或伪造账户快照绕过风控 | High | open | `risk-platform` | `G2` | `TRUST-001`<br>`SPEC-002`<br>`RPC-001`<br>`E2E-001` |
| `R-016` | Demo 会话被当作 Testnet 钱包身份 | High | open | `backend-identity` | `G3` | `WALLET-001`<br>`BACKEND-001`<br>`PRIV-001` |
| `R-017` | 状态、事件或请求资源无界导致拒绝服务 | High | open | `data-platform` | `G3` | `DATA-001`<br>`RPC-001`<br>`OBS-001`<br>`E2E-001` |
| `R-018` | RPC 或 Sequencer 故障触发不安全重试 | High | open | `rpc-and-transaction` | `G3` | `RPC-001`<br>`TX-001`<br>`INDEX-001`<br>`OBS-001` |
| `R-019` | Indexer 把 pending 或孤块日志展示为最终状态 | High | open | `indexing-and-frontend` | `G3` | `TX-001`<br>`INDEX-001`<br>`WEBSEC-001`<br>`E2E-001` |
| `R-020` | 秘密进入仓库、构建产物或日志 | High | open | `security-operations` | `G3` | `SECRET-001`<br>`KEY-001`<br>`WEBSEC-001`<br>`OBS-001` |
| `R-021` | 部署地址或 runtime bytecode 与评审结果不一致 | Critical | open | `release-engineering` | `G3` | `CONFIG-001`<br>`SEC-002`<br>`DEPLOY-001`<br>`VERIFY-001` |
| `R-022` | 审计记录可覆盖、伪造或泄露敏感信息 | High | open | `data-and-observability` | `G4` | `DATA-001`<br>`OBS-001`<br>`IR-001` |

## 风险详情

### R-001 · 调用方控制信任根

- 分类：`authorization-bypass` · STRIDE S/E · CRITICAL · open
- 负责人：`security-architecture`；截止门禁：`G1`
- 场景：请求方同时提供用户公钥、可信 release、账户快照或风险签名者，因而可以把攻击者材料声明为可信。
- 缓解任务：`TRUST-001`、`SPEC-002`
- 验证：固定注册表与指定快照源的负向测试证明请求字段不能替换信任根。
- 残余风险：信任注册表维护者仍可能误登记，需职责分离与审计日志。

### R-002 · 许可跨链、跨合约或参数替换重放

- 分类：`replay` · STRIDE S/T/E · CRITICAL · open
- 负责人：`contract-security`；截止门禁：`G2`
- 场景：现有 ExecutionPermit 未绑定 chainId、verifyingContract、Vault、资产、target 或 calldata，旧许可可用于另一上下文。
- 缓解任务：`TRUST-001`、`SPEC-002`、`CON-001`、`TST-001`
- 验证：EIP-712 域和每个绑定字段的篡改测试、跨链测试及链上 nonce 单次消费测试全部拒绝。
- 残余风险：用户仍可能签署恶意但格式有效的请求，需可读签名 UI。

### R-003 · Demo 隐式角色提升进入 Testnet

- 分类：`authorization-bypass` · STRIDE E · CRITICAL · open
- 负责人：`adapter-platform`；截止门禁：`G1`
- 场景：localSimulation 根据命令类型自动把普通 demo 请求作为 executor 执行；若复用会形成直接越权。
- 缓解任务：`PRIV-001`、`ADAPTER-001`、`BACKEND-001`
- 验证：Testnet adapter 无任何 localSimulation 导入，身份来自钱包/专用 executor，越权命令端到端拒绝。
- 残余风险：演示与 Testnet UI 相似仍可能误导，需持续显式环境标记。

### R-004 · 输入驱动余额被当作链上事实

- 分类：`accounting-corruption` · STRIDE T/R · CRITICAL · open
- 负责人：`accounting-and-indexing`；截止门禁：`G2`
- 场景：本地 deposit、mark 和 settlement 接受调用参数；错误复用会制造没有 Token 转移或 receipt 支撑的余额。
- 缓解任务：`SPEC-001`、`CON-001`、`ADAPTER-001`、`INDEX-001`
- 验证：合约按 balance delta 记账，adapter 只从 receipt/event 建立状态，并与链上余额持续对账。
- 残余风险：被允许 Venue 的估值来源仍可能延迟或异常，必须与可提现资产分开显示。

### R-005 · 任意外部调用或 allowance 导致资产被抽走

- 分类：`authorization-bypass` · STRIDE T/E · CRITICAL · open
- 负责人：`contract-security`；截止门禁：`G2`
- 场景：过宽 target/selector、任意 calldata、delegatecall 或无限授权让 executor/venue 绕过 withdraw 限制。
- 缓解任务：`SPEC-002`、`CON-001`、`CON-002`、`TST-001`
- 验证：allowlist、selector、value 和精确 approve 的负向测试；静态分析确认不存在任意调用路径。
- 残余风险：允许目标自身仍可能有漏洞，因此 MVP 目标数量必须最小且字节码固定。

### R-006 · Token 或 Venue 回调重入破坏状态

- 分类：`reentrancy` · STRIDE T/E · CRITICAL · open
- 负责人：`contract-security`；截止门禁：`G2`
- 场景：恶意 Token/Venue 在 transfer、approve 或执行期间回调 Vault，重复提现、重复结算或打破会计顺序。
- 缓解任务：`CON-001`、`TST-001`、`TST-002`
- 验证：CEI、reentrancy guard 与恶意回调 mock 的单元、fuzz 和 invariant 测试。
- 残余风险：复杂外部协议的跨函数回调仍增加证明成本，因此 MVP 只允许最小固定目标。

### R-007 · 异常 Token 语义破坏会计

- 分类：`malicious-token` · STRIDE T/D · CRITICAL · open
- 负责人：`asset-and-accounting`；截止门禁：`G2`
- 场景：fee-on-transfer、rebasing、callback、假返回值、可变 decimals 或管理员没收造成账面和实际余额分离。
- 缓解任务：`ASSET-001`、`SPEC-001`、`CON-001`、`TST-001`
- 验证：固定测试资产 bytecode；异常 ERC-20 mock 全部拒绝；deposit 按余额差验证。
- 残余风险：目标资产管理员若能改变行为仍有治理风险，部署清单必须披露。

### R-008 · 暂停或外部故障永久阻止用户退出

- 分类：`denial-of-exit` · STRIDE D/E · CRITICAL · open
- 负责人：`contract-and-operations`；截止门禁：`G2`
- 场景：guardian 全局暂停、executor 消失或 Venue 卡住，使 owner 无法撤销、结算或提取 idle 资产。
- 缓解任务：`SPEC-002`、`CON-002`、`TST-002`、`IR-001`
- 验证：暂停/故障状态机 invariant 证明 owner 的直接退出和 timeout/fallback 始终可达。
- 残余风险：外部 Venue 本身可能冻结资产，必须在 UI 和残余风险中单独披露。

### R-009 · 错误网络、地址或 RPC 身份欺骗

- 分类：`rpc-deception` · STRIDE S/T · CRITICAL · open
- 负责人：`rpc-and-release`；截止门禁：`G3`
- 场景：配置或 RPC 返回错误 Chain ID、合约地址、代理 bytecode 或交易状态，UI 仍诱导用户发送。
- 缓解任务：`CONFIG-001`、`RPC-001`、`DEPLOY-001`、`VERIFY-001`
- 验证：配置/钱包/RPC 三方链 ID 校验，地址非空 code 与 runtime hash 校验，错误响应失败关闭。
- 残余风险：多个 RPC 可能共享上游故障；关键验收需独立来源交叉核对。

### R-010 · 重组、交易替换或重复日志造成重复执行

- 分类：`reorg-or-replacement` · STRIDE T/R · CRITICAL · open
- 负责人：`transaction-and-indexing`；截止门禁：`G3`
- 场景：掉线重试、同 nonce replacement、短重组和重复日志让系统重复提交或错误确认。
- 缓解任务：`TRUST-001`、`TX-001`、`INDEX-001`、`E2E-001`
- 验证：多 worker、重启、replacement 与 reorg 测试证明 nonce 单次消费、事件回滚和最终对账。
- 残余风险：极深重组仍可能超过确认策略，必须告警并停止自动动作。

### R-011 · 前端或钱包扩展替换交易

- 分类：`frontend-substitution` · STRIDE S/T/I · CRITICAL · open
- 负责人：`frontend-security`；截止门禁：`G3`
- 场景：受控 bundle、依赖或扩展把显示地址、签名域、calldata 或金额替换为攻击者值。
- 缓解任务：`WALLET-001`、`WEBSEC-001`、`SUPPLY-001`、`E2E-001`
- 验证：严格 CSP、无动态远程代码、构建完整性、可读签名和地址替换端到端负向测试。
- 残余风险：完全受控的终端仍可欺骗用户；文档要求使用钱包原生确认并核对地址。

### R-012 · 特权密钥泄露或角色集中

- 分类：`key-compromise` · STRIDE S/I/E · CRITICAL · open
- 负责人：`key-operations`；截止门禁：`G3`
- 场景：risk、executor、deployer 或 guardian 私钥进入仓库、明文 env、日志或同一热钱包并被盗用。
- 缓解任务：`KEY-001`、`SECRET-001`、`CON-002`、`IR-001`
- 验证：密钥提供方接口、角色分离、最小余额、轮换/吊销和泄露演练；完整历史 secret scan。
- 残余风险：比赛操作仍有人为失误风险，所有地址和操作必须双人复核。

### R-013 · 整数、decimals、舍入或手续费错误破坏守恒

- 分类：`accounting-corruption` · STRIDE T/R · CRITICAL · open
- 负责人：`accounting-and-contracts`；截止门禁：`G2`
- 场景：单位混用、向错误方向舍入、溢出、手续费先后顺序或份额换算导致资产/负债不守恒。
- 缓解任务：`SPEC-001`、`CON-001`、`TST-001`、`TST-002`
- 验证：整数规格、边界向量、模型差分、fuzz 与资产守恒 invariant。
- 残余风险：外部价格精度和过期数据仍需保守限额。

### R-014 · 部署或供应链工件被替换

- 分类：`supply-chain` · STRIDE T/R/E · HIGH · open
- 负责人：`release-engineering`；截止门禁：`G3`
- 场景：依赖、Action、编译器、ABI、前端 bundle 或部署清单与已评审源码不一致。
- 缓解任务：`TOOL-001`、`SUPPLY-001`、`SEC-002`、`VERIFY-001`
- 验证：固定版本、SBOM、依赖审查、可复现 bytecode、provenance 与干净环境复建。
- 残余风险：上游工具签名或发布基础设施仍可能同时失陷，需最小依赖与多源验证。

### R-015 · 过期或伪造账户快照绕过风控

- 分类：`authorization-bypass` · STRIDE S/T · HIGH · open
- 负责人：`risk-platform`；截止门禁：`G2`
- 场景：攻击者提供旧的、有利的或跨账户快照，使仓位、亏损和杠杆检查基于错误状态。
- 缓解任务：`TRUST-001`、`SPEC-002`、`RPC-001`、`E2E-001`
- 验证：指定来源签名并绑定 chain/vault/owner/block；未来、过期、重组和跨账户向量全部拒绝。
- 残余风险：合法但延迟的数据仍可能产生市场风险，需短时效和保守限额。

### R-016 · Demo 会话被当作 Testnet 钱包身份

- 分类：`authorization-bypass` · STRIDE S/E · HIGH · open
- 负责人：`backend-identity`；截止门禁：`G3`
- 场景：本地 alice/bob cookie 或 URL owner 字段被错误复用为钱包主体，导致跨用户或执行器冒充。
- 缓解任务：`WALLET-001`、`BACKEND-001`、`PRIV-001`
- 验证：Testnet 身份只从钱包签名恢复；构建依赖边界和 E2E 证明 demo 会话无法到达 adapter。
- 残余风险：用户钱包本身被盗不在应用恢复能力内，只能撤销许可和告警。

### R-017 · 状态、事件或请求资源无界导致拒绝服务

- 分类：`resource-exhaustion` · STRIDE D · HIGH · open
- 负责人：`data-platform`；截止门禁：`G3`
- 场景：超大 calldata、决策数组、事件历史、重试队列或 RPC 响应耗尽内存、磁盘、连接和 gas。
- 缓解任务：`DATA-001`、`RPC-001`、`OBS-001`、`E2E-001`
- 验证：输入/分页/队列/历史上限和压力测试；超限请求稳定拒绝且 owner 退出仍可用。
- 残余风险：公共 RPC 和 Sequencer 拥塞不可消除，必须支持降级与直接合约退出。

### R-018 · RPC 或 Sequencer 故障触发不安全重试

- 分类：`rpc-deception` · STRIDE T/D/R · HIGH · open
- 负责人：`rpc-and-transaction`；截止门禁：`G3`
- 场景：超时后系统不知道交易是否广播，重新签名或递增 nonce，造成重复、卡死或错误状态。
- 缓解任务：`RPC-001`、`TX-001`、`INDEX-001`、`OBS-001`
- 验证：故障注入覆盖超时、429、断连、receipt 消失和 replacement；状态机可恢复且不重复执行。
- 残余风险：长时间网络不可用时只能停止新操作并指导用户通过可靠 RPC 查询。

### R-019 · Indexer 把 pending 或孤块日志展示为最终状态

- 分类：`reorg-or-replacement` · STRIDE T/R · HIGH · open
- 负责人：`indexing-and-frontend`；截止门禁：`G3`
- 场景：日志重复、乱序或被重组移除，但数据库/UI 保留成功状态或重复累计余额。
- 缓解任务：`TX-001`、`INDEX-001`、`WEBSEC-001`、`E2E-001`
- 验证：事件键 chainId/txHash/logIndex；保存 block hash/checkpoint；重组回滚并与合约状态对账。
- 残余风险：确认深度不能提供绝对最终性，UI 必须保留确认级别。

### R-020 · 秘密进入仓库、构建产物或日志

- 分类：`key-compromise` · STRIDE I/E · HIGH · open
- 负责人：`security-operations`；截止门禁：`G3`
- 场景：裸 EVM 私钥、助记词、provider token 或签名材料出现在 Git 历史、env、前端 bundle、错误或 CI 日志。
- 缓解任务：`SECRET-001`、`KEY-001`、`WEBSEC-001`、`OBS-001`
- 验证：完整历史和构建产物扫描、日志脱敏测试、密钥撤销轮换演练。
- 残余风险：扫描无法证明秘密从未外泄，发现后必须按已泄露处理。

### R-021 · 部署地址或 runtime bytecode 与评审结果不一致

- 分类：`supply-chain` · STRIDE S/T/R · CRITICAL · open
- 负责人：`release-engineering`；截止门禁：`G3`
- 场景：UI、adapter 或部署清单指向空地址、错误构造参数、代理或与本地编译不同的 runtime code。
- 缓解任务：`CONFIG-001`、`SEC-002`、`DEPLOY-001`、`VERIFY-001`
- 验证：确定性 dry-run、干净环境重建、源码验证、runtime hash 和多处地址一致性检查。
- 残余风险：Explorer 验证界面不是信任根，客户端仍必须比较 bytecode hash。

### R-022 · 审计记录可覆盖、伪造或泄露敏感信息

- 分类：`accounting-corruption` · STRIDE T/R/I · HIGH · open
- 负责人：`data-and-observability`；截止门禁：`G4`
- 场景：普通数据库写权限可同时修改快照和 SHA 摘要，或日志记录签名、token、完整 calldata 和用户隐私。
- 缓解任务：`DATA-001`、`OBS-001`、`IR-001`
- 验证：追加式证据、独立 checkpoint、恢复演练和日志字段 allowlist/脱敏测试。
- 残余风险：本地管理员仍能删除存储，关键部署与交易证据需外部持久化。

## 风险接受规则

- Critical 风险不得为 Testnet 写入或比赛发布而接受，必须缓解并提供可复现证据。
- High 风险只有在无法于范围内消除时，才可由风险负责人和独立复核者共同限时接受，并记录补偿控制与失效日期。
- 风险负责人不得单独批准自己负责的接受项；到期、架构变化或证据失效会自动重新打开风险。
- 任何 Critical/High 风险缺少 owner、缓解任务、目标 Gate 或验证方法时，计划校验必须失败。
- 本威胁模型完成只表示风险已登记，不表示风险已修复或 Gate 已通过。

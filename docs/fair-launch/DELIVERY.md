# AlphaForge Fair Launch V3 交付记录

对应用户最终规则：TSLA `MINTING → SOLD OUT → AUTO LAUNCH → LIVE TRADING`，最后一笔认购、资金结算、建池和发射状态写入在同一笔交易中；失败整体回滚。SOLD_OUT 仅为同一交易中的过渡状态，不是等待管理员操作的持久状态。AMZN 保持已发行二级市场。

## A. 现状与保护的基线

2026-10-09 只读检查实际服务、源码、数据库及 Git 远端，没有切换线上 release、改数据库、部署或注资。

| 检查对象     | 观察                                                                                                                                                            | 状态                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 实际入口     | `apps/web/index.html → apps/web/src/product-ui.ts`，workshop 前端最新 commit `5c61e91b9c2ee249592eb8923fee3bee072ce673`                                         | IMPLEMENTED            |
| 运行后端     | workshop release `20261005-024948-287230`，后端 commit 前缀 `7fdbe37`，运行 QP_MODE local / mock adapter                                                        | MOCK                   |
| 保留主源码   | `runtime/source`，分支 `codex/alphaforge-w5-linux-git-release-20261004`，commit 前缀 `c0bba0`，工作区干净                                                       | IMPLEMENTED            |
| 最新 UI 源码 | `runtime/workshop-source`，分支 `codex/browser-wallet-account-20261009`，commit `5c61e91…`，工作区干净                                                          | IMPLEMENTED            |
| 线上数据库   | demo schema1，3 Vault / 90 audit / 1 automata / 1 simulation fund；access schema0，2 identity / 2 whitelist / 2 session；wallet-auth schema1；quick_check 均 ok | IMPLEMENTED / 模拟资金 |
| 已部署新市场 | 现有 operator config 的 vaults 为空，旧 Testnet 配置 NOT_CONFIGURED、execution DISABLED；未发现本轮 Fair Launch 地址 / receipt                                  | NOT_DEPLOYED           |
| 身份         | Google 验证、whitelist、真实 session / CSRF 可复用；Native Website 登录不证明邮箱已验证                                                                         | IMPLEMENTED / PARTIAL  |
| 原资金前端   | 模拟认购、独立用户市场投影及旧 Testnet 入口，不能当本轮共享链资金证据                                                                                           | MOCK                   |
| 原可复用合约 | 固定发行 StrategyPass / TestUSDC；AlphaForgeVault / PassLocker 的本金、利润、关闭与锁仓账本                                                                     | IMPLEMENTED            |
| 原缺口       | 原生 ETH 双向兑换、原子 Fair Launch、真实 AMM / LP、邮件领取、链事件 indexer、两策略受限 TEST 股票 Vault                                                        | 本轮新增               |

本轮独立 clone `worktrees/macbeth01-fair-launch` 基于最新 UI `5c61e91…`，分支 `macbeth01/AF-FAIR-LAUNCH-V3`，没有覆盖上述源码或线上服务。远端 master 基线 `3cb9caa810e34d8ff9f9a6c68b5ef674f489689e` 与最新 UI 相差 48 个既有 commit / 139 个既有变更文件；这些历史保留原作者，draft PR 必须说明继承范围。本轮审查从 `5c61e91…` 开始，不把继承的 UI / release 历史说成新增独立审查已通过。

最小适配为新 ONCHAIN_TESTNET 服务和前端模块：现有 UI 入口尝试读取新配置，已配置时安装真实资金视图；旧 workshop 未提供该路由时继续原模式。原资产合约、Locker、核心 Vault 及原 CI / 保护规则未改写。不会把 mock 健康报告当作新链上线结果。

## B. 代码与数据源

完整文件清单见 `CHANGED-FILES.txt`。主要新增：

| 路径                                                     | 作用                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `contracts/src/market/`                                  | FairLaunch、真实恒积 AMM / Factory / LP、NativeReserve / Router、ClaimReserve                                        |
| `contracts/src/launch-vault/AlphaForgeStrategyVault.sol` | 仅 TSLA / AMZN TEST 股票的受限 Vault、独立测试 venue、keeper 价格 / 日历、Factory                                    |
| `contracts/deployment/market/`                           | 11 个编译生成 ABI、源码 / 编译参数 / runtime 与 creation 大小记录                                                    |
| `packages/launch-market/src/`                            | 整数计价、真实 RPC 接口、链位置、耐久身份 / voucher / operation、canonical projection / SSE                          |
| `apps/server/src/launch-market/`                         | 严格 HTTP API、真实日志 indexer / 重组 / 持有人 / AMM OHLCV、loopback 服务                                           |
| `apps/server/src/launch-market-adapters/`                | 只读链、verified Google bridge、Coinbase / Kraken 原生报价、Alpaca TEST 股票参考、真实 Vault quote                   |
| `apps/web/src/launch-market/`                            | ETH 默认交易、确切 approval / wallet quote、gas / 滑点审核、真实确认 / 恢复、Vault owner / executor 授权、实际链活动 |
| `tools/launch-market/`                                   | 纯离线 unsigned 部署准备、只读 unsigned keeper 准备、隔离链 fixture / E2E / 持续负载、ABI 和 pinned Anvil 检查       |
| `deploy/launch-market/`                                  | 无凭证 env、显式部署参数、待审核 service / ingress 示例                                                              |
| `.github/workflows/fair-launch.yml`                      | 新增范围检查；现有工作流、工具锁和分支保护不削弱                                                                     |

市场价格只来自各策略唯一 PASS / AF-USDC 池；ETH 是支付 / 收款的独立兑换路径。AMM 30 bps 手续费保留在池中，原生兑换费默认 0，并有链上签名 nonce / epoch / expiry 及单笔、账户每日、全局每日限额。固定认购款独立进入用户指定 EOA。

股票 PnL 来自实际 TEST 股票持仓、成本和新鲜参考价，不使用 PASS AMM 价格。目标股票允许 100% 持仓，同时保留 owner、executor grant、最大订单 / 累计预算、滑点、期限、executionVersion、市场时段和风险暂停。行情失效显示未知 NAV，不丢弃真实现金、PASS 锁定或持仓。外部数据源选择和配置见 `DEPLOYMENT.md`。

## C. 数据库、初始化与恢复

新资金服务使用独立 0700 目录、0600 普通文件、单服务锁和 origin / manifest / chain namespace。`market.sqlite` application ID 1095126347、schema1；`market-events.sqlite` ID 1095126348、schema1。原 demo、access、wallet-auth 数据库保留；Google bridge 只读 existing access DB，不导入模拟余额、模拟订单或不具备 verified email 的账户。

初始化只对空的新 namespace 建表；重复启动核验版本、身份和 integrity，不 truncate / reset，不重建 accountKey。未知表、schema、错误 origin、应用 ID 或既有 lock 会拒绝使用。链投影可从实际部署块重建，私有 email / subject → accountKey 和原 voucher 不能由公开链事件推导，必须保留。

领取在签名前原子检查：同链 canonical 领取数量必须与 RPC 成功数量一致；每条领取必须匹配保留的原账户、原 voucher wallet、transactionHash 和状态。Indexer 落后时只暂停新领取并要求同步，账户库缺失映射时要求恢复，其他已具备流动性的交易不因此停用。换钱包不生成新 accountKey，历史 claim wallet 不随 rebinding 改写。重启、过期、未回调的链上 claim 和重组保留原 nonce / voucher，不能静默发第二份。

这项保护不能重建丢失的身份映射，也不能证明曾经签发、仍有效但尚未上链的丢失凭证不存在。备份必须包含完整账户和 pending voucher，恢复只使用经核验的最新一致备份。不得以空库、旧的不完整备份或新 namespace 继续给既有发行签 claim。首次新发行 provisioning 与既有发行恢复是不同操作。

离线 backup / restore 工具与步骤见 `STORAGE.md`。恢复到新的目标目录，核验 namespace、schema、完整表内容摘要及领取身份，再启动。旧数据库及快照保留，不把更换目录当作领取资格重置方式。真实服务器备份、迁移和切换 `NOT_RUN`；本轮实现和本地复制验证不会触碰线上个人数据。

离线 `fair-launch:prepare` 可重复生成 unsigned 计划；不产生链写入。合约固定供应构造器仅铸造一次，Factory / initializer / Router 配置 one-shot，成功 Launch 不可再触发，失败末笔 Mint 全回滚。真正部署 / 配置执行必须先查实际 receipt / state，不能重复广播已成功动作。

## D. 部署准备

具体配置、版本、构建 / 测试 / 准备命令、权限矩阵、真实 manifest、gas 与合约验证、登录 ingress 和恢复步骤见 `DEPLOYMENT.md`。示例不含凭证，也不预填实际 LP owner。

本地 TEST 资金和 Bob LP 接收者仅为明确隔离夹具；不作为用户对真实 LP 所有权的批准。读目标链 gas policy 属只读验证，不代表已部署新市场或已完成目标链 gas 验收。

## E. 测试与验收

最终证据与范围见 `TESTING.md` 和 `evidence/`，审查见 `reviews/`。用真实 Anvil 合约 / transaction / receipt / log 验证的项目与使用离线身份或行情夹具的项目分别标注。

已发现并修复：SSE 长连接阻止服务退出、嵌套 API error 导致前端失去恢复原因、授权检查和 gas 模拟跨区块并发竞态、未绑定 wallet 错误暴露 accountId 隐藏绑定按钮、丢失私有领取 registry 后新 accountKey 的重复领取风险、ETH卖出最小到账舍入校验、token授权完成后多余allowance误阻止确认、备份工具漏检完整DDL和CHECK约束。保留初始失败负载记录和复测证据，不删除尾部请求或失败样本。

独立源码审查包含实际缺陷复现和针对性检查。后续已实际执行锁定 Semgrep（300源文件、22规则、44 canaries，0发现）和 Slither（53报告，9既有批准、44新增未批准）；Slither原审批门禁为BLOCKED，没有擅自追加批准或过滤报告。详见 `reviews/STATIC-SCANNERS.md`。正式 Codex Security managed scanner 的必需MCP不可用，目标Testnet、真实Google ingress和部署验证仍为NOT_RUN。原GitHub required checks必须实际hosted运行，不能用本地检查覆盖。

## F. 待授权清单

下列字段尚无用户批准值，部署工具中的 `null` 必须由用户明确确定：

1. TSLA / AMZN LP 接收地址、实际控制权限和后续管理方式。
2. 初始 AF-USDC 固定发行数量、管理员 / 资产持有人、两份 250,000 LP、100,000 claim、兑换和两份股票 TEST 储备的来源及数量；公开认购款不能重复使用。
3. 独立原生 ETH 储备数量、最低保有量、单笔 / 账户每日 / 全站每日额度、兑换暂停和允许的提款权限。
4. 部署钱包、实际待用 nonce、管理员、独立 quoteSigner / claimSigner、keeper、密钥托管 / 轮换流程。
5. Alpaca 只读 TEST 参考数据授权、持续 keeper 更新安排；用户显式 executor grant 后的执行服务身份与预算。
6. 逐项批准 unsigned deployment / configuration / funding / approval / AMZN createPool / TSLA openMint / fresh keeper 更新交易，并确认真实 calldata、gas 和 nonce。
7. 实际目标链合约源码验证、双钱包烟测、3 块确认 / 重组恢复，及服务 ingress / 身份 DB / 持久目录配置和入口切换。

资金风险随具体批准动作一并审核：LP 面临市场价格和流动性变化；TSLA 预存发行 / LP 没有提前管理员提款；指定 EOA 收款不自动返流 LP；兑换储备可能耗尽或被已批准管理员暂停 / 提款；keeper 的源身份、日历和价格属于受信任边界；精确 token approval 和 owner / executor 限额必须保持。已成功的链交易不能用回滚服务器撤销。

## G. 最终状态

完整负载通过，最终73项范围检查、双账户EVM及独立审查完成，浏览器实链结果见 `TESTING.md`。状态分别为：

| 状态                        | 含义                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CODE_COMPLETE               | 已完成：代码、ABI、持久存储、UI、工具和交接准备                                                                  |
| LOCAL_EVM_TESTED            | 已完成：真实隔离 EVM 合约 / 双账户 / 发射 / 资产守恒验证                                                         |
| SECURITY_REVIEWED           | 已完成限定范围独立源码复查及真实静态扫描；Semgrep PASS，Slither 44新增报告待批准，managed Codex Security NOT_RUN |
| READY_FOR_DEPLOYMENT_REVIEW | 已达到：unsigned工具、资金流向、权限及待授权参数可审核                                                           |
| DEPLOYED_TO_TESTNET         | 尚未达到；NOT_DEPLOYED                                                                                           |
| TESTNET_VERIFIED            | 尚未达到；NOT_RUN                                                                                                |

PR publication 已准备保留原始历史的传输方案：临时GitHub Actions校验完整bundle后仅发布新的source tag，GitHub连接再原子创建 `codex/alphaforge-fair-launch-v3-20261009` 分支及draft PR。不会用API重建48个继承提交，不改变原作者、时间、SHA或父提交，也不写保护主分支。用户已取消本任务worker角色要求；精确source profile仅适用于该新分支，保留71个原提交并拒绝遗漏/改写历史及新增worker身份声明。已有其他分支身份规则及required checks不变；实际hosted checks和44新增Slither报告仍是合并门禁，禁止自动合并。

Macbeth01 统筹并负责合约适配、真实 RPC、数据源、fixture、集成和部署准备；Macbeth02 完成市场合约，Macbeth03 完成持久后端 / indexer / 持续负载，Macbeth04 完成前端和浏览器，Macbeth05 完成独立源码审查。额外 Macbeth06 worker 创建因线程额度失败，其工程 / CI 检查由 Macbeth01 实施并由 Macbeth05 复查；没有虚构第六个独立审查者。各 worker 保留自己的分支、作者和提交，不改保护规则，不合并 PR。

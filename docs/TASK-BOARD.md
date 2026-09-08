# QuantPass 工程安全任务看板

> 自动生成文件：唯一事实源为 `planning/roadmap.json`。HTML 版见 [task-board.html](task-board.html)。

更新时间：2026-09-08 · 计划版本：2.7

- 当前任务：**SUPPLY-001 · 强化仓库与供应链策略**
- 已完成：6/41
- 就绪：6
- 未关闭 Critical/High：33
- 硬边界：仅限测试网、模拟资金和可审计工程验证；未通过全部门禁前禁止主网、真实资金以及无人值守或自主交易。

## P0 · 已验证基线

保留已有可复现证据，同时明确它们不是生产认证。

| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| LEDGER-001 | 精确会计与幂等账本基线 | 已完成 | P0 | Critical | BASE-001 |
| PERMIT-001 | 离线交易许可安全模型基线 | 已完成 | P0 | Critical | BASE-001 |
| NET-001 | Robinhood Chain Testnet 网络门禁基线 | 已完成 | P0 | High | BASE-001 |
| CI-001 | 基础工程门禁 | 已完成 | P1 | High | BASE-001 |
| LOCAL-001 | 本地演示 HTTP 安全边界基线 | 已完成 | P1 | High | LEDGER-001 |
| BASE-001 | 比赛公开仓库精简基线 | 已完成 | P1 | Medium | — |

## P1 · 治理、威胁模型与规格

先冻结资产、权限、会计和信任边界，再开始合约实现。

| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| SUPPLY-001 | 强化仓库与供应链策略 | 进行中 | P1 | High | CI-001 |
| TOOL-001 | 固定 Solidity 与安全工具链 | 就绪 | P0 | High | CI-001, NET-001 |
| GOV-001 | 冻结测试网范围、角色与架构 ADR | 阻塞 | P0 | Critical | NET-001, LEDGER-001, PERMIT-001, LOCAL-001, SUPPLY-001 |
| ASSET-001 | 测试资产与外部协议地址核验 | 待排期 | P0 | Critical | GOV-001, THREAT-001 |
| CONFIG-001 | 独立且失败关闭的 Testnet 启动门禁 | 待排期 | P0 | Critical | GOV-001, THREAT-001 |
| PRIV-001 | 消除 Demo Executor 隐式提权并采用无权限 Relay | 待排期 | P0 | Critical | GOV-001, THREAT-001 |
| SPEC-001 | 链上会计、资产与舍入规格 | 待排期 | P0 | Critical | GOV-001, THREAT-001, TOOL-001, ASSET-001 |
| SPEC-002 | 权限、事件、错误与重放规格 | 待排期 | P0 | Critical | GOV-001, THREAT-001, TRUST-001 |
| THREAT-001 | Robinhood Chain 专项威胁模型与风险登记 | 待排期 | P0 | Critical | GOV-001 |
| TRUST-001 | 信任根、签名域与持久重放模型 | 待排期 | P0 | Critical | GOV-001, THREAT-001 |
| ABI-001 | 冻结 Vault v1 ABI 与 Adapter 边界 | 待排期 | P0 | High | SPEC-001, SPEC-002, CONFIG-001, PRIV-001 |

## P2 · 合约实现与安全验证

用测试、fuzz、invariant、静态分析和独立复核证明最小合约。

| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| CON-001 | 实现最小非托管 Vault 合约 | 待排期 | P0 | Critical | ABI-001, TOOL-001 |
| CON-002 | 实现最小权限、不可逆暂停与安全退出 | 待排期 | P0 | Critical | CON-001, SPEC-002 |
| SEC-002 | 静态分析、字节码复现与独立安全复核 | 待排期 | P0 | Critical | TST-001, TST-002, SUPPLY-001 |
| TST-001 | 合约单元、负向与权限测试 | 待排期 | P0 | Critical | CON-001, CON-002 |
| TST-002 | Fuzz、Invariant 与模型差分验证 | 待排期 | P0 | Critical | TST-001, LEDGER-001 |

## P3 · 钱包、适配器与链数据

所有链交互显式、可恢复、可核对，并在错误网络上失败关闭。

| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| DATA-001 | 持久状态、审计与资源上限 | 就绪 | P1 | High | LEDGER-001, CI-001 |
| RPC-001 | RPC 身份、限流与故障策略 | 就绪 | P1 | High | NET-001, CI-001 |
| WEBSEC-001 | 浏览器与前端供应链安全 | 就绪 | P1 | High | LOCAL-001, CI-001 |
| TX-001 | 交易生命周期、替换与重组恢复 | 待排期 | P0 | Critical | ADAPTER-001, TRUST-001 |
| ADAPTER-001 | 实现类型安全的只读与写入 Adapter | 待排期 | P0 | High | ABI-001, CON-002, WALLET-001 |
| WALLET-001 | 钱包连接与显式网络切换 | 待排期 | P0 | High | ABI-001, CONFIG-001 |
| BACKEND-001 | 隔离 Testnet 后端身份与 Demo 会话 | 待排期 | P1 | High | GOV-001, TRUST-001, CONFIG-001 |
| INDEX-001 | 幂等事件索引与链重组处理 | 待排期 | P1 | High | CON-001, SPEC-002, RPC-001 |

## P4 · 部署、供应链与运维

建立可重建发布、最小密钥暴露、监控和事故恢复能力。

| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| SECRET-001 | 完整历史秘密扫描与轮换演练 | 就绪 | P0 | High | CI-001 |
| DEPLOY-001 | Robinhood Testnet 人工部署 | 待排期 | P0 | Critical | DRYRUN-001 |
| DRYRUN-001 | 确定性部署 Dry-run 与广播前复核 | 待排期 | P0 | Critical | SEC-002, KEY-001 |
| IR-001 | 事故响应、停用与迁移演练 | 待排期 | P0 | Critical | CON-002, KEY-001, OBS-001 |
| KEY-001 | 测试网部署密钥与角色操作手册 | 待排期 | P0 | Critical | GOV-001, SUPPLY-001, SEC-002 |
| VERIFY-001 | 部署来源证明与后部署验收 | 待排期 | P0 | Critical | DEPLOY-001 |
| OBS-001 | 可观测性、告警与隐私化日志 | 待排期 | P1 | High | TX-001, INDEX-001, VERIFY-001 |

## P5 · 对抗验收与比赛交付

从新环境复现完整流程，交付可独立验证的证据包。

| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| DOC-001 | 安全声明、限制与证据索引 | 就绪 | P1 | Medium | BASE-001, NET-001, CI-001 |
| E2E-001 | 对抗性 Testnet 端到端验收 | 待排期 | P0 | Critical | TX-001, INDEX-001, VERIFY-001, OBS-001 |
| RELEASE-001 | 最终发布门禁与独立复现 | 待排期 | P0 | Critical | E2E-001, DEMO-001, SEC-002, IR-001, SUPPLY-001 |
| DEMO-001 | 评委演示与恢复流程 | 待排期 | P1 | Medium | E2E-001, DOC-001, IR-001 |

## 发布门禁

| Gate | 名称 | 状态 | 已通过 |
| --- | --- | --- | --- |
| G0 | 公开基线 | 已通过 | 4/4 |
| G1 | 设计冻结 | 未通过 | 0/4 |
| G2 | 安全验证 | 未通过 | 0/4 |
| G3 | 测试网发布 | 未通过 | 0/4 |
| G4 | 比赛提交 | 未通过 | 0/4 |

## 统一完成定义

- 实现、正向测试、负向测试和边界测试全部通过；关键授权与会计路径分支覆盖 100%。
- 总体自动化覆盖率达到约定阈值（目标不低于 90%），fuzz/invariant 运行参数与种子可复现。
- 威胁模型、README、接口和运维文档同步；无未说明的 Critical/High 风险。
- 从干净检出可复现构建，CI 全绿，依赖、secret、license 与静态分析门禁通过。
- 至少一次独立复核，并记录提交、报告、哈希、交易或浏览器链接等验收证据。
- feature flag、暂停、降级、迁移或停用路径已演练，不把“可升级”误当作回滚。

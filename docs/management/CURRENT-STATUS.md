# AlphaForge / QuantPass — 项目管理状态

更新：2026-09-12（UTC+08:00）。本页同步本地交付记录与 GitHub 只读核验，dashboard 使用 macbeth/dashboard 最新版本。

## 当前工作

本地管理记录已整理为 dashboard 的标准数据源：Manager 当前状态、工作队列、决策、变更日志、Worker A 日志及 DARWIN-A1–A8 记录。历史审计保留其日期和基线；本次快照检查结果由版本化证据清单提供。

## 已有交付

- 本地原型：开发基线、整数资金与 Pass 额度模型、SQLite 持久化/幂等/备份恢复、React/Fastify 本地模拟流程、离线执行许可模型。旧模块 M00/M02/M03 的本地范围完成，不能等同新版路线的完整工业级验收。
- 旧 M04：只读 Robinhood 依赖快照、保密威胁/密钥表、实验协议、17 项待执行硬件检查及离线证据工具；未完成真实交易路径或 TEE 验证。
- Darwin：41 个 canonical 任务已逐项初评；6 个 DONE 基线和 GOV 复核；2026-09-09 候选版本 91/91 测试及当时完整配置门禁通过。
- 审计结论：VERIFIED_DONE 0；需要加固 3；PARTIAL 5；READY 5；IN_PROGRESS 1；BLOCKED 1；NOT_STARTED 26。此为历史审计口径，主表的 6 个 DONE 仍是 canonical roadmap 的本地基线口径。
- 诊断覆盖：已加载且被选中的运行时代码分支覆盖 79.18%；不是全仓覆盖，也不满足关键路径完整验收。
- 投资人材料：12 页中文可编辑 pitch deck v2 已交付；结构与排版校验通过，文件摘要见 LOCAL-DELIVERY-001。文件仍为本地产物，未伪造公网下载地址。

## 本轮全 PR 收敛（Macbeth 单人执行）

启动时已分页枚举全部状态，共 7 个 PR，准确启动 head/base 见 [收敛记录](../security/PR-CONVERGENCE-2026-09-12.md)。以下为实际 GitHub 合并回读，按顺序逐次验收，技术审查均为 Macbeth 自审。

| PR | 当前结果 | 准确 master 合并提交与验证 |
| --- | --- | --- |
| #1 | 已实际合并并验证 | 53eb90f54e2c20fa4352360772160df142e7d74e；Engineering / CodeQL 成功 |
| #5 | 已实际合并并验证 | 84cd179e23c4179ed989bf5e118a986cc119475c；Engineering / CodeQL 成功 |
| #2 | 已实际合并并验证 | 50e075607cb335ac66e2ee6d47c2f477b37b527e；Engineering / CodeQL 成功，SBOM 同步 |
| #6 | 已实际合并并验证 | 80fc3d9befef7a1749d4991cd6f00e4c604a4a5e；Linux / Windows / CodeQL 成功 |
| #3 | 保留关闭、未合并 | Node 26 类型不符合 Node 24 运行时契约 |
| #4 | 保留关闭、未合并 | TypeScript 7 超出当前 lint 工具链 peer 范围 |
| #7 | 组合整改中；尚未合并 | 已普通合入上述 master；231 项本地测试及隐私/供应链检查通过，最终证据和 GitHub 门禁待核验 |

## Worker 与审查状态

- Macbeth 是本轮唯一实施、Manager 和正常阶段合并执行者；共享文件串行维护，普通 fast-forward 更新实际源分支。#5 发现 Dependabot 自动更新后暂停旧推送，基于新 head 保留并重新应用自身修改。
- Darwin 本轮暂不参与；未派单、启动或等待其交付，也未声称其客户端已停止。已有提交、作者和历史初评均保留。
- 平台规则要求严格检查、解决 review threads 和线性历史；配置审批数为 0。Macbeth 自审不冒充独立 approval。没有修改保护规则或使用 bypass。
- #7 启动版本的独立不可变范围记录：scan 37443e09-820b-46cd-b168-1ad77594e5d2 已封存，74/74 路径静态自审无报告项；这不是最终组合版本的结论，也不是独立审查。
- 历史 Standard scan 3d6670bc-ca8d-466c-8ec7-b1decaa097d3 上次服务回读仍为 running、无封存报告；不据此声称仍在后台执行或零漏洞。本轮没有接管或重署该历史扫描。

## 仍待完成

- NET 错误脱敏和 permit 到期约束已在 #6 修复并回归；枚举/风险接受元数据、历史记录上限与退出、公开构建范围和覆盖率仍保留历史评估边界，不能据此宣布全项目验收。详见 PROJECT-REALITY-AUDIT.md。
- #7 最终组合版本的安全复核、证据重建、Linux/Windows CI、实际合并与准确 master 验证仍待完成。历史审计扫描最终报告、GOV-001 / SUPPLY-001 外部独立治理验收没有被维护合并替代。
- AlphaForge 全站显示名改造仍待单独交付；历史 QuantPass 文件名及稳定标识保留。
- Solidity/Pass/Vault 合约、钱包与测试网交易、RWA 适配器、TEE/保密运行、实际计费和接续机制尚未完成；Foundry/fuzz/invariant/Slither 没有可用已批准工具链证据。
- 容量缓冲、回购定价等未决策项和法律/生产验收仍开放。

本次同步不改 canonical roadmap 的状态或验收、不授予真实资金或部署权限。

## Windows integration follow-up — 2026-09-12

The first combined head f182180e1eda69c67228db5346db5258085e685e passed Linux and CodeQL but failed 15 Windows fixture checks. Test repositories omitted the real repository’s LF attributes, so Windows checkout changed manifest bytes and the deliberately isolated Git collector correctly detected a dirty tree. Fixtures now copy the existing repository attributes; a regression enables autocrlf and checks exact LF bytes and clean status. No runtime guard, assertion or Windows gate was removed. The failed runs remain recorded; final head checks are required again before merge.

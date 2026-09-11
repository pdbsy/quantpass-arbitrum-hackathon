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

## GitHub 状态（本次同步前精确版本核验）

| PR | 结果 | 说明 |
| --- | --- | --- |
| #1 | OPEN / CLEAN，5 项检查 success | setup-node 升级，尚未合并 |
| #2 | OPEN / CLEAN，5 项检查 success | 本地提交 716090c7d73b944e9db22dac88c2fa34bb113951 已重建 globals 升级的 SPDX SBOM 并推送 |
| #3 | CLOSED / 未合并 | Node 26 类型与项目 Node 24 契约不兼容 |
| #4 | CLOSED / 未合并 | TypeScript 7 超出当前 typescript-eslint 支持范围 |
| #5 | OPEN / CLEAN，5 项检查 success | checkout 升级，尚未合并 |
| #6 | OPEN / 未合并 | codex/supply-security-evidence，bbb3e4b7b40cfd3aa23253866876875f8d98a1fc |
| #7 | OPEN / DRAFT / CLEAN，5 项检查 success | macbeth/dashboard，05c50ee508b0334f4c16c1f178cf2fa87ae201db；本次更新会产生新 head，须重新核验 |

证据：PR 状态/精确 head 与 check-runs 的 GitHub 只读查询，详见 tasks/PR-MAINT-001.md。#1–5 已补 dependencies、security-review-required 标签。

## Worker 状态

- Worker A / Darwin：本地审计台账已可同步；运行时代码加固、独立审计检查点复核及 Wave 1 整体完成仍待交付。
- Worker B / Macbeth：保留原始 B1–B8 记录与最新 dashboard 代码。本次核验确认 PR #7 已有新的发布头和全绿 CI，因此旧日志的“待推送/待 CI”不再描述上述已核验头。日志仍要求独立 post-fix verdict，不能仅凭 CI 宣称所有 finding 已关闭。
- 扫描状态已只读回查：Standard scan `3d6670bc-ca8d-466c-8ec7-b1decaa097d3` 的服务记录仍为 `running`，最后进度更新时间为 2026-09-09T15:35:07Z，`reportAvailable=false`。没有最终封存报告；记录为 running 不证明后台持续执行，findingCount=0 不代表零漏洞。

## 仍待完成

- 历史候选版本的 NET 错误脱敏、permit 到期约束、枚举/风险接受元数据校验、历史记录上限与退出、公开构建文件边界及覆盖率缺口，需要在准确目标版本上分别复核和交付。详见 PROJECT-REALITY-AUDIT.md。
- PR #6 与 dashboard 的独立集成复核、历史审计扫描最终报告，以及外部治理验收仍有待办。本次同步不合并 PR。
- AlphaForge 全站显示名改造仍待单独交付；历史 QuantPass 文件名及稳定标识保留。
- Solidity/Pass/Vault 合约、钱包与测试网交易、RWA 适配器、TEE/保密运行、实际计费和接续机制尚未完成；Foundry/fuzz/invariant/Slither 没有可用已批准工具链证据。
- 容量缓冲、回购定价等未决策项和法律/生产验收仍开放。

本次同步不改 canonical roadmap 的状态或验收、不授予真实资金或部署权限。

> Subsequent M3 assignment — Macbeth04 is now explicitly authorized for `M3-04-PRODUCT-UI` on `macbeth04/M3-product-ui`, from fixed validated baseline `7ecba357d5a19f387e86f578822af04a6261fed2`. See [the task record](agents/M3-04-PRODUCT-UI.md). Earlier audit-only statements below retain their historical scope; this does not grant chain writes or alter other worker assignments.

> Current update — 2026-09-14: remote master is `45e80f921df2d3f9172ddbbc8e6ab37c327107e7` (PR #11 merged, 45% finish). Macbeth02–05 have returned baseline-reading receipts. M3 identity/task alignment is in review preparation; 02 implementation awaits aligned master, and 03–05 retain audit-only scope. See [M3 assignments](agents/M3-ASSIGNMENTS.md) for exact status and blockers. Earlier PR #11 unmerged/master NOT_RUN statements below are historical source snapshots, not current Git status. This update does not claim M3 Testnet completion or independent approval.

# 工作队列

## 当前优先事项 — 2026-09-13

| 事项 | 状态 | 当前事实 / 下一步 |
|---|---|---|
| AF-MIGRATION / PR #11 整改 | 工程验收通过，BLOCKED | 29e2af9 的 366 测试、浏览器、合约和五项必需 CI 已通过；缺少 GitHub CODEOWNER 审批，未合并 |
| 仓库安全清理 | DONE | 4 个已合并旧分支归档后移除分支名；628 个测试临时目录已清理并可恢复；源码和保护规则未改 |
| Dashboard / Forum 同步 | 本次交付 | 更新 Manager、队列、Macbeth01 活动记录和 Forum；重新采集 C/R/S，准确头 CI 随 PR 更新 |
| PR #11 受保护 squash merge | BLOCKED — REVIEW_REQUIRED | 用户已授权本次 merge 并要求保留规则；需合资格 CODEOWNER 的真实 GitHub 审批 |
| 实际 master 合并后验证 | NOT_RUN | 必须实际合并后再验证 master SHA、tree 和本地/托管检查 |
| GOV-001 / SUPPLY-001 | OPEN | 独立治理和信任边界不能由 Macbeth01 自审替代 |
| PR11-L1 hosted contract-security | 后续工作 | 保留已验证 macOS-arm64 锁定工具链；另行资格验证托管工具再加入 required check |

## 历史队列（不是当前活动任务）

更新：2026-09-12。canonical roadmap 为 planning/roadmap.json；本表记录管理交付及剩余工作。

| 记录 / 事项 | 当前状态 | 下一步 / 完成边界 |
| --- | --- | --- |
| ENV-01–05 | DONE — Macbeth | [任务记录](tasks/ENV-01.md)；PR #9 实际 master ba25320a84de60e1561146be11b87a5ccfcaea56 的正式环境、245 项测试及三平台/CodeQL 通过 |
| DARWIN-A1/A2/A3 | 历史初评已落盘，PARTIAL | 41 项审计已导入；独立复核和证据缺口尚未关闭 |
| DARWIN-A4 | IN_PROGRESS | 已复现/记录缺陷；按准确版本逐项回归及修复 |
| DARWIN-A5 | 管理记录已同步 | 本次进度源和生成快照发布后可在 PR #7 查看；不等于审计全验收 |
| DARWIN-A6 | 历史 Worker B 初评保留 | 以本页关联的最新 PR 状态纠正旧发布/CI结论；独立 post-fix 复核仍待核验 |
| DARWIN-A7 | 历史检查已完成，PARTIAL | 91/91 及覆盖率记录保留；扫描封存报告未见交付 |
| DARWIN-A8 | 检查点报告已落盘 | Wave 1 仍需修复、独立复核与集成 |
| PR-MAINT-001 | DONE（限定维护范围） | #1/#2/#5 已由 Macbeth 实际合并并逐次验证；#3/#4 保留关闭 |
| LOCAL-DELIVERY-001 | DONE（材料交付范围） | 12 页中文 PPT v2 与校验产物已存在；后续统一品牌 |
| LOCAL-HISTORY-001 | 历史本地成果已归档 | M00–M04 映射和边界可见，不改变新版 41 项任务验收 |
| DARWIN-BRAND-001 | 当前产品显示名已由 Macbeth 完成 | AlphaForge Hackathon 界面、包名、入口和看板在 #9 落地；Darwin 历史记录、协议/持久状态标识保留；旧材料单独维护 |
| Macbeth B8 / PR #7 | 已合并并验证 | master 0f8cf4079f0f932e2acfd4e5ef76042e697364d1；232 项本地测试及远端 Linux/Windows/CodeQL 通过 |
| PR #6 / 整体集成 | 已合并并验证 | master 80fc3d9befef7a1749d4991cd6f00e4c604a4a5e 的 Linux/Windows/CodeQL 成功 |

本轮全部 PR 收敛统一由 Macbeth 执行，Darwin 历史任务不构成本轮派单或等待条件。旧表中的独立验收缺口仍如实保留；没有新分配 Solidity、交易或生产模块；当前显示名同步来自用户本轮明确要求。阶段完成要求实际 merge 后准确 master 验证通过。

启动清单 #1–#7 处置完成；本次记录发布只同步已发生的验收，不代表独立治理、项目全部功能或未来范围已获验收。

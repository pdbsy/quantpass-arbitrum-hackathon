# 工作队列

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

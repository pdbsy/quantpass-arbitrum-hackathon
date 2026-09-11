# LOCAL-HISTORY-001 Task Record

Task ID: LOCAL-HISTORY-001

Title: 旧模块 M00–M04 本地交付与新版路线映射

Worker: Darwin / local development

Start: 2026-09-05

Finish: 2026-09-12 (record synchronization)

Status: DONE

Disposition: Completed only within the scope stated below; no roadmap or release promotion.

## Summary

旧原型代码和文档已完成本地规格、资金领域模型和模拟应用闭环。M00/M02/M03 的完成口径限于旧计划本地范围；旧 M01 的 CI 权限阻塞是 2026-09-05 的历史记录，不能覆盖新仓库现有 CI 结果。

## Evidence

旧项目源提交 0a813de422a02a2b3f0ade7eee693f0d2491ec33。M00 基础规格；M02 整数金额/余额守恒/幂等；M03 React/Fastify/SQLite、真实 HTTP 重启与备份、本地浏览器核心流程；旧 M04 只读依赖报告、保密实验协议和离线证据清单工具。

## Tests

旧 M04 交付时完整 check 57/57；M03 本地范围有浏览器与 HTTP 重启/备份证据。均为历史结果，不是当前 dashboard 分支测试。

## Mapping

M02 -> LEDGER-001；离线许可核心 -> PERMIT-001；M03 -> LOCAL-001；M01 -> CI-001 的早期工程基础；M04 -> NET/ASSET/TRUST 的参考证据及保密运行前期调研。映射不是自动验收。

## Not fully resolved

M04 的 17 项真实硬件检查仍未运行；旧 M03 补充窄屏/完整键盘/跨浏览器检查未完成。没有真实交易、链上合约或 TEE 集成证据。

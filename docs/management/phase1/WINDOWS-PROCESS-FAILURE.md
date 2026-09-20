# AlphaForge：Windows 文件级失败调查

> 2026-09-21 状态更新：用户已自行将仓库公开，并授权恢复GitHub只读核查与正常PR验证；由01统一调度，06不自行push/rerun。下文预算暂停阶段的记录保留为历史，不再表示当前全面禁止查询。merge、部署、规则变更、新服务/larger runner仍未授权。执行器初版证据已被05提出P1/P2；当前修复证据见CI-LOCAL-POC末尾追加，不以初版PASS代替复核。

Macbeth06 / M3-06-CI-GATES；2026-09-20。结论：**UNDETERMINED / NON-REPRODUCED_ON_ONE_RERUN**。没有证明 flaky，也没有代码修复可归因。本轮原生 Windows 验证 **NOT_RUN**；Actions/Checks 的触发和状态查询持续暂停。

## 已保存事实

准确候选 `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`，tree `6f1a21845a99e16a0ba171612cd97e9bf3439294`。以下来自暂停前保存的日志/响应和01提供的本地日志，不是本轮重新查询。

| 观察 | 证据及限度 |
| --- | --- |
| 初次 PR 执行 | run35499025043、attempt1、Windows job106047314192。Node24.21.0/npm11.19.1；镜像20260907.229.1；Git2.55.windows。712总项、711通过、1文件级失败 |
| 失败位置 | `test\m3-injected-runtime.test.ts:1:1`，`test failed`。该文件五个具名用例均已输出PASS，额外失败在文件进程/测试运行器边界 |
| 最终退出 | 整个 job 退出1；finally 环境检查退出0不能覆盖前面的测试失败，后续串行步骤不可被当作已跑 |
| 同源旁证 | 当时保存的 push Windows记录711项通过，仅为另一执行旁证 |
| 唯一一次已授权重跑 | attempt2 Windows job106048339488，完成2026-09-20T08:26:10Z，711/711及后续完整链通过，identity71。未改源码 |
| 重跑新鲜度 | attempt2返回9个job对象，但8个非Windows沿用先前步骤/时间，仅Windows是真正新执行。不能把9个新job ID计作9次新运行 |
| 本轮静态协作 | 05主动反馈其读取01保存日志也观察到711具名PASS+1文件级失败，原因未定；01负责后续协作 |

06保存的证据位于忽略目录 `.checks/macbeth06-pr22-3a78e34/`（REPORT.md、windows-failure.json、windows-diagnostic-markers.json等）及 `.checks/macbeth06-pr22-3a78e34-attempt2/`（REPORT.md、attempt-job-mapping.json等）。06最初保留的是选取诊断片段/响应，不应称为完整原始日志；01另有 `.checks/phase1-resume/windows-3a78-initial.log`，05已读。发布证据包应保留这些区别，并由01统一纳入索引。

## 本轮源码检查与本地旁证

静态读取准确候选中的五个测试以及 `m3-injected-runtime-fixture.ts`、`m3-browser-runtime-set.ts`、`m3-browser-runtime.ts`、`chain-wallet.ts` 的相关路径：测试使用内存 mock provider/reader，异步动作显式 await；fixture中的 `eth_sendTransaction` 是内存请求记录，不是链上广播。被检路径没有直接启动文件进程、SQLite、监听网络或 interval/timer。runtime的subscribe以Set维护内存监听者；runtime-set内部订阅也不等同OS活跃句柄。浏览器controls的DOM click绑定不在这些Node测试的挂载路径内。

这些观察缩小了显式资源泄漏候选，但没有穷尽Node测试运行器、原生模块、其他并行测试或Windows平台行为。不能据此排除进程异常、资源压力、并发相互影响或运行器缺陷。

本轮在独立准确源码副本运行31项子集，包含这五项，Darwin26.6.2 arm64/Node24.21.0通过；日志见 `CI-LOCAL-POC.md` 中真实源码run。这是本地辅助证据，**不是 Windows复现**，也未重复大量运行追求绿灯。新增本地执行器的进程信号/清理回归验证的是执行器本身，不解释历史Windows失败。

## 尚缺的诊断与下一次有界实验

| 假设 | 现有证据 | 仍需什么 |
| --- | --- | --- |
| 具名断言失败 | 五个具名用例通过，不支持普通断言失败解释 | 完整 reporter/文件级exit/signal/stderr，确认没有遗漏晚到错误 |
| 顶层未处理异步错误或文件子进程异常退出 | 与文件级失败相容，但未发现具体异常堆栈 | 受控 reporter JSON/TAP、unhandled rejection/uncaught error记录；不能先改代码吞异常 |
| 进程资源/并行测试干扰 | 可能但未证实 | 同源原生Windows运行单文件和原完整并发链的有界对比，资源/句柄信息；不得用降低并发永久掩盖问题 |
| Node/Windows测试运行器或镜像问题 | 同源一次重跑不复现，尚不足归因 | 精确Node及镜像/OS记录、exit/signal/系统诊断；有最小复现后才查对应上游问题 |
| fixture资源未清理 | 静态未发现直接OS活跃资源 | 原生Windows运行期间资源观察、可重复残留句柄证据，才能提出资源释放修复 |

在已有获准的原生Windows设备可用时：独立完整checkout、独立依赖/临时目录、精确Node/npm准入、无凭据local/mock，先运行该文件一次，再运行原始完整测试链一次，逐次保留退出和日志。仅有必要时加入有界诊断；不重复直到成功、不先放宽timeout或删除测试。任何新代码修复都需稳定失败例、修复后回归和最终候选验证。

当前未取得这样的原生Windows环境，因此上述实验NOT_RUN。若要新设备、runner注册、远程执行或恢复Actions，需用户明确批准；本轮没有申请或执行。未来一次PASS仍不足以结案为已修复。

## 协作与授权记录

一次06→05发送私有CI诊断及本地路径的工具操作曾被自动审批拒绝，理由是该具体敏感载荷和协作者目的地未充分授权。已报告01，未换渠道或改名重试；01使用自己已有日志协调05。05随后主动给出的诊断只作其自述旁证，不等于独立安全批准。该限制不影响06继续本地分析和向已授权的01交付。

# `5959a44` 最终候选独立重测记录

记录日期：2026-09-21；Macbeth05；本地/mock。

候选完整 SHA：`5959a441f9e199ec325bbbf86bce94511a90e210`；tree：`4b2b51f3cc39ab086e850b8616cd509fb604a43f`；固定 base：`18f5352070910a867b9729b031aa2e3951785e01`。

## 已通过的资格项

在准确候选独立 clone 中，5 项 Node coverage qualified tests **5/5 PASS**，7 项 browser coverage qualified tests **7/7 PASS**。Node 和 browser 工具均按 descriptor 逐字、逐文件校验，使用 Node 24.21.0、Chrome 153.0.8010.50 和既有 Playwright-core 1.62.1；未下载新工具。

## 联合采集结果

`npm run coverage:node -- --tools ... --browser-tools ... --chrome ... --base 18f5352070910a867b9729b031aa2e3951785e01` 实际执行，准确 Node workflow 在 `npm run check` 的 `format:check` 阶段退出 1。唯一报告的格式文件是此前候选已提交的 `docs/management/agents/qa/M3-05-PHASE1-ACCEPTANCE/evidence/browser-driver-review/result.json`。因此 `functionalState=FAIL`，browser workflow 没有被声称完成，`thresholdMet=false`；报告中的 19.29% / 19.16% / 21.71% / 14.32% 是此失败运行保留的部分零下界计数，**不是候选覆盖率结论**，不能用于方法准入或最终验收。

这正是 fail-closed 门禁预期行为：不得把 Node 命令失败、格式失败、未完成 browser/lifecycle 或原始报告问题包装成 PASS。完整原始命令输出保存在 ignored `.checks/macbeth05-private-review-originals/5959a44/`；公开可审摘要、失败证据和 SHA 清单见 [final candidate evidence](evidence/final-candidate-5959a44/SHA256SUMS.json)。

## 当前状态

`5959a44` 在该准确字节上的联合 coverage **FAIL / NOT_ADMITTED**。后续候选须包含已格式化的报告文件，并重新运行完整 Node + browser workflow、四维报告和 independent replay。此前 03/04/06 worker 修复及资格测试 PASS 不替代这次精确候选门禁。

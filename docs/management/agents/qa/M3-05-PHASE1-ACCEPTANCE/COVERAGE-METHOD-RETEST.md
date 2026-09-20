# 覆盖率方法独立复核补充

记录日期：2026-09-21；Macbeth05，`M3-05-PHASE1-ACCEPTANCE`。

## 当前结论

`METHOD_RETEST_PARTIAL / FINAL_CANDIDATE_PENDING`。这份记录不把方法测试绿灯转换为整体覆盖率达标，也不改变既有 `M3-05-P1-001 = NOT_MEASURED`。准确统一候选 `5959a44` 尚未在本独立 clone 中完成复跑；经理继续执行完整 `npm run check`、Node 工作流与 M3 浏览器联合采集。

## 9aefa70 独立复核

在完整、干净的 `9aefa70c7af30f5710500d128c7aa49e20fda7e4` clone 中，先按项目现有 `npm run import:ui` 生成测试所需的 ignored UI 输出；首次直接运行暴露 `test/coverage-prototype-map.test.mjs` 读取 `build/ui-import/user-ui.js` 的前置依赖（ENOENT），该失败原样保留。生成步骤后，7 个 coverage 方法套件为 **41/41 PASS**。这要求测试自身在隔离临时目录生成输入或明确入口顺序，不能依赖另一测试/构建的副作用；01 已确认修复方向。

批准的 instrumentation descriptor SHA-256 为 `9c7cfe03cb7dd97d5313a61d4e70d85ccb38c3b9a97ab287c950c27bbffaa39a`。05 逐文件复制并核验 2009 regular files / 9 internal symlinks、distinct inode、无下载。`prepareCoverage` 对准确源生成 **128 sources / 1 alias**，manifest `bac8be802db437da0efaedd4e9049b80c4099eb86acf70aba1faf523f51f69c4`，generated `0a37860f9c4b31d946b37dffc9b6c594d86951b98cd847e9ed34302cc2db9949`；`verifyPrepared` 重新生成图一致。

两个真实本地 CLI 工作流也做了独立回放：带 `.env.example` 的 `tools/check-config.ts` 为 PASS / readback PASS；旧候选中真实隐私检查为 FAIL / readback FAIL。两者分别保留 root lifecycle、日志和未完成计数（均为 0）。这证明 executor 能保留功能 FAIL，不能证明当前候选的总覆盖率。

## 04 浏览器覆盖率方法

在 `c35803523b4219059826fd7fd5b26af96f397e4e` 的浏览器 coverage 模块上，原 6 项 qualified tests 为 6/6 PASS。独立负例发现 snapshot transport 丢失会让 navigation/finish 抛错并终止工作流，即使 interval 已记录 `complete=false`、`sources={}`。证据见 `browser-capture-loss.json`。该行为违反先前批准的 lower-bound 边界：未采集 interval 应保留零贡献并继续真实功能路径，而已取得 raw 后的 graph/map/format 错误仍必须 fail closed。

04 修复 `1845447a0e0d817f42327cb81309b472f60c1da2`（tree `57bf77b51693fbf0f363430e9a1dd1a5651832e9`）后，05 在准确 clone 以批准 Node/Chrome/Playwright 运行 **7/7 PASS**，包括 context-destroyed 后真实 navigation 继续、重复 flush/reload/close、unknown page、raw/graph/index 篡改拒绝。修复区分 transport 丢失（zero/incomplete、继续）和已持久 raw 的证据损坏（throw/fail closed）。

## 限制与下一步

- 浏览器 qualified 结果使用历史 fixture 与旧候选 manifest；不是 `5959a44` 的正式覆盖率数字。
- 真实 browser page/navigation 收集需要 manager 在最终 candidate 重新生成 manifest、运行工作流并把 raw/index/replay 绑定到同一 candidate/tree/tool digest。
- 四个 Istanbul 维度、critical semantic assertions、incomplete lifecycle 下界和 browser lower-bound 必须在最终 candidate 一起审查。`methodAdmission` 仍保持 `PENDING`。

原始日志、脚本、结果和 SHA 清单在 [coverage evidence](evidence/coverage-versioned-review/SHA256SUMS.json)。完整 prepare/raw 目录仅保留于 ignored `.checks/macbeth05-coverage-versioned-9aefa70/`，不进入公开树；其 manifest/生成物/每个文件 SHA 见同目录的 ignored `ignored-raw-SHA256SUMS.json`。

# AF-QA01 bounded QA plan

Agent: Macbeth05

Task: AF-QA01

协调 PR：https://github.com/pdbsy/quantpass/pull/8

冻结契约：`73230c43e464cd1b579fa16a6425756291ef9e8e`，version 1；详细验收预期见 [CONTRACT-REVIEW.md](CONTRACT-REVIEW.md)。

本 Worker PR：https://github.com/pdbsy/quantpass/pull/6

## 1. 固定公开输入

在自己的隔离工作区记录 master、PR base/head SHA、文件差异、作者完成范围、CI 和运行前提。分别获取 Macbeth02 UI、Macbeth03 Backend、Macbeth04 Contract 及 Macbeth01 冻结契约/集成候选。仅公开提交可作为输入；不进入作者的工作区或读取其数据。不把计划文件当作实现，不把 CI 或作者 PASS 当独立执行。

## 2. 验收设计

按 ACCEPTANCE-MATRIX.md 逐项覆盖 UI、后端、浏览器、安全、合约、ID/金额/状态、重试和失败路径。用冻结契约约束期望值；不为使测试通过而改 expected result。共享 package/lock/CI/type/schema 文件如需修改，先在自己的 PR 公开 SHARED FILE CHANGE REQUEST，由 Macbeth01 协调；当前只新增 Macbeth05 QA 文档，无此改动。

## 3. 独立回归与环境

拿到准确实现后，在自己的隔离工作区准备独立运行数据和缓存，确认锁定工具版本。只对明确的功能边界编写必要回归；只运行检查过的本地测试。金额用整数最小单位、decimal metadata 和字符串序列化，覆盖 ID/账户/策略一致性、状态与重试约定、正常异常输入、幂等、revision、重启与备份恢复。先运行范围内测试，再按候选变更执行必要集成检查。保存真实命令、退出码和日志；不降低门禁。没有源码或环境则记录 NOT RUN/BLOCKED。

## 4. UI 与真实浏览器

先固定用户认可的 UI 基准及授权范围，逐文件核对是否保留设计。未经授权的大范围视觉或布局改动是集成阻塞项。拿到准确集成候选后，只启动自己的本地服务，以真实 Browser 操作五页主流程、error、pending、retry、account switch、refresh、server restart 及响应式基础检查，记录浏览器版本、viewport、动作和截图。服务重启只影响自己启动的进程。源码审查不能冒充 Browser Test。没有实际操作时必须写 Browser verification: NOT RUN。

## 5. 安全与合约边界

安全检查以已发布差异的防御性静态审阅为基础，覆盖身份作用域、错误脱敏、HTML、存储、URL、跨源、CSP 及门禁；不构造或执行漏洞利用复现。准确 diff 未出现前不启动或宣称完成 security-diff-scan。记录安全范围与未覆盖项，不能用功能测试代替安全结论。合约仅在准确环境具备时独立核验工具版本、forge build、forge test 和防御性静态分析；不部署、不广播、不接触真实资金或密钥。

## 6. 问题发布与复验

确认的问题在自己的 PR 使用 REVIEW FINDING 格式发布：Finding ID AF-QA01-FXX、Target Agent、Target PR、Severity、Evidence、Expected Result、Actual Result、Required Fix。证据绑定 SHA 和精确位置，必要时脱敏。缺失依赖使用 D-* 阻塞 ID，不伪造缺陷严重度。由原作者修复，不改其业务代码。复验必须记录 Original SHA、Fix SHA、Revalidation PASS/FAIL、方法及影响范围；旧 PASS 不继承给新提交。未复验项写 NOT RUN。

## 7. 结束标准

发布 WAVE 1 VERIFICATION REPORT，包括 Scope reviewed、Exact commits、各领域结论、PASSED/FAILED/NOT RUN/BLOCKED、Open findings、Resolved findings 和 Integration recommendation。只有所有必需项目有独立证据、无未解决的 Critical/High 或 UI 保护阻塞，并且结果属于同一候选时才可给 READY FOR INTEGRATION；其余为 BLOCKED。QA 文档交付状态可以是 READY FOR REVIEW，但不代表产品可集成。不自合并。

## 8. 本轮范围和停止条件

本轮先完成输入核验、矩阵、计划和有事实依据的报告。若只有任务/计划提交、缺失 UI/Contract PR 或冻结契约，则发布准确阻塞及依赖请求，保留 Draft PR 待交付可用后继续；不启动无关的旧 Demo 验收。没有自动监控安排，不声称后台持续测试。

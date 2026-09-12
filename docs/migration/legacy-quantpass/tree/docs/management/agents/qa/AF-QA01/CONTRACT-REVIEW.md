# Frozen contract review and test plan

Agent: Macbeth05 · Task: AF-QA01 · Document status: READY FOR REVIEW

## 固定依据

- Contract version 1 / FROZEN / TEST_ONLY：[准确契约](https://github.com/pdbsy/quantpass/blob/73230c43e464cd1b579fa16a6425756291ef9e8e/docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md)。
- Contract commit: `73230c43e464cd1b579fa16a6425756291ef9e8e`。
- 原始文件 SHA-256：`e7301dbb170fa4c409bb824013e06483e0dd51bd8e2d54f24cb7b047d817d481`（通过 git show 与 shasum 独立计算）。
- [经理 NOTICE](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646374131) 已读取。
- 独立读取全部契约正文，并与 master `0a813de422a02a2b3f0ade7eee693f0d2491ec33` 的 `balances()`、Pass allowance 和事务回执语义作有限静态对照。这是文档/代码阅读，不是执行测试。
- 已读取 Backend 已发布实现 `708ab59181fe7b372c89f866125a1ffa26cef5be` 的 product-views.ts、strategy-catalog.ts、api-errors.ts 及相关路由片段，只进行契约对照；不是完整实现或安全审阅。

## 冻结契约到验收矩阵

| 属性 | 冻结预期和后续正常边界测试 | Matrix |
| --- | --- | --- |
| 身份/ID | ownerId → strategyId → vaultId；每对仅一个当前 vault；标识符 1–80 字符；空关系为 not_started/null；客户端字段不构成授权 | BOUND-01、BE-04/05 |
| 金额 | 无符号/有符号规范十进制字符串，最多 78 位；assetId TEST_ONLY_USDT_UNIT、decimals 6；覆盖 0、大于 JS 安全整数的值、负 PnL、前导零/精度错误；禁止通过浮点数往返 | BOUND-02、BE-01 |
| Pass | whole Pass units；allowance = passes × 10^6，和现金分开；不能把 Pass 当报价或现金资产相加 | BOUND-02、TRUTH-02 |
| Canonical resources | StrategySummary/Detail、AccountSummary、AccountStrategy、PassBalance、Vault 的必要字段及 schemaVersion: 1；老字段兼容不能代替新必需字段 | BOUND-01、BE-12 |
| 状态 | AccountStrategy 允许 not_started；Vault 仅 stopped/running/stopping；PendingOperation 使用小写 pending、order/withdrawal 和字符串 amount，终态在 audit；UI 页面 phase 可独立命名 | BOUND-03、UI-09 |
| 分页 | cursor 是不透明值，limit 默认 50、范围 1..100，返回 items/nextCursor；顺序/延续/无效游标和重复读取；旧 array 路由兼容边界需明确 | BE-11、BOUND-06 |
| 错误 | 最小 APIError 只有 error，值必须属于冻结闭集；code/message/retryable 不属于必需字段；内部错误归 LOCAL_OPERATION_FAILED；新增公开 code 先请求决策 | BOUND-04、BE-06、SEC-02/03 |
| 原样重放 | 同 ID/规范 payload 不再次变更状态并标记 replayed；不同字段同 ID 返回 IDEMPOTENCY_CONFLICT | BE-02、BOUND-04 |
| 冲突 | stale expectedRevision 不改状态；先读取再重新判断原意有效性，经用户流程确认后用新 ID | BE-03、BOUND-04 |
| 不确定结果 | timeout/5xx 先读 vault 和 audit，缺少命令才原样重试；不因本地 timeout 标记成功，不替换 uncertain ID | UI-08、BR-04、BOUND-04 |
| 浏览器/设计 | 五页流程及错误/pending/retry/账户切换/刷新/自己服务重启；比较用户原始 UI；大范围未授权改动阻塞 | UI-*、BR-* |
| 合约边界 | 只对准确源码和环境运行本地功能回归；资金/密钥/部署/广播仍关闭；ABI 提案不能成为运行能力声明 | CHAIN-*、BOUND-05 |

## 当前结果与开放事项

- PASSED：冻结 SHA 与文档读取、摘要计算、测试预期映射及有限基准语义核对。
- 原始静态 FAILED：F01/F02/F03 at `708ab59181fe7b372c89f866125a1ffa26cef5be`；现已在最终 Fix SHA `f66faa10c2a22f56048b04416cd83a2e8e9dd481` 专项复验 PASS / RESOLVED；见 [REVALIDATION.md](REVALIDATION.md)。
- 已运行：最终 Backend 的 15 项产品回归 + QA 5 组正常断言。NOT RUN：浏览器、完整安全审阅、Forge、全部根工程检查和最终集成套件。
- BLOCKED：等待 AF-BE01/AF-UI01/AF-CHAIN01 最终候选及经理组合候选；冻结契约本身不再是缺失依赖。

## Q01 — RESOLVED：canonical 与 legacy 独立验收

[Macbeth01 公开决策](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646423661) 已读取。冻结契约 SHA 保持 `73230c43e464cd1b579fa16a6425756291ef9e8e`；本决策明确映射边界。

- canonical collection 至少包括 `/api/v1/strategies`、`/api/v1/vaults`、`/api/v1/vaults/:vaultId/audit`，返回 Page<T> 的 items/nextCursor；cursor 不透明；limit 默认 50、1..100。
- legacy `/api` 的数组、after/X-Next-Cursor、audit beforeRevision/默认 100 可保持，不因这些行为判契约失败。
- 允许经测试的 legacy → canonical adapter，但 canonical 命名、封装、顺序、错误仍须符合冻结契约。
- 复验同时检查 legacy 兼容性与 `/api/v1` 合规，不把旧接口的可保留差异算成新缺陷。
- F01–F03 在原 SHA `708ab59181fe7b372c89f866125a1ffa26cef5be` 被经理确认；只有作者公开 Fix SHA 后才复验。后续最终修复 `f66faa10c2a22f56048b04416cd83a2e8e9dd481` 已实际发布并专项复验通过。

## F01–F03 复验步骤

1. 从 Macbeth03 自己的公开 PR 获取明确 Fix SHA、完成范围、运行说明；核对该提交实际可取得。没有公开修复就保留 OPEN / Revalidation NOT RUN。
2. 对原 SHA → Fix SHA 的投影/路由/错误差异作静态检查，确定 canonical 入口与 legacy 边界。只读取发布的源码快照，不访问作者工作区。
3. 在 Macbeth05 自有数据目录运行普通功能场景：空账户及有测试策略的 canonical AccountSummary；测试 order/withdrawal 的 PendingOperation；正常不存在策略/路由的 error 闭集；旧入口兼容。记录实际方法/输出，不能用静态阅读冒充 HTTP 执行。
4. 独立核对 `/api/v1` 分页 envelope、默认/边界 limit、正常续页顺序、opaque cursor 使用和正常无效参数处理；legacy 单独按兼容语义核对。
5. 逐 Finding 记录 Original SHA、Fix SHA、Revalidation PASS/FAIL 和静态/运行时覆盖；只关闭已有证据解决的问题，不把这些专项通过提升为最终 Wave 1 集成 PASS。

## 最终集成执行门槛

经理提供纳入的 AF-BE01/AF-UI01/AF-CHAIN01 精确 SHA 和组合 candidate SHA；各作者提供环境/命令/虚构数据前提；UI 原始工件可独立比较。随后仅在 Macbeth05 自有目录运行相关回归，再运行最终组合套件。每条结果包含 SHA、方法、预期/实际和证据；新 SHA 不继承 PASS。不得把“契约已冻结”误解为三个实现均可验收。

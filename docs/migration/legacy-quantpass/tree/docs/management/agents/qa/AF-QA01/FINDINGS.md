# AF-QA01 Review Findings

以下为冻结契约一致性发现，不是漏洞复现。F01–F03 保留原 Backend 静态证据，并已在准确修复 SHA 关闭；F04/F05 保留 UI 原 SHA 的合法最小响应失败，并已在最终组合复验关闭。冻结依据 `73230c43e464cd1b579fa16a6425756291ef9e8e`，每项仅对其明确 SHA 成立。QA 不修改原作者实现。

## REVIEW FINDING

Finding ID: AF-QA01-F01

Target Agent: Macbeth03

Target PR: #7

Severity: Medium

Evidence: [accountView 返回值](https://github.com/pdbsy/quantpass/blob/708ab59181fe7b372c89f866125a1ffa26cef5be/apps/server/src/product-views.ts#L76) L76–86；[GET /api/account](https://github.com/pdbsy/quantpass/blob/708ab59181fe7b372c89f866125a1ffa26cef5be/apps/server/src/app.ts#L190) L190–202 直接返回该投影。冻结契约 AccountSummary L58–64 要求 schemaVersion、scope、ownerId、strategies 和 passBalances。

Expected Result: 新 AccountSummary 能按冻结字段消费，逐策略 Pass 与账户关系可直接关联，旧兼容字段可加在其外。

Actual Result: 返回 identity.id、passes、vaults 等旧模型字段，没有 schemaVersion、顶层 ownerId、strategies 或 passBalances。按冻结 AccountSummary 读取时必需字段缺失。依据为直接返回对象的静态路径，HTTP 执行 NOT RUN。

Required Fix: 原作者提供冻结 canonical account 投影或经 AF-M01 批准的明确边界；保留旧兼容性，并加入空账户及多策略关系/Pass 字段的契约回归。若要改变冻结资源，先发布 QUESTION/变更请求。

Original SHA: `708ab59181fe7b372c89f866125a1ffa26cef5be`

Fix SHA: `f66faa10c2a22f56048b04416cd83a2e8e9dd481`

Revalidation: PASS — 在准确 Fix SHA 重跑产品测试和 QA 补充断言；见 REVALIDATION.md。

Status: RESOLVED

## REVIEW FINDING

Finding ID: AF-QA01-F02

Target Agent: Macbeth03

Target PR: #7

Severity: Medium

Evidence: [pendingOperations](https://github.com/pdbsy/quantpass/blob/708ab59181fe7b372c89f866125a1ffa26cef5be/apps/server/src/product-views.ts#L29) L29–39，作为 view.pendingOperations 返回；冻结契约 PendingOperation L117–135。

Expected Result: operationId；kind 为 order/withdrawal；status 为 pending；amount 是 MoneyString。stop/stopping 是 Vault 状态，不引入新的 PendingOperation kind。

Actual Result: 投影用 id、PENDING、ORDER/WITHDRAWAL，并在 stopping 时增加 kind STOP、amount null。这些条目违反冻结的必需字段/闭合枚举/金额类型；依冻结模型消费的 pending 过滤与显示可能漏项或读不到 ID。仅静态判断，未运行客户端。

Required Fix: 原作者在 canonical 投影映射准确字段和小写枚举，保持 stop 在既有 Vault 状态；若需要新增类型先请求契约决策。增加 order、withdrawal、stopping 和终态不留 live 集合的正常契约测试。

Original SHA: `708ab59181fe7b372c89f866125a1ffa26cef5be`

Fix SHA: `f66faa10c2a22f56048b04416cd83a2e8e9dd481`

Revalidation: PASS — 在准确 Fix SHA 重跑产品测试和 QA 补充断言；见 REVALIDATION.md。

Status: RESOLVED

## REVIEW FINDING

Finding ID: AF-QA01-F03

Target Agent: Macbeth03

Target PR: #7

Severity: Medium

Evidence: [api-errors.ts](https://github.com/pdbsy/quantpass/blob/708ab59181fe7b372c89f866125a1ffa26cef5be/apps/server/src/api-errors.ts#L31) L31–32 定义 STRATEGY_NOT_FOUND/NOT_FOUND；[路由](https://github.com/pdbsy/quantpass/blob/708ab59181fe7b372c89f866125a1ffa26cef5be/apps/server/src/app.ts#L163) L163/174 和 not-found handler L108 实际引用，L98–106 的错误处理将该 code 对外序列化。冻结契约第 5 节的闭集不含这两个 code。

Expected Result: 公开 error 仅使用已冻结 code；新增 code 必须由 AF-M01 先决定。客户端能按稳定闭集选择恢复行为。

Actual Result: 对应路径可返回冻结表之外的公开 error 值。额外 code/message/retryable 字段本身不作为这个 Finding 的依据；问题是闭集被扩大。静态路径已核对，HTTP 执行 NOT RUN。

Required Fix: 原作者使用冻结列表中的已批准映射，或向 AF-M01 请求明确 status/code 决策后实现；补齐普通未找到场景的错误契约检查。QA 不擅自选择新 code 或修改契约。

Original SHA: `708ab59181fe7b372c89f866125a1ffa26cef5be`

Fix SHA: `f66faa10c2a22f56048b04416cd83a2e8e9dd481`

Revalidation: PASS — 在准确 Fix SHA 重跑产品测试和 QA 补充断言；见 REVALIDATION.md。

Status: RESOLVED

## Summary

Open findings: 0。Resolved findings: 5。F01–F05 在最终组合 c22cfdf59ee120d7d8c5a75edc79ce97418435c7 独立复验 PASS；没有完整安全扫描完成声明。

## 协调确认与复验入口

[Macbeth01 决策](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646423661)确认 F01–F03 在原 SHA 有效，并明确 canonical `/api/v1` 与 legacy `/api` 分离。复验允许保留已批准的旧路由兼容行为，检查修复后的 canonical 投影；只采用 Macbeth03 后续公开的 Fix SHA。最终 Fix SHA `f66faa10c2a22f56048b04416cd83a2e8e9dd481` 已独立复验，三个 Finding 现为 RESOLVED；原始 Actual Result 描述保留为历史证据。

[完整专项复验和可重现 QA 脚本](REVALIDATION.md)。

## REVIEW FINDING

Finding ID: AF-QA01-F04

Target Agent: Macbeth02

Target PR: #9

Severity: Medium

Evidence: [product-adapter.ts L118–119](https://github.com/pdbsy/quantpass/blob/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/apps/web/src/product-adapter.ts#L118) 对 `v.asset` 强制 object/decimals 检查。冻结接口 `73230c43e464cd1b579fa16a6425756291ef9e8e` 第 3 节的必需资产位置为 `Vault.balances.asset`，Vault 顶层没有 asset 必需字段。作者“canonical-only”fixture 仍带这个额外字段，未覆盖最小契约。

Expected Result: 只包含冻结 Vault 必需字段、且 balances.asset 合法的普通响应应被接收，无需任何 legacy/额外顶层 asset。

Actual Result: QA 从公开 f66faa10 NORMAL fixture 仅选冻结 Vault 字段，直接调用 fromCanonicalVault：抛 INVALID_PRODUCT_RESPONSE / 502；同一对象只补顶层 asset 后通过。没有改金额、状态或归属。此为功能契约兼容失败，不是安全漏洞或真实后端当前响应失败。

Required Fix: 从冻结的 balances.asset 读取并校验资产（固定 TEST_ONLY_USDT_UNIT / 6）；额外 alias 不应成为必需条件。补不带顶层 asset 的最小 canonical fixture 回归，保留正常拒绝非法金额/归属行为。

Original SHA: `3caf8dd4c12a6b5da38ee3664b44683b69affcd2`

Fix SHA: `039496859dd238f8bc18824d9a39bca9f9031ea3`

Revalidation: PASS — 在准确最终组合 `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` 重跑原 QA 最小合法响应及对照；作者新增回归也包含在109测试中。详见 [最终组合证据](INTEGRATED-REVIEW.md)。

Status: RESOLVED

## REVIEW FINDING

Finding ID: AF-QA01-F05

Target Agent: Macbeth02

Target PR: #9

Severity: Medium

Evidence: [product-adapter.ts L387–394](https://github.com/pdbsy/quantpass/blob/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/apps/web/src/product-adapter.ts#L387) 对每个 StrategyDetail 执行 object(d.accountStrategy)。冻结契约 StrategyDetail.accountStrategy 明确为 AccountStrategy | null。

Expected Result: 合法 accountStrategy:null 的详情应能加载为尚无详情关联的状态，不能中断整个 account/catalogue 刷新；非空关联仍须校验 owner/strategy。

Actual Result: QA 提供普通已认证 Alice、空 Vault 页、合法 canonical account/strategy 和 accountStrategy:null：client.refresh 抛 INVALID_PRODUCT_RESPONSE，phase DISCONNECTED。同一响应仅改为该 Alice/strategy 的 not_started 关联对象则通过并进入 EMPTY。当前 f66faa10 通常返回关联对象，因此现有集成测试不会暴露该最小契约兼容问题。

Required Fix: 按冻结类型接受 null，并将 null 安全传递到详情显示/claim 路径；保留对非空关联的 owner/strategy 校验。增加合法 null 的回归。如果需收紧冻结契约，应先取得 AF-M01 明确决定，不能静默改变。

Original SHA: `3caf8dd4c12a6b5da38ee3664b44683b69affcd2`

Fix SHA: `039496859dd238f8bc18824d9a39bca9f9031ea3`

Revalidation: PASS — 在准确最终组合 `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` 重跑原 QA 最小合法响应及对照；作者新增回归也包含在109测试中。详见 [最终组合证据](INTEGRATED-REVIEW.md)。

Status: RESOLVED

UI 两项原始执行日志和完整 QA 脚本见 [UI-REVIEW](UI-REVIEW.md)。

最终组合还重新执行 F01–F03 / Q01 的5组QA断言，全部通过；历史失败描述不删除。

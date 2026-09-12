# AF-UI01 集成修复 — READY FOR REVIEW

Original SHA: `3caf8dd4c12a6b5da38ee3664b44683b69affcd2`。Fix SHA 以包含本报告的提交及 PR #9 最新交接消息为准。

## 修复范围

1. **合并类型失败**：AF-BE01 的完整 `view()` 新增规范字段，原适配器内部兼容投影不应注解为完整服务端返回类型。`ClientVault` 现在基于已有领域共有字段声明控制器所需结构，规范页面数据仍保存在唯一的 ProductAdapter 中。没有类型强转掩盖缺失字段，没有更改服务端类型或冻结契约，也没有改变资金值或请求内容。
2. **多 Vault 回归**：新后端的旧 `/api/vaults` 明确保留 core-only 语义。测试改用真实页面所用的 ProductAdapter 和登记过的 satellite-flow-demo，从规范接口读取所有关联 Vault。仍验证跨 Vault retry 被拒绝、原 pending 文本不变、返回原 Vault 才能恢复，另一 Vault 余额保持零。
3. **最小 Vault 契约**：资产校验读取必需的 `balances.asset`，不再要求附加顶层 `asset`。资产 ID 和六位精度保持严格校验。
4. **可空策略关系**：接受冻结契约允许的 `StrategyDetail.accountStrategy: null`；关系非空时继续校验 ownerId / strategyId，不接受其他账户的关系。

冻结契约：`73230c43e464cd1b579fa16a6425756291ef9e8e`。后端代码、命令幂等、pending envelope、revision 语义及 UI 布局均未改动。

## 实际验证

在自己的 ignored 检查目录建立独立 detached worktree，以真实后端 `f66faa10c2a22f56048b04416cd83a2e8e9dd481` 合并原 UI `3caf8dd4`。只在隔离目录合并双方 package.json 测试入口，没有修改任何其他 Worker 分支。修复文件随后覆盖到该真实融合树，后端类型直接参与 TypeScript 检查。

- RED：融合 `npm run typecheck` 复现 TS2740；真实后端多 Vault 测试复现 VAULT_NOT_FOUND；新增最小 Vault 和空 relation 两项测试分别复现 INVALID_PRODUCT_RESPONSE。
- GREEN：原分支 controller/adapter 35 项测试及 typecheck 通过。
- **融合 `npm run check` 全部通过，109/109 测试通过**：两个 TypeScript 项目、lint、format、secret baseline、测试和完整构建均通过。
- **融合浏览器验收 PASSED**：同一融合构建运行真实 Chrome + Fastify + SQLite，十三种操作、停止等待结算、刷新持久化、Alice/Bob 隔离、两个策略隔离、丢失响应精确恢复、revision 冲突、错误/断线状态、原六页与手机布局全部通过；零页面异常/CSP违规。
- 独立增量只读审查：READY FOR REVIEW，无未解决 finding。

[已提交浏览器结果](evidence/integration-fix-browser.json)。完整截图留在 `.checks/AF-UI01/integrated-fix/.checks/AF-UI01/browser-sKrPoH`；日志为 `.checks/AF-UI01/integrated-typecheck-red.log`、`integrated-client-red.log`、`contract-minimum-red.log`、`integrated-fix-check.log`。不提交 SQLite 数据库或会话材料。

本次验证组合为 AF-BE01 + AF-UI01；管理者仍应在自己的 AF-M01 全部候选组合上按新 Fix SHA 重新执行最终门禁。保持 Draft PR，不自行合并。

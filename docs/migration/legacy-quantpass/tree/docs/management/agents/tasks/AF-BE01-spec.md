# Macbeth03 — Backend & Product Data

## Identity

**AGENT_NAME = Macbeth03**
**TASK_ID = AF-BE01**
**ROLE = Backend / Data Engineer**

任务：为用户的新 AlphaForge UI 提供稳定的 Strategy、Account、Vault 数据接口，同时保留现有账本安全语义。

不要重写整个 Backend。

## 初始化

```bash
pwd
git status
git branch --show-current
git rev-parse --show-toplevel
git worktree list
git remote -v
git fetch origin
```

重点检查 apps/server、packages/domain、SQLite store、existing API、existing tests。

## Branch

```text
macbeth03/AF-BE01-product-api
```

## Commit 格式

```text
feat(AF-BE01): [Macbeth03] add strategy catalog API

Agent-ID: Macbeth03
Task-ID: AF-BE01
```

## Draft PR

```text
[Macbeth03][AF-BE01] Build product APIs for strategy and account data
```

## Strategy Catalog

建立统一的本地 Strategy Catalog。第一版可以使用 versioned local fixtures。

至少提供与现有架构一致的：

```text
GET /strategies
GET /strategies/:strategyId
```

或等价接口。

Frontend 不应维护另一份相互冲突的业务定义。

## Account Summary

提供稳定账户视图，至少包含当前架构支持的：identity、passes、vaults、strategy association、idle balance、allocated balance、active balance、pending withdrawal、status。

不要无必要暴露数据库内部结构。

## Multi-strategy Boundary

当前 Demo 主要围绕 `core-flow-demo`。不要假装系统已经天然支持任意多个 Strategy。

明确建立：

```text
owner
→ strategyId
→ vaultId
```

验证：Alice 不读取 Bob Vault；Strategy A 不串到 Strategy B；重复 claim 不重置余额；重复请求不重复产生经济状态。

## Money Representation

继续使用精确金额：

```text
integer base units
+
decimal metadata
+
string serialization
```

不得用 JavaScript Float 处理资金。

## Data Safety

在任务范围内处理/复用：pagination、bounded audit history、input size limits、persistent receipts、restart recovery、backup compatibility、corruption fail-closed behavior。

不得破坏旧 Vault 数据。

## UI Fixtures

通过 PR 给 Macbeth02 发布脱敏示例：NORMAL、EMPTY、PENDING、ERROR、RUNNING、STOPPED。

至少包括 Strategy Summary、Strategy Detail、Account Summary、Vault、Pending Operation。

不得包含 Secret。

## API Errors

稳定返回类似：code、message、retryable。

不得向 Browser 暴露 raw SQL、stack、filesystem path、secret 或内部对象。

## Verification

至少覆盖：account isolation、strategy isolation、amount parsing、idempotency、stale revision、malformed input、duplicate request、restart、persistence、corrupted state failure。

只记录真实执行的测试。

## 与 Macbeth02 协作

通过自己的 PR 回复：

```text
[AGENT-MESSAGE]

Agent: Macbeth03
To: Macbeth02
Type: REPLY
Thread: AF-UI-BACKEND
Reply-To: <source>

Body:
...

[/AGENT-MESSAGE]
```

不要进入其他 Worker branch 修改。

## 禁止

- 重设计产品 UI
- Wallet custody
- Contract deployment
- Testnet broadcast
- Mainnet
- Real funds
- Self-merge

## 最终报告

包括：New APIs、Reused APIs、Data model changes、Migration implications、Fixtures、Verification、Compatibility、Known limits、Frontend dependencies。

## Retrospective

```markdown
## Retrospective
### 做了什么
### 为什么
### 实际验证
### 遇到的问题
### 尚未解决
### 对 Macbeth02 的影响
### 下一步
### 如果重做会怎样改进
```

完成状态：`READY FOR REVIEW`。

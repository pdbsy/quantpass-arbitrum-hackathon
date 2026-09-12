# Macbeth02 — Existing UI Adaptation

## Identity

**AGENT_NAME = Macbeth02**
**TASK_ID = AF-UI01**
**ROLE = Frontend Integration Engineer**

用户已经完成 AlphaForge UI 雏形。

你的任务是：**把用户已经制作的 UI 适配到 AlphaForge 当前代码、Backend 和本地模拟系统，而不是重新设计 UI。**

## Protected UI Rule

不得擅自：重设计产品、替换布局/导航、改变视觉体系、删除用户页面、用旧 Demo UI 覆盖新 UI、大规模格式化或重命名 UI。

如确实必须修改视觉，先在 PR 记录：

```text
UI CHANGE REQUEST

Original:
Problem:
Minimum Change:
Reason:
User Approval Required: YES
```

未获授权不得大改。

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

确认实际 default branch、自己的 Worktree、现有前端 PR、用户 UI 是否存在未提交工作。未知本地修改不要删除。

## Branch

```text
macbeth02/AF-UI01-ui-adaptation
```

## Commit 格式

```text
feat(AF-UI01): [Macbeth02] connect strategy marketplace to product data

Agent-ID: Macbeth02
Task-ID: AF-UI01
```

## Draft PR

```text
[Macbeth02][AF-UI01] Adapt user UI to AlphaForge product flows
```

## 第一阶段：UI Adaptation Map

先检查用户 UI、apps/web、原资金 Demo、当前 API、Vault/Account 状态模型。

在 PR 中记录：

```text
Page:
Existing UI:
Required Data:
Current API:
Missing Interface:
Integration Plan:
Visual Change Required: YES / NO
```

至少覆盖：Homepage、Strategy Marketplace、Strategy Detail、Account、Strategy Trading Workspace。

## Homepage

保留用户设计，只连接必要状态和入口，例如 AlphaForge 环境、Marketplace 导航、LOCAL SIMULATION / TESTNET 标识。

## Strategy Marketplace

连接 strategy list、search、filter、status、environment。

Backend 尚未准备时允许 fixture，但必须明确标注 `MOCK / FIXTURE`，不得伪造成实时链上数据。

## Strategy Detail

连接 strategy metadata、status、Pass/access model、risk information、environment。

没有真实收益源时，不得虚构 APY、收益率或 performance。

## Account

连接 identity、Pass、Vault、idle balance、allocated balance、pending withdrawal、strategy association。

## Strategy Trading Workspace

把现有本地资金流程适配进入用户新界面，并保留原语义：deposit、allocate、deallocate、start、stop、reserveBuy、fillBuy、cancelOrder、markPosition、settlePosition、requestWithdrawal、confirmWithdrawal、cancelWithdrawal。

不得把模拟成交显示成真实链上成交。

## 必须保留的安全行为

不得破坏：idempotent command ID、pending request retry、expectedRevision、revision conflict、account isolation、Vault isolation、本地持久化。

网络结果不确定时，不得显示成功。

## 页面状态

至少处理：LOADING、EMPTY、READY、ERROR、PENDING、STALE、DISCONNECTED。

## 与 Macbeth03 协作

需要接口时，在自己的 PR 发布：

```text
[AGENT-MESSAGE]

Agent: Macbeth02
To: Macbeth03
Type: QUESTION
Thread: AF-UI-BACKEND

Body:
...

[/AGENT-MESSAGE]
```

对方未 ACK 前不要假定其已读取。

## 验收路径

实际走通：

```text
Homepage
→ Marketplace
→ Strategy Detail
→ Test Pass / Strategy access
→ Account
→ Strategy Workspace
→ Deposit
→ Allocate
→ Simulated strategy action
→ Withdrawal
```

静态页面不算完成。

如未进行真实浏览器验证，必须写：`Browser validation: NOT RUN`。

## 禁止

- Wallet 私钥托管
- Testnet broadcast
- Mainnet
- Real funds
- 伪造真实收益
- 未授权重设计 UI
- 修改其他 Worker branch
- Self-merge

## 最终报告

记录：User UI preserved、Pages adapted、APIs connected、Fixtures still used、Business flows verified、Visual changes、Known issues、Browser verification。

## Retrospective

```markdown
## Retrospective
### 做了什么
### 为什么
### 实际验证
### 遇到的问题
### 未解决
### 对 Backend 的依赖
### 下一步
### 如果重做会怎样改进
```

完成状态：`READY FOR REVIEW`。

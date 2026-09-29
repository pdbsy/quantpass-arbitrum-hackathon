# AlphaForge Qinfra stage 2 — 量化策略接入

本阶段提供语言无关的 HTTP / JSON 目标仓位接口。Python、TypeScript 或其他语言只需读上下文、计算目标并发送 JSON；底座继续独占资金、成交、风险阈值和清仓。没有代码上传、策略沙箱或通用 Bot 插件平台。

范围是 Hackathon local/mock：RWA-A、RWA-B 为合成股票代币，金额及数量使用 6 位小数的整数十进制字符串，报价不是实际可交易的链上价格。没有引入真实账户凭证、签名、广播或主网访问。沿用已有演示 session Cookie 与 `x-quantpass-demo: 1` 标记；这不是生产认证方案。

## 创建运行

`POST /api/v1/automata` 的现有请求增加可选 `parameters.strategyMode`：

- `rebalance`（默认）：沿用第一阶段内置阈值再平衡。
- `external`：每帧仅更新行情、估值和风控；没有信号时保持现有现金/持仓。

`parameters.weights` 的键定义不可变的允许标的集合，包括权重为 0 的键。例如 `{"rwa-a":5000,"rwa-b":0}` 允许后续策略选择 A 和 B。外部模式不会自动执行这个初始权重；内置模式继续按它调仓。页面默认 A50% / B0%，支持两标的权重和价格触发资产选择。

## 读取策略上下文

`GET /api/v1/automata/RUN_ID/strategy-context`

示意响应（数值字段均来自同一已提交状态）：

```json
{
  "protocol": "alphaforge-targets-v1",
  "scope": "TEST_ONLY",
  "runId": "external",
  "revision": 1,
  "frameSeq": 1,
  "clock": 1000,
  "mode": "external",
  "status": "running",
  "ready": true,
  "cash": "500000000",
  "equity": "500000000",
  "positions": {},
  "eligibleAssets": ["rwa-a", "rwa-b"],
  "lastDecision": null,
  "replayComplete": false
}
```

实际响应还包含当前已观察 `quotes` 和启动时 `parameters`（含费用、滑点、偏离阈值与清仓条件）；不提供未来帧。`clock` 是回放虚拟毫秒，`frameSeq` 是当前帧序号，不是墙钟时间。`ready` 表示已观察过帧且运行允许外部决策，不保证每个标的报价可成交；策略应检查报价，执行器仍校验有效期、可交易性、滑点和剩余容量。`lastDecision` 包含最近接受信号的 id、frameSeq、at、targets、trades 数。

## 提交目标仓位

`POST /api/v1/automata/RUN_ID/decisions`

```json
{
  "protocol": "alphaforge-targets-v1",
  "runId": "external",
  "id": "decision_001",
  "expectedRevision": 1,
  "frameSeq": 1,
  "targets": { "rwa-a": 5000, "rwa-b": 5000 }
}
```

目标权重以 BPS 表示，10000=100%，必须是非负整数且总和≤10000，不支持杠杆或空头。省略的允许标的按 0 处理；空 targets 表示卖出所有允许标的，但不锁定停止状态。参数外的标的、未知字段、错误协议或路径/请求 runId 不一致会被拒绝。成功返回与运行查询相同的完整 RunView；`state.lastDecision` 是接受回执。接受不等于全部成交，应比较实际 positions、trades 和剩余现金。

每个信号只在绑定帧尝试执行一次：先卖后买，共用费用、滑点、偏离阈值及剩余报价容量。不会把部分成交目标留到下一帧自动补单。外部模式不使用内置 `intervalMs` 调度；策略自己决定提交频率。可在同帧读取新 revision 再发信号，仍只能消耗该报价剩余容量。

## 并发、重试与恢复

1. 每次读取上下文后计算目标，同时绑定 frameSeq 与 revision。资金进出、暂停、其他决策及行情推进都会改变 revision。
2. 决策 ID 在该 run 的命令命名空间中唯一，与资金和控制命令共享。同 ID 的同一序列化请求不重复成交，返回运行的当前状态（可能包含后来发生的变化），不是历史响应重放。改变请求字段或 JSON 键顺序后复用 ID 会产生幂等冲突。
3. 网络超时、响应丢失或 5xx 时，保存并重发**完全相同**请求。不要生成新 ID 猜测重试。确认接受后再读取新上下文。
4. `REVISION_CONFLICT` / `STRATEGY_FRAME` 是确定性 409 拒绝：读取新上下文重新计算，再创建新 ID。400 先修正参数；其他 409 应检查状态，不能无限盲重试。
5. 停止可使用较旧 revision；清仓锁定后任何信号都无法恢复买入。暂停时拒绝信号，但风控随行情继续运行。现金不足的撤回不卖出持仓。
6. SQLite 原子保存 Run、幂等回执、Vault 投影及审计事件；服务重启后读取最后提交检查点。失败事务不会留下部分成交或资金漂移。旧 v1 运行默认内置模式，原引擎标识与数据集摘要不变。

常见状态码：`STRATEGY_PROTOCOL` / `STRATEGY_TARGETS` 为 400；`REVISION_CONFLICT` / `STRATEGY_FRAME` / `STRATEGY_MODE` / `INVALID_STATUS` / `IDEMPOTENCY_CONFLICT` 为 409；跨账户或不存在的运行为 404。错误只返回固定公开代码/消息。

## 可运行参考客户端

先 `npm run demo`，在 `/automata.html` 建立测试 Vault、存入模拟资金，选择“外部量化策略”并启动。在运行卡片“策略接入与信号状态”展开完整运行 ID。

```bash
node tools/automata/strategy-client.mjs RUN_ID '{"rwa-a":5000,"rwa-b":5000}' alice
```

使用仓库锁定的 Node，通过本地演示登录读取上下文，每个观察帧最多发送一个固定目标示例；最多轮询 120 次、默认每秒一次，Ctrl-C 停止客户端。它不创建运行、不变更资金、不停止底座；关闭客户端不会自动清仓，需要在页面停止或依靠风控。它只允许回环 HTTP origin，禁止跳转；可用第四个参数指定另一个回环端口。连接的是本地合成模拟器。

此示例没有收益策略；替换目标计算即可接入自己的语言/进程。同帧已有 lastDecision 时跳过（示例假设单一控制器）。网络不确定时在进程内保留原请求，先重试它，收到确定结果前不生成新请求；轮询结束仍未确认则以错误退出并打印原请求供保存与人工核对。进程崩溃恢复、持久化 outbox、多控制器仲裁需正式适配器自行实现。服务端持久幂等记录不替代客户端保存发出的请求。

所有语言遵循同一个三步流程：本地演示登录取得 Cookie → GET 上下文 → POST 上述 envelope；禁止把 Cookie 写入策略信号或日志。生产认证和策略进程隔离属于后续工程任务。

## 当前容量与验收

固定回放仍为 120 帧。回放结束保留持仓，最后一帧可用于策略决策或手动停止；不意味着仍有真实行情。每 run 最多 1000 次普通命令、历史快照最多 2000 条；Vault 的 9999 次历史上限仍生效。达到边界保留明确错误，没有删除审计或假称支持无限持续运行。生产级行情接入、持续日志压缩/归档、交易适配器、策略持久 outbox 与服务部署仍需后续建设。

`npm run test:automata` 覆盖引擎、API、存储重启/回滚、账户隔离、资金并发、重复/过期信号、容量与风控优先级，以及参考客户端的不确定性重试。全项目检查和 CI 按现有 C → R → S 流程收集，技术自审不构成独立批准。

## Hackathon 收口扩展

当前 context 还提供最多 120 帧的已观察 `observations` 前缀，便于指标恢复；没有未来帧。通用参考客户端的固定目标模式仍默认保持原行为。专用 EMA 演示使用动态目标选择器和独立 SQLite outbox，详见 [一键部署与恢复](QINFRA-HACKATHON-CLOSEOUT.md)。

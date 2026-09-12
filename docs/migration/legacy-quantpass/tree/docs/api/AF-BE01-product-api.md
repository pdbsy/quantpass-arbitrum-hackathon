# AF-BE01 后端接口与前端交接

Agent: Macbeth03 · Task: AF-BE01 · Scope: TEST_ONLY

冻结契约：[`73230c43e464cd1b579fa16a6425756291ef9e8e`](https://github.com/pdbsy/quantpass/blob/73230c43e464cd1b579fa16a6425756291ef9e8e/docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md)。
协调决定：[PR #8](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646402517)。
本任务交付：[PR #7](https://github.com/pdbsy/quantpass/pull/7)。

## New APIs

新前端使用 `/api/v1`，避免把旧数组当成 `Page<T>`。资源包含冻结契约的全部必需字段；兼容别名及汇总属于额外字段。

| 方法与路径 | 返回 | 说明 |
| --- | --- | --- |
| GET `/api/v1/strategies` | `Page<StrategySummary>` | 版本化目录；按 strategyId 升序 |
| GET `/api/v1/strategies/:strategyId` | `StrategyDetail` | 含当前账户的 accountStrategy；尚未领取时 vaultId=null、status=not_started |
| GET `/api/v1/account` | `AccountSummary` + 汇总与 Vault 分页 | 全账户 strategies/passBalances；附加 vaults、pagination、idle、balances |
| GET `/api/v1/vaults` | `Page<Vault>` | 当前账户全部 Vault；可用 strategyId 精确筛选 |
| GET `/api/v1/vaults/:vaultId` | `Vault` | 每次按登录账户校验归属 |
| GET `/api/v1/vaults/:vaultId/audit` | `Page<AuditEvent>` | camelCase 字段；revision 降序 |
| POST `/api/v1/vaults` | `Vault` | `{strategyId}`；复用既有幂等测试 Pass 领取 |
| POST `/api/v1/vaults/:vaultId/commands` | `{vault, replayed}` | 与既有命令共用同一 schema、执行端口、事务和回执 |

所有资源读取需要既有演示会话。会话仍通过 `POST /api/demo/session` 选择 Alice/Bob；该机制是本机演示账户切换，不是真实认证。继续要求 loopback Host/Origin；写请求带 `x-quantpass-demo: 1`；请求体上限 16 KiB。

## Reused APIs 与旧 UI 兼容

原有 `/api/health`、`/api/demo/session`、`/api/session`、领取和命令路由保留。

| 路径 | 兼容行为 |
| --- | --- |
| `/api/strategies` | 仍为数组，原 id/name/description/scope/testPasses 保留；增加 schemaVersion、strategyId、catalogVersion、asset |
| `/api/vaults` | 仍为数组；默认仅 core-flow-demo，以保护旧 UI 的 states[0] 核心策略假设；显式 strategyId 可读第二策略 |
| `/api/vaults/:id` | 原字段保留，增加冻结契约字段和 pendingOperations |
| `/api/vaults/:id/audit` | 仍为原 snake_case 数组，默认最多 100 条 |
| `/api/strategies/:strategyId` | 目录详情兼容辅助路径；需要 accountStrategy 的前端使用 v1 |
| `/api/strategies/:strategyId/vault` | 只读当前账户在该策略下的 Vault；尚未领取返回 VAULT_NOT_FOUND |
| `/api/account` | 与 v1 相同账户投影，但 Vault 页继续使用旧式 after 游标参数 |

旧列表支持 limit/after（audit 使用 beforeRevision），通过 X-Next-Cursor 返回下一页位置。原有未传查询参数的调用仍工作。不要混用旧式游标与 v1 游标。未改动任何产品 UI 文件。

## Data model changes

没有新增经济状态机、资金模型或数据库表。唯一关系仍是 SQLite 的 `UNIQUE(owner_id, strategy_id)`，对应 `ownerId -> strategyId -> vaultId`。

- Strategy：服务端 `strategy-catalog.ts` 是唯一目录定义，catalogVersion 为 `1`。当前只登记 `core-flow-demo` 和 `satellite-flow-demo`。第二项只复用同一本地模拟器证明隔离，不代表接入新交易系统。任意其他策略不能领取。
- Vault：`vaultId` 是原 state.id 的边界别名；`passBalance.total` 来源于 state.passes；完整 balances 直接映射原金额字段和领域 `balances()`。
- Asset：`{assetId: "TEST_ONLY_USDT_UNIT", decimals: 6}`，并不代表已选择链上代币。
- PendingOperation：仅从 orders 和 pendingWithdrawals 映射 `{operationId, kind: "order" | "withdrawal", status: "pending", amount}`。已完成/取消操作离开 live 列表，历史通过审计读取。停止中的 Vault 使用 `stopping`，不伪造一个 STOP 操作或提前声称停止完成。
- Account：ownerId 来自会话；strategies 和 passBalances 列出每个登记策略的关联。未领取时 status=not_started、vaultId=null、Pass 为零。已有非目录 Vault 仍保留原关系，不被删除或重置。

### 金额语义

所有金额使用整数原子单位字符串；只有 decimals、revision、limit 和数量计数是数字。使用 BigInt 聚合，包含超过 Number.MAX_SAFE_INTEGER 的回归测试。单字段沿用领域 uint256 边界，PnL 可为带符号字符串。

- idle：未分配的现金。
- activeGross：activeCash + reserved + positionValue，即已分配池按当前估值的总额。
- activeNet：activeGross - feeLiability，即已分配池的净值。
- pending：已从 idle 转入待提现的金额；不再计入 idle 或 activeNet。
- equity：idle + activeNet + pending。
- allowance：passes × 10^6，是运行额度，不是资金；不要把 Pass 加入现金总额。

`activeGross` 与 `activeNet` 是同一资金池的不同口径，不能作为两笔资金相加。并无独立持久化的“allocated balance”字段，前端展示分配池应选定上述口径并保持标签一致。

账户顶层 idle/passes 和 balances 是**整个账户**的汇总，不随 vaults 翻页改变。它们在同一个 SQLite 只读事务中计算，逐条验证持久化状态，任一条损坏都不会返回部分汇总。账户聚合 status 是辅助字段：存在 stopping 时为 stopping，否则有 running 时为 running，否则 stopped；无 Vault 为 null。每个策略的权威状态在 strategies 中。

## Pagination

v1 列表参数为 `limit`（1..100，默认50）和 `cursor`。HTTP 查询自然以字符串传输，服务端严格验证后转换为数字。响应是 `{items, nextCursor}`；账户的附加 Vault 页在 `vaults` 和 `pagination.nextCursor` 中。

- 将 nextCursor 原样传回；null 表示没有下一页。不要解析、构造或混用游标。
- 游标绑定账户、资源及 strategyId 筛选；无效、篡改、跨账户/资源/筛选和进程重启前的游标返回 400 INVALID_REQUEST。
- 服务重启会使游标失效，但不会影响账本。重新登录并从第一页读取即可。
- Vault 按 vaultId 升序；策略按 strategyId 升序；审计按唯一 revision 降序，同一 Vault 的 revision 唯一，因此无需时间字段作为额外平局判定。
- 数据不变时，同一游标产生同一逻辑页。不同请求之间不是历史快照，写入后应重新读取。
- 分页限制返回记录数，不截断持久化回执。领域现有每 Vault 10,000 条命令历史限制保持。

## API Errors 与重试

**v1 错误体严格为 `{error: code}`**，使用冻结契约的封闭代码列表。没有 message/retryable/code 的附加键。旧 `/api` 错误保留 error，并提供安全的固定 code/message/retryable 元数据；这不是 v1 契约，也不构成新的经济状态。

| 状态/错误 | 前端操作 |
| --- | --- |
| 400 INVALID_REQUEST | 修正参数；金额浮点、非法精度/编码、uint256 溢出、无效游标均在变更前拒绝 |
| 401 SESSION_REQUIRED | 重建本地会话，重新读取 |
| 403 边界或 FORBIDDEN | 停止重复请求 |
| 404 VAULT_NOT_FOUND | 刷新账户/策略关系 |
| 409 UNKNOWN_STRATEGY | 使用当前目录中的 strategyId |
| 409 REVISION_CONFLICT | 读取新 revision，重新评估意图，必要时创建新命令 ID |
| 409 IDEMPOTENCY_CONFLICT | 同 ID 的请求已变更；停止，不盲目重试 |
| 429 RATE_LIMITED | 遵循 Retry-After（当前为60秒） |
| 500 LOCAL_OPERATION_FAILED / 网络超时 | 结果不确定；先读 Vault 与审计，再决定是否原样重发同 ID、同 payload |

错误不会包含 SQL、路径、堆栈或内部异常对象。持久化状态校验失败统一转为内部错误，即使状态 digest 一致，也不会向客户端发送内部不变量代码。`retryable`（旧接口）不是立即自动重试的指令，500 必须先回读。

## Migration implications 与 Compatibility

SQLite user_version 保持1；不新增/更改 migration。不写旧 Vault 的新默认值，不重建余额，不丢弃 receipts 或 audit。原 store 的 BEGIN IMMEDIATE、乐观 revision、回执指纹、WAL、FULL synchronous、备份排他写入全部复用。重复领取返回原 Vault；重复命令不会重复经济效果。

已有 v1 SQLite 文件可直接读取；备份可独立打开，保留 Vault ID、余额、revision 和重放识别。没有依赖、lockfile 或 CI 变更。唯一共享文件修改是协调批准向 package.json 的 test 命令追加 `test/product-api.test.ts`。

## Fixtures

[`fixtures/AF-BE01.json`](fixtures/AF-BE01.json) 由真实 v1 API journey 生成，schemaVersion=1、scope=TEST_ONLY。每组提供 Strategy Summary、Strategy Detail、Account Summary、Vault、Pending Operation 和 error 槽位，无数据时明确为 null。随机 Vault ID 归一化，不包含 cookie、认证头或秘密。

| 场景 | 含义 |
| --- | --- |
| NORMAL | 已领取并注入模拟 idle 余额 |
| EMPTY | 未领取、not_started、零 Pass/余额、无 Vault |
| PENDING | 有待提现与待成交订单，Vault 为 stopping，不能显示停止完成 |
| ERROR | 真实非法参数响应；accountSummary/vault 为 null，不伪造零余额成功 |
| RUNNING | 已分配并启动模拟 |
| STOPPED | 启动后停止，状态为 stopped；已分配现金不会因停止自动退回 idle |

测试会重新调用 API 并比较归一化示例，防止文档数据与实现漂移。测试辅助生成函数为 `test/helpers/product-fixtures.ts` 的 `generateProductFixtures()`，不属于生产接口。

## Verification

最终执行结果与精确 SHA 以 PR #7 为准。可复现命令（Node 24.12.0 / npm 11.6.2）：

```sh
node --test test/product-api.test.ts test/server.test.ts
npm run check
npm run verify:gates
```

覆盖账户/策略隔离、金额精确性、重复领取/命令、stale revision、非法输入与体积限制、分页与游标、错误封闭形状、数据库损坏、重启/备份、示例一致性与旧 UI 的核心策略默认绑定。

## Known limits 与 Frontend dependencies

- 仅本机 TEST_ONLY；不含真实账户认证、任意策略插件、行情、自动交易、资金托管、链上网络或部署。
- 账户总览为全部有效存量账本逐条计算，成本随账本大小增长；当前目录为两个本地策略、每个账户/策略至多一个 Vault。
- 现有历史记录由领域上限约束，未做破坏历史兼容的归档迁移。
- 游标与演示会话均在进程重启后失效；持久化经济数据不失效。
- Macbeth02 应从一个适配层消费 v1 字段/分页/错误，复用返回的 strategyId/vaultId，不以数组第一项推断策略归属；不要重新计算经济状态或硬编码另一份目录。
- 后端已提供可审查接口与 fixtures；新 UI 的浏览器适配验收和 AF-QA01 跨 PR 联调由对应任务执行，本 PR 不代替其完成声明。

## Retrospective

### 做了什么

复用现有账本添加目录、详情、账户关联、规范资源、分页、固定错误与真实接口示例。

### 为什么

把新 UI 的数据需求集中在后端的一个边界层，同时保留原演示路径。

### 实际验证

通过真实 Fastify 注入和 SQLite 验证，最终检查结果记录在 PR，不将未执行的浏览器/联调检查写成通过。

### 遇到的问题

任务进行中冻结契约到达；初始投影需要调整为规范字段与不透明游标。独立复审发现旧 UI 依赖 states[0] 的核心策略假设，已通过后端兼容默认及回归测试处理。

### 尚未解决

新 UI 浏览器适配与跨 PR 集成仍依赖 Macbeth02、Macbeth05；本任务不执行合并。

### 对 Macbeth02 的影响

使用 `/api/v1` 和冻结字段；通过 fixtures 展示不同状态；500 先回读，停止中不显示完成。

### 下一步

提交精确候选 SHA 给协调方和 QA，保持 READY FOR REVIEW。

### 如果重做会怎样改进

先冻结字段和旧消费者兼容规则，再展开契约测试，可减少投影层返工。

## QA 独立运行说明

在 QA 自己的 checkout 固定本 PR 提交，使用 Node 24.12.0 / npm 11.6.2，执行 `npm ci --ignore-scripts`。以下运行路径均属于当前 checkout 的 `.checks`，不读取作者工作区的数据。账户仅为 Alice/Bob；策略仅为上述两个本地登记项。

### 启动与停止

需要自定义端口/数据路径时，可直接使用现有 buildApp，不必修改产品配置：

```sh
AF_BE01_DB=.checks/af-be01-manual/ledger.sqlite node --input-type=module <<'JS'
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildApp } from './apps/server/src/app.ts';
const dbPath = resolve(process.env.AF_BE01_DB);
await mkdir(dirname(dbPath), { recursive: true });
const { app } = await buildApp({
  dbPath, env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
  origin: 'http://127.0.0.1:4193',
});
await app.listen({ host: '127.0.0.1', port: 4193 });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close());
console.log('TEST_ONLY API: http://127.0.0.1:4193');
JS
```

另一个终端可执行以下本地请求；cookie 文件只留在 QA 的忽略目录，不上传：

```sh
curl --fail-with-body -c .checks/af-be01-manual/alice.cookie \
  -H 'x-quantpass-demo: 1' -H 'Content-Type: application/json' \
  -d '{"user":"alice"}' http://127.0.0.1:4193/api/demo/session
curl --fail-with-body -b .checks/af-be01-manual/alice.cookie \
  http://127.0.0.1:4193/api/v1/account
curl --fail-with-body -b .checks/af-be01-manual/alice.cookie \
  -H 'x-quantpass-demo: 1' -H 'Content-Type: application/json' \
  -d '{"strategyId":"core-flow-demo"}' http://127.0.0.1:4193/api/v1/vaults
```

以 `user=bob` 和独立 cookie 文件建立另一会话。以 `strategyId=satellite-flow-demo` 创建第二个策略关系。发送命令时使用领取响应中的 vaultId、revision；命令的 `id` 是调用者生成的唯一请求标识，资金 amount 是整数单位字符串。

Ctrl-C/SIGTERM 停止服务器。重复启动命令读取同一个 ledger.sqlite；重新登录后 Vault/余额/回执保留，旧会话及旧游标不可用。异常重启的自动化证据由 `test/http-e2e.test.ts` 提供，其子进程、SQLite 路径及模拟请求独立创建。

### 备份和恢复校验

在自己的数据目录运行以下备份，目标必须是尚不存在的文件：

```sh
node --input-type=module <<'JS'
import { access } from 'node:fs/promises';
import { LocalStore } from './apps/server/src/store.ts';
const source = '.checks/af-be01-manual/ledger.sqlite';
const target = '.checks/af-be01-manual/backup.sqlite';
await access(source);
const store = new LocalStore(source);
try { await store.backupTo(target); } finally { store.close(); }
const restored = new LocalStore(target);
try {
  if (restored.db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('backup invalid');
  for (const ownerId of ['alice', 'bob']) restored.list(ownerId);
  console.log('TEST_ONLY backup reopened and validated');
} finally { restored.close(); }
JS
```

停止服务器后，将启动命令中的 AF_BE01_DB 改为该 backup.sqlite 路径，在独立备份上验证恢复；不覆盖原数据库，不手工复制正在写入的 WAL 文件。损坏状态、重复/冲突请求及失败回滚使用既有测试与 `test/product-api.test.ts` 的隔离 SQLite fixture 验证，预期为失败关闭或相应契约错误，没有部分余额成功响应。

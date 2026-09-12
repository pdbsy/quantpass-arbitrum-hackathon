# LocalAdapter / TestnetAdapter Boundary — REVIEW DRAFT

Agent: Macbeth04 · AF-CHAIN01。采用已 FROZEN 的 [Interface Contract v1](https://github.com/pdbsy/quantpass/blob/73230c43e464cd1b579fa16a6425756291ef9e8e/docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md)，exact SHA `73230c43e464cd1b579fa16a6425756291ef9e8e`。本文件记录冻结语义和未来链扩展提案，不新增共享 TypeScript 类型或运行实现。

Testnet Writes = CLOSED。本轮不构造/签名/广播交易，也不连接链 RPC。Robinhood Chain Testnet / 46630 仅来源于任务与现有配置记录，未重新验证当前 RPC、EVM hardfork、资产/venue 或实际链兼容性。

## 1. 共同语义，不制造相同执行能力

ownerId → strategyId → vaultId 为共同归属路径。ownerId 来自已认证会话；未来 wallet 身份需独立批准映射；服务端据此检查 Vault 归属，客户端 owner/role 字段不可授权。相同 strategy 下不同 ownerId 的 Vault 不能混用；每对 (ownerId, strategyId) 最多一个当前 Vault。没有 Vault 则 accountStrategy.status = not_started 且 vaultId = null，不给 Vault.status 增加 not_started。

金额保持规范十进制整数字符串，词法通过后仍沿用现有 money.ts 的 uint256 上界检查（78 位长度本身不保证范围合法）；现有 idle/activeCash/orders/positionCost/positionValue/pendingWithdrawals/feeLiability 含义沿用 M02。展示小数必须引用批准资产精度，不能让 UI 把展示金额直接转 float 计算。TEST_ONLY_USDT_UNIT 的 6 decimals 没有链资产含义。地址映射和 decimals 缺失时返回未配置，不能回退为任意 token 或零地址。

现有 `stopped/running/stopping` 是唯一 Vault 状态词汇。异步 receipt 是另一个维度；以下候选 transport 状态不加入 Vault.status。LocalAdapter 的同步领域转换不能冒充链 finality，TestnetAdapter 的网络延迟不能改变资金会计。

## 2. 候选边界（文档 API，不是可调用实现）

| 操作 | 输入/结果 | 约束 |
| --- | --- | --- |
| readVault | ownerId/strategyId/vaultId；现有 Vault 投影 + 数据来源和已验证版本引用 | 不返回秘密；字段按冻结的 Vault/VaultBalances/PassBalance/PendingOperation 投影 |
| submitCommand | Command.id、expectedRevision、允许的 Command.type 及其明确参数 | 当前只由 LocalAdapter 消费；未来写入始终先检查 CLOSED gate |
| readReceipt | Vault scope + 原 Command.id，查持久化 receipt | 同一请求重试定位原动作，不能按新 id 复制付款 |
| readEvents | Vault scope + 稳定游标和有界 limit | 冻结 Page = {items,nextCursor}；limit 整数 1..100 默认 50；opaque cursor；无效/过期返回 INVALID_REQUEST；audit 按 revision、recordedAt 倒序 |
| capabilities | 实际 adapter/mode 与 supported operations | TestnetWrites = CLOSED；能力不能靠环境变量或浏览器传 true 解锁 |

允许命令沿用当前 Command union；deposit/allocate/deallocate/requestWithdrawal 只带 amount，confirmWithdrawal/cancelWithdrawal 带 withdrawalId，订单动作带 orderId，start/stop 不带任意 payload。未知字段/类型拒绝。chain receiver、asset、合约地址等不是 UI 可任意覆盖的字段；未来服务端固定 operation builder 根据已批准 registry/config 决定，用户查看具体意图后才进入另行授权的签名流程。

禁止通用 `sendTransaction(target, calldata, value)`、任意 approve、delegatecall、任意 asset 列表和任意 nonce overrides。没有把本地 mock 配置切成 testnet 的开关；现有 `readConfig` 仍仅接受 local/mock。

## 3. 权限和 receipt 映射

| 现有 LocalAdapter / Domain | 未来 TestnetAdapter 的必要差异 |
| --- | --- |
| ownerId + actor.role 由服务端认证提供 | 必须验证 wallet owner 与 chain/Vault 映射，relayer 仅传输 |
| revision 为安全整数；expectedRevision 做乐观并发 | 链 stateVersion 是候选 uint256，不能直接 JSON Number 化；冻结前保持独立，不改本地 DTO |
| command.id 在每 Vault 内唯一；canonical actor+command+policyId 做 fingerprint | 持久化 command.id 到 intentHash/chainId/vaultAddress/nonce/epoch 的唯一绑定；同 id 不同意图拒绝 |
| 重试原 command 返回当前 state，不再增加 revision/events | 冻结 API 要求 recorded result + replayed:true；后端负责保留原结果，可另外读当前状态；不能把当前 revision 当原 receipt revision |
| requestWithdrawal 的 command.id 就是 pendingWithdrawals key | withdrawalId 引用原 request command；不是 finalize 的新 command.id，也不是 txHash |
| executor confirmWithdrawal 直接表示模拟支付 | 不能仅凭 relayer/API ack 记已支付；必须从固定资产真实转移与对应 Vault 事件确认 |
| stop 设置 stopping 或 stopped | 不能将 stop 请求、取消订单请求或广播回执解释为已清仓/到账 |
| SQLite 事务存 state+audit_event 并用 revision CAS | 广播与数据库不是同一原子事务，需 outbox/reconciliation；崩溃重启先查询原动作 |

## 4. 重试、重组与最终性

候选 transport receipt fields（等待冻结）：commandId、vaultId、adapter、intentHash、stateVersionBefore/After、operation reference、错误 code；只有真实链 receipt 才可有 chainId/vaultAddress/txHash/blockNumber/blockHash/logIndex。Local receipt 不伪造 txHash/block/finality。Identifier 采用冻结正则 /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/；新增 chain hash/地址编码仍需单独冻结。

候选链 transport 状态：`prepared → submitted → included → finalized`；失败可为 `rejected/reverted`，观察到块消失为 `reorged`，无法判定为 `unknown`。这是未来链索引语义提案，不是新业务状态或本轮实现。RPC 超时不得直接判定失败并再次广播；submitted/included 不代表 withdrawalsPaid；最终性阈值未批准就不能自行选 N 个块并标成功。

1. 校验归属、允许参数、CLOSED gate、映射、当前版本及相同 id 的原 receipt。
2. 未来获批版本才生成固定意图；持久化请求与意图绑定后才进入签名/提交。此次不进入这一步。
3. 重试相同 id/相同 fingerprint 查询原 receipt；不同 fingerprint 返回 IDEMPOTENCY_CONFLICT。版本冲突不自动改金额、revision 或 nonce，不替用户补签。
4. 若网络结果未知，保留原 nonce/request 引用，查询链和索引结果；确认未执行且仍满足授权才考虑受控重试，不能复制提款。
5. 以 chainId+contract+txHash+logIndex+blockHash 去重原始日志；基于规范链投影处理重组。非规范分支事件撤回；finality 被违反时停止新写、对账并升级处理，不能静默改已展示到账。
6. pending request/finalize/cancel 的竞态必须由合约原子状态决定；链最终状态为准，不允许后端两次释放同一预留。

## 5. 错误契约和能力关闭

保留领域错误 `FORBIDDEN, IDEMPOTENCY_CONFLICT, REVISION_CONFLICT, INSUFFICIENT_IDLE, INSUFFICIENT_ACTIVE_CASH, ALLOWANCE_EXCEEDED, WITHDRAWAL_NOT_PENDING, NOT_RUNNING`；API 只返回冻结结构 `{ error: APIErrorCode }`，不加 message/details/code 第二套字段。内部异常、持久化、配置和不变量错误一律 LOCAL_OPERATION_FAILED。HTTP 400/401/403/404/409/429/500 与冻结错误矩阵一致。

未来 adapter 边界错误候选：`TESTNET_WRITES_CLOSED, CHAIN_CONFIGURATION_MISSING, CHAIN_MISMATCH, INTENT_EXPIRED, NONCE_USED, AUTHORIZATION_REVOKED, FINALITY_UNKNOWN, REORG_DETECTED`。这些是建议名称，不能在全局 types/后端实现中提前定稿。错误响应不泄露密钥、原始 RPC 凭据或内部堆栈。

CLOSED gate 必须在生成授权请求、访问 signer、估算/准备交易和写 RPC 前执行；拒绝前后均无签名或网络副作用。当前仓库没有 TestnetAdapter 实现，未运行其副作用测试，不声称有已实现的第二套写防护。未来的只读链探测也需单独范围授权；本轮没有调用链。

## 6. 对齐样例和待验证项

本地手算样例：deposit 1,500,000,000 TEST_ONLY 单位；已有 1,000 Pass 时 allocate 1,000,000,000，idle 留 500,000,000。requestWithdrawal 100,000,000 后 idle 400,000,000、pending 100,000,000；重复相同 request id 不再扣账；confirmWithdrawal 引用该 request id 后 pending 清除、withdrawalsPaid 增 100,000,000。本例不决定真实 token、Pass 标准、费率或生产精度。

后续合约与 LocalAdapter 应共享已冻结的确定性账本向量，并分别验证各自权限与 finality；不能对网络特有行为使用本地同步结果冒充。

冻结对齐：金额正则 /^(0|[1-9][0-9]{0,77})$/；PnL 用 SignedMoneyString；PassString 为整枚单位；Revision 为非负 safe integer。pendingOperations 仅保留 pending，终态 completed/cancelled/failed 留在 audit，不能把链 finality 状态塞入该枚举。

等待：Macbeth03 确认实现 receipt 与原请求的关联；Macbeth01 确认本任务工具锁文件归属，后续链字段如需新增另行提出变更；Macbeth05 独立检查本轮边界。产品资产、费用、容量、退出和链最终性仍 PRODUCT DECISION REQUIRED，详见 Vault 规格。

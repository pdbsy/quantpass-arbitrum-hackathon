# Fair Launch 测试证据与范围

日期 2026-10-09。仅运行新市场、相关身份 / 资金 / Vault / 恢复边界和本轮要求的持续负载，不重复全站历史故障矩阵。最终来源检查点 `1f482a4f3083b8f4a9be0468d56d94267ba272b1`；下表的已完成结果均为实际运行证据，文档和额外浏览器证据提交不改变此检查点的资金合约。

## 已完成检查

| 检查                     | 结果                      | 实际范围                                                                                                                                                                 |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundry market 合约      | PASS，30 tests            | 认购 / 恒积池 / LP / 原生兑换 / claim、最后 mint 原子建池、失败全回滚、重复触发、末笔竞争、nonce / account / payer / domain / expiry / 预算；256 轮相关 fuzz             |
| Foundry TEST 股票 Vault  | PASS，7 tests             | owner / executor / 目标 whitelist、锁仓 / 容量 / 利润先提 / 本金解锁 / 亏损 / dust / 关闭、订单预算、60 秒源 / calendar、关闭时段 / 暂停原子回滚                         |
| ABI / bytecode 检查      | PASS，11 产物             | 真实 solc0.8.31 Paris 编译 ABI / source identity / 大小；所有 runtime <24,576 bytes、creation <49,152，实际 fixture 部署包含构造参数                                     |
| unsigned 部署准备        | PASS，2 tests             | 连续 CREATE 顺序 / nonce、独立 LP / claim / reserve 资金、显式 LP 接收者、schema2资金 metadata 与真实参数一致、不足资金 / 不安全 ETH 限额拒绝                            |
| 最终 scoped 自动化       | PASS，73/73               | `evidence/unit-final.log`；包含实际 loopback SSE、领取 registry 映射、钱包关联、正确 token allowance、ETH SELL整数 minOut、身份 / 模拟 / owner / executor / 重组及新存储 |
| 存储 backup / restore    | PASS，5/5（包含于73）     | 原 accountKey / voucher / canonical事件 / WAL 保留，完整 canonical DDL pin、错误CHECK / UNIQUE谓词和违反CHECK的数据拒绝，source bytes 不变                               |
| 双账户 local EVM         | PASS，1 完整 scenario     | 真实 claim / ETH 和 USDC mint / ETH buy / USDC sell / create / deposit / TEST 股票持仓 / profit / principal / close / ETH sell / 最后一笔 mint / Live Trading            |
| guard 修改后的 local EVM | PASS，1 scenario          | 1b8edba 的领取映射 guard 与实际 indexer / claim / 重组 / restart；最后 mint gas3178873，固定供应和 all-holder Transfer 守恒                                              |
| 最终集成 local EVM       | PASS，1 scenario          | `evidence/local-evm-final.log`；覆盖最终READY token quote并补全Alice AF-USDC认购、Bob ETH买入，最终gas3178873与资金 / 重启 / 重组守恒相同                                |
| 最终集成真实浏览器       | PASS，1 scenario，38.38秒 | `evidence/browser-evm-final.log`；实际HTTP / EVM / EIP-1193钱包桥接、4笔资金 / approval tx、2个绑定签名、真实SSE和鼠标pointer；离线身份 / 行情明确标注                   |
| typecheck                | PASS                      | server / shared / tools 与 web 两个 tsconfig，使用真实 pinned Node / TS                                                                                                  |
| 前端构建                 | PASS                      | 226 modules；原 user-ui 静态 script / CSS 保持 copy 路径，有两条原 bundler 提示，不影响 build 成功                                                                       |
| scoped lint / format     | PASS                      | 本轮新增及最终实际改动文件；原历史格式 / 不相关模块未重写                                                                                                                |
| secret checker           | PASS                      | 原检查器完整运行；env 示例改名为现有规则允许的 `.env.example`，未弱化 checker；最终新证据纳入后再确认                                                                    |
| Macbeth05 独立复查       | PASS，限定范围            | immutable source；两项实际 SSE / API 缺陷针对性执行2/2；领取重建漏洞复现并确认 count+private原映射 guard 拒绝；没有正式 scanner / Slither / hosted approval 声明         |

双账户场景使用随机内存钱包和真实 Anvil 46630 合约，所有资产动作有实际 tx / receipt，邮箱 / session 和参考行情明确为离线测试夹具。测试并未连接线上 Google 发邮件或伪造线上验证。场景核验真实指定 EOA 原生收款、LP Bob（隔离场景指定）、不回调 browser hash 的 Charlie claim 仍从链日志确认及 fork 删除、restart 不改变 accountKey / voucher / 池 / 锁仓。全部账户和合约的两种 PASS / USDC Transfer 最终守恒。

第一次 scoped 单测 65 项中 64 通过，真实 SSE listener 项被沙箱 `listen EPERM` 阻止；只对该失败项取得本地回环运行权限后补验，1/1 PASS，退出约249ms。Wallet-link 回归初稿引用错 fixture 字段导致测试本身失败，修正字段后只补验该项 PASS；不把初次失败标为通过。

## 持续负载与失败记录

重现命令（隔离随机端口，不连接 Testnet）：

```bash
AF_LOAD_DURATION_SECONDS=1800 AF_LOAD_ACTIVE_SECONDS=300 AF_LOAD_REPORT=/absolute/private/new-load-report.json npm run test:fair-launch:load
```

20 个独立随机钱包实际完成 claim，使用实际 EVM 做 AMZN 买卖；100 个真实 HTTP SSE 客户端保持30分钟；前5分钟20并发 actor，持续每秒10个 snapshot / wallet / quote 请求。报价用明确离线 ETH=2000 TEST 参考，不是外部行情性能证据。完整 histogram 保存所有观测，包含失败请求、p95 / p99 / max；SSE 统计真实 broker 发布至客户端接收，重连直到取得权威 snapshot。初始 claim version gaps 单独报告，不把正常跳过的中间版本当作旧状态反向更新。

| 记录                                                 | 结果与原因                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `evidence/load-before-pinned-simulation-failed.json` | FAIL / interrupted；345秒，8 个 quote read503 MARKET_OPERATION_UNAVAILABLE。授权在 RPC 授权读取后被真实并发交易消耗，模拟又读取 later block。保留全部失败与延迟；修正将 allowance / call / estimate 固定在同一 canonical block |
| `evidence/load-interrupted-smoke-not-pass.json`      | NOT_PASS / interrupted；错误使用旧环境变量后主动停止，未满足完整持续时间，不能作为60秒或30分钟验收通过                                                                                                                         |
| `evidence/load-delivery-smoke-60s.json`              | PASS，针对性60秒，20账户 / 254交易 / 600 reads / 100 SSE / 0失败；quote p95约848ms且max1579.55ms保留，SSEp95168ms / max264.4ms，reconnect142ms                                                                                 |
| `evidence/load-final-1800s.json`                     | PASS，1800.42秒完整持续 / 300秒20并发，20 claim / 1,220 trade / 1,220 exact approval / 18,001 reads，10RPS；100 SSE最低连接数100，失败0、旧更新0、version gaps0、reconnect106.24ms；全样本和尾部保留                           |

最终负载 p95 / p99 / max 分别为：quote392 / 495 / 757.30ms，snapshot103 / 186 / 408.51ms，wallet130 / 208 / 424.40ms，SSE broker发布至接收60 / 73 / 671.89ms。应用APIp95<1000ms、SSEp95<5000ms、reconnect<10000ms均通过。RSS峰值332MiB、heap峰值112MiB，结束前RSS约278MiB。该结果是本地真实Anvil资金与HTTP性能，不保证真实Testnet公共RPC或外部行情SLA。

完整持续 run 在 aca74a1 source 开始，后续1b8edba新增的 claim registry guard 和 wallet linkage独立实际 EVM / 单测补验；它们不改变被测 AMM / 报价模拟 / SSE资金与性能路径。浏览器 ETH SELL 修正只在客户端校验 quote 精度，单独通过真实 HTTP / wallet / EVM验证，不把 load 成绩称为全链全浏览器全功能认证。

## 浏览器及未运行项目

Desktop / mobile 现有模块浏览器 fixture 检查通过，但 fixture API 不属于真实链端到端。新增 `test:fair-launch:browser-evm` 使用真实 Fastify、真实 Anvil、真实钱包签名 / transaction；Macbeth04实际检查PASS，36.4秒。两次真实personal_sign绑定、ETH Mint / AMZN ETH买入 / 独立精确PASS approve / ETH卖出共4笔真实交易，1→2→3包含成交块的确认，Bob polling snapshot被暂停时仍从真实SSE接收储备，实际history / OHLCV及零pageerror。首次切SELL使用DOM click事件做功能检查；结束后的已加载BUY/SELL标签单独通过真实鼠标pointer检查，不把两种检查混淆。

复现需先 `npm run build:web`，具备官方 hash 锁的 Anvil / 编译产物，以及已准入的 Playwright core1.62.1与ChromeForTesting151.0.7922.34（cache目录chromium-1234）；本环境的独立路径为 `/opt/alphaforge/mock-source/.checks/release-browser-tools/package/index.mjs`、`/opt/alphaforge/mock-browser-cache/chromium-1234/chrome-linux64/chrome`，可用 `AF_UI_BROWSER_PACKAGE` / `CHROMIUM_PATH` 指向等价已审核 runtime，然后执行 `npm run test:fair-launch:browser-evm`。新 CI 不默认下载未经限定的浏览器；缺少工具明确失败，不silent SKIP。

| 项目                                                                         | 状态                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式 Codex Security scanner                                                  | NOT_RUN，当前环境没有对应 scanner 执行能力；已有独立人工复查不冒充 scanner                                                                     |
| Slither                                                                      | 已实际执行固定0.11.3：53项报告，9旧批准、44新报告未批准；扫描完成，原admission门禁BLOCKED，不标为PASS。逐项记录见 `reviews/STATIC-SCANNERS.md` |
| 真实 Google ingress / OAuth / 线上邮箱双账户                                 | NOT_RUN，当前 production bridge 已做 session / revoke / CSRF 必要离线边界验证                                                                  |
| 真实 Alpaca clock / calendar / IEX credential调用                            | NOT_RUN，没有配置数据授权；parser / DST / early-close / holiday / freshness 的固定响应测试已通过                                               |
| 外部 ETH feeds 实际实时可用性 / SLA                                          | NOT_RUN，已验证两源 HTTPS格式 / age / disagreement / payload / outage拒绝规则；不宣称公网请求能满足本地p95                                     |
| Testnet 部署 / 注资 / 最后一笔 Mint / gas / confirmations / reorg / 源码验证 | NOT_RUN，未获得操作授权                                                                                                                        |
| 新服务真实迁移 / ingress切换 / signer启动 / keeper或executor持续签名         | NOT_RUN，交付准备工具与配置，不自动启用                                                                                                        |
| Hosted GitHub required checks | 已实际运行；首次 source `72ca153` FAIL，后续按对应失败项修复。完整状态见 `reviews/CI-FOLLOWUP.md` 和 draft PR #47；不使用本地结果覆盖 hosted 门禁。 |

目标链 chain46630和 ArbGasInfo execution caps 的只读观察保存在 `evidence/target-gas-readonly.json`；`writesPerformed=false`。它支持目标策略检查，不是部署 receipt。

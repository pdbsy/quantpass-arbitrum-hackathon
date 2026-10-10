# Fair Launch V3 部署交接

本交付提供代码、隔离测试及无签名准备工具。用户已授权 Robinhood Testnet 部署和交易测试，并明确新建真实钱包只作为普通产品用户，不担任部署者、管理员或 LP 接收者；此前给它部署职责的草案已作废。2026-10-10 的成功链上读取核验该钱包已收到 0.01 原生测试 ETH。用户已接受精确 44 条新增 Slither 报告的本轮 Testnet 残余风险，历史审批证据保留，准入仍绑定精确源码、报告和环境。当前 reader 仍为 `NOT_DEPLOYED`，部署、真实领取及交易均未执行。部署管理员与签名方式、具体资金参数、真实已验证测试账户尚需补齐；这些前提不能用本地测试或只读预检替代。[真实测试进展与边界](reviews/REAL-TESTNET.md)。所有金额使用整数最小单位：AF-USDC 6 位，PASS / 测试股票 / 原生 ETH 18 位。链固定为 46630。

## 构建与必要检查

在审核过的独立 checkout 中运行，使用 `.node-version` 的 Node 24.21.0、npm 11.19.1。依赖保持原 lockfile，ethers 6.17.0、Fastify 5.12.5、Vite 8.2.2、TypeScript 6.0.3。合约沿用仓库固定的 Forge 1.5.1、solc 0.8.31、OpenZeppelin 子集与 Paris EVM；不修改原工具链准入和保护规则。

```bash
npm ci --ignore-scripts
python3.12 contracts/script/bootstrap.py
python3.12 -c "import runpy; runpy.run_path('contracts/script/pinned_dependency.py')['prepare']()"
cd contracts
../.checks/af-chain01/toolchain/bin/forge test --offline --match-path 'test/{market,launch-vault}/*.t.sol'
cd ..
npm run fair-launch:artifacts
npm run test:fair-launch:artifacts
npm run typecheck
npm run test:fair-launch
npm run build:web
node tools/launch-market/bootstrap-anvil.mjs
npm run test:fair-launch:evm
```

最后两项仅启用隔离回环 Anvil，测试中使用内存随机钱包、测试余额和明确标注的离线身份 / 行情夹具，不访问真实钱包或外部交易链。新 workflow 为 `.github/workflows/fair-launch.yml`，原 CI 不变。不要为了普通修改重复全站历史测试。

## 无签名部署准备

2026-10-10 的继续上线请求、登录 Unix 连接、加密 voucher 加载、部署 journal 的具体能力与尚未实现的真实签名 / 状态核验接入，见 [实际上线继续工作](GO-LIVE.md)。该记录不把组件隔离测试或系统模板视为目标链已上线。

填写 `deploy/launch-market/deployment-inputs.example.json` 的显式地址与资金参数，保存到私有新文件。示例中的 `null` 必须替换，不能默认 LP 归部署者或收款 EOA。准备工具只读取编译产物并输出 calldata，没有 RPC、交易签名或广播功能。

```bash
npm run fair-launch:prepare -- /absolute/private/approved-inputs.json /absolute/private/new-unsigned-plan.json
```

重复生成使用新的输出文件；已有输出拒绝覆盖。同样的输入产生同样的计划，运行准备脚本不铸币、不建池、不更改链上状态。计划中部署者 nonce 必须为实际已审核的待用 nonce。先连续完成所有部署，再执行配置 / 注资；中间插入其他部署者交易会使后续 CREATE 地址预测失效，应重新审核，不能沿用旧计划。

真实公网只读检查可使用 `npm run fair-launch:target-preflight -- --wallet PUBLIC_ADDRESS`；它不需要或生成批准的部署计划。已有无签名计划可通过 `npm run fair-launch:target-preflight -- UNSIGNED_PLAN.json BUDGET.json` 核验源与编译产物、链、区块、nonce、预测地址及有限资金预算。预算中的 gas 上界是策略限制，不是全部实际部署的目标网络估算；依赖合约未部署时，完整估算保持 NOT_RUN。只读结果不能替代签名授权、合约安全准入或真实交易确认。准备工具会在生成任何部署前拒绝零 ETH 保留储备，避免与构造器约束不符的计划消耗部署 nonce。

最低分离资金需求为：

```text
TSLA LP                        250,000 AF-USDC
AMZN LP                        250,000 AF-USDC
100 × 免费领取                   100,000 AF-USDC
独立 ETH 兑换储备                 conversionUsdcRaw
TSLA 测试股票交易储备              stockReserveUsdcRaw
AMZN 测试股票交易储备              stockReserveUsdcRaw
```

即固定部分 600,000 AF-USDC，再加兑换资金和两份股票测试资金。公开 TSLA 认购所得独立进入 `0x86767116cd40bf6b4f8cf88e08d11e38b04364cf`，不重复计入 LP。AMZN 初始 500,000 PASS / 250,000 AF-USDC 建池，另外 500,000 PASS 进入上述指定钱包。TSLA Launch 在开放前持有全部 1,000,000 PASS，其中公开 500,000、LP 500,000，以及独立的 250,000 AF-USDC。

例如本地隔离夹具的 2,000,000 AF-USDC 总供应、100,000 兑换 AF-USDC、50 ETH、每个股票测试储备 100,000 AF-USDC / 500,000 TEST 股票，只用于本地验证，不是生产批准参数。实际发行 AF-USDC 总供应、兑换资金和 ETH 限额仍需明确批准。

计划 schema 2 对每一步列出链、合约、函数 / 参数、调用者、输入资产 / 原始数量、实际资金流向、LP 接收方、预期输出、权限、恢复与验证要求。AMZN 实际 pool 地址和 LP 数量从成功事件取得，不把预测占位文字当作部署地址。Gas 为 `NOT_RUN_TARGET_NETWORK`，不能用本地测量替代目标链交易估算。

## 权限与不可逆步骤

| 操作 | 权限主体 | 资金或结果 | 审核边界 |
| --- | --- | --- | --- |
| 一次性部署固定供应资产 | 明确部署者 | USDC / 两种 PASS / 两种 TEST 股票初始供应进入管理员 | PASS 每种固定 1,000,000，不提供后续 mint |
| Factory initializer、Router 授权 | 合约管理员 | 固定合法入口，不能重复初始化 | 校验真实合约、token、chainId 和代码哈希 |
| AMZN 建池 | 配置的 initializer | 500,000 PASS + 250,000 AF-USDC；实际 LP 给批准接收者 | 成功后不能重复建池；LP 权限依接收账户实际控制 |
| TSLA LP / 发行库存预注资 | 资产持有人 | 1,000,000 PASS + 250,000 AF-USDC 锁入 Launch | Launch 没有管理员提前提款；配置错误必须在转入前发现 |
| TSLA openMint | Launch owner | 检查足额库存、LP 储备、兑换就绪后进入 MINTING | 最后一笔 Mint 自动发射，无后续管理员签名 |
| 用户认购 / 交易 | 用户钱包 | 真实 ERC-20 / ETH 原子结算 | exact approval、quote 到期、滑点、gas、nonce |
| 免费领取签名 | 独立 claimSigner | EIP-712 单账户 / 单 nonce / 最多 100 份 | 无链上管理或交易广播权限；领取资金预存 |
| ETH 报价签名 | 独立 quoteSigner | 有期限的 EIP-712 兑换凭证 | 账户、payer、chain、reserve、router、nonce、epoch 和额度绑定 |
| Reserve 调整、暂停、允许的提款 | 合约管理员 | 独立兑换库存、限额及风险开关 | 不访问 Vault 用户资产；须重新评估受影响兑换路径 |
| 股票 TEST 价格 / 日历更新 | feed 的实际 immutable keeper | 只更新 TEST 参考价格与交易时段 | <=60 秒，真实数据源、日历 / DST / 提前收市；不调用券商下单 |
| Vault 存取 / 关闭 | 各 Vault owner | 1 PASS 对应 1 AF-USDC 本金容量 | 利润先提、本金解锁、亏损不自动解锁、最终关闭清理 |
| Vault 股票 TEST 交易 | owner 或显式限时 executor grant | 只交易对应 TSLA / AMZN TEST 股票 | 单笔 / 累计预算、滑点、executionVersion、市场时段、暂停与流动性 |

Owner 与 LP 接收地址是不同字段；收款 EOA 不获得默认 LP 或用户 Vault 权限。前端 executor 表单要求用户逐项填写并审核授权，不把创建 / 存入 Vault 显示为已自动开始交易。此交付没有擅自启用任何持续 keeper 或 executor 签名进程。

## 合约验证与真实 manifest

获授权后逐笔保存原始交易、receipt、部署 nonce、3 个包含成交块的 L2 区块确认及区块 hash。确认深度为应用策略，不表示 L1 最终性。比对固定供应、decimals、owner / keeper、signer、epoch、factory / router、策略关联、LP recipient 及实际余额。

从成功 receipt 取得真实 `deploymentBlock`、pool 地址和每个合约 `eth_getCode` 的 keccak256，按 `packages/launch-market/src/types.ts` 的 `LaunchMarketManifest` schema 1 填写私有 manifest。代码包含 constructor immutables，manifest 哈希必须来自实际部署的运行时代码，不能复制无参数编译产物的占位哈希。保留 source / compiler / constructor args，通过目标链支持的浏览器验证完整源码；自动验证 API 尚未执行。

Reader 启动会核验 chain46630、非空 runtime code hash、PASS 1,000,000 / 18 位及 USDC 6 位、真实策略和池关联。TSLA pool 在 PREPARING / MINTING 可为 null，成功发射后从 Factory 读取；不要为更新 TSLA pool 而变更既有存储身份。所有初始操作先读取状态和成功事件，成功过的一次性操作不得重复执行。真实部署工具不会自动签署计划，也没有自动广播部署命令。

本地最后一笔 Mint 消耗 3,178,873 gas，测试预算 6,000,000。2026-10-09 的目标链只读 ArbGasInfo 观察 transaction / block 执行上限为 32,000,000；保留块号、hash 与时间的证据。目标链实际部署、最后 Mint 估算 / 执行和执行限制验收仍为 `NOT_RUN`。Nitro header 的人工 `gasLimit` 不能当作实际执行限制。[Arbitrum gas 说明](https://docs.arbitrum.io/arbitrum-essentials/arbitrum-vs-ethereum/block-numbers-and-time)、[ArbGasInfo 接口](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbGasInfo.sol)。

## 服务、登录与行情

配置参考 `deploy/launch-market/.env.example`、service 和 nginx 示例。没有 manifest 时显示 `NOT_DEPLOYED`，余额未知且资产操作禁用。先使用单独的 preview 数据目录；正式已配置服务的持久目录必须保留，不得把空目录用作重新初始化。

实际服务只监听 127.0.0.1:4101，RPC 用于只读。两份 EIP-712 key 必须是服务 owner 的 0600 单链接普通文件，quote / claim signer 与部署钱包分开，不输出密钥，不为这些 Wallet 绑定 provider。服务器不签署或广播资产交易；用户通过钱包提交。

`/auth/*` 继续使用现有 Google access 服务，`/api/launch-market/*` 转给新服务并保留 Host、Origin、Cookie；SSE 不缓存或缓冲。Access 源码默认端口 4188，切换前应核验实际配置。现有 `__Host-ikol_session`、Google `email_verified`、whitelist、有效期和撤销状态由只读 bridge 核验，mutation 要求真实 session CSRF。Native Website / demo 登录不满足本轮资金账户和领取资格。真实 ingress / Google 登录集成测试等待授权切换后进行，不用本地身份夹具冒充完成。

ETH 报价固定读取 Coinbase ETH-USD ticker 与 Kraken ETH/USD recent trade，两源最大年龄 30 秒、差异上限 2%，失败或超期不签新报价。使用整数 6 位 USD 数据，5 秒 single-flight 缓存，签名最长 60 秒并随源年龄缩短。单一路径兑换库存不足只禁用相关 ETH 路径，AF-USDC AMM 仍由自身流动性决定。[Coinbase](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker)、[Kraken](https://docs.kraken.com/api-reference/market-data/get-recent-trades)。

股票参考工具使用固定 Alpaca paper clock / calendar 与 IEX TEST 参考 quote 的 GET 接口，不连接真实股票订单账户。价格来源独立于 PASS AMM，日历处理美国节假日、DST 和提前收市。提供只读数据授权文件后，可生成短期有效无签名更新：

```bash
npm run fair-launch:stock-reference -- /absolute/private/verified-manifest.json https://approved-testnet-rpc.example /absolute/private/data-credentials.json TSLA /absolute/private/new-reference-plan.json
```

工具读取链上真实 feed keeper；获授权的 keeper 另行审核、签署和广播新鲜更新。没有新鲜价格和日历时 TEST 股票交易停止，已有现金 / PASS 仍读真实链余额，过期 NAV 以未知显示。Keeper 更新频率、密钥托管、stock reserve 注资和 executor 服务启动均在待授权清单中。[Alpaca market calendar](https://docs.alpaca.markets/us/v1.4.2/reference/getcalendar-1)。

## 切换与恢复

1. 审核地址、LP 归属、独立资金、签名权限、数据源、限额及真实部署计划，取得针对实际 Testnet 交易的批准。
2. 部署 / 验证并初始化，预存储备，AMZN 建池；TSLA `openMint` 最后执行。任何偏差立即停止后续动作，保留已成功 receipt。
3. 使用真实 manifest、新批准发行的持久身份数据库和已有只读 access DB 启动新 loopback 服务；确认 indexer 健康、真实余额、LP、发行状态和身份边界。
4. 完成真实双钱包目标链烟测后，再批准入口切换；旧 release 与原数据库保留。
5. 切回旧 release 不撤销链上交易。持久账户 / voucher 目录保留，不能恢复为空库或更换 accountKey。SSE 关闭会结束连接，再按链 canonical 状态恢复，不重播用户钱包交易。

真实部署及切换均未执行。服务日志不得记录 cookie、CSRF、Google 邮箱、API secret、签名私钥或原始会话数据。

# Macbeth04 浏览器 driver 独立复核

记录日期：2026-09-21；Agent Macbeth05；任务 `M3-05-PHASE1-ACCEPTANCE`。

结论：**PASS_AT_F26E919 / FINAL_INTEGRATION_PENDING**。本次在真实 product-ui 上独立完成 8 组 DEV_MOCK 路径、核对 9 笔精确 mock 钱包提交；没有新增阻塞性发现。它验证 UI/runtime 到 mock provider 的行为，不代表 API/Indexer 联调、真实链收据或正式覆盖率已完成。

## 准确来源和独立环境

- HEAD：`f26e919a3fea4117318f153ce781c725764f6a92`。
- tree：`794853945d42f7017483abc3a82d31b70b0b048d`。
- parent：`aa6c7648e13f46b98e14cf4474adbc48073ee8e0`。
- worker 只读源：`<WORKER04_PRODUCT_CHECKOUT>`，接收时干净。
- 05 clone：`/private/tmp/AlphaForge-M3-05-BROWSER-F26E919`，独立完整 clone，193 个包以锁文件离线安装；完成后 tracked 干净。
- Node 24.21.0 / npm 11.19.1，darwin arm64；既有 Google Chrome 153.0.8010.50。
- Playwright-core 1.62.1 的 111 个文件与批准 `planning/coverage-toolchain.lock.json.browser.installedFiles` 完全匹配；descriptor SHA-256 为 `9c7cfe03cb7dd97d5313a61d4e70d85ccb38c3b9a97ab287c950c27bbffaa39a`。05 从已核验本地字节复制至自己的工具目录，逐文件重验摘要、不同 inode、0 symlink；没有新增版本或下载。

## 实际执行和证据

| 验证                   | 实际入口                                                                                                                   | 独立结果                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| driver 与 runtime 回归 | `node --test test/m3-browser-journeys.test.mjs test/m3-injected-runtime.test.ts test/m3-browser-runtime.test.ts`           | 43/43 PASS，其中新 driver 4 项 |
| 类型检查               | `npm run typecheck`                                                                                                        | PASS                           |
| 改动格式完整性         | `git diff --check HEAD^ HEAD`                                                                                              | PASS，空输出                   |
| 真实浏览器             | `node tools/verify-m3-browser.mjs`，显式隔离 AF_PLAYWRIGHT_PATH、AF_M3_BROWSER_PORT=4287、独立 AF_M3_BROWSER_EVIDENCE_ROOT | PASS；8 组路径 / 9 笔精确请求  |

首次浏览器执行因沙箱拒绝 `127.0.0.1:4287` 监听报 EPERM，原失败日志保留。按已授权 local/mock 范围允许本地监听后重跑成功，没有改变源码或断言。原始文本日志、结果 JSON、截图处置摘要与工具复制回执见 [证据清单](evidence/browser-driver-review/SHA256SUMS.json)。

## 已核对行为与实现

入口仍为 `apps/web/index.html` → `apps/web/src/product-ui.ts`。结构化 provider/runtime 证据仅通过既有 `import.meta.env.DEV` 与 `?m3Fixture=1` 条件加载的 fixture 暴露。新断开钱包状态返回空账户；driver 操作真实页面控件并读取 runtime 发布的状态。

浏览器实际验证：Owner A 连接及正确网络；1 raw Pass 转账后余额严格减少 1；A/B Owner、spender、余额与审批后不同 allowance 隔离；非 Owner、断连、错链和刷新恢复；精确有限双 token approval、deposit、普通及降级 withdraw；reorg/soft-ready；close 与两种 post-close rescue；已有原型图表、收藏和 demo 交易只改变独立本地账本。原型交易前后链上 fixture Pass 余额相等，未用 demo 交易冒充真实 Pass 转账。

最终 9 笔发送依次为：Pass 转账 1 raw；AF-USDC approval 1000001；Pass approval 1000001000000000000；deposit 1000001；withdraw 1；降级 withdraw 1；close；固定 token rescue；native rescue。每笔 from 为 Owner A，target/spender/recipient/金额按 allowlist 和 calldata 解码断言，value 为 0。页面错误、CSP 错误、外部请求均为 0。

本轮未重复父提交已独立通过的完整 717 项测试，也未把 worker 自报的 build/full-suite 算作05新执行结果；本次改动相关的43项、类型检查和真实浏览器已执行。普通 CLI 为未插桩 Vite DEV；正式 canonical coverage 由01基于准确统一候选采集。API session 未连接符合该 fixture 限定，不能据此宣称 API/Indexer 闭环通过。

## 后续条件

将此准确交付保留历史地集成到01统一候选，注册新增专项测试，并在最终候选重跑适用验证。04后续 coverage adapter 如另有提交，应按新 SHA 审查；本结论不提前覆盖它。托管门禁、独立批准、正式覆盖率和真实 Testnet 验收各自独立。

当前公开扫描器拒绝非文本 NUL 字节，因此 PNG 截图保留在 ignored `.checks/macbeth05-private-review-originals/m3-browser-journey.png`，不放入公开 tracked 树；截图原件的字节数和 SHA-256 单列在 `historical-ignored-m3-browser-journey.json`，当前清单只收录可在公开树中逐字节复核的文件；本地原件仍可按该摘要核验。此存储调整不修改图片或浏览器结果 JSON，也不清除先前提交里的图片。

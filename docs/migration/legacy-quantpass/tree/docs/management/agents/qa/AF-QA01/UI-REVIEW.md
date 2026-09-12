# AF-QA01 UI / Browser independent review

> 历史专项记录：以下“开放/未交付/BLOCKED/NOT RUN”均描述本报告所列旧阶段。最终组合已经重新验证，当前结论与F01–F05关闭见 [INTEGRATED-REVIEW](INTEGRATED-REVIEW.md)。原始SHA/失败/限制保留。

Agent: Macbeth05 · Task: AF-QA01 · 执行日期：2026-09-12 UTC。

**Browser verification: PASSED（下列准确配对与场景）**。**UI contract acceptance: FAILED**：F04/F05 两个 Medium 兼容性问题开放。正常配对通过不能覆盖最小冻结契约失败。Integration recommendation: **BLOCKED**。

## Exact scope / environment

- UI PR #9：`3caf8dd4c12a6b5da38ee3664b44683b69affcd2`；公开交付 [SUMMARY](https://github.com/pdbsy/quantpass/pull/9#issuecomment-5646728175)。
- Canonical Backend PR #7：`f66faa10c2a22f56048b04416cd83a2e8e9dd481`。
- Legacy compatibility：同一 UI SHA 内未经 UI 分支修改的 base 后端；基准 `0a813de422a02a2b3f0ade7eee693f0d2491ec33`。此运行不声称 legacy 支持 v1 或第二策略。
- 冻结接口：`73230c43e464cd1b579fa16a6425756291ef9e8e`；采用 [Q01 决定](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646423661)。
- macOS 26.6.2 / arm64；Node 24.21.0 / npm 11.19.1；Chrome **152.0.7977.83**，headless 实际 Chromium 页面；Playwright-core **1.63.0**，QA 自有工具目录，与应用依赖分开。官方 npm SRI 与安装 lock 一致：`sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==`。
- QA 自己 `git archive` 的不可变候选快照、自己依赖缓存、临时 SQLite、全新浏览器 context；本地 127.0.0.1:42915/42916/42917/42918。未读其他 Worker 的私有工作树/运行时、用户浏览器 profile 或真实身份。全部服务和浏览器均由 harness 在 finally 关闭。

## Source / UI protection

读取 23 个变更路径清单，重点全文审阅 product-client、product-adapter、product-ui、api、importer、浏览器 harness 与新增测试；检查 entry/build/test wiring 和原型中用户文本/路由/存储渲染路径。并未把原型全部业务和依赖宣称为完整安全审计。

原用户文件 `<HOME>/Downloads/AlphaForge_v3_EN.html` 与提交的 prototype **285969 bytes 逐字节相等**；SHA256 `949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45`。构建 CSS 与原 `<style>` 内容相等，SHA256 `8b0996e01403be0d0fbf555e03151973cdfe1118ad20f4423324538a32e4aff6`；构建 user-ui.js 只执行已审阅的 `style=` → `data-user-style=` 机械变换。新增 importer 的 2 项测试实际运行并校验 shell 与重复导入。

执行后 UI 的 **123 个 tracked Git blobs** 全部与准确 SHA 相同。未替作者修改实现、预期或业务测试。原六个 fixture strategy ID、原站导航/论坛/账户子页保持可达；API 目录和资金明确分区；纸色、rust/sage 配色与手绘卡片的桌面/移动截图已人工看图。未观察到未经授权的大范围重做。新增入口和命令 wiring 在 [AF-M01 授权](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646524389) 内；api.ts 仅增加 [获准 Retry-After 元数据](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646524603)。没有依赖、lock、后端、domain、CI、lint/format 排除项修改。

## Actual commands / results

所有 Node/npm 命令通过 `fnm exec --using v24.21.0 -- …` 执行；cwd 是 QA 自有 UI 快照，另行注明的 QA 脚本在 QA 自有工作树运行。

| 命令/检查 | 实际结果 | 证据/限制 |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | [日志](ui-evidence/typecheck.log.gz) |
| `npm run lint` | exit 0 | [日志](ui-evidence/lint.log.gz) |
| `npm run format:check` | exit 0 | [日志](ui-evidence/format.log) |
| `node --test test/ui-import.test.mjs test/ui-product-client.test.ts test/ui-product-adapter.test.ts` | **35/35**, exit 0, 0 skip | [日志](ui-evidence/ui-tests.log)；不是全部 92 tests |
| `npm run build` | exit 0 | [日志](ui-evidence/build.log)；board/import/Vite 可构建，不是发布 provenance |
| `npm run verify:gates` | exit 0 | [日志](ui-evidence/gates.log)；既有合成门禁验证，未使用真实秘密 |
| `npm run secrets:check` | exit 0，但扫描 **0 files** | [原日志保留](ui-evidence/secrets.log)；归档位于父仓库忽略目录，不能计为源码扫描 PASS |
| QA 显式准确 Git 清单 + 既有 findSecretKinds | PASSED | [补扫日志](ui-evidence/explicit-secret-check.log)：UI 123 文件/121 文本，BE 117/117，构建 4 文本；无匹配，二进制与全量秘密审计不在覆盖内 |
| QA 普通后端表单边界 | PASSED, exit 0 | [日志](ui-evidence/backend-form-boundaries.log)：10 个拒绝 + 合法 1 atomic unit 对照，失败无账本变化 |
| QA 最小合法契约两组/两对照 | **F04/F05 FAILED** | [原日志](ui-evidence/contract-check.log)；观察脚本 exit 0 仅表示完成，不代表断言通过 |

归档内 build-manifest 调用了父仓库 Git，记录的是 QA HEAD `8c1d0b5d7e716dc84d0d6f3f9ee84ebc3a644478`，不用于证明 UI provenance。准确绑定来自独立 Git blob、HTML/CSS/脚本内容核验。本次没有把无 Git 的归档环境工具输出误算为真实发布证明。

## Browser execution

先完整阅读，再在 QA 自有环境运行作者 `tools/verify-ui-browser.mjs`，未复制作者 result：

```sh
# 在上述准确 UI 快照；路径均指向 QA 自己目录。
AF_PLAYWRIGHT_PATH="$QA_ROOT/.checks/af-qa01/browser-tools/node_modules/playwright-core/index.mjs" AF_BROWSER_PORT=42915 AF_BACKEND_APP="$QA_ROOT/.checks/af-qa01/candidates/f66faa10c2a22f56048b04416cd83a2e8e9dd481/apps/server/src/app.ts" fnm exec --using v24.21.0 -- node tools/verify-ui-browser.mjs
AF_PLAYWRIGHT_PATH="$QA_ROOT/.checks/af-qa01/browser-tools/node_modules/playwright-core/index.mjs" AF_BROWSER_PORT=42916 fnm exec --using v24.21.0 -- node tools/verify-ui-browser.mjs
```

`QA_ROOT=<SOURCE_ROOT>`。Canonical / legacy 两次 **exit 0**，各 10 组流程；[canonical result](ui-evidence/canonical-result.json)、[legacy result](ui-evidence/legacy-result.json)。每次重新建 SQLite 和 browser context。

- Homepage → Marketplace → API Strategy → 领取 1000 测试 Pass（资金仍 0）→ Account → Workspace。
- 全部 **13 种命令**：deposit、allocate、deallocate、start、stop、reserveBuy、fillBuy、cancelOrder、markPosition、settlePosition、requestWithdrawal、confirmWithdrawal、cancelWithdrawal。stop 先为 stopping，结算才 stopped；最终模拟提款 1600 单位 = `1600000000` 原子单位，idle/activeNet/pending 为 0。
- 实际服务器先提交 deposit 7，再丢弃浏览器响应；localStorage 保留原 owner/vault/id/revision/payload；reload 后显式恢复，核对 audit 与 exact envelope，余额保持 7，未重复入账。
- 同账户第二个普通请求推进 revision；旧 review 被拒绝，保留原请求，必须刷新/明确 dismiss，余额只增加已确认的 1。
- 离线读取显示 STALE/DISCONNECTED，禁用新金额操作；恢复网络并 refresh 后可用。7 位小数在 review 前 ERROR，没有 POST；余额不足正常业务拒绝，无成功假象和余额变化。
- canonical 两策略关联分开：core idle 8、satellite idle 3、不同 vaultId；legacy 明确只具有旧能力。
- 原六策略、论坛/排行榜/所有账户子页可达；fixture 图表数据与模拟现金在导航前后相同。desktop **1440×1000**、mobile **390×844**，五类页面无水平溢出；两次运行 page errors / CSP errors **0**。

随后独立编写并执行 QA 补充浏览器脚本，最终 [extra result](ui-evidence/extra-result.json) 6 组、[navigation result](ui-evidence/navigation-result.json) 3 组均 **exit 0**：

- 受控正常 POST 延迟观察到 PENDING，禁用新命令；精确 `2.345678` 最终为 `2345678`。受控 GET 延迟观察 LOADING → READY。
- 真正 SIGTERM 自己的服务进程，使用同 SQLite 启动不同 PID；旧 session 失效，refresh 清空旧 vault 私有视图；显式 Alice 登录恢复相同 vault、revision=1、idle=`2345678`，audit 仍恰好一条 deposit / revision 1。
- browser back/forward 恢复目录/选中 API 策略；五类路由完整 reload 后身份、vault 与资金一致。目录 search/status/environment 过滤及无匹配空态实际操作。
- 请求仍在处理中点击 Bob 返回 BUSY，并保留 Alice session；响应丢失形成未决请求后可切 Bob，旧 vault/重试不可见；切回 Alice 恢复 exact pending，没有重复入账。延迟旧身份读不能覆盖新身份的更底层检查在实际运行的 client test 中，浏览器未强行绕过禁用按钮制造读/切换竞态。
- 存储不可读/格式错误导致 DISCONNECTED；恢复存储后刷新回到 PENDING，保留相同未提交请求字节，command POST 计数 0。该故障注入仅自己的浏览器测试存储。
- 实际响应 CSP 没有 unsafe-inline/unsafe-eval，Referrer-Policy=no-referrer；会话 cookie 不可从 document.cookie 读取；此正常流程 localStorage keys 无凭据类字段，page errors 0。

UI 状态条为五类页面共用；动作 PENDING/review/重试适用于 API workspace，账户私有视图适用于账户/API 页，静态首页/原 fixture 不伪造 API 动作。429/Retry-After 到期行为用实际运行的 adapter 注入时钟单元测试覆盖，未宣称浏览器实际等待 60 秒。

## UI evidence screenshots

以下是 QA 本次运行生成的原始图片，未修改；其余全尺寸截图只在 QA 忽略目录保留。

[移动端首页](ui-evidence/mobile-home.png) · [移动端 API workspace](ui-evidence/mobile-workspace.png) · [原 fixture 桌面](ui-evidence/fixture-desktop.png) · [实际 PENDING](ui-evidence/pending.png)

截图体现 TEST_ONLY / LOCAL SIMULATION、测试 Pass 非入金、API 不提供真实价格或收益，以及原 MOCK / FIXTURE 账本分离。没有真实链部署/托管/交易/收益声明。

## Functional contract findings

[F04/F05 完整模板](FINDINGS.md)；已在 [QA 自己 PR 公布](https://github.com/pdbsy/quantpass/pull/6#issuecomment-5646779600)。

| Finding | 普通合法输入 | 实际 / 对照 |
| --- | --- | --- |
| F04 Medium | 仅冻结 Vault 字段；资产在 `balances.asset` | 502 INVALID_PRODUCT_RESPONSE；只补非必需顶层 asset 后接受 |
| F05 Medium | `StrategyDetail.accountStrategy=null`，合法已认证空账户 | refresh 抛 INVALID_PRODUCT_RESPONSE / DISCONNECTED；只换合法 not_started 对象后 EMPTY |

准确 Original SHA 为 UI `3caf8dd4c12a6b5da38ee3664b44683b69affcd2`。Fix SHA 尚未公开，Revalidation NOT RUN。两项是功能兼容问题，未被称为安全漏洞；当前 f66 后端提供额外字段/关联对象，正常配对浏览器 PASS 不足以证明最小合法响应可消费。请原作者修复并发布准确 SHA；QA 不修改实现。

## Limitations / next input

完整根 `npm test` / `npm run check`（作者 92 tests）、最终组合候选整套回归、其他浏览器/操作系统、无障碍全面审计、全仓漏洞扫描与完整依赖/provenance 审计 **NOT RUN**。本报告限定静态安全矩阵见 [UI-SECURITY-REVIEW](UI-SECURITY-REVIEW.md)，不能据此承诺无漏洞。

最终组合 candidate SHA 未交付。需 UI F04/F05 修复复验、经理组合 SHA 后完成最终回归。新提交不能继承旧 PASS；Chain 已接受的严格 gate FAILED 不构成当前阻塞。

[完整 QA 补充脚本与摘要](UI-QA-SCRIPTS.md)。

## Published artifact SHA256

| 文件 | SHA256 |
| --- | --- |
| `ui-evidence/backend-form-boundaries.log` | `f6b15b4c96b34d887fb89cbf39fc22854ccae518ec3d530fef94cf8b2275b7f6` |
| `ui-evidence/build.log` | `51964f92680a5f04c26671bd0c26efd607acf796ad3ca43162d5d412a9c52b56` |
| `ui-evidence/canonical-result.json` | `c122093e7d1a5a7dd9786142248f63fb510d31e325e8a0ff70b055c89cdb8b2a` |
| `ui-evidence/contract-check.log` | `36b33d8400e5b9d04255e132677fe8604248a6eb97a674fe161187fd6d844805` |
| `ui-evidence/explicit-secret-check.log` | `113cd2215ebf0b71bf3aa23420b4c473e59c3bef6eb7fbb06c917fe6ec12a41a` |
| `ui-evidence/extra-result.json` | `d50f02291206f543461cc64b6c4321e85b630f9bfdf7b8932e62f085b4a9a20e` |
| `ui-evidence/fixture-desktop.png` | `0117d8c41d6dbee406452ad2cd11c6f4110451612817a2cac926b789fcef8fc3` |
| `ui-evidence/format.log` | `e9f8f86c62eba231d75baa570290ee509152fb28e1d2828283de484f5a9f3819` |
| `ui-evidence/gates.log` | `cda0579b845d3927cb60e59e6a969dd07838360bd48a323337621527dcd667fd` |
| `ui-evidence/legacy-result.json` | `b328750e0bdcf02de9c4b50a40c4905df79f187b144eff01355d5e863d459bdd` |
| `ui-evidence/lint.log.gz` | `618d12d0bb583a98731446b6b9f362012a12e93177eeff781fee04e303e45884` |
| `ui-evidence/mobile-home.png` | `97a4d60f73412330b8da1d002ac28154afa600191bde41b77b9be2e2338de432` |
| `ui-evidence/mobile-workspace.png` | `18de6171bebe8bdbf0a45e273c3801fcbc2677997e2bac12a8f18782fe11989f` |
| `ui-evidence/navigation-result.json` | `a8ee0367a5fa99e7dfd79135426e542f03ffa8a2e47e9e0b31fd928321cb5bad` |
| `ui-evidence/pending.png` | `dc17753243b640364d9488e9cfca3a9e00042e8bc82c5c9b74cf63c3af26e40d` |
| `ui-evidence/secrets.log` | `952c161c6a8fb31ae1d70266960f389917d6b1c839151d19c7aa5184ab92eb65` |
| `ui-evidence/typecheck.log.gz` | `5fd03446da7de2561b3a101b2bbcef2ffb71d82eb72d1c37c8bb0271efd18279` |
| `ui-evidence/ui-tests.log` | `0e9e6583da8e5f81b4dac54a7f4126037f53ba415759c52752f573334d616832` |

JSON证据只按仓库格式要求补末尾换行，解析值逐项保持相等；截图与日志原字节不变，以上SHA256记录已发布文件。

原始typecheck/lint日志以无损gzip保存，解压字节与原输出完全一致；避免原工具多余末尾空行触发QA补丁的空白检查。其他原日志不改。

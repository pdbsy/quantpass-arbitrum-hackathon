# AF-UI01 — READY FOR REVIEW

Macbeth02 · branch `macbeth02/AF-UI01-ui-adaptation` · Draft PR #9. No self-merge.

## User UI preserved

The original six-page English UI remains the main application: Home, Marketplace, Rankings, Forum, Trade and Account. Original navigation, typography, paper/rust/sage colours, Doodle styling, animations, charts, bookmark/notes interactions and local fixture exchange remain. The HTML snapshot is byte-identical to the supplied 285969-byte source, SHA256 `949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45`.

The CSS payload is unchanged. The importer externalizes source assets and mechanically marks inline style attributes for a small CSSOM hydrator under the unchanged server CSP. Authored code stays linted; no new ignore rules, dependencies or lockfile changes were introduced. The companion JSX only embeds the same HTML in an iframe, so the actual HTML was integrated directly.

## Pages adapted / APIs connected

- Homepage: local API identity/environment and status, original navigation.
- Marketplace: real catalogue, text/status/environment filters; six original fixture cards retained.
- Detail/workspace: metadata, test Pass access, vault association and thirteen reviewed commands.
- Account: authenticated owner, strategy relationships, Pass allowance, idle/allocated/pending balances and withdrawals.
- Session: `/api/demo/session`, `/api/session`.
- Canonical: `/api/v1/strategies`, strategy detail, account, vault lists/detail/audit, vault claim and commands. Opaque pages are fully consumed within bounded limits.
- Explicit legacy compatibility only after the initial canonical catalogue returns 404; missing old fields display Unavailable.

Frozen contract: `73230c43e464cd1b579fa16a6425756291ef9e8e`. Actual canonical browser backend: public Macbeth03 candidate `f66faa10c2a22f56048b04416cd83a2e8e9dd481`. It was loaded from an isolated read-only public source snapshot; no backend or other worker branch was changed. Legacy browser backend: master implementation at `0a813de422a02a2b3f0ade7eee693f0d2491ec33`.

## Fixtures still used

Original strategy IDs trend/factor/mean/rotate/breakout/pairs, their price/performance charts, rankings, Pass exchange, trial funds and local forum content remain MOCK / FIXTURE. None is mapped to a real server vault. The actual core-flow-demo and satellite-flow-demo entries use independent owner-strategy-vault relationships. Pass allowance is never represented as cash. The API supplies no live market performance, yield or risk rating; the UI invents none.

## Business flows verified

Browser validation: **PASSED**, actual headless Google Chrome with the real Fastify/SQLite application and fresh isolated database.

1. Homepage → Marketplace → API strategy → claim 1000 test Pass → Account → Workspace; claim creates no funds.
2. Deposit 1500, allocate 1000, start, reserve/cancel, reserve/fill, mark position 1100, stop, settle, deallocate, withdrawal request/cancel and request/confirm. All thirteen commands ran. Stop stayed stopping until settlement. Exactly 1600 simulated units were withdrawn; ending active/pending/idle balances were zero.
3. Reload preserved SQLite state. Bob saw no Alice vault. Switching back restored Alice's vault.
4. A real POST was committed but its browser response was aborted. Reload retained the exact command; retry read audit/vault and confirmed it without duplicate deposit.
5. A peer command advanced revision after review. The reviewed request stayed unchanged and was visibly rejected; refresh and explicit dismissal were required.
6. Offline read disabled money writes; refresh restored readiness. Excess precision showed ERROR before confirmation. Insufficient idle produced a visible rejection without changing funds.
7. Satellite deposit 3 left core idle 8 unchanged; catalogue and account exposed both associations.
8. All original six strategy routes and account subpages remained. Desktop 1440×1000 and mobile 390×844 checks passed; tested mobile pages had no horizontal overflow. No page errors or CSP violations. Screenshots finish finite animations for stable inspection.
9. Unreadable and malformed cooldown storage showed DISCONNECTED and blocked writes. Restored storage plus refresh recovered the original PENDING envelope without any command POST.

Evidence: [canonical browser checks](evidence/canonical-browser.json), [legacy checks](evidence/legacy-browser.json), [storage recovery checks](evidence/storage-browser.json), [original fixture desktop](evidence/fixture-desktop.png), [API workspace mobile](evidence/workspace-mobile.png).

Full local captures are retained under `.checks/AF-UI01/browser-CkKv0s`, `browser-nS4DUD`, and `storage-browser-XfjGqD`. Databases and session material remain uncommitted.

## Automated verification / review

- 92 tests pass, covering real SQLite command flows, response loss, identity change, executor audit recovery, storage durability, canonical-only mapping, pagination, Retry-After, import integrity and startup errors.
- Full `npm run check`: typecheck, ESLint, Prettier, tests, secret baseline and build.
- `npm run verify:gates`: injected type/test failures, invalid production/mock configuration and synthetic-secret checks correctly rejected.
- Independent read-only review covered the full implementation, then the storage fix at `42f298f21fe6caa7848a981a5754a770c1ccf414`: no unresolved Critical or Important findings; READY FOR REVIEW.

Reproduce after `npm run build:web`, using Node 24.12/npm 11.6 and optional external playwright-core plus Chrome:

```sh
node tools/verify-ui-browser.mjs
AF_BACKEND_APP=/absolute/path/to/published/backend/apps/server/src/app.ts node tools/verify-ui-browser.mjs
```

`AF_PLAYWRIGHT_PATH`, `CHROMIUM_PATH` and `AF_BROWSER_PORT` allow local tooling overrides. The script defaults to ignored `.checks/browser-tools` tooling; browser dependencies are not added to the application.

## Visual changes / known issues

No redesign, replacement navigation or global CSS change. Supplemental API catalogue/status/account/workspace content uses existing classes and dialogs. API test values and original fixture values are explicitly separate.

This remains a local simulation with Alice/Bob test identities. The original six strategy specimens have no execution backend. The durable command controller uses one pending slot and a single-instance lock; cross-tab atomic coordination is not implemented. Legacy API lacks some canonical totals and detail capabilities. Canonical integration depends on the reviewed backend candidate; it is not silently copied into this branch. No unresolved blocker was found in the accepted scope.

## Retrospective

### 做了什么

保留用户原始界面，接入规范 API、真实账户关系、十三种模拟资金操作和错误恢复。新增可复现浏览器验收及少量截图。

### 为什么

用户已经完成视觉设计，本任务需要补齐业务能力。原始六个策略没有对应后端，因此保留为明确标注的样例，另展示后端真实登记的两个策略。

### 实际验证

92 项测试、类型/格式/静态检查、构建和故障门禁通过。Chrome 实际走通规范后端及旧版兼容流程，覆盖取消、停止等待结算、持久化、账户隔离、策略隔离、断线、冲突和存储异常。

### 遇到的问题

真实浏览器发现模拟器审计执行者被误判为账户不匹配，导致 reserveBuy 后流程阻塞；已按真实执行角色修复并补回归。另修复身份切换残留视图、后续分页404错误降级、重载丢失限流时间及存储启动异常。

### 未解决

真实行情/收益源、六个样例策略的执行映射、生产身份系统及跨标签原子协调不在本次范围。没有把缺失能力显示为已实现。

### 对 Backend 的依赖

已公开询问并读取 Macbeth03 精确接口及候选 SHA，依据冻结 Wave 1 契约完成双策略联调。合并时由集成负责人协调前后端候选与 package.json 测试入口。

### 下一步

保持 Draft PR，交由负责人审查并决定集成；不自行合并。

### 如果重做会怎样改进

更早用真实执行者审计和存储故障跑一条浏览器纵向流程，尽快暴露单元契约样例未覆盖的行为差异。

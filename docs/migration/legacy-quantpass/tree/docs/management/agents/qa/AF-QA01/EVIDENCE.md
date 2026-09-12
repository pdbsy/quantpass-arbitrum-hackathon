# AF-QA01 evidence record

整理时间：2026-09-12T14:01:24.006161+00:00。来源为本会话实际 Git/GitHub CLI 输出；各 PR 读取非原子，所有判断仅绑定下列 SHA。

## E-01 启动核验

工作区 `<SOURCE_ROOT>`；初始状态干净；原分支 `macbeth05/af-agent-setup` / `043781b10a4208ebff1617b5698458c2fa4328ab`；新分支 `macbeth05/AF-QA01-wave1-verification`；remote `git@github.com:pdbsy/quantpass.git`；GitHub default branch `master`；fetched base `0a813de422a02a2b3f0ade7eee693f0d2491ec33`。

实际运行：`pwd`、`git status --short`、`git branch --show-current`、`git rev-parse HEAD --show-toplevel`、`git worktree list`、`git remote -v`、`git fetch origin` 和 `gh repo view`。均成功；没有修改 Git 作者身份。

## E-02 公开提交与差异

`gh pr list --state all --limit 100` 先发现 setup PR #1–#5；随后分阶段发现 #6 QA、#7 Backend、#8 Integration、#9 UI、#10 Contract。启动期“尚无交付 PR”的记录是历史状态，下表更新了当前所读输入。

| PR / Owner | Head SHA | Base SHA | 独立核对的交付范围 |
| --- | --- | --- | --- |
| [#8 Macbeth01](https://github.com/pdbsy/quantpass/pull/8) | `3d3e877423bccd31cc7e34e83103bdad8cf3c848` | `0a813de422a02a2b3f0ade7eee693f0d2491ec33` | 1 个新增 Markdown 文档，未交付实现 |
| [#9 Macbeth02](https://github.com/pdbsy/quantpass/pull/9) | `69cc4e7934cdcec9307ed4d477d5be20594eb6dd` | `0a813de422a02a2b3f0ade7eee693f0d2491ec33` | 3 个新增 Markdown 文档，未交付实现 |
| [#7 Macbeth03](https://github.com/pdbsy/quantpass/pull/7) | `686c0d108151a1c5075152a5c0d34264dacfe794` | `0a813de422a02a2b3f0ade7eee693f0d2491ec33` | 2 个新增 Markdown 文档，未交付实现 |
| [#10 Macbeth04](https://github.com/pdbsy/quantpass/pull/10) | `aa42ce2c19ccb85aaf8e13a3fd3e5e515e914e2f` | `0a813de422a02a2b3f0ade7eee693f0d2491ec33` | 2 个新增 Markdown 文档，未交付实现 |

实际操作：读取 `gh pr view <n> --json ...` 的描述、评论、files、base/head 和 checks；fetch 后用 `git show <固定 SHA>:<path>` 阅读以下全部 8 个文件，并用 `git diff --name-status <base> <head>` 独立确认改变范围。其他 Worker 的本地工作区、未发布改动和 runtime 未被访问。

### PR #7

- [docs/management/agents/tasks/AF-BE01-spec.md](https://github.com/pdbsy/quantpass/blob/686c0d108151a1c5075152a5c0d34264dacfe794/docs/management/agents/tasks/AF-BE01-spec.md)：已读。
- [docs/superpowers/plans/2026-09-12-af-be01-product-api.md](https://github.com/pdbsy/quantpass/blob/686c0d108151a1c5075152a5c0d34264dacfe794/docs/superpowers/plans/2026-09-12-af-be01-product-api.md)：已读。

### PR #8

- [docs/management/wave1/AF-M01-INTEGRATION.md](https://github.com/pdbsy/quantpass/blob/3d3e877423bccd31cc7e34e83103bdad8cf3c848/docs/management/wave1/AF-M01-INTEGRATION.md)：已读。

### PR #9

- [docs/management/ui/AF-UI01/ADAPTATION-MAP.md](https://github.com/pdbsy/quantpass/blob/69cc4e7934cdcec9307ed4d477d5be20594eb6dd/docs/management/ui/AF-UI01/ADAPTATION-MAP.md)：已读。
- [docs/management/ui/AF-UI01/SPEC.md](https://github.com/pdbsy/quantpass/blob/69cc4e7934cdcec9307ed4d477d5be20594eb6dd/docs/management/ui/AF-UI01/SPEC.md)：已读。
- [docs/superpowers/plans/2026-09-12-af-ui01-adaptation.md](https://github.com/pdbsy/quantpass/blob/69cc4e7934cdcec9307ed4d477d5be20594eb6dd/docs/superpowers/plans/2026-09-12-af-ui01-adaptation.md)：已读。

### PR #10

- [docs/contracts/AF-CHAIN01-INTAKE.md](https://github.com/pdbsy/quantpass/blob/aa42ce2c19ccb85aaf8e13a3fd3e5e515e914e2f/docs/contracts/AF-CHAIN01-INTAKE.md)：已读。
- [docs/superpowers/plans/2026-09-12-af-chain01-contract-foundation.md](https://github.com/pdbsy/quantpass/blob/aa42ce2c19ccb85aaf8e13a3fd3e5e515e914e2f/docs/superpowers/plans/2026-09-12-af-chain01-contract-foundation.md)：已读。

## E-03 CI 观察，非独立产品测试

下列是 GitHub API 报告的检查状态；由本会话读取，未冒充 Macbeth05 本地运行。各 PR 在固定 SHA 仅改变文档，绿色 CI 不能证明尚未提交的 Wave 1 实现。

| PR | Check / observed result | Evidence |
| --- | --- | --- |
| #7 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697708295/job/103563941770) |
| #7 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697666406/job/103563828772) |
| #8 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697718469/job/103563967881) |
| #8 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697675441/job/103563853680) |
| #9 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697815893/job/103564225193) |
| #9 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697755899/job/103564067145) |
| #10 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697818425/job/103564232378) |
| #10 | verify / COMPLETED / SUCCESS | [GitHub run](https://github.com/pdbsy/quantpass/actions/runs/34697741890/job/103564031832) |

## E-04 Forum 与公开通信

- PR #1 head `52c61def3604bd78d6523ba348cf296debf53bc5` 的 COMMON-PROTOCOL.md 和 forum-snapshot.json 已读。Forum last_sync_at `2026-09-12T13:33:41.010Z`，8 条消息，仅 AF-AGENT-SETUP；不是 Wave 1 最新交付视图。没有执行 Dashboard 浏览器验证或 forum:sync。
- 自己的 setup PR #3 评论和 CI 已读取，不把其结果用于 Wave 1 验收。
- [Macbeth05 四项依赖请求](https://github.com/pdbsy/quantpass/pull/6#issuecomment-5646310918) 已实际发布并读取。
- [Backend 契约问题](https://github.com/pdbsy/quantpass/pull/7#issuecomment-5646327849) 已读；作者说 57 个既有测试通过、新契约测试处于红灯，均为作者声明，未由本 Worker 运行。
- [UI 契约问题](https://github.com/pdbsy/quantpass/pull/9#issuecomment-5646323101) 已读；六个 fixture ID 不能擅自映射到 core-flow-demo。

## E-05 本轮执行边界

没有启动 Wave 1 服务、访问产品 Browser、安装/执行 Forge、运行产品测试或安全差异扫描。没有可验收实现提交和冻结集成候选；不以 master 的旧应用代验 Wave 1。仅验证文档和输入范围。

Browser verification: NOT RUN

## E-06 冻结契约与 Backend 更新（后续轮次）

本节更新 E-02/E-05 的历史输入状态，不能把旧的“只有文档”断言用于新 SHA。

- 经理 PR #8 `73230c43e464cd1b579fa16a6425756291ef9e8e`；已读冻结全文和 NOTICE `https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646374131`。
- `git show 73230c43e464cd1b579fa16a6425756291ef9e8e:docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md | shasum -a 256` 实际得到 `e7301dbb170fa4c409bb824013e06483e0dd51bd8e2d54f24cb7b047d817d481`。
- `gh pr view` 观察到 Backend #7 `708ab59181fe7b372c89f866125a1ffa26cef5be`，包含实现文件；UI #9 与 Chain #10 在本轮所读 head 仍分别为 `69cc4e7934cdcec9307ed4d477d5be20594eb6dd`、`aa42ce2c19ccb85aaf8e13a3fd3e5e515e914e2f`。
- 实际 `git show` 阅读 Backend product-views.ts、strategy-catalog.ts、api-errors.ts 和 app.ts 的相关路由/错误片段；`nl -ba` 核对 Finding 精确行号。未完整阅读该实现全部文件，未执行运行时/安全测试。
- master `packages/domain/src/vault.ts` L88–98 与 store.ts 事务回执片段已读，只作既有语义参考。
- [真实 ACK / Finding / QUESTION](https://github.com/pdbsy/quantpass/pull/6#issuecomment-5646406738) 已发布。3 个静态问题均绑定 `708ab59181fe7b372c89f866125a1ffa26cef5be`，不宣称影响之后的修复。

## E-07 最终 Fix 独立复验

最终 Fix `f66faa10c2a22f56048b04416cd83a2e8e9dd481` 已在自己的 git archive 快照运行 15 项产品测试与 5 组独立 QA 断言，全部通过。Node24.21.0/npm11.19.1；192 个锁定依赖在自己的目录安装；候选 lockfile 与安装基准相同；测试后 117 个快照文件逐 blob 核验不变。最初 `0beef3ad` 的 14 项测试只作历史证据，新 SHA 已重跑。Q01 已解决，F01–F03 现在 RESOLVED。见 [REVALIDATION.md](REVALIDATION.md) 的准确命令、日志摘要及完整 QA 补充源码。

[公开结果](https://github.com/pdbsy/quantpass/pull/6#issuecomment-5646507616)。运行范围仅本地 Fastify 注入/SQLite；Browser、Forge、完整安全和最终组合套件仍未执行。

## Chain candidate 673a33bbb53c0894db622ee0a626b09c27e51fbe — 2026-09-12

[独立 Chain 验证](CHAIN-REVIEW.md) 记录准确工具/源码、17/17 本地测试、QA ABI/向量脚本、下载恢复、47 wheel 元数据、原始日志摘要和哈希。

[扫描分诊](CHAIN-TRIAGE.md) 保留 46 个输入各自的静态结论；1 项目 / 45 包含依赖扫描实际完成，提示多重集合与发布记录一致，两个严格门禁 exit 255 保留为 FAILED。候选 122 个 Git blob 执行前后未变；本轮未运行 Browser、UI 或最终组合套件。

## AF-M01 对 Chain 信息提示的接受决定

[AF-M01 公开接受决定](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646714929)：Chain `673a33bbb53c0894db622ee0a626b09c27e51fbe` 的项目 Informational pragma 在该 TEST_ONLY 摘要预览范围内为 **ACCEPTED AS NON-BLOCKING**。CHAIN-04 保持 FAILED / exit 255，扫描提示、46 项分诊和限制保留；它不再是集成阻塞项。该决定不延伸到未来托管、验签、nonce、授权、退出、部署或其他链实现。

这是集成阻塞分类更新，不是重新执行检查、修改 scanner 结果或继承新代码的 PASS。准确 Chain SHA、原始日志和矩阵 12 PASSED / 1 FAILED / 43 NOT RUN 不变。已回读 UI/经理 PR 最新公开评论；最终 UI 和组合候选尚未发布。

## 最终 UI 与组合复验 — 2026-09-12 UTC

原 UI3caf的两套浏览器与35测试实际通过，但QA最小契约发现F04/F05。经理后续提供本地准确组合c22cfdf59ee120d7d8c5a75edc79ce97418435c7（含UI修复039496859dd238f8bc18824d9a39bca9f9031ea3）及文档记录84b477d45d8133d806d8760bcdac71a72141e6ea。QA在自己的detached工作树独立重跑109tests/full check、门禁、全部补充API/browser/Chain。详情、环境错误恢复及未运行范围见 [INTEGRATED-REVIEW](INTEGRATED-REVIEW.md)。

最终55PASSED/1FAILED（Chain严格255已接受非阻塞）/0NOT RUN；5 Findings RESOLVED；Browser PASSED；READY FOR INTEGRATION仅对TEST_ONLY准确组合。前面的历史NOT RUN/BLOCKED不能用于当前状态。

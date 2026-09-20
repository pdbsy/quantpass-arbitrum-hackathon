# Macbeth03 / Macbeth06 本地交付独立工程复核

记录日期：2026-09-21（Asia/Shanghai）。执行者：Macbeth05；任务 `M3-05-PHASE1-ACCEPTANCE`。

当前结论：**四项发现均已在准确 worker 修复提交独立复验通过，统一候选待验收**（03 `ac266ca`；06 `c817e94`；详见文末修复记录）。以下原始审查结论保留为修复前证据：`CHANGES_REQUIRED`。03 的恢复回归 66/66 与类型检查通过，06 的执行器回归 14/14 通过；额外负例独立复现两项 P1 和两项 P2。该结果是本地工程复核，不构成治理批准、独立安全身份背书或最终统一候选验收。业务修复由 Macbeth01 分派给原责任 worker；05 未修改 worker 源码。

## 版本、环境与边界

| 项目           | Macbeth03                                                                   | Macbeth06                                        |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| 准确 HEAD      | `733538600fb2c643afbfe5e13e3c9de9b7dbbd67`                                  | `d1c52e32510f2efee5e2896a246f749b19cc22f1`       |
| tree           | `7176490cf1965afcd43960e104a671d84c3ba6d2`                                  | `5150146e94f1a4ec8033643d0eb30d5767dd9a21`       |
| parent         | `276aa041bbf0ef0c5ad57050bfd7a52a1a66fb7c`                                  | `8c86276d5a4c24bd2052132bd8608ad9bb55fe4b`       |
| 复核范围       | `a4d73bb197ff1f715fcf6ea9f1fe1daae2c75030..7335386`，包含 parent 的恢复改动 | `8c86276..d1c52e3`                               |
| 只读源         | `<WORKER03_RECOVERY_CHECKOUT>`                                              | `<WORKER06_CI_CHECKOUT>`                         |
| 独立执行 clone | `/private/tmp/AlphaForge-M3-05-RECOVERY-7335386`                            | `/private/tmp/AlphaForge-M3-05-LOCAL-CI-D1C52E3` |

运行工具为批准的 Node 24.21.0 / npm 11.19.1，darwin arm64，macOS 26.6.2（25G83），Git 2.50.1（Apple Git-155）。Node 来自 `<APPROVED_FNM_NODE_24_21_0>`。03 clone 离线安装自身的 193 个锁定包；06 专项仅使用 Node 内置模块。两者均保留完整本地 Git 历史，SQLite 与依赖不共享可写数据。QA 报告编辑前 HEAD 为 `ab4fbb40c1b1d15707de946df73c078c4f27af35`。

03 交付接收时干净。06 源工作树存在两份 worker 所有的未提交 CI 方案文档，复核使用 `d1c52e3` 的已提交字节。该提交实际 author/committer 为 Macbeth01，而标题和 Agent-ID 为 Macbeth06；已向 01 报告身份来源不一致，保留原提交，不改写作者或历史。未来严格 LOCAL 身份入口需独立复核。

本轮没有推送、远程 PR 修改、GitHub Actions/Checks 执行或状态查询，没有新增安全服务调用、工具版本、签名、广播、部署或 Testnet 写入。

## 已执行验证

| 范围与实际入口                                                     | 结果                                | 原始证据                     |
| ------------------------------------------------------------------ | ----------------------------------- | ---------------------------- |
| 03：`node --test test/chain-store.test.ts test/chain-sync.test.ts` | PASS，66/66                         | `7335386-recovery-tests.log` |
| 03：`npm run typecheck`                                            | PASS，exit 0                        | `7335386-typecheck.log`      |
| 03：两提交累计 `git diff --check`                                  | PASS，输出为空                      | 只读命令回执                 |
| 06：`node --test test/local-ci.test.mjs`                           | PASS，14/14                         | `d1c52e3-runner-tests.log`   |
| 06：交付 `git diff --check`                                        | PASS，输出为空                      | 只读命令回执                 |
| 03：版本号/表名伪装但结构错误的 SQLite                             | FAIL：误报 HEALTHY                  | `recovery-schema.json`       |
| 06：assume-unchanged / skip-worktree 隐藏实际源码修改              | FAIL：绑定旧提交却执行新字节后 PASS | `local-ci-probes.json`       |
| 06：真实 FAIL 报告副本存在顶层 PASS + reason 矛盾                  | FAIL：回读 PASS                     | `local-ci-probes.json`       |
| 06：PASS 报告副本缺少必需执行结果字段                              | FAIL：回读 PASS                     | `local-ci-probes.json`       |
| 06：stdout 系统调用成功但只写入 1/16 字节                          | FAIL：执行和回读均 PASS             | `local-ci-short-write.json`  |

以上文件及完整最小复现脚本保存在 [证据目录](evidence/worker-delivery-review/)，字节数和 SHA-256 见 [清单](evidence/worker-delivery-review/SHA256SUMS.json)。脚本以 `.mjs.txt` 保存，避免把取证附件自动纳入产品执行源；复跑时复制到隔离临时目录并恢复 `.mjs` 后缀，使用上述固定 clone 路径和批准 Node。它们仅创建私有临时 fixture 仓库/数据库。原始输出未改写；负例只修改另外复制的 synthetic 报告并重算普通传输校验和，不修改仓库 PASS 证据。

03 既有用例实际覆盖空/旧/损坏源不迁移、不覆盖既有目标、并发 WAL writer 固定快照、失败目标清理、租约与回滚隔离以及 128-block 恢复。06 既有用例覆盖真实非零退出、超时、SIGTERM、遗留子进程、缺失/修改日志、过期源码/Node 身份、Windows NOT_RUN、脏源码、非法 job、校验和与未知状态。下面的额外发现不等于这些已通过路径全部失效。

## M3-05-P1-LOCAL-SOURCE-01 — 隐藏索引标记绕过源码绑定

- 严重性：P1；状态：OPEN；责任人：Macbeth06；影响：`OFFLINE_ACCEPTANCE_BLOCKER`，仅阻止该本地执行器的证据资格。
- Requirement：运行前后必须绑定实际执行源码与给定 commit/tree，脏源不得 PASS。
- 位置：`d1c52e3` 的 `tools/local-ci/runner.mjs:44-64`，尤其第 56 行。
- 前置条件与最小复现：在独立 fixture 提交 `check.mjs` 内容 `process.exit(7)`；对其设置 `git update-index --assume-unchanged`，再将工作字节改为 `process.exit(0)`；按该旧 commit/tree 运行。另对 `--skip-worktree` 独立复现。
- Expected：识别隐藏标记或真实字节不匹配并 BLOCKED。Actual：Git status 为空；runLocal PASS；verifyRun PASS；HEAD 源仍是 exit 7，实际执行源为 exit 0。
- 影响：旧提交可获得来自未绑定工作字节的成功结果。此处不要求防御同账号恶意并发者，仅要求工具声明的工作树绑定成立。
- 建议：拒绝隐藏索引标记，或对所有 tracked 实际字节执行可信比较；运行前后都验证，不能只靠普通 status。
- 复测：两种标记、前后源码修改均拒绝；干净精确源仍可 PASS。Fix SHA / 新 SHA 复测：待 01 回传。

## M3-05-P1-LOCAL-READBACK-01 — 回读接受矛盾或不完整执行结果

- 严重性：P1；状态：OPEN；责任人：Macbeth06；影响：`OFFLINE_ACCEPTANCE_BLOCKER`，仅阻止本地报告回读资格。
- Requirement：真实 FAIL / timeout / signal / missing log / NOT_RUN 不能被总体 PASS 覆盖，必需执行事实必须完整。
- 位置：`d1c52e3` 的 `tools/local-ci/runner.mjs:334-346`。
- 前置条件与最小复现：生成真实 exit 7 / FAIL 报告；另复制一份，保留 job FAIL/exit 7，只把顶层 state 改成 PASS，加入 reason，再重算 report.sha256。Actual：verifyRun 返回 PASS，因为 reason 跳过聚合一致性检查。
- 第二个负例：对独立 PASS 报告副本删除 signal、timedOut、leftChildren、processFailure、logFailure、startedAt、finishedAt、pid；回读仍 PASS，因为 undefined 被当作 false。
- Expected：矛盾或缺字段的证据必须 BLOCKED。传输 hash 正确只说明字节一致，不能证明内容满足 schema。
- 建议：严格校验必需字段及类型；带全局前置失败原因的报告只能遵循明确 BLOCKED 规则；对所有状态检查 job 事实与顶层聚合一致性。
- 复测：保留原真实失败，再对独立报告副本验证顶层/子项冲突、缺字段、类型错误、reason 分支、NOT_RUN 和日志缺失均不能 PASS。Fix SHA / 新 SHA 复测：待回传。

## M3-05-P1-RECOVERY-SCHEMA-01 — 表结构不合法仍恢复为 HEALTHY

- 严重性：P2；状态：OPEN；责任人：Macbeth03；影响：`OFFLINE_ACCEPTANCE_BLOCKER`，仅阻止恢复工具的完整健康声明。
- Requirement：只允许当前受支持 schema 的源，恢复后业务可读；不得通过迁移或改变源文件修复它。
- 位置：`7335386` 的 `tools/chain-recovery.ts:33-45`。
- 最小复现：创建结构完好的 SQLite，六个表名与工具 expectedTables 相同，但每张表只有 `unrelated TEXT`，设置 user_version=6；执行 restore 到不存在目标。
- Expected：源结构不受支持，拒绝且保留源字节。Actual：exit 0，输出 HEALTHY / schemaVersion 6 / integrity OK / content MATCH；目标查询 `SELECT block_number, block_hash FROM chain_checkpoints` 立即失败 `no such column: block_number`。源 SHA-256 前后一致。
- 影响：物理完整性和表名检查不能证明业务 schema，恢复成功报告可指向无法启动读取的数据。
- 建议：用当前 canonical schema 只读验证列、类型、主键/约束和索引等结构。不得构造会自动迁移源的 ChainStore 实例充当验证。
- 复测：缺列、错误类型、缺/错关键约束和索引、额外结构等负例；合法当前库恢复成功，源字节不变，并发 snapshot 和失败清理继续通过。Fix SHA / 新 SHA 复测：待回传。

## M3-05-P1-LOCAL-LOG-01 — 成功短写导致日志丢失但仍 PASS

- 严重性：P2；状态：OPEN；责任人：Macbeth06；影响：`OFFLINE_ACCEPTANCE_BLOCKER`，仅阻止完整 stdout/stderr 证据声明。
- Requirement：退出结果与完整日志同时留证，写入不完整不得伪装成功。
- 位置：`d1c52e3` 的 `tools/local-ci/runner.mjs:134-146`，第 142 行忽略 writeSync 返回值。
- 最小复现：仅在独立 fixture 进程里替换 Node fs.writeSync，并用 syncBuiltinESMExports 使导入绑定更新；一次正常返回的写入只落盘首字节。子进程原输出 `complete-output\n`（16 字节）。不模拟磁盘满、不破坏实际主机资源。
- Expected：循环写完或 fail closed。Actual：日志仅 `c`（1 字节），logFailure=false，runLocal PASS，verifyRun PASS。
- 建议：处理返回字节数，循环推进直到全部写完；零字节进展或异常必须有界终止并标记失败。
- 复测：stdout/stderr 多次短写完整保存；零进展/抛错不能 PASS；日志 byte/hash 与真实采集字节相符。Fix SHA / 新 SHA 复测：待回传。

## 下一步与未验证项

01 已接收前三项并分派 03/06 修复；第四项和回读缺字段细节也已回传。待准确修复 SHA 后，05 复跑原负例及相应回归，保留本次红色证据。04 新浏览器交付 `f26e919a3fea4117318f153ce781c725764f6a92` 已接收，但不在本报告的已验证范围。

最终统一候选、正式覆盖率方法准入及复跑、原生 Windows 复测、托管门禁、治理批准与 Testnet 各自保持原有状态。不得把本轮的 66/66 或 14/14 等同整体 Phase 1 通过。

## 后续授权更新

本次初始取证后，01 回传用户已将仓库设为 public，并授权恢复正常 PR 验证；由 01/06 统一核对和安排托管执行。05 继续本地复核，不自行重复触发 CI。上述历史未执行记录保留，不再将此前暂停解释为持续有效的用户禁令。

## 03 修复复验：`ac266ca`

修复 HEAD `ac266cac8aaf5f2c045f4cc96b3a2145c2fa1a43`，tree `f9bdcaddb34849ee5b5e6e2766ec69d0bdbc517b`，parent `733538600fb2c643afbfe5e13e3c9de9b7dbbd67`。05 从原本地 worker 获取新增对象后，在自身隔离 clone 切换到准确修复提交；该 clone 名仍带旧 SHA，执行结论以这里实际 HEAD 为准。旧红证据和原脚本不改写；复跑旧脚本时应先检出其记录的旧 SHA。

独立 `node --test test/chain-store.test.ts test/chain-sync.test.ts` 为 **79/79 PASS**；`npm run typecheck` 和修复 diff check 通过。新增 12 类畸形 schema 分别执行 backup/restore，均验证源文件字节保持不变、目标不存在、错误分类正确。此前的并发 snapshot、旧/损坏库拒绝和失败清理用例继续通过。05 自有原始“六张单列假表”负例另行复跑：exit 1、`CHAIN_RECOVERY_SOURCE_UNSUPPORTED`、stdout 为空、sourceUnchanged=true、targetExists=false。

实现将规范迁移仅应用到独立 `:memory:` ChainStore，输入仍由 readOnly DatabaseSync 打开，并在同一 BEGIN 读事务内验证 schema 和内容。源和恢复目标均比较当前 sqlite_schema 的 type/name/tbl_name/sql，覆盖列、类型、主键、约束、索引及额外应用对象；SQLite 内部对象排除。该方案是精确 DDL 准入，明确拒绝手工重建但语义相近的定义；这项边界已写入恢复文档，未扩大到任意 SQLite 格式转换。

`M3-05-P1-RECOVERY-SCHEMA-01` 更新为 **PASS_AT_AC266CA / FINAL_INTEGRATION_PENDING**。这仅关闭该 worker 修复上的具体 P2，06 三项仍 OPEN。原始日志、独立负例和哈希清单见 [修复证据](evidence/recovery-schema-retest/SHA256SUMS.json)。已回传 01，由经理纳入准确统一候选后完成最终复验。

## 06 修复复验：`c817e94`

修复 HEAD `c817e94163c14b882b67cfa53400cae032a9a4f4`，tree `7d51f4efd5d92abb1c19fc71b00a64fe8e93c7f1`，parent `16d78684d12fa9cb3659685d13588071bce2aa8e`。05 的原隔离 clone 获取本地对象后准确切换，运行 `node --test test/local-ci.test.mjs` 为 **19/19 PASS**；diff check 通过。新提交 author 和 Agent-ID 均为 Macbeth06，旧提交作者差异继续保留声明。

05 自有脚本另行执行 **22 项负例/对照，全部符合预期**：真实 exit 7 保持 FAIL；顶层 PASS + reason / 子项 FAIL 拒绝；assume-unchanged 和 skip-worktree 隐藏源均 BLOCKED；逐项删除 10 个执行结果字段及 4 个错类型均 BLOCKED；stdout/stderr 成功短写循环保存完整 16 字节，零字节写入均 BLOCKED 且 logFailure=true。

首次运行自有复验脚本时，清除 skip-worktree 后仅执行 git checkout 未恢复原工作字节，后续“干净对照”被执行器正确拒绝。检查 fixture 文件确认仍为 exit 0；在脚本复位步骤显式从 HEAD 写回原字节并刷新索引后，全部复验通过。这是测试夹具复位纠正，未修改 worker 实现或放宽断言。原始失败发现仍保存在前一证据目录，修复脚本及本次结果独立保存。

实现现在拒绝隐藏索引标记，逐个比较 tracked 文件内容的 Git blob 身份和执行位，并在运行前后校验；本地入口刻意只接受常规文件，符号链接/不支持的 tree 项保持 BLOCKED。回读强制完整字段及类型，按真实退出、超时、signal、日志/清理事实推导子项结果；只有明确 BLOCKED 的前置失败可以携带 reason，不能覆盖成 PASS。短写处理必须取得正向有界进展。它仍是可信本地工作区上的过程证据，不宣称同一 OS 账号间的独立认证。

`M3-05-P1-LOCAL-SOURCE-01`、`M3-05-P1-LOCAL-READBACK-01`、`M3-05-P1-LOCAL-LOG-01` 均更新为 **PASS_AT_C817E94 / FINAL_INTEGRATION_PENDING**。证据及哈希见 [执行器复验](evidence/local-runner-retest/SHA256SUMS.json)。已回传 01。新增 LOCAL 身份入口 `62444c8` 的审查与此分开记录。

06后续 `62444c8` LOCAL身份入口独立58/58通过，见 [身份入口复核](LOCAL-IDENTITY-REVIEW.md)；04 `f26e919` 浏览器独立复跑通过，见 [浏览器复核](BROWSER-DRIVER-REVIEW.md)。

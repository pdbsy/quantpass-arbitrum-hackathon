# AlphaForge：本地 CI PoC 及实际证据

> 2026-09-21 状态更新：用户已自行将仓库公开，并授权恢复GitHub只读核查与正常PR验证；由01统一调度，06不自行push/rerun。下文预算暂停阶段的记录保留为历史，不再表示当前全面禁止查询。merge、部署、规则变更、新服务/larger runner仍未授权。执行器初版证据已被05提出P1/P2；当前修复证据见CI-LOCAL-POC末尾追加，不以初版PASS代替复核。

Macbeth06 / M3-06-CI-GATES；2026-09-20。已完成限定范围的一次性本地执行器与真实验收。**14/14 新回归通过；固定项目源码31/31回归和三个现有检查脚本通过；负向场景全部按预期拒绝。** 不等于完整工程/覆盖率验收，更不等于 GitHub required checks、独立安全批准或 READY_TO_MERGE。

本轮方案是 L1。没有安装编排服务、开放端口、注册 App/runner、注入状态凭据、触发或查询 Actions/Checks、push、PR/ruleset写入或链上操作。仅有官方公共资料研究和本地工作；不声称关闭了账户上其他自动任务。账单实际原因 UNKNOWN。

## 来源和实现边界

| 项目 | 准确值 |
| --- | --- |
| Worker起点 / 分支 | `8c86276d5a4c24bd2052132bd8608ad9bb55fe4b` / `macbeth06/m3-phase1-gates` |
| 项目真实子集的base | `18f5352070910a867b9729b031aa2e3951785e01` |
| 真实子集的head / tree | `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8` / `6f1a21845a99e16a0ba171612cd97e9bf3439294` |
| 新文件范围 | `tools/local-ci/runner.mjs`、`tools/local-ci/run.mjs`、`test/local-ci.test.mjs` 和本轮五份文档；在worker起点及指定source均不存在，无同路径覆盖 |
| 执行环境 | Darwin26.6.2 arm64、Node24.21.0、npm11.19.1、Git2.50.1 (Apple Git-155)、fnm1.39.0；本机Python3.12.9仅探针，未用于此PoC |
| 隔离源码 | `.checks/macbeth06-local-ci/alphaforge-source` 独立Git仓库、完整可达历史、分支`macbeth06/local-ci-source`；自己的node_modules；不把经理混合历史merge到06分支 |
| 依赖 | Node内置模块实现；既有193个本平台npm包从合格本地缓存以`npm ci --offline --ignore-scripts --no-audit --no-fund`安装；不新增依赖、不运行安装脚本 |

新执行器14项回归在06工作目录运行，实际项目31项在独立3a78e34副本运行，两种源码范围分别记录。最终本地commit/交付包摘要由06交付回执给01，不在文档中自引用未生成的commit。manager集成后的新H必须重新验证。

## 接口及本地使用

`runLocal({cwd, outputRoot, expected, jobs})` 返回报告；`verifyRun(directory, expected)` 返回本地完整性状态。`expected={base,head,tree,node}`，均指定准确值；job指定`id, executable, args, platform, arch, timeoutMs`。CLI只接受一个操作者审核的本地JSON文件，不读取项目自动配置、不监听事件、不自动重跑：

```sh
fnm exec --using=24.21.0 node tools/local-ci/run.mjs /absolute/path/reviewed-local-config.json
fnm exec --using=24.21.0 node --test test/local-ci.test.mjs
```

配置形状如下。占位路径须换成已有独立源码、批准的Node绝对路径和准确SHA，不得把示例直接当作可执行验收记录。

```json
{
  "cwd": "/absolute/path/alphaforge-source",
  "outputRoot": "/absolute/path/local-evidence",
  "expected": {"base": "<40 hex>", "head": "<40 hex>", "tree": "<40 hex>", "node": "24.21.0"},
  "jobs": [{"id": "local-regression", "executable": "/absolute/path/approved/node", "args": ["--test", "test/ci-gates.test.mjs"], "platform": "darwin", "arch": "arm64", "timeoutMs": 90000}]
}
```

CLI退出：PASS=0，FAIL=1，BLOCKED/NOT_RUN=2。没有后台服务模式。14项测试独立于package.json现有总测试列表；01拥有注册脚本/正式政策的编辑边界，06没有偷偷修改package.json或CI工作流。

执行前后确认完整非shallow历史、无replace refs、tracked clean、base存在且为head祖先、精确head/tree及Node。每个run独立目录，日志/报告用独占创建；记录实际命令manifest、executor/Node/命令二进制SHA-256、source、开始结束、exit/signal/timeout/cleanup和stdout/stderr字节摘要。私有HOME/TMP位于系统临时区并在返回前删除，清除继承的GitHub/SSH/token环境；不向子命令传入任意调用者env。日志合计上限4MiB，超限BLOCKED。POSIX进程组超时先SIGTERM，再SIGKILL；父进程提前退出但留下子进程会BLOCKED并清理。未确认清理不能PASS。

回读核对报告摘要、源码/工具/manifest、合法状态、job身份、平台匹配、退出结果、日志内容与文件类型。需要准确执行器和工具二进制才能验证该版本的旧报告；新版代码不应改写旧report以“恢复通过”。`report.sha256`是本地一致性校验，不是防同账户攻击的签名，也不是独立治理证据。

## 实测结果及可定位证据

统一证据根 `.checks/macbeth06-local-ci/`；最终汇总 `acceptance-delivery.json`，观察于 **2026-09-20T11:16:08.357Z**。所有旧运行保留，故只按本表准确目录取最终证据。

| 场景 | 实际结果 | 对应run（位于`runs/`） |
| --- | --- | --- |
| 真实源码4条命令 | PASS：31/31回归；source-policy111文件/1,057,713字节、0错误/告警；governance；supply | `run-Oty8Qs` |
| 明确命令失败 | FAIL、exit7、cleanup PASS | `run-aUijar` |
| 后续独立成功 | PASS、exit0；没有覆盖原失败 | `run-sYlq5D` |
| 超时 | FAIL、timedOut=true、SIGTERM、cleanup PASS | `run-qAYtkQ` |
| 异常信号退出 | FAIL、SIGTERM、cleanup PASS | `run-L3mI6Y` |
| Windows与Linux原生平台不可用 | 两项均NOT_RUN，无执行pid | `run-iG3TYK` |
| 删除专用合成成功run的stdout | 回读BLOCKED；保留原report，明确为破坏性负例 | `run-Uh12ww` |
| 失败历史保留 | 原exit7报告摘要未变，仍回读FAIL | `acceptance-delivery.json`中的failure-preserved |

真实源码report SHA-256：`680907d0e7ca7e1397a63f940cc0d8ff0a787141c47222011af4777be87302aa`。精确四条命令：

```sh
node --test test/security-scanners.test.mjs test/ci-gates.test.mjs test/m3-injected-runtime.test.ts
node tools/ci/check-source-policy.mjs
node tools/check-governance-v2.mjs
node tools/check-supply-chain.mjs
```

31项由scanner逻辑16、CI gate逻辑10、injected runtime5构成。不是全量scanner运行，不是代码覆盖率计算，不是完整npm run check。source-policy报告的runId/attempt/imageVersion为null，诚实保留本地身份。

新执行器回归日志 `green-delivery.log`：14项、0失败/跳过/取消，26.160秒。涵盖真实临时Git仓库与子进程：成功和工具/源绑定、剥离凭据、失败保留、拒绝SIGTERM的超时进程清理、异常信号、父退出残留子进程、缺失/篡改日志、错误HEAD/tree/Node、平台NOT_RUN、tracked源码修改、空任务/缺执行文件/无效超时、仓库外临时目录、报告篡改/陈旧源，以及重算校验和后未知job状态仍BLOCKED。格式检查和ESLint使用现有锁定工具通过。

## 保留失败及修复理由

- `red.log`：实现前接口缺失；后续初次GREEN的残留子进程测试暴露Darwin结束中进程组短暂EPERM。实现不把EPERM当清理成功，等待组消失，否则BLOCKED。单次系统诊断支持该解释；没有反复提升权限绕过失败。
- `runs/run-bMSrJ1`：真实源码30/31，缺历史负例意外发现父Git仓库；另三脚本通过。其私有TMP原在run目录内。
- `runs/run-xdICra`：仅加Git ceiling仍30/31，因为既有扫描器自行净化环境而去掉该变量。`temp-red.log`、`temp-sanitized-red.log`保留对应先失败回归。随后将私有HOME/TMP放到系统临时区，两个问题一起解决。
- `acceptance-v2.json`：上述隔离修复后31/31。交付前结构审查又发现未知job状态需要显式拒绝，`schema-red.log`先失败，补齐合法状态/身份/可执行文件回读后产生最终`acceptance-delivery.json`。旧报告及日志未被覆盖或改成PASS。

原始错误报告可能包含项目测试断言数据，按私有项目证据保存，只向已授权01交付；不上传公共服务。

## 资源与清理实测

宿主11可用逻辑CPU/36GiB内存。最终完整PoC接受序列墙钟15.226秒；Node `process.resourceUsage()` 给出执行器自身maxRSS **536,784KiB（约524MiB）**、userCPU1.718秒/systemCPU0.592秒。此值不包括所有子进程合并峰值，不能外推为九job容量。二进制摘要会增加内存开销，串行执行适合当前小规模用途，不提供并发吞吐承诺。依赖目录本机实测约123MiB；日志/报告远小于完整构建制品。

每个已执行最终job cleanup均PASS；测试对超时/残留子进程用存活探针确认ESRCH。交付索引还记录最终run的pid/进程组清理复核和临时目录残留探针。未启动服务、守护进程、容器或端口；不删除证据目录来假装无残留。输出报告、日志与独立源码副本是有意保留的交付物。

## 未覆盖及下一步

只支持已审阅的可信本地命令。相同操作系统账户仍可能通过绝对路径读取宿主文件；环境剥离不是OS隔离；恶意进程另建session、执行器被SIGKILL或系统掉电也超出当前清理保证。无法可靠清理时必须由独立环境销毁机制兜底，故不能把这个PoC用作不可信公开PR运行平台。

Windows supervisor尚未实现资格验证；Linux supervisor未做本机实测。新平台缺失标NOT_RUN。全量工程、正式覆盖率、合约、浏览器、完整scanner及最终安全/治理由各自任务和准确最终候选证据裁决。本轮自审不能代替独立review；已交付给01评审与集成。其他文档：[九job映射](CI-GATE-MAPPING.md)、[方案比较](CI-ALTERNATIVES.md)、[接回方案](CI-RECONNECT-PLAN.md)、[Windows调查](WINDOWS-PROCESS-FAILURE.md)。

## 执行计划完成记录

先写真实Git/进程负向测试并保留RED，再实现runLocal/verifyRun/CLI，随后在独立准确源码上验收并保留失败，最后交付五份文档和本地commit/证据包。上述实现与限定验证已完成；不选择push/PR/merge路径，不新建worker。package脚本注册、完整最终候选独立复验及所有外部准入仍由01在相应授权下处理。

## 交付包与重放说明

首份代码交付为 `d1c52e32510f2efee5e2896a246f749b19cc22f1`，8个新增文件。只增补的交付/参数说明可能有后续06提交，需按最新回执选取；不改写这个已交付提交。`.checks/macbeth06-ci-delivery/DELIVERY.json`记录以下首份包的长度/摘要：

- `macbeth06-local-ci.bundle`：06分支完整历史，SHA-256 `002768d3c80916b54fbf11d23a6ac8ad36c6c62a9d3ce7abaf580ff10a99fb4b`。
- `alphaforge-source-3a78e34.bundle`：被测源完整历史，SHA-256 `bb0f2a65dfd36569486f27e3e0adf206e18d31fa7b3ed9af73951e92dad4a760`。
- `local-ci-evidence.tar.gz`：配置、接受脚本、全部PoC成功/失败日志、报告、公开研究原件和`EVIDENCE-INDEX.json`；不含node_modules/钱包/凭据，SHA-256 `7d60d0101aaebbe07b91beaa820365f12345857a6bf73c3fbe0ffcce27e1b899`。

两个bundle均经`git bundle verify`确认完整历史。证据索引自身SHA-256 `119f677ce23c985256e17a6db7ed86c75c2db9a258161ac99922dd50ffd86e50`；最终接受汇总SHA-256 `94a1074f008be543e566f33ec6030fd795763e69fb2e9e14e19f03d51b6599c1`。包外摘要经已授权01交付，仍不等于独立可信签名。

重放分为“只读核验旧产物”和“重新执行产生新产物”，不能把路径改写后的JSON叫作原始证据：

1. 从回执取得准确包和摘要，先SHA-256核对，再`git bundle verify`。在新的独立临时目录恢复两个仓库，分别checkout准确06代码commit和3a78e34；不得复用可写node_modules/SQLite。保留bundle中的完整历史，不浅克隆、不replace refs。
2. 解压证据包到独立目录，逐文件核对EVIDENCE-INDEX中的bytes/sha256；`run-Uh12ww`缺stdout是预先声明的负例，不补造该日志。初始失败、各版接受汇总和最终运行目录都保留。索引只覆盖文件一致性，不能推导run成功。
3. 原位置可以用精确Node24.21.0加载同版runner，向`verifyRun(originalRunDirectory, expected)`传入上述base/head/tree/node；期望按最终表返回PASS/FAIL/NOT_RUN/BLOCKED。回读会检查原manifest中的绝对可执行路径及摘要。另一台机器缺少该路径/二进制时，旧报告回读BLOCKED是正确的；仍可离线核对归档字节，但不能把它伪装成本机执行证明。
4. 重新执行时，先验证本机原生OS/arch和精确Node/npm。只为独立3a78e34源码安装自己的锁定依赖；可用`npm ci --offline --ignore-scripts --no-audit --no-fund`，缺合格缓存就BLOCKED，不能自动联网/升级补齐。执行器测试仅用Node内置模块；新增14项的准确命令在上文。
5. 复制`configs/*.json`为**新配置**，只修改`cwd`、新`outputRoot`及已核验Node的`executable`；expected保留准确被测源与版本。可信任务平台仍保留darwin/arm64：不同平台先NOT_RUN，不为追求PASS修改目标。用CLI执行每份配置，逐项保留退出0/1/2；不要用shell吞掉失败后只记录最后一个成功。
6. 按接受脚本同样的8类场景复验。缺日志负例仅删除新建合成run的stdout；不破坏原归档。新run应产生新的随机目录/时间/摘要，不要求与旧日志逐字相同。检查失败report未变、所有子进程/组已退出、私有temp已清理，保存新接受汇总，并明确本机源码与环境。

当前worker工作区无tracked改动。01集成时应以已审核06 commit及其8文件变更为来源记录，保留作者/Agent-ID/Task-ID；不要把真实源bundle的经理混合历史合并进普通worker分支。05的执行器审查及01集成复验独立记录，不能由本页预先赋予PASS。

## 2026-09-21 独立审查问题修复追加

05经01回传初版两个P1及一个P2，初版不能据14项PASS放行。此次修复使用追加提交，原d1c52e3及原报告不改写；05的最终复核结论仍须独立记录。

- P1：拒绝所有assume-unchanged/skip-worktree等非普通index标记；执行前后逐个tracked普通文件计算Git blob摘要并与准确HEAD tree比较，同时核对执行位，拒绝symlink路径/不支持的tree类型。记录trackedSnapshotSha256；不依赖status隐藏规则。原始字节比较要求checkout实际字节与tree一致，CRLF转换/过滤器生成副本不能冒充原始源验收。
- P1：报告回读要求pid、起止时间、退出码/信号、所有timeout/process/log/children布尔字段和cleanup等存在且类型合法，重新推导每job状态。顶层reason只能描述合法BLOCKED条件，无法令FAIL聚合变PASS；缺少tracked snapshot摘要也阻塞。摘要校验仍不具备独立签名效力。
- P2：stdout/stderr逐次检查writeSync返回长度并循环补写；零/负/无效返回、写入错误或日志上限导致BLOCKED，不能以部分字节日志PASS。

新增真实负例先RED，保存在 `review-p1-red.log`、`review-fields-red.log`、`review-snapshot-red.log`、`review-short-write-red.log`。短写故障注入初稿误拦截报告写入，测试卡住；已精确终止该测试进程并保留 `review-final-green.log`（失败，不能作GREEN）及 `review-zero-write-fixture/`。故障注入已限定为合成stdout/stderr载荷，不再干扰Git/报告文件；该修正未改变生产逻辑。

当前最终 `review-final-delivery.log`：**19/19 PASS，0跳过/失败，37.659秒**；含assume-unchanged和skip-worktree的tracked `exit7→exit0`复现、reason改PASS、逐字段缺失/错类型、两个日志通道的短写/零写。Prettier/ESLint通过。

同版执行器的真实源码及负向接受序列重新执行：`acceptance-review-final.json`，观察2026-09-20T16:04:04.598Z（北京时间09-21）。真实源仍是3a78e34/tree6f1a218；31项子集及3检查脚本通过。当前真实源run=`run-BgRpqX`，report SHA-256 `126fbb69f0f8add19c9eb9be95c0cdd7c231f7326d7cf1e2ee7fffddc18214f7`。命令失败`run-AMK9m5`仍FAIL，后续成功`run-Y31iAJ`未改写它；超时`run-CZZ6Cn`/信号`run-gCtlit`为FAIL；平台`run-9Ceqhk`为NOT_RUN；缺日志`run-hQXxlH`为BLOCKED。新序列14.237秒、执行器自身maxRSS665440KiB，不能外推九job容量。

交付来源声明：d1c52e3及16d7868的实际Git author/committer均为工作区原有`Macbeth01 <Macbeth01@users.noreply.github.com>`配置；subject/Agent-ID/Task-ID标注的是执行本任务的Macbeth06。两者不一致已披露，历史原样保留，不伪称原Git作者是06。此后06自己新增提交采用命令级`Macbeth06 <Macbeth06@users.noreply.github.com>`，不修改全局配置或重写历史。旧bundle与索引继续保留；修复后交付使用新增版本包/清单。

## 2026-09-21 LOCAL 经理身份入口交付

01追加授权后新增 `verifyLocalManagerIntegration(root,{branch,head,base})` 及独立 `tools/check-local-agent-integration.mjs`。它只接受目标 `macbeth01/m3-phase1-closeout` / `M3-01-PHASE1-CLOSEOUT`，读取**准确head内** `docs/management/agents/integrations/M3-01-PHASE1-CLOSEOUT.local.json`，不接受工作区未提交清单、不回退hosted manifest。真实清单由01维护，06未修改。

LOCAL清单保留schema_version1/repository/branch/task/base/sources，新增必需`provider: "LOCAL"`；每条source必须包含agent/task/branch/head/`local_ref`。local_ref准确形式为`refs/remotes/local-macbethXX/<branch去掉macbethXX/后的后缀>`，必须是非symbolic直接ref，解析commit**等于**pin的完整40位head，不能用后来的分支tip代替。base作为CLI显式准确pin且与清单一致；完整历史、base→source→candidate祖先关系、每提交Agent-ID/Task-ID、source tip身份、02–05各自来源和全部外来历史登记仍须通过。拒绝replace/graft历史；读取Git时不继承GIT_*覆盖。

```sh
fnm exec --using=24.21.0 node tools/check-local-agent-integration.mjs \
  --branch macbeth01/m3-phase1-closeout \
  --base <准确固定base的40位SHA> \
  --head <已经提交local清单的候选40位SHA>
```

输出只含LOCAL来源统计、`githubStatus:false`、`independentAttestation:false`；失败退出1、BLOCKED说明。检测到GITHUB_/ACTIONS_/RUNNER_上下文拒绝执行。canonical origin URL仍核对，但LOCAL不读取或制造origin/source替代物，也不把成功映射为GitHub PASS。

04从经理3a78e34派生的堆叠历史使用独立source条目：`agent=Macbeth01`、`task=M3-01-PHASE1-CLOSEOUT`、`branch=macbeth01/<固定checkpoint后缀>`、`head=3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`、匹配的`refs/remotes/local-macbeth01/<同后缀>`。checkpoint名称必须不同于目标经理分支，同时保留所有原02–05来源登记；源历史里每个外来提交都必须落在独立pin的对应来源范围内。只登记04tip而省略01 checkpoint或其head pin会拒绝；不改写04历史。

用户公开仓库并恢复验证后，01另行授权hosted06最小扩展：仅已登记的`M3-01-PHASE1-CLOSEOUT`目标可接受`Macbeth06/M3-06-CI-GATES`来源。默认`verifyManagerIntegration`仍只读原`${task}.json`、真实`origin/master`和`origin/<source.branch>`，要求pin可达及完整元数据/祖先；拒绝LOCAL provider/local_ref，不接受调用参数切成LOCAL。其他经理任务和错误06任务均拒绝。06没有修改MANAGER_INTEGRATIONS注册表或默认check-agent-identity.mjs；经理已有phase1注册由01维护，测试仅在临时fixture复现该已登记配置。

TDD：`.checks/macbeth06-local-identity/red.log`先证明LOCAL接口缺失；`hosted06-red.log`先证明默认hosted不支持06。最终`hosted06-green.log` **58/58 PASS，0跳过/失败，16.797秒**，包括新LOCAL/hosted06、原22项经理集成及原bypass/lifecycle边界回归。覆盖缺ref/错namespace/先进ref/symbolic、准确base、hosted不fallback、外来提交、错误06任务/目标、固定01checkpoint有无pin、committed manifest/replace防护、CLI显式参数及hosted上下文拒绝。Prettier/ESLint通过。

这是可复核的本地工程结果。01实际最终集成清单与远程origin来源仍须准确候选验证；05审查结论、正式GitHub门禁和有效review不能由这58项单元回归预先宣布通过。

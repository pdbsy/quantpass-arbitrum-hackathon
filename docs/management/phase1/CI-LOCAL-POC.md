# AlphaForge：本地 CI PoC 及实际证据

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

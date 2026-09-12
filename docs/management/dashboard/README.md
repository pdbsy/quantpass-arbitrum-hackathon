# AlphaForge Control Center 操作指南

Control Center 是一个只读、证据驱动的中文静态看板。它从仓库内允许的数据源生成快照，不提供写入 API，不提交交易，也不会把缺失或过期证据显示成成功。

## 安全边界

- 看板服务固定为 `http://127.0.0.1:4181`，项目演示固定为 `http://127.0.0.1:4180`。
- 两个服务都不得绑定到 LAN、`0.0.0.0`、公网地址或代理出口。
- 看板服务器只接受 `GET` 和 `HEAD`，并校验实际回环端口对应的 `Host` 请求头以防 DNS rebinding。
- 不要把 `.env`、钱包、私钥、助记词、Cookie、访问令牌或带凭证的 URL 写入管理文档。
- `docs/management/dashboard/data/*.json` 是生成物，带有 `doNotEdit` 元数据；不得手工编辑。
- 单次来源收集共享固定工作预算：最多 256 个目录条目、128 个来源文件、4 MiB 总内容及每文件 1 MiB；超限会以 `DATA_SOURCE_ERROR` 失败关闭。目录通过有界 `opendir` 迭代，文件增长越过打开时边界也会被拒绝。

## 标准工作流

先在仓库根目录运行真实检查并记录证据：

```bash
npm run management:checks
```

这是完整证据采集，会把有界、脱敏且绑定 Git 命名分支、提交和精确 tree 的报告写入 `.checks/management/latest.json`；该清单需要和生成的看板一起纳入版本控制，逐项运行日志仍由 Git 忽略。采集只能从干净命名分支开始，并在每个检查后及发布清单前确认分支、提交、tree 和工作区均未变化；否则中止且保留上一份清单。原始清单必须与 `quick` 或 `full` 注册表完整、唯一且顺序一致，所绑定提交/tree 必须存在并属于严格验证的源分支祖先链；缺失、畸形、不完整、乱序、旁支提交、任意后续代码变更或伪造不可用检查状态都会失败关闭。不可用的 Foundry、fuzz、invariant 或 Slither 工具链必须保持 `NOT_RUN`，不能根据脚本存在推断为通过。

仅需较快的本地证据时可运行：

```bash
npm run management:checks:quick
```

生成提交用静态快照：

```bash
npm run management:build
```

检查已提交快照是否与仓库来源一致：

```bash
npm run management:check
```

该命令只验证，不运行证据采集，也不应修改文件。主 `npm run check` 门禁会在规划一致性检查之后、Web 构建之前执行它。干净 checkout 中如果版本化报告缺失、绑定到无关 Git 历史、branch/commit/tree 不一致或生成物漂移，检查必须失败；不得从待校验的看板生成物反向重建 PASS 证据。报告提交到快照源提交之间的每个线性过渡提交都只能改动 `.checks/management/latest.json`，快照记录提交到当前逻辑分支头之间的每个线性过渡提交都只能改动两个生成 JSON；中间修改后再回滚同样会使证据失效。

Git 查询全部使用无 shell、固定参数和有界输出。`git ls-files -v -z` 会拒绝 tracked `assume-unchanged`、`skip-worktree` 及其他非正常 index 状态；当前 checkout 的 clean state 也会重新读取验证。GitHub push 只通过精确的 `refs/remotes/origin/master` 解析 CI 基线，并使用 `git merge-base` 证明来源与基线属于共同历史；不要求当前 base tip 必须是 source head 的祖先，因此 base 后续推进形成的正常分叉仍可验证。Pull request 的 detached checkout 会把 GitHub 临时 merge commit 与逻辑 PR head 分开处理：精确 merge ref、两个父提交、远程 PR head 与记录提交必须共同吻合。线性历史合入后的本地或 GitHub `master` checkout 还必须保留精确源分支 ref，并证明源分支与集成提交的 tree 完全相同。版本化清单是可审阅的历史记录，不是不可伪造的外部证明；发布/合并授权必须以 GitHub 上实际执行命令的受保护必需检查为准。

PR 检查仅支持精确 `origin/<source-branch>` 存在的同仓分支。Fork PR 会有意 fail closed；外部贡献必须先复制到经审阅的同仓分支，随后重新采集 commit-bound evidence。

公开元数据最小化检查可单独运行：

```bash
npm run privacy:check
```

它扫描 Git 跟踪及未忽略、未跟踪的有界文本文件，阻止单文件或相关管理记录组合出的主机/SSH 身份画像，并且错误输出只包含文件名与类别，不回显匹配值。扫描器最多迭代解析八层 JSON 字符串包装；它会解码有界的 YAML 双引号 key，并在敏感 identity/SSH 字段使用 block scalar、alias、anchor 或 tag 而无法安全判定时失败关闭。代码检查只组合有界、literal-only 的静态字符串和值或 computed key，不执行被扫描代码；超出 part、空白、长度或扫描次数预算会返回结构化记录错误。

看板在最终写盘前还会对完整快照再次递归脱敏。已识别 `kty` 的 JWK 只按上下文删除 private members，普通无关对象中的短字段 `k`/`d` 不会被过度删除；`ssh-dss` 公钥和 certificate 会与其他支持的 OpenSSH key 形式一同脱敏。超限或无法安全解析的结构化字符串失败关闭。生成物和检查证据写入器都会在写入前逐层拒绝符号链接父目录。

启动只读本地服务：

```bash
npm run management:serve
```

然后手动访问 `http://127.0.0.1:4181`。服务拒绝非回环绑定、非匹配 `Host`、修改方法、目录穿越、点文件、未知 MIME 类型以及逃逸根目录的符号链接。

## 状态解释

- `PASS` 表示版本化报告记录该命令在所绑定提交上通过；`management:check` 验证其结构和 Git 归属，但独立执行证明来自 GitHub 必需检查，而不是静态看板本身。
- `BLOCKED` 表示存在阻塞或检查证据与快照提交不一致。
- `NOT_RUN` 表示检查没有运行或批准的工具链不可用。
- `NOT_AVAILABLE` 表示可选来源不存在。
- `DATA_SOURCE_ERROR` 表示来源存在但无法安全读取或验证。

生成后应审阅 `data/build-log.json` 的诊断列表；缺失的 Manager、Worker A、决策、工作队列或变更日志来源会继续明确显示，不得用 Git 历史或推测内容代替。

## Windows 文件读取边界

POSIX 平台保留 `O_NOFOLLOW`。Windows 不提供该标志，扫描器会在读取任何内容前，把原路径的非零 BigInt 文件身份与打开句柄、当前路径逐一比较，并验证 canonical 路径与符号链接状态；无法取得稳定身份时失败关闭。读取后的文件身份、大小和时间检查继续保留。该控制不声称隔离具有相同系统写权限的并发进程。

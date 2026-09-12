# QuantPass 开发工具链对齐与环境准入规范

**macOS 原生开发 · Robinhood Chain Testnet · 多 Codex 协作**

| 文档属性 | 内容 |
| --- | --- |
| 文档版本 | 1.0.0 |
| 编制日期 | 2026-09-12 |
| 建议仓库路径 | `docs/DEVELOPMENT-TOOLCHAIN.md` |
| 适用仓库 | `pdbsy/quantpass-arbitrum-hackathon` |
| 事实核对基线 | `master` / `5f223039b84f941d8f5c34d245f87c85c676b02a` |
| 文档状态 | **PROPOSED：规范已编制，尚未由本次工作实施或验收** |
| 当前能力边界 | 本地模拟器；Robinhood Chain Testnet 元数据校验；不签名、不广播交易 |
| 管理原则 | Macbeth 负责规划、拆分和审查建议；具体任务由用户分配；Darwin 暂不参与，直到用户另行授权 |

> 本文是一份可落地的工程规范，不是“已经通过工业级安全认证”的声明。写入文档不等于对应控制已实现。文中明确区分现有能力、拟新增能力与未来能力；未实施、未运行或无法验证的项目不得标记为 PASS。
>
> **本规范不授予任何新的 merge、部署、签名、资金操作或系统管理员权限。** 历史阶段的授权不得自动扩展到新的开发任务。以下文件路径及命令的工作目录，除特别说明外，均相对于仓库根目录。

---

## 1. 核心决策

本项目统一的是**实际执行的工具版本、依赖来源、文件规则、验收命令和证据语义**，不是要求所有设备运行相同操作系统。

| 事项 | 本规范的决定 |
| --- | --- |
| 日常开发 | macOS 原生开发；Apple Silicon 使用原生 arm64 工具；Intel Mac 保留独立验证路径 |
| Node 管理 | macOS 统一采用 fnm 激活仓库指定的 Node；不把 Homebrew 的滚动 Node 当项目版本源 |
| 包管理器 | 仅 npm；一个根 `package-lock.json`；不自行引入 pnpm、Yarn 或 Bun |
| 安装入口 | `npm ci --ignore-scripts`；工具链引导安装与项目依赖安装分开处理 |
| 质量门禁 | 延续当前 `npm run check` 和已有安全检查；新增检查必须真正接入 CI |
| 跨平台验收 | 保留 Linux、Windows；新增 macOS 必需检查，不以“主要在 Mac 开发”为理由删除 Windows 验证 |
| 容器化 | 非第一阶段必选项；不强制迁移到 Docker、远程 SSH 主机或 Kubernetes |
| 链上范围 | 默认 local/mock；Testnet 只读接入与 Testnet 写入分别授权；主网不在本规范授权内 |
| AI 协作 | 独立 checkout、分支和运行数据；通过 GitHub PR 协作；不共用可写工作目录 |

“工具更多”不等于“工程更可靠”。本轮不得顺手更换框架、数据库、包管理器或合约架构。

## 2. 已核对的仓库事实

以下是编制时的文件快照，不是重新运行测试后的结论。[R1–R8]

| 项目 | 已观察到的状态 | 对齐要求 |
| --- | --- | --- |
| 默认分支 | `master` | 禁止假定为 `main` |
| Node | `.node-version` 为 `24.12.0` | 保留为历史复现起点；必须开展安全补丁资格审查 |
| npm | `engines.npm` 为 `>=11.6.2 <12` | 目前只是范围约束；需要锁定并核验实际执行的精确版本 |
| Node engines | `>=24.12.0 <25` | 不能代替精确版本选择和环境自检 |
| npm 配置 | `engine-strict=true`、`save-exact=true`、`ignore-scripts=true` | 不得通过关闭这些设置“解决”安装失败 |
| 代码工具 | TypeScript `6.0.3`、ESLint `10.10.0`、Prettier `3.9.6` | 以当前 lockfile 为准；本轮不顺手升级 |
| 应用框架 | Vite `8.2.2`、React `19.2.8`、Fastify `5.12.3` | 保留现有架构，不另起模板项目 |
| 测试执行 | Node 内置测试运行器；TypeScript 类型检查单独执行 | 测试执行成功不能代替 `tsc` 类型检查 |
| 持久化 | 本地 SQLite 模拟账本 | 不新增 PostgreSQL/Redis 作为环境前置条件 |
| Git 文件规则 | `.gitattributes` 为 `* text=auto eol=lf` | 保留 LF，并让临时测试仓库继承同一规则 |
| CI | Linux `verify`、Windows `verify-windows` | macOS 必需检查尚需实施；不要把建议当现状 |
| 应用服务 | 回环地址，端口 `4180` | 不开放到 LAN 或公网 |
| 管理看板 | 回环地址，端口 `4181`；版本化证据和快照 | 遵守现有提交绑定流程，不能手改生成 JSON |
| 链上实现 | 尚未部署合约；不签名、不提交交易 | 不能因工具已安装就宣称合约测试、部署或网络接入已完成 |

### 2.1 必须纠正的版本误区

**Node `24.12.0` 是历史复现版本，不应被长期冻结为安全推荐版本。** Node 官方在 2026-01-13 发布过包含 Node 24 系列修复的安全更新，对应下载版本包括 `24.13.0`；编制时官网列出的 Node 24 LTS 为 `24.21.0`，发布于 2026-09-08。[E1–E2]

因此建立两个不同概念：

| 基线 | 用途 | 状态 |
| --- | --- | --- |
| 历史复现基线：Node `24.12.0` / npm `11.6.2` | 复现截图和既有工程行为；npm 仍需对实际历史执行记录核验 | 非长期安全推荐，不授予发布资格 |
| 新的批准基线 | 通过安全公告审查、干净安装和三平台回归后，写入版本源文件 | 尚待实施；`24.21.0` 只是当前升级候选，不能提前写成已验证 |

不得直接执行 `install --lts`、`@latest` 或批量升级来替代评估。npm 的版本也须独立核验；“Node 升级了”或“npm 是随 Node 附带的”均不能替代 npm 的精确版本检查。

安全资格审查必须覆盖 **Node 运行时本身**，而不仅是 `npm audit` 输出。具体公告对本项目是否可达、如何处置，由升级 PR 记录；本文不把公告中每个问题都断言为本项目已经存在的可利用漏洞。

## 3. 规范强度与职责

`MUST` 表示必须执行；`MUST NOT` 表示禁止；`SHOULD` 表示通常应执行，偏离时须记录理由；`MAY` 表示经任务范围允许后可选。

用户负责最终任务指派、范围调整、风险接受和受控操作授权。Macbeth 可以盘点差异、拆解依赖、制定验收标准和提出合并建议，**不得自行把新任务分配给 Darwin 或其他 Worker，也不得把历史阶段性 merge 授权视为永久授权**。

Worker 只能在用户批准的任务范围内修改，不能通过降低检查标准、扩大白名单或改写证据解决红灯。同一 Worker 编写和检查代码可以减少低级错误，但不构成独立安全审查。

**同一个 GitHub 账号下的两个 Codex、不同分支名、不同 Git author 或不同 Worker 名称，不是两个独立的安全身份。** 这些是协作标签，不是权限隔离证明。部署凭证、仓库管理权限和外部审查凭证不得仅靠提示词隔离。

## 4. 唯一事实来源与版本锁定

### 4.1 文件职责

| 信息 | 唯一事实来源 | 其他位置的角色 |
| --- | --- | --- |
| Node 精确版本 | `.node-version` | `engines.node`、文档和 CI 必须与其一致 |
| npm 精确版本 | 拟新增的 `package.json.packageManager` | 格式为 `npm@x.y.z`；自检核对真实 `npm --version` |
| 根直接依赖版本 | `package.json` | 不使用 `^`、`~`、`*`、`latest` |
| 解析后的依赖图 | `package-lock.json`，保持现有 lockfile v3 | 日常安装不重写它 |
| 平台与环境准入规则 | 拟新增 `planning/development-environment.json` | 只保存环境策略及版本来源路径，不重复维护第二套 Node/npm 版本 |
| 供应链许可、registry、Action 规则 | `planning/supply-chain-policy.json` | 新环境策略不得绕开或复制出一套宽松白名单 |
| 网络身份 | `packages/robinhood-chain/src/network.ts` | `.env.example`、适配器与文档是经校验的引用或镜像 |
| 可运行命令 | `package.json.scripts` 和其调用的受审查脚本 | 文档必须说明命令是否已存在 |
| 任务状态 | 现有规划源文件 | 看板只是生成视图，不是新的状态事实源 |

不得同时手工维护 `.node-version`、`.nvmrc`、Volta pin、`.tool-versions` 等多套版本数字。兼容文件确需存在时，必须由同一事实源生成并接受一致性测试。

### 4.2 npm 的声明不等于执行锁定

`packageManager` 是声明；本项目仍 MUST 在安装前及 CI 内比较实际版本。不能仅添加一个字段就声称所有会话使用了同一 npm。

下面只是**历史复现配置示例**，不是要求永远停留在旧版本；新的批准版本必须通过单独评估替换：

```json
{
  "packageManager": "npm@11.6.2",
  "engines": {
    "node": "24.12.0",
    "npm": "11.6.2"
  }
}
```

不得将这一片段覆盖整个 `package.json`。实施时只修改对应字段，并同步 lockfile 根元数据、供应链生成物及相关验证规则。若项目未来需要表达更宽的运行时兼容范围，必须与“贡献者工具链精确版本”分开建模，不能取消精确版本门禁。

### 4.3 工具分类

Node、npm、TypeScript、打包器、未来合约编译器属于构建输入，MUST 精确锁定。Git、fnm、Homebrew、Xcode Command Line Tools 属于宿主工具，MUST 记录版本、来源和能力，接受补丁维护；不要求 Apple Git 与 Windows Git 使用同一个发行字符串。

宿主工具不以“必须与所有平台逐字同版”为验收条件，但影响 Git 语义、二进制生成或依赖安装时必须重新回归。编辑器主题、字体、窗口布局不属于本规范。

## 5. macOS 原生开发环境

### 5.1 安装与架构原则

macOS 使用 fnm 管理项目 Node。fnm 官方支持 `.node-version`，并提供 Homebrew 安装方式。[E3] Homebrew 在这里是宿主工具安装渠道，不是项目 Node 版本的事实来源。

首次安装 fnm、安装 Command Line Tools、修改 shell 启动文件均属于机器级变更，必须由用户执行或明确授权。禁止自动修改整个系统的 Git/npm 配置，禁止以 `sudo npm install` 解决权限问题，禁止执行未经审查的远程 `curl | sh` 安装链。

Apple Silicon MUST 使用原生 arm64 Node 和对应本地依赖；Intel Mac 使用 x64。诊断时至少采集 `uname -m`、`process.arch`、Node 路径以及 macOS 版本。发现 Rosetta 或架构混用时，停止复用当前 `node_modules`，先定位来源；不得声称混合架构已经通过原生验收。

macOS 的最低支持版本由选定 Node 的平台要求与真实测试确定；不得从浏览器 User-Agent 推断实际系统，也不在未核验情况下写死用户的系统版本。

### 5.2 本地目录与 shell

工作目录 SHOULD 位于本地非同步开发目录，例如 `~/Developer/QuantPass/`。不在 iCloud Drive、OneDrive、共享网络盘或临时下载目录内运行正式 checkout；迁移已有目录前先确认所有未提交改动并取得授权。代码和脚本仍 MUST 正确处理路径中的空格与中文，不能以推荐目录命名替代兼容性修复。

交互终端可用 zsh；仓库自动化优先用 Node `.mjs` 实现。不要依赖交互式 shell alias、GNU 专属 `sed -i`/`readlink -f`，或把 macOS 自带 Bash 当成新版 Bash。确需 shell 特性时必须声明解释器并在 CI 验证。

### 5.3 最小操作顺序

以下命令只能在已审查的 checkout 和已批准的工具链下使用。第一次采用本规范前，先完成第 2.1 节的版本评估；不要把旧 `.node-version` 当成永续推荐。

```bash
# 只读检查；输出中的个人路径不直接发布到公共看板。
xcode-select -p
sw_vers
uname -m
git --version
command -v node
command -v npm
node --version
npm --version
```

fnm 已经由用户安装时，可以在当前终端激活，不自动改写 shell 配置：

```bash
# 以下示例使用 zsh；这是本机已安装的 fnm 输出，不是远程脚本。
eval "$(fnm env --shell zsh)"
fnm install "$(cat .node-version)"
fnm use "$(cat .node-version)"
node --version
npm --version
```

Node 的引导安装须记录官方发行来源，验证下载校验信息；fnm 下载源被代理或配置覆盖时不得静默接受。缺少经批准的 npm 版本时，由引导步骤安装到 fnm 管理的用户级 Node 环境，精确指定版本并关闭安装脚本；这是唯一允许的项目相关全局 npm 安装例外，不扩展到全局 TypeScript、ESLint 或合约框架。

**未完成版本和来源核验前，不执行项目安装或测试脚本。** 图形应用内终端、新启动的 Codex 会话及普通终端必须分别核对，不能假设它们继承相同 PATH。

## 6. 依赖安装与供应链规则

### 6.1 标准安装

```bash
npm ci --ignore-scripts
```

`npm ci` 按 lockfile 安装，发现 manifest 与 lockfile 不一致时失败，不替开发者更新锁文件；`ignore-scripts` 关闭安装生命周期脚本，但显式执行 `npm run`/`npm test` 仍会执行相应脚本。因此它不是恶意代码隔离沙箱。[E4]

MUST 保留所有开发及本平台必需的可选依赖；不得为了省空间使用 `--omit=dev`、`--omit=optional` 或删除跨平台二进制包来通过某台机器的安装。不同 OS/CPU 上实际落盘的可选依赖可以不同，不能把 `node_modules` 逐字相同当成跨平台成功条件。

项目工具从本地依赖解析，通过已提交的 npm scripts 运行。不使用 `npx some-tool@latest` 临时下载修复工具，不让全局 ESLint/tsc 替代仓库版本。

### 6.2 npm 配置

在现有 `.npmrc` 基础上，拟实施的项目级最低配置为：

```ini
engine-strict=true
save-exact=true
ignore-scripts=true
registry=https://registry.npmjs.org/
strict-ssl=true
```

环境自检必须核对**生效配置**，而不只检查文件文本；环境变量、用户级 npm 配置和命令行参数可能覆盖项目配置。registry URL 末尾斜杠可规范化比较，但不得放宽主机、协议或凭证策略。

网络不稳定时可以使用用户批准的代理，但不能关闭 TLS 验证、提交代理凭证、改用未批准 registry，或把 lockfile 改写成镜像站 URL。下载失败是 BLOCKED，不是“可以跳过完整性检查”的理由。

### 6.3 变更与安装脚本例外

只有明确的依赖变更任务才允许执行会改动 lockfile 的安装。依赖升级必须审查实际 diff、来源、完整性、许可、发布变更与安全公告，并运行 `supply:check` 和相关测试；生成式 SPDX SBOM 继续沿用现有流程。[R7]

如某依赖确实需要安装脚本，必须形成精确到包版本、脚本及所需权限的例外，在无密钥、受限网络的隔离步骤执行并验证结果。不得直接关闭整个仓库的 `ignore-scripts`，不得用全量 `npm rebuild` 隐式放行所有包。

禁止 `npm audit fix --force`、`--legacy-peer-deps`、删除 lockfile 后重装等无评估修复。校验和能说明字节完整性，不等于该包无恶意或发行身份已经独立验证。

## 7. 文件、Git 与测试夹具一致性

保留 `.gitattributes` 的现有内容：

```gitattributes
* text=auto eol=lf
```

拟新增 `.editorconfig` 的最小内容如下，具体格式规则仍以仓库 Prettier/ESLint 配置为准：

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

所有正式源码及生成文本 MUST 使用 UTF-8、LF，并保持导入路径大小写一致；Git 的换行行为以 `.gitattributes` 为准。[E12]二进制文件不作文本换行转换。只改大小写的重命名须在大小写不敏感文件系统和 Linux 中都验证。

Git 的换行设置使用仓库局部配置，不替用户改全局偏好。转换已有文件必须使用单独、可审查的变更；不得把全仓换行、格式化或 `renormalize` 噪声混入安全修复 PR。

**临时 Git 测试仓库必须在第一次 `git add` 之前安装仓库的换行规则。** 临时仓库不应继承机器全局的换行、hooks、签名或作者设置后再把结果误报为产品差异。验收应包含 CRLF 输入、LF checkout、非 ASCII 路径、带空格路径和文件名大小写。

MUST 检查 Git 索引中的 `assume-unchanged`、`skip-worktree` 等隐蔽状态。不得通过这些标志或 `--no-verify` 隐藏变更、绕过检查。不要将 `safe.directory=*` 作为默认初始化步骤。

## 8. 多会话、分支和运行数据隔离

每个活跃 Worker MUST 拥有独立 clone 或经批准的独立 worktree、独立分支、独立 `node_modules` 和独立 SQLite 数据。默认优先独立 clone，因为 worktree 仍共享部分 Git 元数据；两个会话不能同时 checkout、reset、stash 或修改同一可写目录。

分支遵循 `<worker>/<task-id>-<slug>`；Macbeth 可使用 `macbeth/...`，Darwin 恢复参与后继续使用 `darwin/...`。命名约定不得替代真实任务授权。禁止直接在 `master` 开发，禁止未经批准 force push、删除他人分支或清理未提交文件。

本规范不引入跨机器 SSH、SMB 或共享文件夹协作。协作依赖 GitHub commit、PR、diff 和已验证任务记录。

当前应用及管理看板固定使用端口 `4180`、`4181`。[R8] 同一台 Mac 出现冲突时，只处理当前任务自己启动的进程，不使用 `killall node` 或自动切换到公网绑定。并行端口方案必须作为明确变更，同时修改和测试 Host 校验、文档及启动入口；不是私下换端口。

**不要默认执行 `git fetch --prune` 或“合并后删除全部旧分支”。** 当前管理证据依赖精确来源分支 ref；删除或清理前必须证明不会破坏证据验证。保留完整历史，必要时通过经审查的证据迁移处理 ref 生命周期。[R8]

## 9. 环境变量与秘密边界

当前示例配置为：[R5]

```dotenv
QP_MODE=local
QP_ADAPTER=mock
QP_CHAIN=robinhood-chain-testnet
QP_CHAIN_ID=46630
QP_RPC_URL=https://rpc.testnet.chain.robinhood.com
QP_EXPLORER_URL=https://explorer.testnet.chain.robinhood.com
```

示例只表示公开元数据和本地模式，**不等于已经批准 RPC 访问，更不等于批准交易**。最终准入取决于运行时校验与能力控制。调用 `--env-file=.env.example` 也不能取代对进程环境中覆盖值的检查。

不得为了环境对齐新增默认私钥、测试钱包助记词、正式合约地址、容量或收费参数。未知参数应保持未配置并拒绝相应能力，不用“看起来合理”的默认值填充。

私钥、助记词、GitHub token、供应商凭证、Cookie 不得进入 Git、前端可见配置、worker 论坛、终端截图、CI artifacts 或静态看板。完整 `.env` 和全量进程环境不得打印；对 URL 只公开经批准的无凭证 origin，不公开路径、查询串或用户信息。

自检须识别可能改变 Node/npm/Git 行为的环境覆盖，例如 `NODE_OPTIONS`、`NODE_PATH`、npm 配置覆盖、Git 对象目录和配置注入；输出仅说明存在何种覆盖及其是否获批，不回显可能含秘密的值。`NODE_TLS_REJECT_UNAUTHORIZED=0` 等禁用 TLS 验证配置必须阻断。

普通开发和 PR CI 不持有部署密钥；未来受控部署必须使用与开发任务隔离的签名流程。发现秘密泄露时先撤销或轮换，再处理日志与代码；“删掉最新一行”不构成已消除泄露。

## 10. 环境自检：拟新增的执行契约

### 10.1 命令与实现边界

拟新增以下接口；**当前基线中不存在，实施前不得直接运行并宣称通过**：

```text
npm run env:check         开发模式：检查版本、配置及本地状态
npm run env:check:ci      CI 模式：强制完整、干净且可归属的验收输入
npm run verify:ci        自检 → 现有完整检查 → 工作区与输出验证
```

建议实现为 `tools/check-environment.mjs`，使用 Node 标准库，不依赖安装后的第三方包。安装前可直接调用该脚本检查版本和 manifest。引导检查只解析数据，不执行待审查配置中的任意脚本，也不下载“缺失的最新工具”。

自检默认只读、不联网、不修改文件，不执行 fetch、stash、reset、clean、install、kill、commit、push 或自动修复。明确启用的报告写出只允许受控位置，拒绝符号链接逃逸，限制文件大小，并使用原子写入。

### 10.2 必需检查项

| 检查组 | 开发模式 | CI / 证据模式 |
| --- | --- | --- |
| 仓库身份 | 校验仓库根、预期 origin；URL 脱敏 | 校验来源及事件上下文；未知来源阻断 |
| Node/npm | 与唯一事实源精确一致 | 不一致直接失败；不能接受 CI 自带版本 |
| 宿主平台 | 检查 OS/CPU、实际执行路径、架构混用 | 验证 runner 声明与实际 `process.platform/arch` |
| 依赖输入 | manifest、lockfile、npm 配置一致 | 安装前后验证输入未被偷偷重写 |
| Git 状态 | 脏工作区可供开发，但标记不可出具正式证据 | 开始和结束均验证；隐藏索引状态阻断 |
| Git 历史 | 分支、HEAD、tree、base 可识别 | 缺失历史/必要 ref 阻断；验证对象归属 |
| 身份配置 | 提交作者配置存在；不公开私人邮箱 | detached CI 不要求伪造本地作者或 Worker 分支 |
| 文件规则 | LF、编码及关键配置检查 | 加入跨平台夹具与大小写检查 |
| 网络边界 | local/mock 且未启用未批准能力 | 无签名/广播能力；不得意外连真实网络 |
| 数据与端口 | 当前 checkout 的隔离性、端口冲突提示 | 不接入用户真实数据或其他会话数据 |
| 敏感覆盖 | 检查 Node/npm/Git/TLS 覆盖策略 | 未批准覆盖阻断，不通过转储环境排查 |
| 证据语义 | 显示 freshness、适用提交和不可验收项 | 缺项、过期或来源不符不可 PASS |

`base` 必须标识真实解析得到的提交，而不是只写字符串 `origin/master`。报告记录 base 获取时间；离线检查不能证明远程 base 此刻最新。需要更新时由显式、可审查的 fetch 步骤完成，不由 doctor 暗中改变仓库。

GitHub PR 的临时 merge commit、逻辑 PR head 和目标 base 必须分别记录。`merge_group`、`push`、`pull_request`、本地命名分支不能用同一个“必须在分支上”的判断处理。[R8]

### 10.3 状态与退出码

新环境报告可以使用以下独立语义：`PASS`、`WARN`、`FAIL`、`BLOCKED`、`NOT_RUN`。它们不能未经适配就写入现有看板 schema。

退出码 `0` 仅表示所有当前必需检查通过；`1` 表示确定的版本、配置或测试失败；`2` 表示缺少工具、历史、授权、网络条件或证据而不能完成验证。可选项缺失可保留 NOT_RUN，但不得让必需项缺失返回 0。

开发模式允许脏工作区时 MUST 显示 `eligibleForEvidence=false`。CI 模式中不能用 WARNING、`continue-on-error` 或 `|| true` 把必需项降格。

报告至少包含 schema 版本、UTC 时间、工具精确版本、平台和架构、HEAD/tree/base、输入 lockfile 摘要、每项命令与退出码，以及验证范围。公共报告不包含用户名、主机名、绝对 home 路径、代理地址、SSH 画像或机器序列号。

## 11. 命令对齐与证据生成

### 11.1 当前真实存在的入口

下表根据基线 `package.json` 核对。[R1] 命令存在不表示本次已运行，也不保证当前工作区满足前置条件。

| 命令 | 用途 | 注意事项 |
| --- | --- | --- |
| `npm ci --ignore-scripts` | 锁定依赖安装 | 需要可用下载源；不是离线安装承诺 |
| `npm run check` | 类型、lint、格式、测试、安全/规划/看板及 Web 构建 | 保留既有覆盖；看板证据过期会正确失败 |
| `npm run audit:dependencies` | npm 依赖漏洞公告检查 | 依赖网络；失败/超时不能改成零漏洞 |
| `npm run robinhood:check` | 目标链配置校验 | **不代表已成功访问 RPC 或部署合约** |
| `npm run governance:check` | 治理证据一致性 | 不能替代仓库外部可信门禁 |
| `npm run supply:check` | 锁文件、许可、Action 与 SBOM 一致性 | 新 CI job 必须匹配已审查 policy |
| `npm run management:checks` | 从干净命名分支采集完整证据 | 依现有受控流程写入版本化清单 |
| `npm run management:build` | 生成看板快照 | 会改变生成物，不是纯只读校验 |
| `npm run management:check` | 验证快照 | 不运行采集，不从快照反推 PASS |
| `npm run demo` | 本地模拟演示 | 仅回环，不签名、不广播 |
| `npm run management:serve` | 本地只读管理看板 | 仅回环，不作为控制台执行任意命令 |

未来 `verify:ci` 必须在明确的干净 checkout 上实际运行环境自检、现有完整产品/安全检查及输出验证，并如实传播退出码。`audit:dependencies` 保持独立的 Linux 必需步骤，不能因 `verify:ci` 成功而省略。依赖审计与无网络产品测试分开报告；普通产品单测、HTTP E2E 不得依赖公共 RPC、faucet 或个人钱包。

### 11.2 不能被环境重构破坏的现有证据流程

当前 `.checks/management/latest.json` 是**需要版本控制的证据清单**，不是可随意删除的缓存。运行日志可被忽略，但不能用 `.gitignore` 整体忽略 `.checks/`。[R8]

采集必须绑定干净命名分支的源提交与 tree。按照现有管理指南，证据记录与看板快照存在受约束的过渡提交：证据记录阶段只允许清单变化，快照阶段只允许被允许的两个生成 JSON 变化；任何额外源码变化都需要重新采集。

因此，新增 `env:check`、修改 Node/npm、增加 macOS job 或修改本文件，都应进入实际源提交，随后再按照原指南生成证据。不得把环境修改、清单修改、看板修改随意混成一个“全部通过”提交；不得手工修改 `PASS`、时间或绑定 SHA。

新环境报告优先通过受控 CI artifact 或单独忽略的诊断路径保存。接入现有看板前，先修改并验证注册表、schema、来源白名单、脱敏和过期语义；不得直接新增一个伪造“已通过”的 JSON 数据源。

工人回顾/论坛记录必须链接实际任务、分支、提交、测试和未解决项。静态文字和本地 JSON 均不是独立执行证明，不能覆盖 CI 的失败状态。

## 12. CI 平台矩阵与可信门禁

### 12.1 目标矩阵

以下为**拟实施矩阵**。runner 标签和架构依据编制时 GitHub 官方文档；上线实施时仍须重新核验。[E6]

| Job | 建议 runner 标签 | 目标架构 | 验收角色 |
| --- | --- | --- | --- |
| `verify` | `ubuntu-24.04` | x64 | 保留现有 Linux 必需检查名称；完整验收及网络审计 |
| `verify-windows` | `windows-2025` | x64 | 保留 Windows 回归；完整产品/安全检查 |
| `verify-macos` | `macos-15` | arm64 | 新增主要开发平台完整检查；落地后设为必需 |
| `verify-macos-intel` | `macos-15-intel` | x64 | 初期为显式兼容性验证；有活跃 Intel 开发者时纳入必需 |

版本化 runner 标签比 `*-latest` 更明确，但托管镜像仍会更新；必须记录实际 ImageVersion 和工具版本，不能声称标签已经固定了完整操作系统字节。Beta/preview runner 不用作唯一发布验收环境。

MUST 保留完整 Git 历史与证据验证所需的精确 ref。不要通过重命名 `verify` 或矩阵化导致已有 required status check 不再匹配。新增 job、事件、权限或 reusable workflow 必须先更新受审查的供应链 profile；当前仓库并未普遍允许本地/container Action 或 reusable workflow。[R7]

### 12.2 每个 CI job 的最低流程

受审查的 checkout → 根据 `.node-version` 安装 Node → 安装并核对精确 npm → 安装前环境检查 → `npm ci --ignore-scripts` → 当前完整检查 → 平台对应的安全检查 → 验证 tracked 文件无非预期变化 → 发布有界脱敏结果。

Linux 的依赖审计失败或网络不可用须独立标明。合并候选头更新后重新验收，不沿用旧 head 的成功结果。任何必需检查取消、跳过、无结果或超时都不得视为通过。

缓存只用于加速，键必须区分 OS、CPU、Node、npm 和 lockfile；不跨平台共享 `node_modules`。发布步骤不能复用来源不可信的可执行缓存或带秘密的产物。

### 12.3 权限与外部信任边界

普通 CI 保持最小权限；Action 使用经验证来源的完整 commit SHA，checkout 不持久化写入凭证。不把不可信 PR 内容带入拥有秘密或仓库写权限的执行环境；不得用 `pull_request_target` 加载并执行 PR 代码。[E5]

**不把开发用 Mac 注册为处理不可信 PR 的常驻 self-hosted runner。** 它可能同时持有浏览器会话、个人文件和其他项目凭证，不能靠“只有我会提交”作为隔离设计。

编制时仓库的供应链文档仍标记外部治理门禁未完成；仓内 validator、CI 文件和状态名可以一起被改写，因此仓内自检不是独立信任根。[R7] 本环境任务可以按现有保护策略接受审阅，但不能把“环境对齐完成”当成 `SUPPLY-001`/`GOV-001` 已完成，更不能据此开放链上写入。外部可信验证器仍是单独的安全工作。

## 13. Robinhood Chain 网络准入

### 13.1 官方网络值与项目默认

| 字段 | Testnet 值 |
| --- | --- |
| 网络名称 | Robinhood Chain Testnet |
| chainId | `46630`，十六进制 `0xb626` |
| 原生 gas 货币 | ETH |
| 公共 RPC | `https://rpc.testnet.chain.robinhood.com` |
| 浏览器 | `https://explorer.testnet.chain.robinhood.com` |
| Faucet | `https://faucet.testnet.chain.robinhood.com` |

上述值与仓库网络文档及 Robinhood 官方网络配置一致。[R6][E7] 官方文档现同时提供主网，并且部署示例默认使用主网；**不能直接复制其默认网络和广播命令到本项目**。主网 `4663` 不属于 `46630` 的别名。[E8]

### 13.2 能力逐级开放

| 等级 | 能力 | 本规范下的状态 |
| --- | --- | --- |
| L0 | local/mock，本地状态与静态网络校验 | 当前开发基线 |
| L1 | 官方 Testnet 的有界只读 RPC | 需要单独任务、实现和授权；不默认开启 |
| L2 | Testnet 部署、签名、广播或权限操作 | 单独安全门禁、可审查交易计划和用户授权 |
| L3 | 主网或任何真实价值操作 | 本规范不授权；不能由 L2 成功自动升级 |

安装 Foundry、加入 RPC URL、通过 `robinhood:check` 均不改变能力等级。bootstrap、doctor、普通 `npm test` 和 PR CI 不得产生链上写入。

### 13.3 未来只读连接的验收要求

只有 L1 已获批准时，才可增加显式 RPC 探针。探针必须核对 `eth_chainId` 为 `46630`，设置单次/总超时、响应大小和重试上限，拒绝未经审查的重定向、协议降级和任意 fallback RPC。错误链、JSON-RPC 错误、畸形响应、限流和超时必须被测试。

配置缺失时 fail closed；不得自动 fallback 到 Ethereum、Arbitrum One、Arbitrum Sepolia、Robinhood 主网或任意可连通节点。chainId 一致只能证明接口自报身份一致，不能单独证明节点诚实、状态正确或交易最终结算。

Mock、通用本地 EVM、fork 与真实 Testnet 必须分别标记。不能把 Anvil/Hardhat 的本地运行结果说成已完整复现 Robinhood Chain 的 Nitro 行为。

## 14. 合约工具链：未来独立 Profile

当前已核对的应用基线不需要合约部署工具才能运行本地模拟器。本轮不强行引入 Foundry、Hardhat、Rust、Python、Slither 或本地全节点作为所有开发者的必需安装项。

进入合约开发任务时，优先评估 **Foundry 作为单一合约构建/测试工具链**，应用层继续使用现有 Node/npm；Hardhat 仅在明确需要其插件或集成时另行决策。Robinhood 官方支持使用 Foundry 或 Hardhat，并不要求两者同时安装。[E8]

合约 Profile 激活前 MUST 具备以下确定值与证据：

| 类别 | 必须固定或证明的内容 |
| --- | --- |
| 工具版本 | Forge/Anvil/Cast 的精确发行版或提交，以及不同平台资产的校验信息；不使用浮动 nightly |
| Solidity | 精确编译器版本、来源与校验；不能只看 `pragma ^...` |
| 编译设置 | 显式 `evmVersion`、optimizer 开关/runs、viaIR、metadata、remappings、库链接 |
| 依赖 | 合约库精确版本/提交与许可证；不得依赖滚动 branch |
| 输出 | ABI、creation/runtime bytecode、编译输入和摘要；同一批准输入可重建 |
| 检查 | 合约单元、负向、fuzz、invariant、静态分析与覆盖报告；分别记录 seed、配置和限制 |
| 网络兼容 | Robinhood Chain 当前升级/硬分叉支持的官方依据与实际验证 |
| 写入边界 | 默认无 broadcast；测试键不能用于任何公共网络；用户签名授权独立 |

本文件没有替尚不存在的合约项目猜测 Solidity 或 `evmVersion`。这些值未定时，合约 Profile 保持 BLOCKED/NOT_RUN，而不是使用安装工具的默认值。合约实现已经存在但检查未跑时，同样不能以“暂未安装工具”为理由声明该功能已完成。

L2 特性验证需覆盖相关业务实际使用的区块编号语义、预编译、gas/数据费用与最终性阶段；普通 Ethereum 测试不能直接代替。Robinhood 官方说明其部分行为与 Ethereum 不同，并区分排序器确认和后续最终性。[E9–E10] 测试不得把收到 receipt 等同于所有不可逆结算条件已经满足。

## 15. 可复现性与证据的最低标准

同一源提交、同一 Node/npm、同一 lockfile、同一编译配置，应能在干净 checkout 上重复完成安装、测试和构建。证据须包含输入摘要与结果；“我电脑上能跑”不构成验收。

跨 OS 的可选依赖及宿主镜像可能不同。本规范第一阶段承诺的是**可重复安装、行为一致性和可追溯构建输入**，不空口承诺所有平台构建输出逐字节相同。需要字节级复现的合约产物或发布包必须单独进行双构建比对，处理时间戳、绝对路径和非确定性元数据，并记录允许差异。

正式证据至少关联 source HEAD、tree、base、实际测试 checkout、Node/npm、OS/arch、lockfile 摘要、命令、退出码和时间。PR 临时 merge commit 与 source head 分开记录。任何源文件变更都要重新评估证据适用范围；旧报告不得因为文件名叫 `latest.json` 就被视为最新。

## 16. 升级、例外与回退

所有工具链升级必须通过专门 PR，说明旧/新版本、动机、安全公告、兼容性影响、lockfile/SBOM 变化、各平台结果及回退边界。依赖、Action、Node、npm 的批量混升原则上拆开；只有同一修复存在明确耦合时才合并评估。

Critical 问题立即冻结受影响的发布和变更；High 问题应在三天内完成初步处置判断，并按现有风险规则阻断或形成经批准的处置。不得为追求“全绿”降低告警级别。[R7] 组织响应期限以用户批准后的统一安全策略为准，不另立冲突 SLA。

临时例外必须有风险 ID、精确范围、理由、用户批准记录、补偿控制和到期时间。例外不能由 Worker 自批，不能无到期时间，也不能隐含适用于后续版本。

回退使用受审查的版本源和 lockfile 变更，不重写主分支历史。涉及 SQLite 数据变化时先执行现有受控备份；工具链回退不等于数据库可自动降级。旧版本含未处置安全问题时，不得仅因为旧测试曾通过就恢复发布资格。

## 17. 必需回归测试

环境对齐的完成条件不只是 happy path。以下为拟新增测试的最低覆盖；测试仅针对隔离 fixture、本项目代码和被授权环境，不连接无关系统。

| 测试场景 | 期望结果 |
| --- | --- |
| Node 或 npm 不符合精确版本 | 安装前/CI 中拒绝，不自动下载最新版本 |
| manifest 与 lockfile 不一致 | 安装失败；工作区没有被隐式“修好” |
| 非批准 registry、TLS 禁用、敏感覆盖 | 阻断，错误信息不泄露凭证 |
| ARM/x64 工具和本地依赖混用 | 明确诊断，不能冒充原生通过 |
| 换行、Unicode/空格路径、大小写差异 | 各平台行为一致或有明确可审查失败 |
| 正常本地脏工作区 | 允许开发诊断，但不能生成正式 clean evidence |
| 隐藏索引状态、缺失历史或必要 ref | 验收失败；不以空结果作为通过 |
| 正常 GitHub detached PR merge checkout | 正确区分 merge/head/base；不误判为非法工作区 |
| 缺少可选合约工具 | 显示 NOT_RUN，不能伪造 fuzz/invariant/Slither 通过 |
| 报告缺项、过期、错误 source tree | 拒绝接受，不从旧看板恢复 PASS |
| RPC 错误链/超时/畸形响应（L1 启用后） | fail closed，不广播、不切换主网 |
| 报告路径不安全或包含敏感字段 | 拒绝写出或脱敏；现有 privacy 检查仍通过 |

不允许无测试成功、吞退出码、注释断言或减少必需检查来提高通过率。环境规范不是对业务安全测试的替代。

## 18. 落地任务与阶段验收

**下表只划分工作，不分配执行人；全部为 UNASSIGNED，等待用户决定。** 任务拆分不授权 Macbeth 开始开发，也不恢复 Darwin 的参与。

| 任务 | 交付物 | 通过标准 | 优先级 |
| --- | --- | --- | --- |
| ENV-01 基线盘点与安全资格 | 当前差异表、Node/npm 公告评估、批准候选与迁移计划 | 不把 `24.12.0` 当长期安全结论；用户确认升级范围 | P0 |
| ENV-02 精确锁定与文件规则 | `.node-version`、npm pin、配置一致性、EditorConfig、机器策略 | 干净安装可重复；无混合包管理器或换行噪声 | P0 |
| ENV-03 环境自检 | doctor、结构化结果、负向测试、脱敏 | 版本错误/证据缺失会失败；不自动修复或联网 | P0 |
| ENV-04 三平台 CI | macOS job、原有 Linux/Windows 保留、policy/profile 同步 | 真实运行；必需检查名称及权限无漂移 | P0 |
| ENV-05 管理证据对接 | 合法源提交/清单/快照、工作回顾、未解决项 | 不破坏原证据链；不把 NOT_RUN 写成 PASS | P0 |
| ENV-06 容器/合约扩展 | 单独 ADR、精确版本与能力门禁 | 仅在用户批准相关需求后实施 | P2 |

### 18.1 第一阶段 Definition of Done

只有以下条件全部满足，才可以把**环境标准化任务**标记完成：版本与来源被核验；旧 Node 的安全处置有明确结论；新同事或新会话可从干净 checkout 完成初始化；Mac/Linux/Windows 实际通过；必需负向用例通过；执行前后无非预期文件变化；安全/供应链检查未被削弱；证据正确绑定提交；README/本规范/机器策略一致；用户审阅并批准范围内结果。

阶段完成不等于合约安全完成、外部治理门禁完成、Testnet 写入开放、主网可用或资金产品可发布。未解决事项必须继续保留原风险状态。

### 18.2 提交审阅时的最小报告

```text
任务 ID：
用户分配记录：
实际执行者标签：
源分支 / source HEAD / tree：
base SHA / 获取时间：
实际 CI checkout / run / job：
实际 Node / npm / OS / CPU：
依赖锁摘要：
改动文件与目的：
实际运行命令与退出码：
负向用例与限制：
PASS / FAIL / BLOCKED / NOT_RUN 汇总：
未解决问题、风险 ID 和下一步依赖：
是否触及 CI 权限、秘密或链上写入：
用户尚需决定的事项：
```

## 19. 给 Codex 的仓库入口

建议在根 `AGENTS.md` 添加以下精简入口，而不是把整份长规范复制进每个会话。Codex 官方支持仓库级 `AGENTS.md`，且存在分层/覆盖及长度限制，因此仍需确认当前会话实际读取的规则。[E11]

```markdown
## Development environment and authority

开始任何代码修改前，阅读 docs/DEVELOPMENT-TOOLCHAIN.md，核对当前
仓库、分支、HEAD、Node/npm 实际版本及任务授权。

该规范中的 PROPOSED 命令不代表已经存在。先检查 package.json。
不得为了通过检查关闭安全规则、升级到 latest、修改 PASS 证据或添加私钥。

Macbeth 仅负责规划拆分和审查建议；任务由用户分配。
Darwin 暂不参与，直到用户另行授权。历史 merge 授权不自动延续。
使用独立 checkout 和自己的任务分支，不与其他会话共用可写工作目录。

保持 local/mock；安装、测试、doctor 不得签名、广播或开放主网能力。
工具链修改完成后遵守现有管理证据提交流程，记录实际测试和未解决项。
缺少条件时报告 BLOCKED/NOT_RUN，不能修改文档把它写成已完成。
```

`AGENTS.md` 是工作约定，不是操作系统沙箱或服务端权限控制。不能把密钥安全、分支保护或独立审批仅建立在 AI 遵守文本之上。

## 20. 来源与核验范围

### 20.1 仓库来源

以下路径全部按固定提交 `5f223039b84f941d8f5c34d245f87c85c676b02a` 读取，避免把不同时刻的文件拼成一个不存在的基线。

| 编号 | 路径 | 支撑内容 |
| --- | --- | --- |
| R1 | `package.json` | 现有依赖版本、scripts、engines |
| R2 | `.node-version` | Node `24.12.0` |
| R3 | `.npmrc`、`.gitattributes` | 安装脚本、精确依赖、LF 规则 |
| R4 | `README.md` | 本地模拟器、SQLite、当前非链上执行边界 |
| R5 | `.env.example` | 现有 `QP_*` 参数与 local/mock |
| R6 | `docs/ROBINHOOD-CHAIN.md` | 网络身份与当前未接入范围 |
| R7 | `docs/security/SUPPLY-CHAIN.md`、`.github/workflows/ci.yml` | 供应链 profile、CI、外部门禁限制 |
| R8 | `docs/management/dashboard/README.md` | 回环端口、证据链、ref、脱敏与看板约束 |

固定提交浏览入口：
`https://github.com/pdbsy/quantpass-arbitrum-hackathon/tree/5f223039b84f941d8f5c34d245f87c85c676b02a`

### 20.2 官方技术来源

访问/核验日期：2026-09-12。官方页面可继续更新；每次更换版本、网络或 runner 时需要重新核验。

| 编号 | 官方来源 | 地址 |
| --- | --- | --- |
| E1 | Node.js 2026-01-13 安全发布 | `https://nodejs.org/en/blog/vulnerability/december-2025-security-releases` |
| E2 | Node.js 24.21.0 LTS 发布 | `https://nodejs.org/en/blog/release/v24.21.0` |
| E3 | fnm 官方项目说明 | `https://github.com/Schniz/fnm` |
| E4 | npm v11：npm ci、ignore-scripts | `https://docs.npmjs.com/cli/v11/commands/npm-ci/` |
| E5 | GitHub Actions Secure use reference | `https://docs.github.com/en/actions/reference/security/secure-use` |
| E6 | GitHub-hosted runners reference | `https://docs.github.com/en/actions/reference/runners/github-hosted-runners` |
| E7 | Robinhood Chain 钱包网络配置 | `https://docs.robinhood.com/chain/add-network-to-wallet/` |
| E8 | Robinhood Chain 部署文档 | `https://docs.robinhood.com/chain/deploy-smart-contracts/` |
| E9 | Robinhood Chain 与 Ethereum 的差异 | `https://docs.robinhood.com/chain/differences-from-ethereum/` |
| E10 | Robinhood Chain 最终性 | `https://docs.robinhood.com/chain/transaction-finality/` |
| E11 | OpenAI：AGENTS.md 项目指令 | `https://developers.openai.com/codex/guides/agents-md/` |
| E12 | Git：gitattributes | `https://git-scm.com/docs/gitattributes` |

**本次交付范围：**读取仓库文件及官方资料、编写此规范；没有安装或升级用户的工具，没有修改远程仓库、创建 PR、执行 merge、访问链上 RPC、部署合约或发送交易，也没有在用户的 macOS/Windows 上运行回归。因此本文所有“拟新增”“目标矩阵”“通过标准”均为待实施要求，不是伪造的验收结果。

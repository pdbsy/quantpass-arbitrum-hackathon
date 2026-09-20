# AlphaForge：未来恢复远程验证与可信门禁方案

Macbeth06 / M3-06-CI-GATES；2026-09-20。**设计稿，未实施。** 本轮不查询/触发 Actions 或 Checks，不 push、建 PR、改变 PR/ruleset，不注册 App/webhook/runner，不部署签名服务。L1 PoC 的 JSON/hash 不具备独立签发资格。

## 恢复前的最小决策

用户需先核实并确认具体计费账户、SKU、预算、计费周期、额度与恢复范围。账户事实目前 UNKNOWN；不能仅凭公开价目表、旧绿灯或“self-hosted 免费”自行恢复。可以选择恢复原有受保护 GitHub Actions，也可以另外批准 L3 试点；前者不自动批准新服务/App，后者不自动批准修改原有 required checks。

在用户恢复授权后，01 冻结最终候选 H、实际 base B、tree T、锁文件 L、政策版本 P、平台/命令矩阵与有效独立 review。新代码集成后，3a78e34 的本地结果只是历史子集；不得给最终 H 复用绿灯。完整 C/R/S 证据按原流程重新生成和验证，不手改生成 PASS。真实 Testnet 部署、钱包签名和合并继续分别授权。

## 两条可选路径

**路径一：恢复原有来源。** 用户批准后，核对真实 required contexts 与 integration 来源，逐平台重新验证精确最终 H；保留 runner image、工具链、base/head/tree、全部步骤和原始日志。若只重跑失败 job，要区分新鲜执行和 GitHub 沿用结果；任何新候选/基线变化均使旧结论失效。缺少有效审批或有未解决的最终安全/治理条件，即使九 job 通过也不得合并。

**路径二：独立新来源试点。** 另行批准专用 verifier GitHub App，例如拟议 `alphaforge-verifier`（名称尚未注册）。使用新 context，如 `alphaforge-external/linux-engineering/v1`、`.../windows-engineering/v1`、`.../macos-engineering/v1`、`.../contracts/v1`、`.../semgrep/v1`、`.../osv/v1`、`.../gitleaks/v1`。这不是现有 `verify` 等 context，也不能冒充 integration **15368**。source-policy/dependency-delta 可有各自新 context，准入范围由用户批准。

GitHub 允许将必需状态限定为具体 App 来源；同名 context 的任意写入者不应被接受。受保护分支实际规则、merge queue/merge_group 的对象绑定和配置权限必须在试点时验证，而不是依赖文档推断。[GitHub expected source](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## L3 信任边界和权限

| 组件 | 最少拟议权限 | 明确禁止/边界 |
| --- | --- | --- |
| 可信调度/取源 | 单一仓库 metadata read、contents read；若读取 PR base/head 再加 pull requests read；完整 Git 源和受保护政策只读 | 不给管理写、contents写、merge、workflow写、账单权限；对 ref 重放/基线漂移检查 |
| 独立 verifier/signer | 专用 App 的 checks write，短寿命安装 token；App private key 在独立受保护服务/密钥存储 | 不给受检代码、agent、PR Jenkinsfile、容器 env/挂载；不得复用个人 PAT 或原 integration 身份 |
| 构建 worker | 无状态签发凭据、无个人 HOME/钱包/SSH/browser数据；只读输入、每次全新 OS沙箱、受控依赖网络和有限写制品区 | 不可信 PR 不在主开发账户运行；不挂 Docker socket，不允许宿主提权，worker不能自行选择政策/成功结论 |
| webhook（若选用） | 最少所需 PR/push 事件，专用 secret 验签、重放去重、TLS | 未批准不监听端口或隧道；不能将 webhook 内容当作可信源码身份，需控制面复核 |
| ruleset 管理 | 仅用户授权的管理员在迁移步骤变更具体新增 context/source | App 不需管理 ruleset；不得删除/关闭旧门禁来“排绿” |

这是最少能力设计，不是已经创建的可用权限清单；实际平台 API 若要求额外权限，应说明用途并重新批准。签发服务、受保护配置与构建身份由独立控制者维护；同一开发账户拥有代码、执行器和签名文件无法提供独立治理。

## 证据与时效契约

签发器必须从可信控制面获得 B/H/T，不能只相信构建上传的字段。报告至少绑定仓库数字身份、PR/merge-group 身份、事件递送 nonce、B/H/T、lock 摘要、政策版本/摘要、执行器镜像或二进制摘要、命令矩阵、平台 OS/arch/image、依赖资产摘要、开始/结束时间、单 job 原始退出/信号/超时、coverage 范围/阈值和产物/日志摘要、清理结果。全量源历史与证据 refs 可审计；不依赖可移动标签。

建议试点策略为开始前和签发前分别复核候选；报告结束后 **24小时** 内且候选/基线/政策未变方可使用（拟议值，须用户确认）。超时、取消、缺日志、签名失败、环境不匹配、未知状态、NOT_RUN、BLOCKED、过期 scanner/例外或低于覆盖阈值都不得成功。GitHub 平台可能允许 neutral/skipped 满足某些规则，本项目外部验证器应只签发完整真实成功，不能利用该语义跳过检查。

受检 PR 改动 CI脚本本身时，独立政策仍从受保护版本加载；把脚本改成 `exit 0` 不得使验证器接受。允许经审核的工程命令变化时，要先变更受保护政策并重新验证。日志/JSON 摘要只证明传输一致性；独立签发还必须证明来源、授权、完整性和可信执行环境。构建 worker 的自签报告不满足此条件。

## 接入前必须实际演练的负向场景

| 试验 | 必须出现的结果 |
| --- | --- |
| 同名 context、错误 App 或个人 token 写入 | 无法满足来源绑定规则；不接受别名或 any-source |
| 旧 H、旧 B、相同 tree 但不同 commit、旧 merge-group | 拒绝，重新执行准确候选 |
| 替换日志/制品、删除一条结果、篡改 manifest/锁/工具摘要 | BLOCKED；保留原失败，不签发成功 |
| PR 将测试脚本/工作流/政策改成永远成功 | 可信政策拒绝或按原策略验证；PR无签发路径 |
| 运行中基线推进、webhook 重放、乱序后来的 FAIL 被旧 PASS 覆盖 | 失效旧成功，最新准确执行才可评价；记录 run nonce 和序列 |
| Windows/Linux缺席，超时，agent失联，签发器断网或凭据过期 | NOT_RUN/BLOCKED/FAIL；不能降级手工 PASS |
| 未经授权请求签发/更改门禁 | 拒绝并留最小审计记录；不泄漏私钥/源码内容 |
| 合并队列使用合成 commit | 必须验证实际受保护流程要求的合成源及其base/head关系，不能只验证PR旧头 |

本轮上述 L3 试验 **NOT_RUN**；L1 只完成日志/源码/工具一致性及进程结果的本地负向测试。

## 分阶段启用和回滚

1. 用户批准选定控制面、设备、预算、App权限/端口/网络与维护责任；对精确发行资产、插件传递图、隔离机制进行准入。
2. 在独立试点仓库或明确授权的非必需新 context 运行；核验准确 App ID、事件/候选绑定、平台实测和所有负向试验。构建账号无法使用 signer；持久污染和恢复演练通过。
3. 独立 reviewer 审核签发政策与证据；用户批准后才将具体新 context + App来源加入规则。并行比较期间保留旧门禁，不设 any-source。替换/退役旧来源需要另行批准和精确差异回读。
4. 后续每次升级锁定配置/工具/插件，备份 DB、加密密钥、政策、必要日志；恢复演练独立进行。发生误签/入侵时暂停调度与签发、撤销/轮换 token，保存失败及审计；不要把 required check 删除后合并。
5. 回滚到已审核配置/镜像和匹配数据库备份，重新验证准确候选；若不能恢复，门禁保持阻塞。只有明确授权才能退回旧来源规则，并需真实旧来源新验证、规则差异和回读记录。

本轮状态：L1 方案已有实际证据；L2/L3 未部署，GITHUB_CHECKS_PAUSED，EXTERNAL_SECURITY_BLOCKED、GOVERNANCE_BLOCKED、REVIEW_BLOCKED、MERGE_NOT_AUTHORIZED、TESTNET_NOT_DEPLOYED 不由06本地结果解除。仓库整体状态由01汇总准确最终候选后裁决。

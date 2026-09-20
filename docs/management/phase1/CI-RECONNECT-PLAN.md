# AlphaForge：未来恢复远程验证与可信门禁方案

> 2026-09-21 状态更新：用户已自行将仓库公开，并授权恢复GitHub只读核查与正常PR验证；由01统一调度，06不自行push/rerun。下文预算暂停阶段的记录保留为历史，不再表示当前全面禁止查询。merge、部署、规则变更、新服务/larger runner仍未授权。执行器初版证据已被05提出P1/P2；当前修复证据见CI-LOCAL-POC末尾追加，不以初版PASS代替复核。

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

## 可交付接回参数包（全部禁用，仅供批准前核对）

以下值将来由01/独立验证控制者确认；UNKNOWN/UNASSIGNED不是可以自动补全的默认值。

| 参数 | 当前值/提案 | 启用所需证据 |
| --- | --- | --- |
| enabled / publishStatus / mutateRuleset | `false / false / false` | 用户明确恢复及选定路径；本轮不执行 |
| repository | `pdbsy/quantpass-arbitrum-hackathon` | 后续只读核验实际数字repository ID及组织/所有者范围，当前ID未重新查询 |
| billingAccount / SKU / remainingBudget | `UNKNOWN / UNKNOWN / UNKNOWN` | 实际账户账单与预算确认；公共文档不足 |
| candidateH / baseB / checkoutQ / checkoutTreeM | `UNASSIGNED`（3a78e34仅历史PoC源） | 最终集成后冻结准确SHA及关系，不使用移动branch作为身份 |
| verifierAppName / appId / installationId | 拟名`alphaforge-verifier` / `UNASSIGNED` / `UNASSIGNED` | 经批准创建及实际平台回读；绝不填旧15368 |
| expectedSource | 上述真实新App ID，未创建 | 每一新required context绑定该ID；错误来源负例不能通过 |
| policyOwner / policyRepository / policyCommit | `UNASSIGNED` | 独立控制主体、受保护仓库及不可变政策版本；受检PR不能覆盖 |
| policyInputs | 命令矩阵、工具/镜像摘要、锁清单、coverage方法/阈值、来源/日志/清理要求 | 与迁移前准确政策逐条对照，审批记录及摘要 |
| resultMaxAge | 拟议24小时，尚未批准 | 用户选定时效；H/B/Q/M/政策变化均立即失效，与年龄无关 |
| executionTargets | Linux x64 / 原生Windows x64 / 原生macOS arm64 | 每类实际独立隔离节点准入；当前Windows/Linux缺口未解决 |
| node/npm/Python | 24.21.0 / 11.19.1 / 3.12.9（Python按相应job） | 精确资产摘要/架构及版本准入，不自动升级 |
| controlPlane | L1本轮；L2产品`UNSELECTED` | 选择服务后另审固定发行资产/JDK/plugins/存储/维护责任 |
| credentials/network | 本轮无；拟议权限见上表 | 密钥控制者、TTL/轮换、受控出站/TLS及按需webhook；不交给构建 |
| migrationMode | `shadow-only`提案，尚未启用 | 独立验收后另批required规则变更，旧规则保留 |
| rollbackOwner / backupRef | `UNASSIGNED` | 实際备份、可恢复版本和演练记录；故障保持阻塞 |

九个job的拟议新context精确表如下；命名仍是未注册提案，只有真实新App签发才能参与后续资格验证。

| 原job | 拟议新context | 不降低语义的比较基准 |
| --- | --- | --- |
| verify | `alphaforge-external/linux-engineering/v1` | 同完整工程链、原生Linux x64、identity/governance及在线依赖audit |
| verify-macos | `alphaforge-external/macos-engineering/v1` | 原生arm64、完整工程链和工具准入 |
| verify-windows | `alphaforge-external/windows-engineering/v1` | 原生Windows x64、完整工程链；保留文件级失败，不以单次重跑消除根因未定 |
| contracts-m3-macos | `alphaforge-external/contracts/v1` | 原生macOS arm64、同锁定合约工具/全测试与产物验证 |
| semgrep-ce | `alphaforge-external/semgrep/v1` | 相同完整源清单、规则/fixtures/版本、错误与缺报告阻塞 |
| osv-scanner | `alphaforge-external/osv/v1` | 相同全部包身份与新鲜完整响应，不漏包/网络失败放行 |
| gitleaks | `alphaforge-external/gitleaks/v1` | 同完整refs/历史/文件清单/canary，准确且有效的历史例外，不扩容例外 |
| source-policy-js | `alphaforge-external/source-policy/v1` | 相同受控文件清单与规则，仍披露非CodeQL等价 |
| dependency-delta-audit | `alphaforge-external/dependency-delta/v1` | 同准确候选依赖差异/元数据与在线audit；缺base或响应阻塞 |

绑定须明确区分四个对象：PR源head H、target base B、实际执行checkout Q、Q对应tree M。若仅执行H，必须标`Q=H`而不能宣称验证合并树；若保护流程要求merge commit或merge-group，则可信控制面获取并复核Q的父提交/合并队列关系，源码与报告同时绑定B/H/Q/M。签发对象使用平台对该事件真正要求的commit；在试点证明语义前不启用。即使两次H的tree相同，commit或base变化也重新裁决。

迁移验收需生成一张由独立reviewer确认的“旧政策摘要→新政策摘要”对照表：覆盖文件/包/历史refs分母、命令和所有步骤、原生平台、工具版本、超时/取消与非零退出、缺日志/缺网络、覆盖率四维指标及冻结阈值、历史例外范围/期限、来源App、准确候选和有效review。每条都要有真实正例/负例；任何缺失标BLOCKED。旧绿灯与新编排器能启动只能证明局部可用性，不能替代这张语义验收表。至今该迁移验收NOT_RUN。

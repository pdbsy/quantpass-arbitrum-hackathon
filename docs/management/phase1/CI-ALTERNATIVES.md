# AlphaForge：预算暂停期间的 CI 替代方案

> 2026-09-21 状态更新：用户已自行将仓库公开，并授权恢复GitHub只读核查与正常PR验证；由01统一调度，06不自行push/rerun。下文预算暂停阶段的记录保留为历史，不再表示当前全面禁止查询。merge、部署、规则变更、新服务/larger runner仍未授权。执行器初版证据已被05提出P1/P2；当前修复证据见CI-LOCAL-POC末尾追加，不以初版PASS代替复核。

Macbeth06 / M3-06-CI-GATES；资料核验日期 2026-09-20。结论是本轮采用 **L1：现有锁定脚本 + 一次性本地执行及证据入口**。已有实际 PoC；不安装 Woodpecker/Jenkins/act，不注册 runner，不申请 GitHub 凭据。L2 编排和 L3 独立门禁分别是未来方案，均未实施。

本轮账单来源、额度归属、实际 SKU、计费周期和扣费原因仍为 UNKNOWN。公开文档不能证明账户实际账单。当前 GitHub 文档区分私有仓库标准 runner 配额、存储等费用，并说明 larger runner 即使公共仓库或有剩余额度也收费；self-hosted 的硬件运维仍由使用者承担。即使后来核实免费，也须用户明确恢复授权，不能据此自动重启 Actions。[GitHub 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## 候选及能力

| 维度 | A：纯本地入口（推荐本轮） | B：Woodpecker stable | C：Jenkins LTS | 辅助：act / GitHub self-hosted |
| --- | --- | --- | --- | --- |
| 版本、许可、维护 | 本仓库 Node 24.21.0 内置模块；无新增依赖；维护责任在项目 | 3.18.1，2026-09-08 发布；Apache-2.0；有近期维护，不等于安全认证 | 2.568.3 LTS；MIT；LTS 定期安全/缺陷维护；未采用 weekly | act 0.2.89，MIT；有发行维护。self-hosted runner 按 GitHub 支持更新策略维护 |
| 最小拓扑 | 现有原生机器、独立 checkout/node_modules、单次进程、本地只增日志 | 正式：server + agent + DB；默认 SQLite，可选 PostgreSQL/MariaDB。CLI exec 可无 server 单次运行 | controller、持久 JENKINS_HOME、至少一个隔离 agent、合格 JDK；controller executor=0 | act：本机 CLI + 合格镜像/容器引擎或本机执行；self-hosted：已注册节点 + GitHub Actions 控制平面 |
| 当前设备 | 已在 Darwin arm64 实测；Windows/Linux 原生缺口保留 | stable Darwin 提供 agent/CLI，无 server 二进制；本机仅适合可信 local backend，正式部署仍缺控制面 | 当前 Mac 可做潜在 agent；controller/JDK/平台节点、维护责任未准入 | 未安装 act/runner；Mac 上的 Linux 容器不能补 Windows/macOS 原生资格 |
| OS/架构 | 原生匹配才执行；目前 POSIX supervisor 已测 Darwin arm64，Windows supervisor 尚未资格验证 | stable 支持 Linux amd64/arm64 server-agent-cli；Windows amd64、Darwin amd64/arm64 能力见下文；不能由一种节点推导全平台通过 | Java 支持矩阵内分平台 agent；Linux x64、Mac arm64、Windows x64 仍须各自工具链准入 | act 的 Windows/macOS 本机执行必须相应宿主；self-hosted 也须逐 OS/arch 设备 |
| 工具与结果复用 | 直接复用九 job 的底层脚本；有退出码、日志、source/tool hash；coverage 不会凭空生成 | 可执行同一命令并收集制品，但 YAML、事件、缓存语义需迁移验证 | 可复用脚本，Pipeline/制品和测试插件负责编排展示；插件供应链额外增加 | act 适合有限 workflow 兼容检查；self-hosted 最接近现有 workflow，但仍是 Actions |
| 不可信 PR | 不支持；只运行已审阅本地可信源码，临时 HOME 和 env 白名单不是 OS 沙箱 | local backend 无隔离；Docker daemon 权限不是安全边界；Kubernetes Pod 也需权限/网络/挂载策略 | 不得在 controller 构建；独立无凭据短寿命 agent；PR 可写 Jenkinsfile 不得获得管理/状态签发权限 | act 本机/特权 Docker 同样不能隔离恶意 PR；持久 self-hosted 节点有跨任务污染风险 |
| GitHub 权限 | 无 | stable GitHub 集成为 OAuth2 app/client secret/webhook，不能当作独立 App 门禁 | 可用 GitHub App + 经审核插件；App 私钥必须留在可信控制面，不能交给构建 | act 本地不必接入 GitHub；self-hosted 注册、仓库 token 和网络控制面需单独授权 |
| L3 来源绑定 | 无，仅本地一致性证据 | 普通 OAuth 集成不是来源锁定的独立可信 App | 可设计独立 App 来源，但签发器、配置、证据校验均需独立实现/验收 | 两者运行成功都不自动取得 required-check 资格 |
| 运维/恢复 | 保存完整 Git 历史、锁文件、只增 run 目录及外部交付摘要；逐目录保留/清理 | server/DB/配置/secret 一致备份，版本锁定、迁移试演、恢复演练；不能只退镜像而忽略 DB schema | controller/JDK/plugin 全依赖锁，JENKINS_HOME/secret 加密备份，隔离恢复演练，升级前完整快照 | act 镜像和缓存锁定清理；self-hosted OS、runner、工具和干净重建由项目负责 |
| 新增批准事项 | 本轮已有授权，无新增服务 | 正式 server、节点、端口、OAuth/webhook、运维人和预算 | controller、JDK/plugins、节点、端口、App、维护及备份 | act 引擎/镜像准入；runner 注册/费用/权限和恢复 Actions 授权 |

版本及许可依据：[Woodpecker 3.18.1](https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.18.1)、[该 tag 许可](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/LICENSE)、[Jenkins 下载及 LTS](https://www.jenkins.io/download/)、[Jenkins MIT](https://www.jenkins.io/license/)、[act 0.2.89](https://github.com/nektos/act/releases/tag/v0.2.89)、[act MIT](https://github.com/nektos/act/blob/v0.2.89/LICENSE)。这些是本次观察的固定版本，不是允许安装 latest 的指令。

## Woodpecker 稳定版核实

能力取自 **v3.18.1 tag 内 version-3.18 文档**，未以 Next 文档作依据。server 接收事件并调度，agent 执行；CLI 支持 `woodpecker-cli exec --backend-engine local` 的本地入口。后者本轮仅文档核实、没有安装或执行，所以本项目实际 PoC 归于 A。[稳定版架构](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/30-administration/00-general.md)、[稳定版本地执行](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/20-usage/73-local-execution.md)

平台表包含 Windows amd64 server/agent/CLI，Windows arm64 缺 agent/CLI；Darwin amd64/arm64 有 agent/CLI、无 server。Docker/容器运行能力还受宿主后端支持限制，不能把二进制存在等同项目九 job 全部可跑。local 后端直接用 agent 用户权限且不支持 services，适用于可信私有源码；Docker socket 或 privileged 容器能暴露宿主；Kubernetes 另需集群及 Pod 权限治理。[平台矩阵](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/30-administration/05-installation/05-supported-platforms.md)、[local backend](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/30-administration/10-configuration/11-backends/30-local.md)、[Docker backend](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/30-administration/10-configuration/11-backends/10-docker.md)、[Kubernetes backend](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/30-administration/10-configuration/11-backends/20-kubernetes.md)

稳定版 GitHub 页要求 OAuth2 应用，回调 `/authorize`、client ID/secret；并明确当前 GitHub App 集成的用户 token 刷新存在问题。故不能拿“支持 GitHub”推导具备来源绑定的合格独立 App；私有仓库授权范围也须在未来 OAuth 审批时逐项核对，不提前接受扩大访问。[稳定 GitHub 集成](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.1/docs/versioned_docs/version-3.18/30-administration/10-configuration/12-forges/20-github.md)

## Jenkins 支持与插件成本

当前 LTS 2.568.3 需要受支持 Java 21 或 25（controller、agent、CLI 都要满足）。本轮未安装 JDK/Jenkins。必要能力至少包括 Pipeline、Git checkout、Credentials；多分支需要 github-branch-source；GitHub Checks 需要 github-checks、checks-api 及 GitHub App。插件所有传递依赖仍需固定版本、许可证及安全公告复核，不能只锁顶层三项。[Java 支持](https://www.jenkins.io/doc/book/platform-information/support-policy-java/)

本次记录的可复核版本：workflow-aggregator `608.v67378e9d3db_1`（最低 Jenkins 2.479.3），github-branch-source `1983.vfa_27ed961853`（最低 2.541.1），github-checks `679.v74133da_b_435a_`（最低 2.504.3）。这些最低版本兼容当前 LTS 只是必要条件，不是完整插件组准入。Pipeline 总包可能引入不需要的插件；最终部署应锁定最少功能及全部传递图，单独审查 advisories。[Pipeline](https://plugins.jenkins.io/workflow-aggregator/)、[Branch Source 发行索引](https://updates.jenkins-ci.org/download/plugins/github-branch-source/)、[GitHub Checks](https://plugins.jenkins.io/github-checks/)

controller 设置零执行器，agent 不可读取 JENKINS_HOME/管理凭据或 sudo。签发配置在受保护的独立控制面；从 PR 获取的 Jenkinsfile 只作为不可信输入，不允许决定自身 required context、成功结论或签发密钥使用。[controller 隔离](https://www.jenkins.io/doc/book/security/controller-isolation/)

## 资源：要求、实测、估算分开

| 方案 | 官方要求（已查到） | 本轮实测 | 规划估算，不是准入或容量承诺 |
| --- | --- | --- | --- |
| 本地 A | 项目精确 Node/npm；无厂商 CI 服务最低资源声明 | Darwin 26.6.2 arm64，11 可用逻辑 CPU，36 GiB RAM；PoC 汇总见 CI-LOCAL-POC.md，执行器自身约 524 MiB maxRSS，15.226 秒；不含全部子进程峰值 | 一个串行 worker 起步；为完整工程/扫描器预留 4–8 GiB、10–20 GiB 工作盘，再实测；不是现有九 job 总需求 |
| Woodpecker | 所读 stable 文档未给足够 CPU/RAM/盘硬下限，标 UNKNOWN | 未安装，NOT_RUN | 小型控制面 1–2 vCPU、1–2 GiB、10–20 GiB 起步，另计各平台 worker/缓存/日志；需负载验证 |
| Jenkins | 官方最小 RAM 256 MiB、盘 1 GB（Docker 建议至少 10 GB）；小团队建议 RAM 4 GB+、盘 50 GB+；未给 CPU 硬下限 | 未安装，NOT_RUN | controller 起步 2 vCPU；agent 单列。官方最低值不代表本项目可用容量 |
| act / self-hosted | act 默认镜像非完整 hosted VM，部分大型镜像超过 18 GB；本轮不指定未审核镜像 | 未安装，NOT_RUN | 按原生节点和实际镜像/缓存估算，不能凭空给统一最低值；设备、电力、升级和恢复均有成本 |

Jenkins 资源来源：[Linux 安装要求](https://www.jenkins.io/doc/book/installing/linux/)。act 官方说明默认镜像、虚拟化和宿主差异：[runner 镜像](https://nektosact.com/usage/runners.html)。并有未实现/忽略的 concurrency、job permissions、timeout-minutes、continue-on-error、取消、部分环境/上下文与 OIDC 语义，故只能辅助定位，不能作为现有 workflow 的等价裁决器。[act 不支持功能](https://nektosact.com/not_supported.html)

## 选择理由与缺口

本轮没有经批准的常驻控制面、三平台隔离节点、状态签发器或运维预算。A 已能验证本地修复、保留真实失败并给出源码/工具绑定；B/C 的编排收益目前不足以抵消安装、凭据和维护成本。当前 Mac 可承担所测 L1 子集，不能据此宣称能承担完整九 job 并发。将来有跨机器队列和持续执行需求，再比较 Woodpecker 的较小控制面与 Jenkins 的平台/插件成熟度。

L1/L2 均不替代独立安全审核、外部治理、有效 review、GitHub required checks 或 merge 授权；coverage 必须来自明确范围及阈值的真实原始产物，不能由“命令 PASS”替代。GitHub self-hosted 仍需 Actions 控制平面、注册和维护，且不保证每个 job 有全新环境，因此本轮也不采用。[self-hosted 官方边界](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)

# AlphaForge 第一阶段基线门禁核验

Agent: Macbeth06 · Task: M3-06-CI-GATES · Branch: `macbeth06/m3-phase1-gates`。

核验源 / BASE_SHA：`18f5352070910a867b9729b031aa2e3951785e01`；tree：`a4b1cf782f6e5f2aaa90c955cfffb629ee5231ba`。登记源：`48cccb8743d2e77ec8001187c00e95044a3d2f40`。最终远端观察：2026-09-20 02:50:21 UTC。这是固定基线的运行核验，不是最终候选验收或独立安全审查。

| 状态 | 本次结论 | 适用范围 |
| --- | --- | --- |
| CI_EXECUTION_STATUS | PASS_BASELINE | 合并后 master run 35470492722；9 作业、102 步骤 success |
| REQUIRED_CHECKS_STATUS | PASS_BASELINE | 七项名称、来源15368、准确head与成功结果相符 |
| RULESET_STATUS | VERIFIED | 当前七项required与全部保护字段已读回 |
| REVIEW_REQUIREMENTS_STATUS | NOT_SATISFIED_FOR_NEW_WORK | 本人PR未发布；协调PR #22为Draft、reviews=[]；旧#21例外不继承 |
| EVIDENCE_INTEGRITY_STATUS | VERIFIED_WITH_LIMITATIONS | 固定SHA/tree、30项输入哈希绑定通过；Slither细粒度原始结果不在远端artifact中 |
| MERGE_READINESS | BLOCKED | 新候选未指定、本人发布受自动审批限制、正常review/适用QA与merge授权不齐 |

## 实际事件与运行

[PR #21](https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/21) 已合并，merge_commit_sha 为本次BASE；源候选 `a712685c1645d9a924dcb0931c98d917da919ced` 与该master同tree。历史PR/push验收不被改写；本次重新读取[合并后master运行](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722)，不是仅凭同tree继承结果。

该run为 push/master，attempt=1，2026-09-19 21:27:57 UTC创建，21:33:15 UTC更新为completed/success。九份日志均绑定实际checkout=head=sourceHead=BASE及上述tree。push扫描器baseHead=null如实保留；dependency-delta的事件before/base为 `7ecba357d5a19f387e86f578822af04a6261fed2`，而环境准入的当前master base字段为本次BASE；两者语义不同。

| 作业 | 实际证据 | 步骤总数 / success | 结论 |
| --- | --- | --- | --- |
| verify-macos | [job 105970432040](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432040) | 11 / 11 | success |
| contracts-m3-macos | [job 105970432045](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432045) | 11 / 11 | success |
| verify-windows | [job 105970432048](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432048) | 11 / 11 | success |
| gitleaks | [job 105970432076](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432076) | 11 / 11 | success |
| dependency-delta-audit | [job 105970432107](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432107) | 11 / 11 | success |
| source-policy-js | [job 105970432120](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432120) | 10 / 10 | success |
| osv-scanner | [job 105970432126](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432126) | 11 / 11 | success |
| semgrep-ce | [job 105970432150](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432150) | 13 / 13 | success |
| verify | [job 105970432153](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35470492722/job/105970432153) | 13 / 13 | success |

每个列出的步骤都为completed/success，无skipped/neutral/cancelled。固定 `.github/workflows/ci.yml` 没有 job/step 的条件跳过或 continue-on-error；包含完整checkout、准入、精确工具引导及真实执行步骤。校验范围是本固定版本的运行控制和日志，不是对任意未来workflow的保证。

三平台实际Node 24.21.0 / npm 11.19.1；Linux x64 image 20260907.300.1、macOS arm64 image 20260907.0337.1、Windows x64 image 20260907.229.1。三平台各591 tests/pass、0 fail/skip/cancel；Linux另有10项治理测试。环境准入exitCode=0、eligibleForEvidence=true，remoteFreshness=NOT_RUN保持原值。

Action来源固定为checkout `3d3c42e5aac5ba805825da76410c181273ba90b1`、setup-node `820762786026740c76f36085b0efc47a31fe5020`、setup-python `e797f83bcb11b83ae66e0230d6156d7c80228e7c`。全历史fetch、persist-credentials=false、contents:read、固定超时及CPython 3.12.9/目标架构均在固定执行路径。镜像标签和上游下载/漏洞数据库仍有外部可变性，不将版本固定等同独立供应链证明。

## 合约与四个collector NOT_RUN

合约job日志记录 Forge 1.5.1-v1.5.1 / commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`，solc 0.8.31+commit.fd3a2265.Darwin.appleclang，Slither 0.11.3，原生CPython 3.12.9 arm64。bootstrap、compiler-probe、contracts-and-abi阶段均PASS，明确exitCode=0/incomplete=false；121 Solidity测试、20 Python测试，冻结Vault ABI比较通过。

| collector项 | collector真实状态 | 本BASE的独立执行证据 | 边界 |
| --- | --- | --- | --- |
| foundry | NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR | check-local.sh执行fmt/build/test；121测试、14 suites、零失败/跳过 | 不是覆盖率测量或链上部署 |
| fuzz | 同上 | 日志20条testFuzz PASS，各runs=256 | 固定配置seed=0x04；未宣称覆盖所有性质 |
| invariant | 同上 | 日志8条invariant PASS，各runs=64/calls=2048/reverts=0 | 固定depth=32、fail_on_revert=true；非形式证明 |
| slither | 同上 | 日志版本0.11.3；check-local.sh的strict命令为contracts-and-abi返回0的必要前序 | 未获取原始JSON的目标/探测器数量，不能捏造零发现清单 |

证据链：`tools/ci/verify-contracts.mjs` → `contracts/script/check-m3-vault.sh` → `contracts/script/check-local.sh`，shell为set -euo pipefail，清理环境后固定FOUNDRY_PROFILE=default，无可选跳过；Slither命令为 `slither . --compile-force-framework foundry --exclude-dependencies --fail-pedantic --foundry-out-directory ../.checks/af-chain01/out --json -`。随后ABI校验成功，支持该Slither命令实际完成并退出0；第三方dependencies被明确排除。其JSON写入忽略的本地文件，当前workflow未上传artifact，本run artifacts API返回0。因此执行成功的证据成立，原始结果内容的独立读回仍NOT_RUN；不能把安装版本行本身当作扫描报告。

**缺口分类**：四项collector占位的NOT_RUN本身不是“合约从未运行”的硬缺口。基线 `docs/management/dashboard/README.md` 与 `docs/security/CI-GATES.md` 明确允许独立门禁另存来源；当前登记规范也允许“保留NOT_RUN并明确独立证据路径/范围”。本基线已具备上述真实独立执行。不得回填四项PASS。最终阶段仍必须在统一候选重验这些检查，并满足roadmap/有效任务的覆盖率、独立复核与完整证据要求；121测试数量不能替代90%总体/关键分支要求。Slither细粒度结果未归档属于当前可追溯粒度限制，已提出最小整改建议，未擅自删除阶段验收要求或认定全阶段完成。

## 三扫描器及附加检查

- Semgrep CE 1.177.0：107文件、990505 bytes，22规则/44实际引擎正反样例，findings=[]。JS/TS/Python选定范围与函数内污点；排除测试目录、HTML内联脚本及其他语言。不声称CodeQL跨函数/跨文件等价。
- OSV 2.6.0：317唯一包/源码身份，根npm217条目、三Python锁179条目，全部5份输入锁有哈希，findings=[]。保持所有不同版本；覆盖OpenZeppelin、Forge npm及Foundry源码commit；原生solc、Go内嵌依赖、Actions/Node/Python runtime在unmapped中明确排除。所有返回advisory阻断。
- Gitleaks 8.30.1：306 commits、503跟踪文件/5335198 bytes，实际refs清单及refsSha256已记录；history/currentFiles PASS，canary=PASS、rootDeletedSideTagMerge=true、redaction=PASS。非浅克隆/连通性检查、全部已fetch refs+HEAD及当前跟踪文件；不覆盖无法取得/已删除远端refs或未跟踪个人文件。脱敏canary为hosted自检，不是独立安全审查；没有保存或转发真实秘密、canary值、原始扫描报告。
- source-policy-js：103文件、969979 bytes，0 errors/warnings/findings，保留四条语法规则边界。
- dependency-delta-audit：相对真实push前序base的added/removed/changed为空，exitCode=0、所有advisory计数0；保留根npm变更、许可/来源完整性与高危审计边界。

固定 `tools/security/results.mjs` 拒绝进程异常、信号、错误退出码、畸形/空或部分报告、缺失路径/包集合、版本错误等；`tools/ci/context.mjs` 将PASS/FAIL/BLOCKED分别映射0/1/2。scanner摘要不直接输出原始子进程数值：空发现PASS只接受0；Semgrep正例命中要求1、Gitleaks canary要求10，这些数值由固定分类契约与成功结果推导，不伪称独立原始数值日志。本机未运行扫描或重新验证安全发现。

## 规则与审批

规则集22507334最终读回ACTIVE，target master；七个required contexts为verify、verify-macos、verify-windows、semgrep-ce、osv-scanner、gitleaks、contracts-m3-macos，全部integration_id=15368。对应本BASE的check-runs名称/app.id/head_sha/结论均相符。strict_required_status_checks_policy=true、do_not_enforce_on_create=true。

required_approving_review_count=1、require_code_owner_review=true、require_last_push_approval=true、dismiss_stale_reviews_on_push=true、required_review_thread_resolution=true、require_extra_approval_for_unattributed_changes=true。仅squash/rebase；required_linear_history、deletion、non_fast_forward均保留；bypass_actors=[]、current_user_can_bypass=never。CODEOWNERS仍路由至共享账号；这不是独立审核身份。

协调Draft PR #22源为登记提交、base为本BASE，reviews=[]、mergeable_state=blocked；它不是最终统一候选。自己的新PR尚不存在。#21已合并的历史一次性review例外不能扩展到本轮。没有独立审批替代、GOV-001/SUPPLY-001关闭或新merge授权。旧CodeQL/Dependency Review工作流仍手动运行，在此范围未执行，不改写旧失败。

## 证据精度、命令与下一步

本次实际使用只读 `git fetch --no-prune origin`、固定SHA的 `git show`/tree/status及 `gh api` 查询run/jobs/logs/check-runs/artifacts/ruleset/PR/reviews。九份有界日志摘要均绑定本BASE；30项报告输入哈希逐字匹配固定Git对象，包括root lock、scanner lock/rules、5份OSV输入和contract lock。报告记录的是原始hosted执行结果，不是新生成的C/R/S PASS证据。API快照、提取摘要、源输入和SHA256清单在本任务隔离证据目录保留；本报告链接可重取的正式run/job，避免提交个人路径和主机画像。

最终候选必须重新提供source/head/base/tree及PR，重新读取push/PR和适用master运行、全部步骤/输入哈希与实时review/rules。当前本人本地报告提交不具备hosted CI，不能以此BASE绿灯背书。

最小整改建议交给Macbeth01串行处理：在后续合约门禁报告中输出脱敏的Slither目标/探测器/发现数量及报告SHA256，保留真实执行状态；或归档有界脱敏结果并注明保留期限。若选择接入collector，应真实运行并验证其schema/provenance，不复制独立job的PASS。当前仅提出要求，不更改CI/scanner/collector。

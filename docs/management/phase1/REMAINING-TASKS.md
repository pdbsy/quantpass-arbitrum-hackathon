# 第一阶段全量剩余任务矩阵

归属：AlphaForge / Robinhood Chain Testnet / pdbsy/quantpass-arbitrum-hackathon / PR22；Macbeth01；AF_Xlayer独立。当前授权、缺口与最终验收口径见[本轮收口记录](PR22-READY-CLOSEOUT-2026-09-23.md)。当前处于最终候选冻结前，局部验证不能代表最终Ready。

字段以[JSON矩阵](remaining-tasks.json)为事实源；旧检查点保存在各项 prior_checkpoint，不冒充当前候选。真实部署任务单列且不在本轮执行授权内。

| Task | Owner | 目标 | 当前状态 | 关闭条件 | 证据 / 阻塞 |
| --- | --- | --- | --- | --- | --- |
| PH1-01 | 01 | 固定基线、登记、文档/路线图/状态板同步 | IN_PROGRESS | 所有来源映射；真实 ACK；无旧状态冒充当前 | 01统一来源登记、独立审阅和C/R/S。基线f966dd2的1069缺口保留；旧6a完整报告及后续局部命中仅用于排序，最终同一候选重新全量测量。02/03 f403已正常集成，最终采集器修复等待独立复核。 / FINAL_CANDIDATE_FREEZE |
| PH1-02 | 02 | Pass 固定供应、策略绑定、完整权限/事件/ABI；只补缺 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 25 Vault selectors/7 topics 等完整 compiler equality；发行/转账精度及异常 token 回归 | 合约源e09e639保持；6a完整原生160 Solidity测试/19 suites、fuzz/invariant、Slither通过。合约LCOV原缺42减少27，余15保留限定说明与分母；新最终候选复验待运行。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-03 | 02 | 可重建构建、constructor/immutables/bytecode 清单和本地 VM 演练 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 干净重建一致；重复运行不覆盖；明确无外部链广播 | 6a完整原生合约门禁与2次本地部署演练通过，ABI与制品绑定保持；没有真实Testnet部署。准确最终源需同一完整验收。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-04 | 03 | manifest、地址/字节码/ABI、三方链身份与调用目标校验 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 错链/错地址/错ABI/错owner失败关闭；真实参数缺失保持 NOT_DEPLOYED | 03来源图与链身份/ABI/地址边界经独立源码复核；05同源后端、chain-store、domain、部署配置局部117/117通过。完整6a为历史，最终新候选待验收。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-05 | 03 | 拒签/revert/replaced/dropped/断线/模糊提交/重复回调恢复 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | SUBMISSION_AMBIGUOUS 不自动重发；刷新恢复不重复经济动作 | 已有模糊提交不重发、账户/会话隔离与恢复回归；本轮实际UI迟到review/confirm/本地API完成跨模块修复并独立浏览器复验。最终原始断言和状态迁移须在新候选重跑。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-06 | 03 | 有界 catch-up、重组、跨进程所有权和多实体隔离 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 同块多操作不丢失；无共同祖先保留证据且持久degraded | 索引重组、租约/事务失败、损坏输入及幂等路径已有来源绑定回归；保留05后端限定审阅，最终完整验收与剩余图分类待准确候选。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-07 | 03 | 数据库迁移、备份恢复、健康/故障说明和演练 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 备份一致且不覆盖原库；恢复后身份和索引对账；实际 RPO/RTO | SQLite query_only健康误报已修复并回归；本轮管理检查真实120秒超时管道滞留和同步错误递归修复8d85df2通过05独立25/25，清理未确认不发布complete/latest。最终统一验收待运行。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-08 | 04 | 暖色英文实际入口、六页信息和数据来源标签 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 主页/市场/详情/账户/用户论坛/排名准确；不改未使用React入口 | 原主界面与管理看板回归保留；真实禁用localStorage、跨窗口同步、公开API及迟到会话响应新增断言已集成f403。05独立普通CLI6/6、native资格7/7、Node hook13/13通过；实际browser collector须经新修复并统一全量复验。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-09 | 04 | 发行/分配或获取 Pass、自由转账、创建/选择 Vault 操作入口 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 1 PASS容量不等于价格；转账18位；创建或选择 Vault；受审 allowlist 选择满足产品路径，创建保留显式 Owner 部署流程；切换废弃旧意图/模拟 | 固定供应、首发分配、18位转账、allowlist Vault选择范围不变。ab16a84拒绝canonical账户中未知策略Pass并保持旧状态；05原源码RED、修复57/57与三工作流独立通过。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-10 | 04 | 有限授权、模拟/会话复核、存入/提款/close/post-close rescue | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 关闭后禁用存取/close和无效approve；合法Owner rescue可执行；金额不舍入 | 支持的Vault授权/存取/关闭/关闭后救援范围不变，迟到响应保持原身份与单次经济动作；独立浏览器回归已有，当前新候选须统一复验。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-11 | 04 | API/index degraded 下 canonical 直接读和Owner退出 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | API失败不显示陈旧READY；链/Owner可验证时退出仍可用 | degraded状态、真实链身份与Owner退出边界保留；已验证失败不显示伪成功，保留本地mock与未部署区分，最终同一源码报告待验收。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-12 | 05 | 功能验收矩阵、准确覆盖率与跨层独立复测 | IN_PROGRESS_NOT_COMPLETE | 测量总体90%目标和关键授权会计100%分支要求；不足仍FAIL/BLOCKED，不拿数量替代 | 05已独立复核源码图和原始计数；旧37e证据包287条限定证明/4条语义已验但计数未观察，不等于最终命中。新增真实双browser采集器修复feb25f1与最终S/full图待复核；不移植旧源命中。 / FINAL_CANDIDATE_COVERAGE_AND_METHOD_REVIEW |
| PH1-13 | 05 | 独立最终安全复核 | BLOCKED_EXTERNAL_REVIEW | 服务限制未解除不得重试规避；普通功能复测不能代替；无伪造通过 | 05 2026-09-19服务失败；新05状态报告 / EXTERNAL_REVIEW |
| PH1-14 | 06 | 7必需CI、附加任务、合约/scanner覆盖和证据真实性 | FINAL_CANDIDATE_HOSTED_PENDING | 9jobs每关键步骤实际执行；错误失败关闭；旧CI失败不改写 | 正常公开发布及标准CI已授权；准确最终head须通过7必需+2现有附加job及承诺CodeQL/Dependency Review。06已交付扫描器与Windows回归，当前会话受服务限制；01继续原定集成、全量验收和远程核验，独立身份/安全服务限制仍单列。 / EXACT_HEAD_REMOTE_CI |
| PH1-15 | 01 | 仓库外不可被受检diff替换的治理验证与独立身份 | BLOCKED_EXTERNAL_AUTHORITY | 不可仅改JSON verified；外部修订/摘要/强制规则/失败样本均可验证 | docs/security/SUPPLY-CHAIN.md；组织准备方案 / EXTERNAL_DEPENDENCY_AND_AUTHORIZATION |
| PH1-16 | 用户 | 首发分配与转账纳入；付费销售和真实Buy/Sell由用户明确移出第一阶段 | USER_DECIDED_OUT_OF_PHASE_FOR_PAID_TRADING | 不实现付费机制；不重复询问已确认范围 | docs/management/phase1/DECISIONS.md；用户本轮异步答复 / NONE |
| PH1-17 | 01 | 旧PR15–20覆盖与superseded关系；Dependabot12/13单列 | SOURCE_RECONCILED | 不凭非祖先判断缺失；不重复merge；不删除来源refs；未覆盖差异保留任务 | PR-SUPERSESSION.json / PR-SUPERSESSION.md；PR15–20 已按准确来源覆盖证据关闭，原 refs 保留 / NONE |
| PH1-18 | 01 | 4项合约NOT_RUN采集边界 | SCOPED_LOCAL_CONTRACT_EVIDENCE_LINKED | 不得手填PASS；若阶段硬门槛则真实解决；否则明确两套证据覆盖 | 6a原生门禁160 Solidity/19 suites、fuzz/invariant/2演练/Slither/ABI及制品绑定通过。管理collector4个未注册NOT_RUN保留，以独立原生工作流证据覆盖，不手改PASS。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-19 | 01 | 统一候选、干净环境复现、演示/恢复和交付包 | IN_PROGRESS | 实现/本地/CI/QA/review/merge/testnet各状态分列；所有限制留存 | 01已正常集成f403原生浏览器交接并登记真实修订，169项迁移当前摘要一致。feb25f1修复多browser共享关闭Promise的实际缺陷，本文件全部8项真实资格通过；最终独立复核/C/R/S/14工作流/准确head托管验证待完成。 / FINAL_CANDIDATE_FREEZE_AND_ACCEPTANCE |
| PH1-20 | 01 | 核验实际GitHub审批和合并条件；本轮到Ready后停止 | REVIEW_BLOCKED_STOP_AT_READY | 全部准确head门禁和实际审批条件满足；不降低规则、不代签、不自动merge | 2026-09-24只读核验：ruleset22507334仍要求1独立审批、CODEOWNERS、末次push审批、解决讨论及7 required checks。当前仅pdbsy有写权限且为PR作者，review列表为空；不得降规则或代签。本轮到Ready停止，不合并。 / GITHUB_INDEPENDENT_REVIEW |
| PH1-21 | 01 | 真实部署参数、Owner/Creator/策略、资产与交易清单 | PREPARE_THEN_REQUEST_AUTHORIZATION | 先完整方案再批准；不向聊天索要私钥助记词；无自动重发 | 新02部署方案；新03smoke；01审批包 / DEPLOYMENT_PARAMETERS_AND_AUTHORIZATION |
| PH1-22 | 01 | 真实Testnet发行/分配/转账/Vault授权存提款关闭验收 | NOT_RUN | local VM/mock非testnet；仅批准交易；未知结果先查链 | 尚无真实链证据 / EXTERNAL_CHAIN_AUTHORIZATION |
| PH1-23 | 04 | 确认中Vault A→B与A→B→A失效；Vault action/Pass transfer/deposit approval | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 05定向独立复测；真正钱包发送前失效，已发送操作按原身份跟踪 | Vault切换与Pass/授权动作隔离已有真实mock浏览器证据；cd75eaa、ed0ab28、d9640fd三类迟到弹窗缺陷均经05独立复测。后续集中批次待最终源码映射，不借旧绿。 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-24 | 06 | 九job本地映射、Woodpecker/Jenkins/act比较、PoC与接回方案 | SCOPED_LOCAL_VERIFIED_FINAL_CANDIDATE_PENDING | 真实失败/超时/日志缺失负例；无新服务/凭据；未运行平台NOT_RUN | 现有本地CI映射和失败/超时/日志缺失证据保留；没有部署新CI服务。03原生监督修复8d85df2通过独立25项，06真实Windows补测已准备，平台专属结果待托管环境。 / EXACT_PLATFORM_ACCEPTANCE |
| PH1-25 | 05 | 使用保存日志调查Windows文件级进程失败 | REAL_WINDOWS_FINAL_HEAD_PENDING | 06协作；无合格原生Windows则NOT_RUN，不用macOS证明Windows通过 | 远程旧头Windows结果仅历史证据。1142996新增真实Windows120秒超时回归，05静态复核已通过；macOS实际0PASS/1SKIP。准确最新head在Windows-2025实跑后才能结论。 / EXACT_WINDOWS_HEAD_RETEST |

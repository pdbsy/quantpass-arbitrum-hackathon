# 第一阶段全量剩余任务矩阵

归属：AlphaForge / Robinhood Chain Testnet / pdbsy/quantpass-arbitrum-hackathon / PR22；Macbeth01；Xlayer独立。最新集中补测与全量收口见[当前记录](BRANCH-CLOSEOUT-2026-09-23.md)。下表旧候选的PASS只保留原范围，不代表最终统一候选；新头托管和独立准入保持待验收。

字段以[JSON矩阵](remaining-tasks.json)为事实源。

| Task | Owner | 目标 | 当前状态 | 关闭条件 | 证据 / 阻塞 |
| --- | --- | --- | --- | --- | --- |
| PH1-01 | 01 | 固定基线、登记、文档/路线图/状态板同步 | IN_PROGRESS | 所有来源映射；真实 ACK；无旧状态冒充当前 | 集中补测在2b052c5及前序批次累计减少410个未变源码原有缺口，修复脱敏语法优先级；按准确源统一C/R/S和全量验收，本地交付，不预写PASS / NONE |
| PH1-02 | 02 | Pass 固定供应、策略绑定、完整权限/事件/ABI；只补缺 | PASS_AT_LOCAL_778F71A_CHECKPOINT | 25 Vault selectors/7 topics 等完整 compiler equality；发行/转账精度及异常 token 回归 | 778f71a完整140 Solidity/25 Python/2演练/Slither/ABI/manifest通过；06独立140/140+后段失败回滚探针1/1及8制品绑定通过，正式回归纳入待新头复验 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-03 | 02 | 可重建构建、constructor/immutables/bytecode 清单和本地 VM 演练 | PASS_AT_LOCAL_778F71A_CHECKPOINT | 干净重建一致；重复运行不覆盖；明确无外部链广播 | 准确778f71a生成制品与完整编译一致、2离线演练通过；06独立8制品和23依赖派生等价通过；NOT_DEPLOYED保留 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-04 | 03 | manifest、地址/字节码/ABI、三方链身份与调用目标校验 | PASS_AT_PR26_SOURCE_CHECKPOINT | 错链/错地址/错ABI/错owner失败关闭；真实参数缺失保持 NOT_DEPLOYED | PR26 a4d73bb；05独立643/643，冻结Chain/API关键授权会计分支清单已通过；整体13文件95.39%分支保持原值；统一3a78e34已独立711/711通过，旧关键子集不重新标OPEN；本轮差异需准确复验 / CANDIDATE_DEPENDENCY |
| PH1-05 | 03 | 拒签/revert/replaced/dropped/断线/模糊提交/重复回调恢复 | PASS_AT_LOCAL_778F71A_CHECKPOINT | SUBMISSION_AMBIGUOUS 不自动重发；刷新恢复不重复经济动作 | 06准确195efd5独立58/58+5探针通过；相同实现于778f71a完整858/858及实际M3浏览器9组/9mock发送通过 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-06 | 03 | 有界 catch-up、重组、跨进程所有权和多实体隔离 | PASS_AT_LOCAL_778F71A_CHECKPOINT | 同块多操作不丢失；无共同祖先保留证据且持久degraded | 03失租回滚379d9cc经理55/55复验，统一778f71a完整858/858通过；历史多Vault隔离边界保留 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-07 | 03 | 数据库迁移、备份恢复、健康/故障说明和演练 | AUDIT_001_INDEPENDENT_LOCAL_RETEST_PASS | 备份一致且不覆盖原库；恢复后身份和索引对账；实际 RPO/RTO | 06在b9283da独立124/124与额外5项v6/v7恢复/结构拒绝/迁移回滚检查通过；至54540a7实现相同，非hosted或外部安全批准 / CANDIDATE_RETEST |
| PH1-08 | 04 | 暖色英文实际入口、六页信息和数据来源标签 | PASS_AT_LOCAL_778F71A_CHECKPOINT | 主页/市场/详情/账户/用户论坛/排名准确；不改未使用React入口 | 准确778f71a扩展旧界面实际浏览器及M3浏览器均通过；暖色产品入口与蓝色管理看板分别验证 / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-09 | 04 | 发行/分配或获取 Pass、自由转账、创建/选择 Vault 操作入口 | PASS_AT_PR27_SOURCE_CHECKPOINT | 1 PASS容量不等于价格；转账18位；创建或选择 Vault；受审 allowlist 选择满足产品路径，创建保留显式 Owner 部署流程；切换废弃旧意图/模拟 | 3a78e34历史统一功能检查与真实local/mock浏览器通过；本轮新增确认中Vault切换竞态待验证/复测，不继承为新候选PASS / CANDIDATE_DEPENDENCY |
| PH1-10 | 04 | 有限授权、模拟/会话复核、存入/提款/close/post-close rescue | DELIVERED_PENDING_FINAL_ACCEPTANCE | 关闭后禁用存取/close和无效approve；合法Owner rescue可执行；金额不舍入 | 3a78e34历史统一功能检查与真实local/mock浏览器通过；本轮新增确认中Vault切换竞态待验证/复测，不继承为新候选PASS / CANDIDATE_DEPENDENCY |
| PH1-11 | 04 | API/index degraded 下 canonical 直接读和Owner退出 | DELIVERED_PENDING_FINAL_ACCEPTANCE | API失败不显示陈旧READY；链/Owner可验证时退出仍可用 | 3a78e34历史统一功能检查与真实local/mock浏览器通过；本轮新增确认中Vault切换竞态待验证/复测，不继承为新候选PASS / CANDIDATE_DEPENDENCY |
| PH1-12 | 05 | 功能验收矩阵、准确覆盖率与跨层独立复测 | IN_PROGRESS_NOT_COMPLETE | 测量总体90%目标和关键授权会计100%分支要求；不足仍FAIL/BLOCKED，不拿数量替代 | 完整基线6148305：979/979、九工作流PASS，四维92.67/90.44/92.38/86.01；集中补测未变源码原有缺口减少410个，脱敏源单独重采集。统一最终值、独立方法准入和关键语义验收分别判断 / COVERAGE_THRESHOLD_AND_FINAL_METHOD_ADMISSION |
| PH1-13 | 05 | 独立最终安全复核 | BLOCKED_EXTERNAL_REVIEW | 服务限制未解除不得重试规避；普通功能复测不能代替；无伪造通过 | 05 2026-09-19服务失败；新05状态报告 / EXTERNAL_REVIEW |
| PH1-14 | 06 | 7必需CI、附加任务、合约/scanner覆盖和证据真实性 | REMOTE_3A78E34_9_JOBS_PASS_NEW_CANDIDATE_PENDING | 9jobs每关键步骤实际执行；错误失败关闭；旧CI失败不改写 | 06实际run35499025043/attempt3 9/9 PASS含7/7 required，经理GitHub API回读一致；仅远程旧头3a78e34，新候选待发布及复验 / NEW_CANDIDATE_HOSTED_AND_SCANNER_RETEST |
| PH1-15 | 01 | 仓库外不可被受检diff替换的治理验证与独立身份 | BLOCKED_EXTERNAL_AUTHORITY | 不可仅改JSON verified；外部修订/摘要/强制规则/失败样本均可验证 | docs/security/SUPPLY-CHAIN.md；组织准备方案 / EXTERNAL_DEPENDENCY_AND_AUTHORIZATION |
| PH1-16 | 用户 | 首发分配与转账纳入；付费销售和真实Buy/Sell由用户明确移出第一阶段 | USER_DECIDED_OUT_OF_PHASE_FOR_PAID_TRADING | 不实现付费机制；不重复询问已确认范围 | docs/management/phase1/DECISIONS.md；用户本轮异步答复 / NONE |
| PH1-17 | 01 | 旧PR15–20覆盖与superseded关系；Dependabot12/13单列 | SOURCE_RECONCILED | 不凭非祖先判断缺失；不重复merge；不删除来源refs；未覆盖差异保留任务 | PR-SUPERSESSION.json / PR-SUPERSESSION.md；PR15–20 已按准确来源覆盖证据关闭，原 refs 保留 / NONE |
| PH1-18 | 01 | 4项合约NOT_RUN采集边界 | LOCAL_CONTRACT_EVIDENCE_LINKED | 不得手填PASS；若阶段硬门槛则真实解决；否则明确两套证据覆盖 | 778f71a完整140 Solidity/25 Python/2演练/Slither/ABI/manifest实际通过；独立LCOV核心Vault/Locker/Pass行/函数/分支均100%，不把collector四项NOT_RUN手改PASS / FINAL_CANDIDATE_ACCEPTANCE |
| PH1-19 | 01 | 统一候选、干净环境复现、演示/恢复和交付包 | IN_PROGRESS | 实现/本地/CI/QA/review/merge/testnet各状态分列；所有限制留存 | 778f71a本地完整执行、独立06回滚证据和真实来源发布清单已准备；新状态/探针/托管来源配置需准确候选复验及交付包 / DEPENDENCIES |
| PH1-20 | 01 | 正常PR审批与本轮合并 | REVIEW_BLOCKED_MERGE_NOT_AUTHORIZED | 不复用21例外、不降规则；实际merge后master验证 | ruleset22507334；本轮最终PR / GITHUB_REVIEW_AND_MERGE_AUTHORIZATION |
| PH1-21 | 01 | 真实部署参数、Owner/Creator/策略、资产与交易清单 | PREPARE_THEN_REQUEST_AUTHORIZATION | 先完整方案再批准；不向聊天索要私钥助记词；无自动重发 | 新02部署方案；新03smoke；01审批包 / DEPLOYMENT_PARAMETERS_AND_AUTHORIZATION |
| PH1-22 | 01 | 真实Testnet发行/分配/转账/Vault授权存提款关闭验收 | NOT_RUN | local VM/mock非testnet；仅批准交易；未知结果先查链 | 尚无真实链证据 / EXTERNAL_CHAIN_AUTHORIZATION |
| PH1-23 | 04 | 确认中Vault A→B与A→B→A失效；Vault action/Pass transfer/deposit approval | PASS_AT_WORKER_RETEST_INTEGRATED_QA_PENDING | 05定向独立复测；真正钱包发送前失效，已发送操作按原身份跟踪 | 04 aa6c764 guard; 05 independent717/717; f26 driver independent9 mock sends; integrated9aefa70 810 tests PASS; final source QA pending / ENGINEERING_VALIDATION |
| PH1-24 | 06 | 九job本地映射、Woodpecker/Jenkins/act比较、PoC与接回方案 | PASS_AT_WORKER_RETEST_INTEGRATED_QA_PENDING | 真实失败/超时/日志缺失负例；无新服务/凭据；未运行平台NOT_RUN | 06 c817 runner19/19 plus05 independent22 probes;62444c8 identity58/58 independently reviewed; no new services installed / LOCAL_VALIDATION |
| PH1-25 | 05 | 使用保存日志调查Windows文件级进程失败 | REMOTE_3A78E34_WINDOWS_PASS_NEW_CANDIDATE_PENDING | 06协作；无合格原生Windows则NOT_RUN，不用macOS证明Windows通过 | 06实际Windows2025标准runner在run35499025043/attempt3通过711/711；仅远程旧头，当前本地新候选另测 / EXACT_CANDIDATE_RETEST |

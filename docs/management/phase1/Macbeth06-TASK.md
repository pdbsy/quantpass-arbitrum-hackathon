# 本轮增量：预算暂停与本地替代验证

身份仍为 Macbeth06 / M3-06-CI-GATES，分支 macbeth06/m3-phase1-gates。精确本轮源码起点 3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8；worker仅只读等价映射，不把经理混合历史合入普通worker分支。读[新规范](../specs/PR22-LOCAL-CLOSEOUT-2026-09-20.md)与[暂停记录](CI-BUDGET-PAUSE.md)。

本轮允许独占实现 tools/local-ci/**、test/local-ci*.test.mjs 与五份报告：CI-ALTERNATIVES.md、CI-LOCAL-POC.md、CI-GATE-MAPPING.md、CI-RECONNECT-PLAN.md、WINDOWS-PROCESS-FAILURE.md，均位于当前phase1目录。使用Node内置库，固定可信本地源码、无状态签发凭据、无驻留服务。共享package/正式CI策略仅由01处理。允许本地提交；禁止远程push/PR操作、Checks查询或托管执行。

成功/失败/超时/异常/缺日志/未运行平台、准确源码工具绑定、失败历史保留与清理必须有实际PoC结果。官方资料用于核验选型和费用边界，未知账单仍UNKNOWN；不安装或接入Woodpecker/Jenkins。本文增量覆盖下方旧只读职责中的对应部分，不改变保护规则、安全服务限制和权限边界。

## 历史任务记录

# Macbeth06 — M3-06-CI-GATES

BASE_SHA: `18f5352070910a867b9729b031aa2e3951785e01`
Branch: `macbeth06/m3-phase1-gates`
Goal: 只读 CI/规则/证据核验与合约/scanner 覆盖核对
Scope: docs/management/phase1/Macbeth06-* 和自有只读报告；不改业务、CI、scanner、ruleset 或 review 政策
Dependencies: 复用登记身份；起点 base；后续绑定每个准确候选；不是 05 或独立 GitHub 审批

Read [the full assigned user scope](../specs/PHASE1-CLOSEOUT-2026-09-20.md), especially the frozen constraints and your worker section, and [assignments](ASSIGNMENTS.md). Current instructions supersede historical inactive/startup states only within this assignment.

Acceptance: report precise source/candidate/tree/environment/commands/results; preserve failures and NOT_RUN; provide versioned handoff, own retrospective and original PR/Forum ACK. No Testnet broadcast, signing, merge, rule weakening, history rewrite or invented approval. The new Task Intake is not yet received.

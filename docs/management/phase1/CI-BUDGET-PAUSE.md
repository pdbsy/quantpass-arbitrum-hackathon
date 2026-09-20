# PR22 本地收尾与托管执行暂停

当前状态：HOSTED_VALIDATION_AUTHORIZED / NOT_READY_TO_MERGE。

2026-09-21 用户明确更新：“我仓库开public了，可以正常验证pr了”。经理随后实际只读核验 repository visibility=PUBLIC、Actions enabled=true、默认分支master；用户完成可见性变更，agent未改设置。PR #22 仍 Draft，准确远程头3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8，旧头9项检查成功。真实fetch后master仍18f5352070910a867b9729b031aa2e3951785e01。恢复正常PR查询与验证，由01统一调度；不会重复用旧头绿灯签收新候选。现有runner为标准GitHub托管ubuntu-24.04、windows-2025、macos-15，没有新增服务、larger runner、费用承诺、规则变更或merge授权。历史账单原因仍UNKNOWN。

下面保留恢复前的暂停范围与历史事实；其中“禁止托管查询/执行”和“公开仅未来选项”已由上述用户新指令更新。原完整规范见 [完整规范](../specs/PR22-LOCAL-CLOSEOUT-2026-09-20.md)。

本轮本地 SOURCE_BASE / 起始候选为 `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`，tree `6f1a21845a99e16a0ba171612cd97e9bf3439294`；已存在的本地 master 为 `18f5352070910a867b9729b031aa2e3951785e01`。启动时经理分支 `macbeth01/m3-phase1-closeout` 干净，origin 为唯一正式仓库 pdbsy/quantpass-arbitrum-hackathon。以上来自本地 Git；本轮未重新核验远程 Checks。

- 用户明确暂停 GitHub 托管执行和 Checks 状态查询。实际额度类型、计费 SKU 与账单原因：UNKNOWN。无需先查明费用才能继续本地工作。
- 不触发、重跑、轮询 Actions/Checks；不 push、不新建/重开远程 PR、不改 Draft/标签，不上传收费缓存或制品。本地报告不得伪装 hosted provider。
- 不修改 Actions 开关、ruleset、required checks、CODEOWNERS 或权限；不使用 skip-ci、跳过任务、吞退出码等替代真实通过。
- 本地可信候选允许实现、测试、提交与只读成果交接；保留作者和完整历史，不直接修改其他 Worker 工作区，不共享可写依赖或数据库。
- 02–06 继续原身份与任务，由 01 协调；所有问题先回 01。安全服务限制不绕过。
- Woodpecker/Jenkins/act 仅调研及既有安全环境许可范围内 PoC；不安装常驻服务、不创建 App/Webhook/runner/secrets，不新增费用或公开端口。
- 仓库公开仅为用户提出的未来后备选项，本轮没有可见性变更授权。即使发现免费运行选项，也必须等待用户明确恢复托管执行。
- 合并、真实 Testnet 部署与钱包交易仍需各自适用授权。历史 CI 与审批不能用于放行新候选。

当前工作区中的历史记录保留原始日期和 SHA；新候选的本地/覆盖率/安全/治理/托管/审批/合并/部署状态分别记录。未声称已停掉仓库外所有定时任务。

# Macbeth06 LOCAL 身份入口独立工程复核

记录日期：2026-09-21；Macbeth05 / `M3-05-PHASE1-ACCEPTANCE`。

结论：**PASS_AT_62444C8 / REAL_CANDIDATE_VALIDATION_PENDING**。独立回归 **58/58 PASS**，未发现新增阻塞问题。这里通过的是准确工具提交上的本地/托管分流与来源校验逻辑；真实经理候选的清单、ref 和完整 ancestry 仍须另行验证。此过程身份不等同独立审查身份或 GitHub approval。

来源 HEAD `62444c86c35c9af4c1a76a49c9a7c231f5a47f90`，tree `5085b189c2adc441b20e81ed5eec730d2b78f3db`，parent `c817e94163c14b882b67cfa53400cae032a9a4f4`。从 06 本地仓库取得准确对象，在05既有独立 clone `/private/tmp/AlphaForge-M3-05-LOCAL-CI-D1C52E3` 检出；未复制 worker 同时在写的工作树。Node 24.21.0 / npm 11.19.1；只用本地 Git fixture 和 Node 内置模块。

## 实际验证

执行：`node --test test/local-agent-integration.test.mjs test/agent-integration-identity.test.mjs test/agent-identity-bypass.test.mjs test/agent-identity-lifecycle.test.mjs`。结果 58 tests / 58 pass / 0 fail / 0 skipped，约18.2秒。修复 diff check 通过。日志与摘要见 [独立证据](evidence/local-identity-review/SHA256SUMS.json)。此前19项 runner回归已在父提交 `c817e94` 执行；本提交没有改变 runner，不重复运行或改称新执行结果。

## 审查结果

- LOCAL 是单独导出函数及CLI，仅接受 `macbeth01/m3-phase1-closeout` 目标和明确准确 base/head；从指定 head Git对象读取 `${task}.local.json`，不读取未提交清单。
- LOCAL 必须 provider=LOCAL；每条 source 的 branch、agent、task、head、local_ref 完整且对应。local_ref 必须在固定 `refs/remotes/local-macbethXX/` namespace 下，为非 symbolic ref，解析 commit 与 pin 完全相等；先进 tip 不能替代旧 pin。
- base→source→candidate ancestry、02–05必需来源、每个原始提交身份及全部外来历史登记均保留。04 堆叠经理 checkpoint 需另有准确 pin，省略或缺 head 均拒绝。不同提交的 Git author 不被重新写作；本工具验证的是现有 subject/trailer 过程来源。
- LOCAL 要求完整历史，拒绝 replace refs / grafts，剥离继承的 GIT_* 覆盖，并拒绝 GITHUB_/ACTIONS_/RUNNER_ 上下文；输出明确 githubStatus=false、independentAttestation=false。
- 默认 hosted 函数继续使用原 `${task}.json`、origin/master 和真实 origin/source refs，不因传入 LOCAL 参数而切换，也不回退到 local_ref。LOCAL provider / local_ref 在 hosted manifest 中拒绝。
- Macbeth06 来源扩展仅适用于已登记 `M3-01-PHASE1-CLOSEOUT` 目标和 `M3-06-CI-GATES` source task。错误06任务、其他经理目标及缺失远程来源均拒绝。此提交未改默认 check-agent-identity 入口或 MANAGER_INTEGRATIONS 注册表。

测试使用的 canonical origin URL 是隔离本地 fixture 元数据，未访问托管平台。真实统一候选验证必须保留批准 base、准确 source refs、经理注册和完整历史；不能把58项fixture结果代替实际候选通过。本轮没有触发或读取 GitHub Actions/Checks。01/06已按用户新授权协调托管验证，05不重复执行。

# AlphaForge：九个 CI job 与本地验证映射

> 2026-09-21 状态更新：用户已自行将仓库公开，并授权恢复GitHub只读核查与正常PR验证；由01统一调度，06不自行push/rerun。下文预算暂停阶段的记录保留为历史，不再表示当前全面禁止查询。merge、部署、规则变更、新服务/larger runner仍未授权。执行器初版证据已被05提出P1/P2；当前修复证据见CI-LOCAL-POC末尾追加，不以初版PASS代替复核。

Macbeth06 / M3-06-CI-GATES；2026-09-20。映射固定于源码 `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`、tree `6f1a21845a99e16a0ba171612cd97e9bf3439294` 的 `.github/workflows/ci.yml` 与 package.json。当前 GitHub 状态未查询。本轮 **GITHUB_CHECKS_PAUSED**。

历史 required contexts 是 verify、verify-macos、verify-windows、semgrep-ce、osv-scanner、gitleaks、contracts-m3-macos，来源 integration 15368；另外保留 source-policy-js、dependency-delta-audit。这里引用保存的配置快照，不声称远端当前规则已经重新核验。本地结果使用 `local-*` ID，不回写这些 context。

## 公共步骤与环境边界

所有 job checkout 精确 SHA、完整历史、`persist-credentials: false`；checkout 锁 `3d3c42e5aac5ba805825da76410c181273ba90b1`，setup-node 锁 `820762786026740c76f36085b0efc47a31fe5020`。Node `.node-version` = **24.21.0**；`node tools/bootstrap-ci-npm.mjs` 固定 npm **11.19.1**；`node tools/check-environment.mjs --ci` 校验真实 CI 环境。需 npm 的 job 运行 `npm ci --ignore-scripts`。Python action 锁 `e797f83bcb11b83ae66e0230d6156d7c80228e7c`，版本 **3.12.9**，禁止漂移。

本地不设置 GITHUB_ACTIONS、伪 runner 或事件变量。若执行正式本机环境准入，使用已有 `npm run env:check`，不能拿它替换 hosted `--ci` 输出。准确 npm/toolchain 不代表整个机器已准入。当前是 Darwin 26.6.2 arm64，并非 hosted macos-15 镜像；Python 实测 3.12.9。每个 checkout 单独 node_modules、缓存/临时 HOME；不共享 SQLite。npm 安装所需资产须锁文件完整性校验，缺缓存/网络时 BLOCKED，不跳过依赖。

## 按 job 映射

下表“本轮”仅指 06 新跑的范围，不覆盖其他 worker 的独立交付。底层命令来自固定源码，工具与网络要求亦应随候选变动重新核对。

| job / 目标与超时 | checkout/引导之后的实际核心命令及目的 | 精确工具、网络与缓存 | 本地执行资格、替代边界及本轮结果 |
| --- | --- | --- | --- |
| verify / ubuntu-24.04 x64 / 20m | `node tools/check-governance-v2.mjs`；`node --test test/governance.test.mjs`；`npm run verify:agent-identity`；`npm run verify:ci`；`npm run audit:dependencies` | Node/npm 公共基线；lock 中 TypeScript 6.0.3、ESLint 10.10.0、Vite 8.2.2 等；npm registry 安装及 audit 网络，过期缓存不能冒充新审计 | Linux 原生节点缺失→完整 job NOT_RUN。Mac 上仅底层脚本子集；未来任何 L1/L2 均须真正 Linux x64 执行完整链 |
| verify-windows / windows-2025 x64 / 20m | identity；verify:ci（完整工程链） | Node/npm 公共基线及 Windows 原生依赖；npm registry/合格缓存 | 无 Windows 原生节点→NOT_RUN。WSL/Linux 容器不可替代；已有文件级失败见专文 |
| verify-macos / macos-15 arm64 / 20m | identity；verify:ci | 原生 Apple Silicon Node/npm 与 lock；npm registry/合格缓存 | 本机原生 arm64 可做本地工程，版本不是 hosted 镜像；本轮31项子集+source policy/governance/supply 通过，完整 job NOT_RUN，不能标 verify-macos PASS |
| contracts-m3-macos / macos-15 arm64 / 35m | `node tools/ci/verify-contracts.mjs` → Python `contracts/script/bootstrap.py` → solc version → `/bin/bash contracts/script/check-phase1-contracts.sh` | Python3.12.9 arm64；锁定 Foundry1.5.1、solc0.8.31、Slither0.11.3/OpenZeppelin 及完整摘要；官方资产下载或逐资产验证缓存 | 本机有原生 arm64/Python；仍需脚本正式 host/tool准入及02结果。06本轮未执行→NOT_RUN。不得降低 ARM/macOS 要求；需真实测试/fuzz/invariant/Slither/ABI/制品清单/rehearsal 输出 |
| source-policy-js / ubuntu-24.04 x64 / 35m | `node tools/ci/check-source-policy.mjs`；覆盖受控 JS/TS/TSX 目标并校验输出 | 精确 ESLint/TypeScript锁；npm 安装外无需在线规则服务 | 本地底层脚本 PASS；目标清单及报告保留。只是 Darwin 执行，Linux完整 job NOT_RUN |
| dependency-delta-audit / ubuntu-24.04 x64 / 35m | `npm run supply:check`；`node tools/ci/check-dependency-delta.mjs` | 比较准确 base/head 元数据及依赖变化；npm audit 网络；独立临时依赖图，不拿旧缓存充当实时审计 | supply:check PASS；delta+audit未执行→NOT_RUN。离线无 audit 回应为BLOCKED；准确候选 refs 不得伪装 GitHub PR event |
| semgrep-ce / ubuntu-24.04 x64 / 35m | supply:check；`node tools/ci/check-semgrep.mjs` | Python3.12.9；Semgrep CE1.177.0，锁 wheel/hash；22规则44 fixtures；安装资产需官方网络或完整已验证集合 | Darwin arm64 是扫描器脚本支持的平台，但本轮未安装/跑 scanner→NOT_RUN；16项scanner逻辑回归不能替代扫描；Linux job 仍须Linux |
| osv-scanner / ubuntu-24.04 x64 / 35m | supply:check；`node tools/ci/check-osv.mjs` | OSV Scanner2.6.0 固定平台资产/摘要；317 package identities；官方资产和 OSV API 网络，响应完整性校验 | 本地逻辑回归可跑；当前完整扫描未运行→NOT_RUN；缺 API/报告/身份覆盖必须BLOCKED，不能用缓存安全结论代替 |
| gitleaks / ubuntu-24.04 x64 / 35m | supply:check；`node tools/ci/check-gitleaks.mjs` | Gitleaks8.30.1固定资产/摘要；完整Git历史及 refs、HEAD文件目标；canary覆盖已删/旁支/tag/merge；网络只为合格资产 | 本轮16项scanner逻辑回归通过（含历史对象证明），完整扫描NOT_RUN。已有精确历史例外不等于新扫描PASS；FP001失效期2026-10-20须继续执行原判定 |

`verify:ci` 经 `tools/verify-ci.mjs` 包装 `npm run check`，执行前后环境/源码证据；check 包含 typecheck、lint、format、完整测试、secrets/privacy/chain配置相关脚本、governance/supply/threats/planning/forum/management一致性及 web build。不能只跑 npm test 就声称整个 job 完成；package.json 的准确链优先于本页概述。

## 证据对应与复用

1. 原有 gate/env 报告继续使用各自 schema，绑定实际源/HEAD/tree/lock、工具、host/runner 与观察时间。原有 source C → manifest-only R → snapshot-only S 保持不变；不编辑生成 PASS，collector 原有 NOT_RUN 不被本 PoC 重标。
2. 新执行器本地 schemaVersion1 明确 `scope=trusted-local-only`、`independentAttestation=false`，保存 base/head/tree、manifest 与执行器/Node/可执行文件摘要、exit/signal/timeout、日志摘要和 cleanup。报告详情与实际路径见 [CI-LOCAL-POC.md](CI-LOCAL-POC.md)。这是子集工程证据，不是 hosted job 或 L3 认证。
3. 本轮真实子集准确源码为上述 3a78e34，31项为 security-scanners16 + ci-gates10 + m3-injected-runtime5；另有三个现有脚本 PASS。独立新执行器14项测试在06工作区运行，不能混称源码3a78已有这些新增测试。
4. 每个平台仍须自身实际 OS/arch/tool准入、独立工作目录及完整命令；缺 OS/工具/网络/权限只记 NOT_RUN/BLOCKED。L2 编排可排队同样命令，但不会补足缺失平台。未来 Gate来源接回方案见 [CI-RECONNECT-PLAN.md](CI-RECONNECT-PLAN.md)。

## 公开后的配置只读核查

用户自行公开仓库后，06重新读取经理当前已提交的三份workflow；Engineering九job仍为6个ubuntu-24.04 x64、1个windows-2025 x64、2个macos-15 arm64，均为GitHub标准hosted标签。push仅排除gh-readonly-queue/**，另有pull_request、merge_group、workflow_dispatch；同workflow/ref取消旧任务。CodeQL及Dependency Review当前仅workflow_dispatch，ubuntu-latest，超时15/10分钟，不因公开或普通push自动启动。未修改workflow/触发运行。官方公共runner标签及公开仓库标准runner规则见[GitHub官方矩阵](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)；不由此推导larger runner/存储等费用均免除。

发布固定SHA的普通source分支仍会触发push CI；固定ref不能改变04从经理3a78e34派生后的混合作者历史。不能通过改成未登记前缀、伪造origin、跳过CI或改写04历史获取绿灯。最小方案保留真实来源分支结果，并由准确经理候选的登记集成manifest证明全部源范围和实际PR门禁；如果另要求每个来源分支都获得完整身份绿灯，需要独立受限checkpoint模式设计，非仅发布refs能够解决。01统一决定发布/运行顺序，06未执行任何发布。

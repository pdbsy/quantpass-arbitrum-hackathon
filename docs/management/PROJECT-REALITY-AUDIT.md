> Historical local checkpoint imported on 2026-09-12. Its results apply only to the stated 2026-09-09 PR #6 candidate. Worker B findings, publication, CI and scan activity described below are historical; CURRENT-STATUS.md records the newer remote readback. No current scan status or finding closure is inferred. Superseded Worker B object IDs are omitted.

# PROJECT REALITY AUDIT — Wave 1

Audit source: bbb3e4b7b40cfd3aa23253866876875f8d98a1fc (PR #6 candidate, NOT merged).
Auditor: Darwin. Date: 2026-09-09. Record status: WORKING CHECKPOINT — final security/independent review pending.
Canonical planning: planning/roadmap.json, 41 tasks. This document does not modify roadmap or release-gate states.

## Result and interpretation

No task is promoted to VERIFIED_DONE at this checkpoint. This does not mean no code works: 91/91 automated tests and all configured local checks passed. It means the global completion contract has not been met with complete evidence.

| Audited status | Count |
| --- | ---: |
| VERIFIED_DONE | 0 |
| PARTIAL | 5 |
| DONE_BUT_NEEDS_HARDENING | 3 |
| BLOCKED | 1 |
| NOT_STARTED | 26 |
| READY | 5 |
| IN_PROGRESS | 1 |
| INVALID_STATUS | 0 |

READY means scoped groundwork may be prepared; it does not certify prerequisite DONE assurance or authorize deployment. NOT_STARTED includes tasks waiting for dependencies; dependency wait is recorded explicitly rather than calling every future task an active blocker. PARTIAL also identifies existing delivery that backlog/ready alone hides.

## Reproducible evidence

- E1: 2026-09-09 Windows Node24.12.0/npm11.6.2, `npm run check`: exit0,91/91 pass,0skip; type/lint/format/secret/network/governance/supply/threat/planning/webbuild pass.
- E2: `npm run audit:dependencies`: exit0,0 known vulnerabilities at query time. Not proof that dependencies contain no vulnerabilities.
- E3: diagnostic Node coverage on the exact 11 test files:91/91 pass; selected loaded runtime files96.03% lines/79.18% branches. Excludes frontend, tooling and unloaded files; NOT overall repository90% evidence. Detailed table below.
- E4: synthetic-only child-process network CLI probe:valid URL exit0 with no marker; malformed port and userinfo URL exit1 with marker and raw URL in stderr. No real credential or RPC request used.
- E5: GitHub readback2026-09-09:PUBLIC/default master; master202e625; PR6headbbb3e4b remains OPEN. Prior candidate Linux/Windows,CodeQL/dependency-review success is recorded in PR6. Not an approval to merge other heads.
- E6: Worker B remote4ff1043d275f51075b366d34cd77e72a85778990, B8 IN_PROGRESS/MERGE_BLOCKED; reported1Medium/6Low findings and below-minimum local toolchain. These are Worker B findings, not merged candidate findings or Darwin acceptance.
- E7: Standard source scan3d6670bc-ca8d-466c-8ec7-b1decaa097d3 is RUNNING. Quota interrupted review workers; resumed at15:50+08. No completed report is claimed yet.

| Loaded runtime file | Line % | Branch % |
| --- | ---: | ---: |
| src/security-model/index.ts |91.39|55.86|
| apps/server/src/store.ts |93.45|78.38|
| apps/server/src/app.ts |100|87.93|
| apps/server/src/simulation.ts |100|85.71|
| packages/domain/src/vault.ts |100|97.37|
| packages/domain/src/money.ts |100|88.46|
| packages/domain/src/fixtures.ts |100|100|
| packages/config/src/index.ts |100|100|
| packages/robinhood-chain/src/network.ts |100|92.31|

Coverage invocation: `node --experimental-test-coverage --test-coverage-include=packages/**/*.ts --test-coverage-include=apps/server/**/*.ts --test-coverage-include=src/**/*.ts --test` followed by the same11 explicit files in package.json's test script. Coverage is a gap locator, not proof of assertion quality. HTTP subprocess production main is not represented as covered.

## All-task assessment

The numbered acceptance outcomes follow the canonical task's acceptance array order. Evidence paths establish inspected implementation, not that every criterion passes. Future contract/tooling/deployment checks are NOT RUN, never PASS by analogy with local tests.

### BASE-001 — 比赛公开仓库精简基线

- Roadmap status: `done`; audited status: `PARTIAL`.
- Priority / risk: P1 / medium; dependencies: NONE.
- Deliverables checked: 公开仓库说明与边界；忽略规则和示例配置；可复现初始提交。
- Implementation / documentation: README、忽略规则和公开初始提交存在；GitHub 只读查询确认 PUBLIC/master。
- Acceptance status (canonical order): PASS | FAIL | PASS.
  1. 仓库为 PUBLIC 且默认分支为 master
  2. 不存在内部评审记录、私有证据或本地环境文件
  3. README 明确当前能力边界
- Evidence status: README.md; .gitignore; docs/management/host/HOST-BASELINE.md; GitHub repository readback
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 公开分支含开发主机、用户目录、LAN/SSH 操作记录，和“无内部/本地环境记录”验收冲突；本报告不复述具体值。
- Required hardening / next action: 先隔离公开构建资产，协调脱敏当前记录；历史重写需明确批准，不删除 Worker B 的工作历史。
- Final verdict: PARTIAL; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### NET-001 — Robinhood Chain Testnet 网络门禁基线

- Roadmap status: `done`; audited status: `PARTIAL`.
- Priority / risk: P0 / high; dependencies: BASE-001.
- Deliverables checked: 网络常量；配置校验工具；正负测试与官方来源文档。
- Implementation / documentation: network.ts 固定预期 46630并校验 HTTPS/URL userinfo；CLI 只在成功时输出 origin。尚无钱包/RPC调用。
- Acceptance status (canonical order): PARTIAL | PASS | FAIL.
  1. 配置、钱包和 RPC 预期 Chain ID 均为 46630
  2. HTTP、错误链和嵌入凭据的 URL 被拒绝
  3. 运行检查不输出 URL 查询参数或凭据
- Evidence status: packages/robinhood-chain/src/network.ts; tools/check-robinhood-chain.ts; test/robinhood-chain.test.ts; docs/ROBINHOOD-CHAIN.md
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 合成 marker 复现：畸形端口和畸形 userinfo URL 被拒绝，但未捕获的 URL 异常把完整输入写入 stderr。G0 的“RPC Chain ID 已核对”没有实时 RPC 证据。
- Required hardening / next action: 单独修复 URL 解析/CLI 错误脱敏并增加真实子进程回归；钱包/RPC 实测仍归 CONFIG/WALLET/RPC，不暗中增加链写入。
- Final verdict: PARTIAL; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### LEDGER-001 — 精确会计与幂等账本基线

- Roadmap status: `done`; audited status: `DONE_BUT_NEEDS_HARDENING`.
- Priority / risk: P0 / critical; dependencies: BASE-001.
- Deliverables checked: 纯状态转换；SQLite 原子提交与摘要；确定性和重启测试。
- Implementation / documentation: 整数余额分区、授权角色、版本 CAS、回执、事务回滚、重启/备份/损坏用例均存在且通过。
- Acceptance status (canonical order): PASS | PASS | PASS (bounded baseline).
  1. 金额拒绝浮点、指数和越界输入
  2. 重复命令不重复记账，冲突版本不覆盖状态
  3. 账本重启、备份和损坏场景失败关闭
- Evidence status: packages/domain/src/{money,vault,fixtures}.ts; apps/server/src/store.ts; migrations/001-local-ledger.sql; test/domain.test.ts; test/server.test.ts; test/http-e2e.test.ts
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 诊断分支覆盖：vault 97.37%、money 88.46%、store 78.38%，不满足关键路径100%。未知数据库/版本、备份 I/O 失败等分支未覆盖；1500步生成仅覆盖四类 owner 命令，不是完整协议 invariant。
- Required hardening / next action: 补真实持久层失败/边界和完整角色操作矩阵；明确历史资源上限/恢复演练归 DATA-001；不得改容量缓冲或收费政策。
- Final verdict: DONE_BUT_NEEDS_HARDENING; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### PERMIT-001 — 离线交易许可安全模型基线

- Roadmap status: `done`; audited status: `PARTIAL`.
- Priority / risk: P0 / critical; dependencies: BASE-001.
- Deliverables checked: 规范化签名载荷；短时执行许可；风控与篡改负向测试。
- Implementation / documentation: 6个离线 Ed25519 测试通过：短期 trade-only、policy hash、nonce 重放、仓位、亏损、决策篡改。应用未导入该签发库。
- Acceptance status (canonical order): PASS | PARTIAL | PASS (listed scenarios only).
  1. 许可不包含提现或转账权限
  2. 策略、政策、账户和时间窗口不匹配时拒绝
  3. 重放、篡改、仓位和亏损限额均有负向测试
- Evidence status: src/security-model/index.ts; test/security-model.test.ts; planning/security-boundary.json
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 分支覆盖55.86%。策略/release、账户/venue、签名类型、时间窗口、order/gross/leverage等拒绝路径缺少回归。派生许可到期未取 grant.validUntil 的最小值，待定向复现。
- Required hardening / next action: 先补授权时效的最小回归/修复及负向矩阵；持久重放、EIP-712、可信快照和编译期信任根仍是 TRUST-001，不能用本地模型冒充。
- Final verdict: PARTIAL; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### LOCAL-001 — 本地演示 HTTP 安全边界基线

- Roadmap status: `done`; audited status: `DONE_BUT_NEEDS_HARDENING`.
- Priority / risk: P1 / high; dependencies: LEDGER-001.
- Deliverables checked: loopback-only 服务；同源与请求校验；HTTP 崩溃恢复 E2E。
- Implementation / documentation: 真实入口绑定127.0.0.1；Host/Origin/Fetch-Site/专用header、owner隔离、严格schema、Cookie和通用错误已测试。
- Acceptance status (canonical order): PASS | PASS (tested classes) | PASS.
  1. 非 loopback origin 无法启动
  2. 跨用户、跨源、未认证与畸形请求被拒绝
  3. 服务错误不泄露 SQL、文件路径或内部细节
- Evidence status: apps/server/src/{main,app,simulation}.ts; apps/web/vite.config.ts; test/server.test.ts; test/http-e2e.test.ts
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: app分支覆盖87.93%；bodyLimit、速率/会话上限和生命周期边界未有完整回归。Vite publicDir复制整个docs，会把非演示文档一起送入静态产物。不是生产认证，alice/bob可主动切换。
- Required hardening / next action: 增加限流/大小/会话边界测试；将静态发布改为明确演示文件清单的独立修复，不把本地会话迁移为真实身份。
- Final verdict: DONE_BUT_NEEDS_HARDENING; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### CI-001 — 基础工程门禁

- Roadmap status: `done`; audited status: `DONE_BUT_NEEDS_HARDENING`.
- Priority / risk: P1 / high; dependencies: BASE-001.
- Deliverables checked: 最小权限 CI；依赖锁和版本门禁；secret 与依赖审计。
- Implementation / documentation: 候选PR的Linux/Windows工程CI和CodeQL/dependency review已有成功证据；本机Node24.12.0/npm11.6.2全量check和依赖审计通过。
- Acceptance status (canonical order): PASS (candidate CI) | PASS (engineering workflow) | PARTIAL.
  1. 干净检出可运行完整 check
  2. GitHub Actions 使用固定 commit 且无写权限
  3. 高危依赖或潜在秘密导致失败
- Evidence status: package.json; package-lock.json; .npmrc; .node-version; .github/workflows/ci.yml; tools/check-secrets.mjs; docs/security/SUPPLY-FIX-2026-09-08.md
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 没有自动覆盖率门禁；secret baseline仅当前tracked/unignored文本，不覆盖完整历史/二进制/全部provider格式，且缺少专门负向测试。CodeQL有明确批准的security-events:write例外，不可宣称所有workflow零写权限。
- Required hardening / next action: 增加secret拒绝/不泄露输出回归；完整历史扫描归SECRET-001；覆盖率范围与门禁单独DEC，不伪造90%全仓覆盖。
- Final verdict: DONE_BUT_NEEDS_HARDENING; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### GOV-001 — 冻结测试网范围、角色与架构 ADR

- Roadmap status: `blocked`; audited status: `BLOCKED`.
- Priority / risk: P0 / critical; dependencies: NET-001, LEDGER-001, PERMIT-001, LOCAL-001, SUPPLY-001.
- Deliverables checked: 架构与数据流图；角色/能力矩阵；资产与禁止项 ADR；不可升级优先及迁移策略；真实 Git 祖先与闭集验收转换证据；受仓库外强制门禁保护的验收后 ADR、roadmap 政策、validator、治理测试与 CI 持续语义锁定。
- Implementation / documentation: ADR、机器边界、10项治理回归及Git来源校验存在。decision=review；两个写平面false。
- Acceptance status (canonical order): NOT_ACCEPTED.
  1. Owner、策略、风险/快照签名者、暂停者、部署者和 Indexer 权限为闭集、互斥且最小化；relayer 无权限且不绑定身份
  2. 明确支持 token、decimals、管理员冻结/门控、fee-on-transfer/rebasing 等拒绝策略
  3. 禁止任意 call/delegatecall、主网和真实资金路径
  4. 签名和快照绑定 Vault 状态版本/哈希，合约原子递增且风险签发按版本串行
  5. 独立复核者能指出每个秘密、签名、资产、manifest 自举和管理员边界
  6. 复核摘要从真实 reviewed commit 重算，首次接受提交不能夹带业务代码、校验器或测试变更
  7. 在不可由同一受检 diff 修改的强制执行入口中，验收后 ADR、README 治理段、roadmap 非生命周期字段、validator、治理测试或 CI 漂移均失败关闭；计划版本、任务/gate 状态、证据、日期和阻塞原因仍可正常推进
  8. 仓库内 CI 不经 package.json 间接寻址，直接执行治理校验器和治理测试作为纵深防御；SUPPLY-001 提供仓库外 required workflow/status check，消除校验器自行证明自身未被替换的信任循环
  9. Git provenance 查询忽略 GIT_* 污染与 replace refs，先以 tree 判定可选历史路径是否存在，存在后的读取错误不得降级为缺失
  10. 日期仅为 YYYY-MM-DD 时按 UTC-12 至 UTC+14 的可实现区间校验，不拒绝真实本地次日，也不接受尚未在全球任何时区开始的日期
- Evidence status: planning/security-boundary.json; docs/adr/0001-testnet-mvp-scope-and-authority.md; tools/check-governance-v2.mjs; test/governance.test.mjs; SECURITY.md
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 外部信任根未建立，写平面关闭，不接受风险。
- Problems: 外部不可自改的required check与独立身份验收仍缺失。内部绿灯只证明内部规则一致，不构成外部信任根。
- Required hardening / next action: 维持BLOCKED；SUPPLY外部治理方案需要用户选择/外部协调，不自行接受Critical/High风险。
- Final verdict: BLOCKED; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### THREAT-001 — Robinhood Chain 专项威胁模型与风险登记

- Roadmap status: `backlog`; audited status: `PARTIAL`.
- Priority / risk: P0 / critical; dependencies: GOV-001.
- Deliverables checked: 资产/攻击者/入口清单；STRIDE/滥用场景；风险负责人、缓解和接受记录。
- Implementation / documentation: risk-register及生成模型覆盖22项风险/12类场景，有owner、缓解任务和gate；4项一致性测试通过。
- Acceptance status (canonical order): PASS (planned scenarios) | PASS (labels/gates) | PARTIAL.
  1. 覆盖授权绕过、重入、重放、恶意 token、RPC 欺骗、前端替换和密钥泄露
  2. 每个 Critical/High 风险有负责人、缓解任务和截止门禁
  3. 威胁模型与实际数据流、ABI 和角色一致
- Evidence status: planning/risk-register.json; docs/THREAT-MODEL.md; tools/check-threat-model.mjs; test/threat-model.test.mjs
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 已有交付物，因此NOT_STARTED不准确；但其主体是待建链架构，不是已实现运行时，且GOV未接受。登记owner标签不是独立复核身份。
- Required hardening / next action: 完成当前运行时与未来链边界区分、真实负责人/验收和依赖后再推进；扫描报告不等于THREAT任务完成。
- Final verdict: PARTIAL; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### CONFIG-001 — 独立且失败关闭的 Testnet 启动门禁

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, THREAT-001.
- Deliverables checked: 区分 local/testnet 的判别联合配置；三方 Chain ID 校验；主网硬关闭与 feature flag。
- Implementation / documentation: 仅有local/mock配置拒绝门禁，没有testnet判别配置或三方实时链校验。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 默认启动仍为 local mock
  2. 配置、钱包与 RPC 任一不为 46630 时写操作不可达
  3. 生产/mainnet 字符串、错误合约地址和空地址均有失败测试
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, THREAT-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### ASSET-001 — 测试资产与外部协议地址核验

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, THREAT-001.
- Deliverables checked: chain-specific 资产清单；地址与 runtime bytecode hash；decimals/管理员能力/行为探测；mock token 命名与隔离规则。
- Implementation / documentation: activeAllowlist为空，无已核验地址/bytecode/资产探测报告。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 每个地址至少由官方来源与链上 bytecode 双重核对
  2. 不按 symbol 猜测 token，明确 decimals、代理实现、owner/admin/AccessControl 和升级风险
  3. 没有权威测试资产时只部署醒目标记、固定供应、部署后无特权角色且不可混淆的 Mock
  4. 源码、runtime bytecode 与负向测试证明 holder 转账不能被 pause、freeze、allowlist 或管理员门控
  5. 未知、空代码、地址变化、特权角色或异常 ERC-20 行为阻止 adapter 写入
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, THREAT-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### TRUST-001 — 信任根、签名域与持久重放模型

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, THREAT-001.
- Deliverables checked: EIP-712 domain 与 schema；Web/risk-service 编译期固定且一致的 manifest digest；原子持久 nonce store；可信账户快照来源。
- Implementation / documentation: 没有risk service、编译期manifest digest、EIP-712、持久nonce或签名快照实现。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 签名绑定 chainId、verifyingContract、wallet、Vault 状态版本/哈希、nonce、deadline 和 calldata hash
  2. 请求、环境变量和运行时响应不能选择或覆盖 trusted manifest、release、public key 或账户快照来源
  3. Web 与 risk service 的编译期 manifest digest 不一致时失败关闭，digest 变化要求新 release、ADR 与复核
  4. 进程重启、并发和跨实例下重放仍被拒绝；每个 Vault 状态版本只能保留一个签发槽
  5. 密钥失效时停止签发许可；替换信任根必须走不可逆暂停、Owner 退出、新部署和重新授权
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, THREAT-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### PRIV-001 — 消除 Demo Executor 隐式提权并采用无权限 Relay

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, THREAT-001.
- Deliverables checked: 本地命令/Testnet 双签意图分离接口；不可信 Relay 边界；权限矩阵负向测试。
- Implementation / documentation: localSimulation仍自动选择executor；无独立testnet路径，不能算已完成隔离实现。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 普通用户不能直接触发 fill、mark、settle、confirm 或 fee payment
  2. msg.sender/relayer 身份不构成授权；链上只接受 Owner+Risk 双签、独立 nonce、状态版本和完整调用绑定
  3. 用户钱包与任意 relayer 提交同一签名材料得到相同结果，且 relayer 不能成为收款人或业务参数
  4. 演示快捷路径只能在编译/运行时 local-only 边界内存在
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, THREAT-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### TOOL-001 — 固定 Solidity 与安全工具链

- Roadmap status: `ready`; audited status: `READY`.
- Priority / risk: P0 / high; dependencies: CI-001, NET-001.
- Deliverables checked: 工具版本文件；最小 Foundry 工程；依赖许可与哈希记录；CI 缓存与权限说明。
- Implementation / documentation: 没有Foundry工程、solc/Slither/OZ固定版本或字节码复现报告。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 干净环境可安装固定版本并重建相同字节码
  2. 依赖仅来自官方来源且许可证兼容
  3. CI 不执行未审查的安装脚本或浮动 Action
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：CI-001, NET-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: READY; 仅可准备受限任务，不是验收通过。

### SPEC-001 — 链上会计、资产与舍入规格

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, THREAT-001, TOOL-001, ASSET-001.
- Deliverables checked: 状态变量与单位表；存入/分配/提现/费用状态机；舍入与精度策略；会计不变量清单。
- Implementation / documentation: 本地TS会计是参考，不是冻结的链上单位/舍入/资产规范。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 每种资产的 decimals 与最小单位显式定义且不猜测
  2. 总资产、负债、待提取、费用和策略额度在每次转换后守恒
  3. 拒绝 fee-on-transfer、rebasing、回调、可变实现和非标准返回 token
  4. 零值、最大值、舍入尘埃、暂停和紧急退出有规范
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, THREAT-001, TOOL-001, ASSET-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### SPEC-002 — 权限、事件、错误与重放规格

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, THREAT-001, TRUST-001.
- Deliverables checked: 函数权限矩阵；事件/错误目录；nonce/deadline 规则；不可逆暂停、Owner 退出与新地址迁移状态机。
- Implementation / documentation: ADR描述目标，但无逐函数冻结权限/事件/错误/nonce规范。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 所有状态写入都有明确角色和自定义错误
  2. 事件足以独立重建关键状态且不记录秘密
  3. 跨链、跨合约、跨账户和过期签名不能重放
  4. 暂停不锁死合法提现或指定安全退出
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, THREAT-001, TRUST-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### ABI-001 — 冻结 Vault v1 ABI 与 Adapter 边界

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / high; dependencies: SPEC-001, SPEC-002, CONFIG-001, PRIV-001.
- Deliverables checked: Solidity interface；TypeScript 判别联合端口；事件到领域状态映射；ABI hash。
- Implementation / documentation: 无Solidity interface、冻结ABI hash或本地/testnet双端口契约测试。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 接口只暴露必要存入、分配、提现、安全退出和状态读取能力
  2. local 与 testnet adapter 共享语义但不能混用配置
  3. ABI 变更由版本和兼容测试管理
  4. UI 不直接拼装任意 calldata
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：SPEC-001, SPEC-002, CONFIG-001, PRIV-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### SUPPLY-001 — 强化仓库与供应链策略

- Roadmap status: `in_progress`; audited status: `IN_PROGRESS`.
- Priority / risk: P1 / high; dependencies: CI-001.
- Deliverables checked: 分支保护、CODEOWNERS/required review、仓库外 required workflow 与签名 attestation；Dependabot 与 CodeQL 配置；SBOM/license 报告；锁文件与 Action 更新策略；安全差异扫描记录与 workflow parser/permission 加固 backlog。
- Implementation / documentation: 固定lock/Action、结构化YAML权限闭集、SBOM/license、CodeQL/dependency review和安全报告存在；217包/3workflow检查通过。
- Acceptance status (canonical order): PARTIAL | PASS (recorded controls) | PASS | PASS | PASS | BLOCKED.
  1. master 禁止未通过 required checks 和所需身份复核的直接更新，且治理 required workflow/status check 的定义、执行代码和必需性均不能由同一受检 diff 自行关闭或改写
  2. 依赖漏洞告警、安全更新和 CodeQL 启用且有处置 SLA
  3. 发布生成 SBOM 并拒绝不兼容许可证
  4. Actions 固定到审查过的完整 commit SHA，PR 执行 dependency review
  5. workflow 解析对引号等价键失败关闭，逐 workflow/job 权限由显式 allowlist 校验，任何新增写权限必须单独批准
  6. externalGovernanceGate 只有在外部 provider、enforcement readback、revision/digest 与失败 tamper test 均可验证时才能从 blocked 变为 verified
- Evidence status: planning/supply-chain-policy.json; tools/check-supply-chain.mjs; test/supply-chain.test.mjs; docs/security/**; .github/**
- Tests / CI / reproducibility: E1–E3验证已存在的有限检查；仍受本项缺口及全局DoD限制。
- Security status: 外部信任根未建立，写平面关闭，不接受风险。
- Problems: 外部provider/enforcement/revision/tamper证据仍无，离线validator强制拒绝verified；PR #6尚未合并。
- Required hardening / next action: 先审查并整合PR #6，选择外部治理信任根；不要通过改同仓validator解除阻塞。
- Final verdict: IN_PROGRESS; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### CON-001 — 实现最小非托管 Vault 合约

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: ABI-001, TOOL-001.
- Deliverables checked: Vault 合约；接口与事件；NatSpec 与状态不变量注释。
- Implementation / documentation: 无Solidity Vault源码或对应编译产物。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 实现与冻结 ABI、会计规格逐项对应
  2. 使用 checks-effects-interactions 和显式 SafeERC20 边界
  3. 所有外部写函数具备授权、暂停与重入分析
  4. 不包含任意 target/calldata、delegatecall 或可注入实现地址；类型化固定调用逐项验证
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：ABI-001, TOOL-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### CON-002 — 实现最小权限、不可逆暂停与安全退出

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: CON-001, SPEC-002.
- Deliverables checked: 闭集角色控制；不可逆暂停矩阵；Owner 直接退出路径；新地址替换与显式迁移流程。
- Implementation / documentation: 无链上闭集角色、不可逆暂停或Owner退出实现。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 任何单一策略、签名者或 relayer 都无提现/任意转账权
  2. 不可逆暂停时禁止新增风险，但 Owner 可直接撤销意图和提取测试资产
  3. 暂停后唯一资产外流是 Vault 到 Owner 的提现，不能被通用外部调用暂停误伤
  4. 部署时拒绝零地址/空 key，分别验证 EVM 地址与 Ed25519 key 指纹互异且禁止跨角色复用密钥材料；不存在原地角色变更或 unpause
  5. 角色丢失或泄露时按暂停、Owner 退出、新合约和重新授权流程恢复
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：CON-001, SPEC-002。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### TST-001 — 合约单元、负向与权限测试

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: CON-001, CON-002.
- Deliverables checked: Foundry 单元测试；恶意 token/接收者夹具；覆盖率报告。
- Implementation / documentation: 只有TS/Node测试；无Foundry合约负向/重入/token测试与覆盖报告。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 关键授权和会计路径分支覆盖 100%，总体目标不低于 90%
  2. 未授权、错误状态、零/最大值、重入与异常 token 均失败关闭
  3. 每个公开自定义错误和关键事件都有断言
  4. 测试不依赖公共 RPC 或时间不稳定外部状态
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：CON-001, CON-002。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### TST-002 — Fuzz、Invariant 与模型差分验证

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: TST-001, LEDGER-001.
- Deliverables checked: stateful invariant handler；固定种子与运行预算；TS/Solidity 差分夹具；失败最小化样例。
- Implementation / documentation: TS的1500操作基线不是Foundry状态fuzz，也无TS/Solidity差分。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 资产守恒、负债覆盖、额度上限和无重复支付不变量持续成立
  2. 不可逆暂停、角色失效、显式迁移、失败 token 与随机顺序均纳入生成
  3. 失败可用种子和命令序列稳定复现
  4. CI 运行短预算，发布门禁运行长预算并保存报告
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：TST-001, LEDGER-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### SEC-002 — 静态分析、字节码复现与独立安全复核

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: TST-001, TST-002, SUPPLY-001.
- Deliverables checked: 静态分析报告；可复现字节码 manifest；安全审查清单；风险接受记录。
- Implementation / documentation: 没有合约、Slither或可复现链上字节码，现有JS扫描不能替代。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 无未处置 High/Critical 静态分析发现
  2. 相同 commit 与编译参数生成相同 ABI 和字节码 hash
  3. 独立复核覆盖授权、会计、重入、签名、暂停和退出
  4. 例外均记录理由、负责人和失效时间
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：TST-001, TST-002, SUPPLY-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### WALLET-001 — 钱包连接与显式网络切换

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / high; dependencies: ABI-001, CONFIG-001.
- Deliverables checked: 连接状态机；wallet_add/switchEthereumChain 流程；accountsChanged/chainChanged/disconnect 处理。
- Implementation / documentation: 无EIP-1193钱包连接或签名/切链生命周期；UI明确不连接钱包。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 未连接、拒绝连接、错误链、切换失败和断开均有明确状态
  2. 每次签名前重新核对账户与 Chain ID 46630
  3. 页面永久展示 Testnet 且不自动请求签名
  4. 不把账户地址当作认证会话
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：ABI-001, CONFIG-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### ADAPTER-001 — 实现类型安全的只读与写入 Adapter

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / high; dependencies: ABI-001, CON-002, WALLET-001.
- Deliverables checked: read adapter；write adapter；地址/ABI hash manifest；领域错误映射。
- Implementation / documentation: 仅localSimulation端口；无固定manifest/ABI的testnet读写adapter。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 所有地址由 chain-specific manifest 加载并校验 bytecode
  2. 写入前模拟调用并展示资产、金额、目标和预期变化
  3. 错误、超时和用户拒绝不会被当作成功
  4. local/testnet adapter 通过相同契约测试
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：ABI-001, CON-002, WALLET-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### TX-001 — 交易生命周期、替换与重组恢复

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: ADAPTER-001, TRUST-001.
- Deliverables checked: 交易状态机；操作 ID 与 tx hash 映射；确认/重组策略；恢复 UI。
- Implementation / documentation: 本地重试回执不是交易广播/替换/确认/reorg状态机。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 刷新、断网和重复点击不会导致重复经济动作
  2. replacement、dropped、reverted、timeout 与 reorg 有确定状态和恢复步骤
  3. 达到明确确认深度后才显示最终完成
  4. 浏览器链接与 receipt、事件、账户变化一致
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：ADAPTER-001, TRUST-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### INDEX-001 — 幂等事件索引与链重组处理

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P1 / high; dependencies: CON-001, SPEC-002, RPC-001.
- Deliverables checked: 事件游标与唯一键；reorg rewind/replay；链上读取对账；RPC 限流退避。
- Implementation / documentation: SQLite audit列表不是链事件索引；无block-hash游标或reorg回放。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 重复日志和进程重启不重复记账
  2. 检测 block hash 变化并回退到安全水位重放
  3. 索引状态定期与合约 view 对账
  4. RPC 429、超时和部分响应不产生伪完成
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：CON-001, SPEC-002, RPC-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### DATA-001 — 持久状态、审计与资源上限

- Roadmap status: `ready`; audited status: `READY`.
- Priority / risk: P1 / high; dependencies: LEDGER-001, CI-001.
- Deliverables checked: 数据保留与分页策略；容量/并发/恢复测试；审计完整性语义；RPO/RTO 演练。
- Implementation / documentation: 有1万历史上限和audit最近100条，但未完成快照/回执拆分、压力/磁盘故障/RPO/RTO交付。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 状态、回执、事件和输入都有硬上限与分页，不随历史无限重写
  2. 普通 SHA 摘要只声明检测损坏，不被描述为对抗性防篡改
  3. 并发、长历史、大输入和磁盘故障测试保持资源有界
  4. 恢复演练验证备份一致性、RPO、RTO 和不可覆盖策略
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：LEDGER-001, CI-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: READY; 仅可准备受限任务，不是验收通过。

### BACKEND-001 — 隔离 Testnet 后端身份与 Demo 会话

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P1 / high; dependencies: GOV-001, TRUST-001, CONFIG-001.
- Deliverables checked: 后端必要性 ADR；SIWE/等价登录协议；会话与 CSRF/限流策略；Demo/测试网代码隔离测试。
- Implementation / documentation: 只有demo身份；无后端必要性ADR或钱包nonce身份方案。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. alice/bob 演示身份无法访问任何测试网写路径
  2. 登录签名绑定 domain、nonce、URI、chainId、issuedAt 和 expiration
  3. 生产会话使用 Secure/HttpOnly/SameSite、持久撤销和分布式限流
  4. 若选择无后端架构，服务器无法获得代表用户签名的能力
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, TRUST-001, CONFIG-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### RPC-001 — RPC 身份、限流与故障策略

- Roadmap status: `ready`; audited status: `READY`.
- Priority / risk: P1 / high; dependencies: NET-001, CI-001.
- Deliverables checked: RPC client policy；eth_chainId/bytecode 健康检查；429/5xx/timeout 策略；观测指标。
- Implementation / documentation: 仅URL配置验证，无RPC client、eth_chainId调用、超时退避或熔断。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 每次写入前验证 chainId，关键读取可交叉核对
  2. 指数退避带抖动且有总时间预算，不无限重试
  3. RPC 故障时 UI 显示过期/未知而非成功
  4. 日志不记录带 API key 的完整 URL
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：NET-001, CI-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: READY; 仅可准备受限任务，不是验收通过。

### WEBSEC-001 — 浏览器与前端供应链安全

- Roadmap status: `ready`; audited status: `READY`.
- Priority / risk: P1 / high; dependencies: LOCAL-001, CI-001.
- Deliverables checked: 生产 CSP；前端威胁测试；地址与金额确认组件；第三方脚本清单。
- Implementation / documentation: 已有local CSP/React安全渲染，但无钱包确认组件、签名前地址核验或完整前端威胁测试。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 无未审查远程脚本、eval、危险 HTML 注入或隐式分析代码
  2. 地址、金额、链和合约在签名前以不可混淆格式显示
  3. 私钥、签名、完整 RPC 凭据不进入 localStorage、日志或错误上报
  4. CSP、点击劫持、跨源和依赖篡改有自动检查
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：LOCAL-001, CI-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: READY; 仅可准备受限任务，不是验收通过。

### KEY-001 — 测试网部署密钥与角色操作手册

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: GOV-001, SUPPLY-001, SEC-002.
- Deliverables checked: 密钥生成/存储/替换流程；EVM 地址与 Ed25519 公钥指纹清单；泄露响应；最小测试 ETH 预算。
- Implementation / documentation: 无经批准部署/角色keyprovider与泄露/丢失演练；不生成或存储真实密钥。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 密钥不进入仓库、终端记录、构建产物或普通浏览器存储
  2. 部署者、guardian、risk signer 地址互异，strategy/snapshot key 指纹互异且底层密钥不复用
  3. 部署者不保留部署后权限；特权身份替换必须通过暂停、Owner 退出、新部署与重新授权
  4. 泄露、丢失和错误签名演练完成
  5. CI PR 无权读取部署秘密或自动广播
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：GOV-001, SUPPLY-001, SEC-002。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### SECRET-001 — 完整历史秘密扫描与轮换演练

- Roadmap status: `ready`; audited status: `READY`.
- Priority / risk: P0 / high; dependencies: CI-001.
- Deliverables checked: gitleaks/等价规则与基线；历史和构建产物扫描；误报治理；撤销/轮换演练记录。
- Implementation / documentation: 当前有限secret baseline不扫描完整历史/发布产物，也无撤销轮换演练。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 当前工作树、完整 Git 历史和发布产物均被扫描
  2. 覆盖 64 位 EVM 私钥、助记词和主要 provider token 模式
  3. GitHub push protection 保持启用且 CI 失败时不打印秘密值
  4. 测试凭据泄露演练能完成撤销、轮换和影响范围确认
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：CI-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: READY; 仅可准备受限任务，不是验收通过。

### DRYRUN-001 — 确定性部署 Dry-run 与广播前复核

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: SEC-002, KEY-001.
- Deliverables checked: 幂等部署脚本；本地链 dry-run 记录；constructor/角色/预计算地址 manifest；独立复核记录。
- Implementation / documentation: 无部署脚本/本地链dry-run/冻结部署manifest。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 干净检出的 bytecode、constructor args、角色和预计算地址与复核 manifest 完全一致
  2. 脚本在本地链重复运行不会覆盖地址或因未知 nonce 产生不同结果
  3. EVM 地址、Ed25519 key 指纹、资产与 manifest trust anchor 满足 GOV-001/TRUST-001
  4. 复核证据包含 commit、工具版本、命令、输出哈希和明确 PASS，且没有 Testnet 广播
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：SEC-002, KEY-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### DEPLOY-001 — Robinhood Testnet 人工部署

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: DRYRUN-001.
- Deliverables checked: 参数最终预览；部署交易；广播回执；失败恢复步骤。
- Implementation / documentation: 无部署交易；deployment write plane关闭。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 广播的 bytecode、constructor args、角色、nonce 和地址与 DRYRUN-001 复核 manifest 完全一致
  2. 广播前从钱包与 RPC 双重确认 Chain ID 46630
  3. 脚本不会覆盖已有地址或在未知 nonce 下重复部署
  4. 失败时不自动提升 gas 或无限重播
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：DRYRUN-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### VERIFY-001 — 部署来源证明与后部署验收

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: DEPLOY-001.
- Deliverables checked: deployment manifest；Blockscout 源码验证；链上 bytecode 比对；存取款/暂停 smoke 报告。
- Implementation / documentation: 无部署receipt、地址、Blockscout验证、bytecode对照或smoke证据。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. manifest 字段完整且由工具从交易回执生成
  2. Blockscout 源码、constructor args 和本地构建匹配
  3. 最小存入、分配、提现、暂停和恢复事件/余额核对通过
  4. 失败验收不会把地址暴露给 UI adapter
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：DEPLOY-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### OBS-001 — 可观测性、告警与隐私化日志

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P1 / high; dependencies: TX-001, INDEX-001, VERIFY-001.
- Deliverables checked: 结构化事件与指标；告警阈值；日志脱敏；健康/就绪语义。
- Implementation / documentation: local health仅表示进程可用；无链/RPC/reorg/indexer告警和对账指标。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 可区分 RPC 故障、链错误、合约回滚、索引滞后和客户端拒绝
  2. 告警包含操作 ID/tx hash 而非私钥、签名或 RPC 凭据
  3. 关键角色、暂停和异常资金事件触发告警
  4. 健康接口不因进程存活而错误宣称可写
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：TX-001, INDEX-001, VERIFY-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### IR-001 — 事故响应、停用与迁移演练

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: CON-002, KEY-001, OBS-001.
- Deliverables checked: 事故分级与联系人；暂停/前端禁用/安全退出步骤；新地址迁移流程；演练记录。
- Implementation / documentation: ADR有退出方向，未形成六类事故的执行/恢复演练证据。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 每类事故明确检测、决策者、动作顺序和恢复证据
  2. 演练暂停新入口但保留规范允许的用户退出
  3. 旧地址、前端 manifest 和文档不会静默指向不同代码
  4. 演练后记录时间、缺口和改进任务
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：CON-002, KEY-001, OBS-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### E2E-001 — 对抗性 Testnet 端到端验收

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: TX-001, INDEX-001, VERIFY-001, OBS-001.
- Deliverables checked: 可重复 E2E 脚本；测试钱包/测试资产准备；失败注入矩阵；交易和对账证据。
- Implementation / documentation: 已有HTTP进程重启E2E，不是钱包/测试网对抗性E2E。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 正向流程从新钱包可复现且每步有浏览器链接
  2. 错误链、拒签、余额不足、RPC 超时、revert 和重复点击均安全
  3. 刷新或进程重启后能从链上恢复而不重复动作
  4. 所有 UI 数值与事件、receipt、合约 view 对账
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：TX-001, INDEX-001, VERIFY-001, OBS-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### DOC-001 — 安全声明、限制与证据索引

- Roadmap status: `ready`; audited status: `PARTIAL`.
- Priority / risk: P1 / medium; dependencies: BASE-001, NET-001, CI-001.
- Deliverables checked: security.md；limitations.md；evidence index；架构和恢复说明。
- Implementation / documentation: README、SECURITY.md、网络文档、ADR和风险登记已存在。
- Acceptance status (canonical order): PARTIAL | PASS | NOT_AVAILABLE (no deployments) | FAIL.
  1. 每项安全声明可链接到测试、代码、报告或链上证据
  2. 未实现能力和风险接受项醒目标注
  3. 网络、地址和交易链接可独立验证
  4. 文档不包含个人信息、秘密或误导性收益表达
- Evidence status: README.md; SECURITY.md; docs/ROBINHOOD-CHAIN.md; docs/management/host/HOST-BASELINE.md
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 缺少完整逐项证据索引/limitations交付；公开host记录与不含个人信息标准冲突。
- Required hardening / next action: 补证据索引和已实现/未实现对照，协调公开数据脱敏；不制造链地址/交易或收益。
- Final verdict: PARTIAL; 不满足完整VERIFIED_DONE；需按上述证据缺口继续。

### DEMO-001 — 评委演示与恢复流程

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P1 / medium; dependencies: E2E-001, DOC-001, IR-001.
- Deliverables checked: judge walkthrough；演示数据重置；失败/恢复分支；录屏和时间预算。
- Implementation / documentation: 已有本地资金工作台，不是带真实测试网证据与恢复路径的最终评委演示。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. 新环境按 README 可在限定时间内跑通
  2. 页面始终显示 Robinhood Chain Testnet、账户、合约和交易状态
  3. 至少演示错误网络或重复操作被拒绝
  4. 演示失败不需要接触主网或私人账户
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：E2E-001, DOC-001, IR-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

### RELEASE-001 — 最终发布门禁与独立复现

- Roadmap status: `backlog`; audited status: `NOT_STARTED`.
- Priority / risk: P0 / critical; dependencies: E2E-001, DEMO-001, SEC-002, IR-001, SUPPLY-001.
- Deliverables checked: release checklist；clean-room reproduction；最终风险登记；版本标签与证据包。
- Implementation / documentation: G1–G4未通过，无版本标签/源码-ABI-bytecode-address一致性证据包。
- Acceptance status (canonical order): NOT_IMPLEMENTED / NOT_VERIFIED for all criteria.
  1. G0–G4 所有检查有最新证据且无人为跳过
  2. 无未接受 Critical/High 风险和未解释门禁失败
  3. 版本标签对应相同源码、ABI、字节码、地址和文档
  4. 明确声明不批准主网或真实资金
- Evidence status: 当前tracked源码/测试/工具清单与canonical evidence=[]；不能把类似的local demo能力当作本任务证据。
- Tests / CI / reproducibility: 本任务专属完整自动化验收和复现证据未提供；E1不证明其完成。
- Security status: 保持local/mock/testnet-only既有边界；风险等级是任务风险，不是已验证漏洞严重度。
- Problems: 未找到该任务完整交付、专属验收测试或完成证据。依赖：E2E-001, DEMO-001, SEC-002, IR-001, SUPPLY-001。
- Required hardening / next action: 按依赖顺序另开任务；完成实现、负向/边界测试、独立复核与证据后再验收。当前Wave不新增此功能。
- Final verdict: NOT_STARTED; 没有足够实现证据，不提前开工或宣称完成。

## Gate reassessment and unresolved decisions

G0 remains passed in canonical planning but its public-baseline and live-RPC evidence claims are not substantiated by the current candidate. Audit verdict: NOT VERIFIED. G1–G4 remain OPEN. No roadmap edit was made; any correction must be explicit and regenerate dependent artifacts.

The checked-in ADR is still under review. Per-intent manual confirmation, a fixed non-admin test token and atomic-only venue behavior are MVP restrictions, not an implementation of the long-term confidential automated RWA strategy marketplace. No pass issuance/transfer market, builder publication/capacity registry, strategy confidentiality execution, fee rent/continuity mechanism, production return calculation or RWA adapter is implemented. Do not silently present hackathon constraints as final SaaS product decisions.

Not fully resolved: pending scan/independent review; malformed URL error leakage; missing negative/coverage evidence; public host data and build copying; Worker B's seven reported defects; immutable external governance; future deployment/user-confirmation decisions. Historical host-data removal or history rewrite requires user direction. No new financial authority was exercised.

# AF-CHAIN01 Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task in the current Macbeth04 session. Cross-worker review and questions use this worker's PR.

**Goal:** 交付可本地验证的合约工程与可审阅的 Vault/Adapter 规格，链上写入保持关闭。

**Architecture:** 独立 `contracts/` 工程；仅用不托管资金的 EIP-712 Intent preview 验证 Solidity 与授权字段绑定。Vault 状态机和 Adapter schema 作为候选文档提交，未冻结前不落入复杂运行代码或共享类型。

**Tech Stack:** Foundry、solc、OpenZeppelin Contracts、Slither，均固定精确版本和工件摘要；沿用根目录 Node 基线。

**Frozen coordination:** [Interface Contract v1 at 73230c43e464cd1b579fa16a6425756291ef9e8e](https://github.com/pdbsy/quantpass/blob/73230c43e464cd1b579fa16a6425756291ef9e8e/docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md); task-local locks/docs approved in PR #8 comment 5646402687.

**Spec:** [AF-CHAIN01 Task Intake](../../contracts/AF-CHAIN01-INTAKE.md)，依据用户提供的 Macbeth04 任务文件。

## Global Constraints

- AGENT_NAME = Macbeth04; TASK_ID = AF-CHAIN01。
- Branch = macbeth04/AF-CHAIN01-contract-foundation。
- Testnet Writes = CLOSED; target metadata = Robinhood Chain Testnet, Chain ID 46630。
- 不签名、不网络部署、不广播、不保存私钥、不 self-merge、不修改其他 Worker 分支。
- 产品经济决策全部保留 PRODUCT DECISION REQUIRED。
- 测试通过与工具安装结果分别记录，不能将 NOT RUN 表述为 PASS。

### Task 1: Publish intake and lock the toolchain

**Files:** 本计划、`docs/contracts/AF-CHAIN01-INTAKE.md`、`contracts/toolchain.lock.json`、`contracts/TOOLCHAIN.md`、`contracts/.gitignore`。
**Consumes:** 已核验默认分支、官方 release 元数据及发布工件。
**Produces:** 自己的 Draft PR；精确 toolchain、平台范围、许可证、下载摘要和可复现安装步骤。

- [x] 提交 intake/plan，推送指定分支并创建指定标题 Draft PR。
- [x] 核验官方 Foundry v1.5.1、solc 0.8.31、OpenZeppelin 5.4.0、Slither 0.11.3 的 release/包元数据；如不兼容，先记录证据后选择另一精确版本。
- [x] 下载到本工作树忽略目录，核对发布摘要后执行版本命令；禁止远程脚本管道、浮动 latest、全局安装或改 Git 身份。
- [x] 文档记录官方 URL、SHA-256/SHA-512 或 Git revision、license、supported/tested platform 和已知限制。

### Task 2: Minimal non-custodial contract and local checks

**Files:** `contracts/foundry.toml`、`contracts/src/VaultIntentPreview.sol`、`contracts/test/VaultIntentPreview.t.sol`、`contracts/script/check-local.sh`、`contracts/README.md`。
**Consumes:** Task 1 固定 Foundry/solc 和 OpenZeppelin EIP712。
**Produces:** `preview(Intent) external view returns (bytes32)`，只计算候选摘要；不验签、不转账、不改状态。

- [x] 测试先写：从真实 preview 结果验证 ownerId/strategyId/vaultId/commandId/commandType/assetId/decimals/amount/expectedRevision/nonce/deadline/authorizationEpoch/policyHash 每个字段变化都会使摘要变化；不同合约和 chainId 域隔离。用 Forge 测试合约部署本地实例，测试不签名、不广播。
- [x] 先写最小可编译 stub：`function preview(Intent calldata) external pure returns (bytes32) { return bytes32(0); }`；执行 `forge test`，确认字段绑定断言实际失败。
- [x] 实现最小 `_hashTypedDataV4(keccak256(abi.encode(words)))`，words 为 bytes32[14]，依次为 TYPEHASH、六个 UTF-8 字符串的 keccak256、decimals、amount、expectedRevision、nonce、deadline、authorizationEpoch、policyHash，每个字段按结构声明顺序编码。域名与版本明确标记为草案 preview 域。
- [x] 执行 `forge test`、`forge build`、`forge fmt --check`；如需要格式化，只覆盖本工程。
- [x] 本地脚本固定离线 build/test/fmt/static-analysis 命令，不接受自定义 target、RPC、calldata、私钥或 broadcast 参数；检查工具精确版本，失败立即退出。
- [x] 执行 Slither，保留真实报告，逐条解释适用性；未执行检查标明 NOT RUN。

### Task 3: Vault v1 and Adapter specification

**Files:** `docs/contracts/VAULT-V1-SPEC.md`、`docs/contracts/ADAPTER-BOUNDARY.md`。
**Consumes:** M02 状态/命令、security-model-v0 的授权与风险边界、产品决策登记。
**Produces:** REVIEW DRAFT 规格和接口提案；不改变 `packages/**` 或 `apps/**`。

- [x] 定义状态/金额单位、deposit、allocation、deallocation、withdrawal、pause、owner exit 及完整权限矩阵；区分 stop 请求、已结算和资金到账。
- [x] 定义 authorization/nonce/deadline/stateVersion/epoch，标准 EIP-712 domain 与 exact call intent，风险签名候选的双签绑定及撤销；明确 Ed25519 本地引用模型不能直接迁移为 EVM 签名。
- [x] 为每个操作写前置条件、原子状态变化、事件、错误；列出重试/回滚/重组与暂停下退出规则。
- [x] 写 LocalAdapter/TestnetAdapter 共享命令和 receipt 语义、允许字段、错误映射和 finality 差异；客户端不能拼任意 calldata，TestnetAdapter 写实现未开放。
- [x] 列出 PRODUCT DECISION REQUIRED 与下一阶段测试清单；通过本 PR 向 Macbeth03/01 提交接口问题，向 Macbeth05 请求独立复核。

### Task 4: Verify and hand off

**Files:** `docs/contracts/AF-CHAIN01-VERIFICATION.md`，本计划及 PR 日志。
**Consumes:** build/test/static-analysis 实际日志、最终 diff、协作回复。
**Produces:** 可复核证据、明确未执行项、READY FOR REVIEW Draft PR。

- [x] 运行固定版本工具、Forge build/test/format、Slither、根目录相关检查，核验没有 UI 和业务实现改动。
- [x] 校验每个新提交的 Macbeth04/AF-CHAIN01 元数据，完整审阅 diff，并将独立安全复核标为已完成或等待 Macbeth05，不能代签。
- [x] 更新工具链/工程/规格/Adapter/Build/Tests/Static analysis/Open product decisions/Security concerns/Next dependency 和八项 Retrospective。
- [x] 推送、回读 PR/评论/HEAD，停止于 READY FOR REVIEW，不合并或部署。

## Execution evidence

Implementation and local checks are recorded in docs/contracts/AF-CHAIN01-VERIFICATION.md. Slither completed with one informational pragma finding; strict exit 255 is retained, not labeled a clean PASS. Independent Macbeth05 review and final PR readback are handoff gates recorded publicly at the exact candidate SHA; no self-merge.

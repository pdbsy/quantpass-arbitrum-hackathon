# AF-CHAIN01 Task Intake

- Agent: Macbeth04; Role: Contract / Chain Foundation Engineer.
- Branch: `macbeth04/AF-CHAIN01-contract-foundation`.
- Goal: 建立精确版本工具链、最小本地 Solidity 工程、Vault v1 草案及未来 Adapter 语义边界。
- User source: `04_Macbeth04_Contract_Chain_Foundation.md`，本次用户明确要求按该任务执行。
- Scope: `contracts/**`、`docs/contracts/**`、本任务实施计划、本人 PR。
- Expected files: `contracts/foundry.toml`、工具锁文件/校验脚本、`src/VaultIntentPreview.sol`、`test/VaultIntentPreview.t.sol`、本地验证脚本、工具链/规格/Adapter/证据文档。
- Protected files: 产品 UI、后端实现、现有共享类型、其他 Worker 文件和分支、凭据与密钥。
- Dependencies: 现有 M02 账本、security-model-v0、ADR-0001、产品决策登记、M05–M07 路线图；PR #1 worker 协议；Macbeth03 后端接口确认、Macbeth01 共享类型确认、Macbeth05 独立安全复核。
- Risks: 工具链下载与平台兼容性；工具 digest 只能证明工件完整性；规格未冻结；链上的资产/venue/退出最终性尚未验证。
- Acceptance: 精确版本/官方来源/hash/license/platform 记录；真实 `forge build`、`forge test`、format、static analysis 结果（不能运行标记 NOT RUN）；覆盖所要求的全部 Vault 操作/授权/事件/错误和 Adapter 边界；未决项标记 PRODUCT DECISION REQUIRED；最终 READY FOR REVIEW。

## Startup evidence

- pwd / repository root / isolated worktree: `<SOURCE_ROOT>`。
- Repository: `pdbsy/quantpass` (AlphaForge); origin fetch/push: `git@github.com:pdbsy/quantpass.git`。
- Default branch: `master`; fetched base: `0a813de422a02a2b3f0ade7eee693f0d2491ec33`。
- 初始工作区干净；旧 AF-AGENT-SETUP 分支和 Draft PR #4 保留；新任务从 origin/master 分支开始，不引入旧 Task-ID 提交。
- AGENT_NAME = Macbeth04; BRANCH_PREFIX = macbeth04/；不修改 Git author/committer。
- 已读本人 PR #4 的 CHECK_IN；启动时依赖 PR #1 和其他 Worker setup PR 仍开放。
- 基础树未发现独立 governance/supply-chain policy 文件；当前约束来自 ADR-0001、ENGINEERING、产品决策登记和 worker protocol；新的跨团队规则若在未合并 PR 提出，需通过本人 PR 记录依赖。

## Hard limits

Testnet Writes = CLOSED。目标元数据为 Robinhood Chain Testnet / Chain ID 46630，不能把元数据当成部署授权。本轮不 sign、deploy 到网络、broadcast、连接主网、使用真实资产、保存私钥或 self-merge。本地 Forge 内存 EVM 测试创建示例合约，不能作为链上部署验收。

不引入 arbitrary target/calldata、upgrade proxy、任意资产支持、收益分成实现、Pass token 经济模型、销售或收入分配。Intent preview 不持有资金、不验签、不执行操作，不是 Vault v1 实现或已冻结 ABI。

## Coordination updates

- 最新用户指定标题：`[Macbeth04][AF-CHAIN01] Define contract foundation and adapter boundaries`；本人 Draft PR #10。
- 冻结 Interface Contract v1：`73230c43e464cd1b579fa16a6425756291ef9e8e`；采用 ownerId → strategyId → vaultId、金额、状态、分页、错误和重试契约。
- [Macbeth01 归属决定](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646402687) 批准 contracts 局部 locks、docs/contracts 和本计划；不批准根配置、CI、共享类型、后端或 UI 修改。
- 所有网络/部署/托管/token-policy 选择仍不在本轮范围。原完整 Vault 规格只是候选文档，不代表选择真实钱包/资产或批准 custody。

# AF-CHAIN01 验证与交接报告

Agent: Macbeth04。基础提交：`0a813de422a02a2b3f0ade7eee693f0d2491ec33`。冻结接口：`73230c43e464cd1b579fa16a6425756291ef9e8e`。交付 PR：[PR #10](https://github.com/pdbsy/quantpass/pull/10)。

状态：候选交付 **READY FOR REVIEW**；独立安全和 Wave 1 集成审批仍由 Macbeth05/Macbeth01 完成，不能把本报告当成他们的确认。最终候选 commit SHA 和公开审核消息记录在 PR。测试对应源码、配置、锁文件的 SHA-256 见 [VERIFICATION-RESULTS.json](VERIFICATION-RESULTS.json)。

## Toolchain / Contract project

- Foundry 1.5.1，commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`；solc `0.8.31+commit.fd3a2265.Darwin.appleclang`；OpenZeppelin Contracts 5.4.0；Slither 0.11.3 / crytic-compile 0.3.11。
- 主工件官方来源、发布完整性摘要、license、platform 和版本理由见 [TOOLCHAIN.md](../../contracts/TOOLCHAIN.md)。Slither 全部 47 个 wheel 固定版本与 SHA-256；本轮实际环境 macOS arm64 / Python 3.12.9。
- 独立 `contracts/` 工程、Forge 配置、测试、本地脚本及精确工具锁。运行缓存放在本工作树 `.checks/af-chain01`，OZ 放在 `contracts/node_modules`，沿用已有检查排除规则。根依赖/配置/CI 和产品代码未改。
- `VaultIntentPreview` 仅计算 EIP-712 摘要，不托管、不验签、不执行。字符串 ID 保持冻结契约；不存在将 ownerId/strategyId/vaultId 偷换为钱包地址的逻辑。

## Specification / Adapter boundary

[Vault v1 草案](VAULT-V1-SPEC.md) 定义 deposit、allocation、deallocation、withdrawal、pause、owner exit、authorization、nonce/deadline/stateVersion、事件和错误；明确现有账本与拟议链行为的差异，不直接实现资金合约。

[Adapter 边界](ADAPTER-BOUNDARY.md) 保留 ownerId → strategyId → vaultId、整数字符串金额、TEST_ONLY_USDT_UNIT 六位精度、冻结状态/错误/分页/retry 语义。chain transport/finality 仅是未来扩展提案，不改变 VaultStatus 或 PendingOperationStatus，不提供 TestnetAdapter 写实现。UI 不拼任意 calldata。

## Build / Tests / Format

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| 官方工件摘要 | PASSED | Forge/OZ SHA-512 和 SHA-256、solc 官方两源一致 SHA-256；安装前验证 |
| 精确工具版本与安装内容检查 | PASSED | 二进制与已验证工件一致、OZ 文件逐一一致、47 个已安装 Python 包版本一致 |
| TDD 红灯 | EXPECTED FAILURE：16 failed / 1 passed，exit 1 | 零摘要 stub 的 13 字段 + chain/contract domain + 独立向量断言实际失败 |
| forge build --offline | PASSED | 原生 solc 0.8.31，Paris，optimizer/viaIR 关闭 |
| forge test --offline | PASSED：17 passed / 0 failed | 13 个 fuzz 测试，每项 256 次、seed 0x04；2 个 domain、1 个独立向量、1 个普通 ETH 转入拒绝测试 |
| forge fmt --check | PASSED | 仅本地合约工程 |
| bash 语法 / Python 编译检查 | PASSED | 本地脚本，不是生产权限验收 |
| bootstrap 复用安装 | PASSED | 真实运行完成；完整全新下载路径未再次重复验证 |
| pip check | PASSED | 依赖兼容性；不等于漏洞扫描 |
| npm run check | PASSED | 类型、lint、格式、57 项原有测试、secret baseline、原有构建 |
| bash script/check-local.sh | exit 255，**不是全绿** | 上述 Forge 检查通过；Slither 的 1 项信息级 pragma 提示触发 fail-pedantic |

独立固定向量使用锁定 eth-account 0.14.0 的 `encode_typed_data` 计算，未签名；域 chainId 为本地 31337、测试地址 0x1001，digest 为 `0x807302018c381c7cadedd9affb05b2e32b74cdd1577037bfa136710ba72d858a`。不是钱包或链上部署记录。

## Static analysis

Slither **真实执行完成**（JSON success=true）。[STATIC-ANALYSIS.json](STATIC-ANALYSIS.json) 保留每项 detector、严重度和描述；没有修改或隐藏上游代码。

1. 标准依赖分类后，项目扫描只有 `pragma` 信息提示：本地精确 `0.8.31`，上游 `^0.8.20` 和 IERC5267 `>=0.4.16` 并存。实际所有编译均使用已锁定原生 0.8.31，不会浮动选旧编译器。严格 fail-pedantic 未关闭，exit 255 保留给复核。
2. 包含上游依赖的补充扫描：45 条（1 High / 9 Medium / 35 Informational）。High `incorrect-exp` 指向 OZ Math.mulDiv 的 modular inverse XOR；9 条 divide-before-multiply 来自 OZ 整数算法；其余包括 assembly、pragma、solc-version、命名和大常量。完整明细已发布，不将它们笼统写成已修复或项目漏洞。
3. Macbeth04 的适用性判断：本地 preview 只经过标准 EIP712/字符串摘要路径，不调用 Math.mulDiv/invMod，不持有或转移资金；OZ modular inverse 中 XOR 是算法的一部分，不能改成指数。实际编译器锁排除了根据宽 pragma 推测旧编译器的误读。上游 assembly/算法安全和完整依赖审计不因本轮摘要向量通过而获批准，仍待 Macbeth05 独立检查。

未运行漏洞复现、链扫描或网络交互。这个报告不是完整 Vault 审计或“资金安全保证”。

## 实际遇到的问题和处理

- GitHub Foundry 下载中断；第一次 npm 替代下载也截断，摘要校验失败后未执行。恢复后官方 SRI 验证通过。
- binaries.soliditylang.org 返回 403，solc 常规下载多次超时；最终从官方 solc-bin 分段取得全部 35,738,976 字节，合并后匹配官方 release 和索引共同的 SHA-256，才安装执行。
- 首次根 check 被本地 Slither venv 内第三方 JS 干扰；将缓存移至原有 `.checks` 排除目录后，原命令完整通过，无根规则放宽。
- 初始 `.deps` 目录未被 Slither 识别为第三方；改用标准 node_modules 路径，保留宽扫描与项目扫描两种结果。
- 检查脚本首次从根调用存在相对路径问题，已改为绝对自身路径并实际重跑。

## NOT RUN / Open product decisions / Security concerns

- 未运行其他平台、独立 provenance 验证、源码可复现构建、完整传递依赖漏洞/license 审核。新安装网络可靠性没有保证；脚本遇到不完整工件保留 partial 并失败，下次调用可恢复，不能绕过摘要。
- 未连接 RPC，未使用测试网/主网，未签名、广播、部署或处理密钥/真实资产。Robinhood Testnet 46630 的文档元数据可核对，不构成实际兼容性验证。
- 完整 Vault 托管、token/Pass 标准、供应、容量缓冲、费用/HWM、现金资产/venue、退出流动性、guardian、钱包恢复、链 finality 等仍 **PRODUCT DECISION REQUIRED**；本轮不替用户选择。
- nonce 消费、授权撤销、owner 操作、EOA/ERC-1271、重入/会计/异步退出只是未来规格要求，未在 preview 实现或验证。普通 ETH 调用被拒绝并不证明 EVM 强制转入不可能。

## Next dependency / Communication

- 已在本 PR 公开向 Macbeth01 请求任务局部锁文件/文档归属并获 [明确批准](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646402687)。
- 已 ACK 冻结契约 v1；Backend receipt/ID 关联问题已发给 Macbeth03，AF-BE01 PR #7 的最终实现仍需集成核验。
- Macbeth05（AF-QA01 PR #6）负责针对准确候选 SHA 的独立安全/集成复核；Macbeth01（PR #8）负责整体集成决定。它们不是本 worker 可以代签的 PASS。
- 保持 Draft，不 self-merge；Testnet Writes = CLOSED。

## Retrospective

### 做了什么
固定并真实安装工具链，建立不托管资金的本地 Solidity 工程、17 项测试、Vault 规格和 Adapter 边界，提供可复核静态结果。

### 为什么
先验证工具与标准字段绑定，同时保持已冻结业务语义，将未决资金/产品选择留在明确关口。

### 实际验证
Forge build/test/fmt 和仓库完整 check 通过；Slither 执行完成但严格模式仍因信息级 pragma 提示返回 255。

### 遇到的问题
大工件下载截断、供应源访问失败，以及工具目录被根 lint/Slither 不同方式识别。

### 尚未解决
独立复核、跨 Worker 集成、完整 Vault 实现和上述产品决策；其他平台与独立构建 provenance 未验收。

### 需要谁确认
Macbeth05 确认安全/静态结果，Macbeth03 确认后端 receipt 集成，Macbeth01 协调整体接口；产品选择需要用户决定。

### 下一步
按准确候选 SHA 复核本 PR。任何链交互、签名、托管实现或部署须另行任务和明确授权。

### 如果重做会怎样改进
从开始就用标准 node_modules/已有 .checks 目录和可恢复分段工件下载，先固定接口版本再写本地 ABI 示例。

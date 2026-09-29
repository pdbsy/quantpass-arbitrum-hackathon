# AlphaForge Vault：产品定义与本轮实现边界

用户于 2026-09-29 确认：Vault 是绑定特定 Strategy、由用户控制的独立链上资金账户。它托管 AF-USDC，约束本金容量，记录协议仓位，执行提款、关闭和 Pass 解锁。它不是基金份额、ERC-4626 share、Creator 公共资金池、Pass 定价池或任意调用钱包。持有 Pass 不获得其他 Vault 的资产权利。

## 权限与容量

Owner 创建时显式指定且非零、不可迁移，不由 deployer、factory owner 或 Creator 隐式代替。仅 Owner 可存款、提款、关闭；收款人固定 Owner。Creator 定义策略，Pass 代表该策略的本金容量，Vault 隔离资金。锁定的 Pass 托管在对应 PassLocker，不能由持有人直接转移；未锁定 Pass 可独立转移。购买 Pass 与存款是不同交易，市场价格不参与本金或权益计算。

1 PASS = 1 AF-USDC 本金容量。AF-USDC 6 decimals、PASS 18 decimals：

```text
passRaw = usdcRaw × 10^12
lockedPassRaw = principalBasisRaw × 10^12
passRaw % 10^12 != 0 → 拒绝反向容量换算
```

全程整数，无舍入、静默截断或浮点。容量优先以 AF-USDC 基础单位记账。Pass 普通转账仍可使用 18 位精度；只有换算为本金容量时要求整除。相同数量的两个代币不要求原始整数相同。

## 资金生命周期

- 存入本金与冻结相应 Pass 原子完成；任一步失败回滚全部资金及会计变化。
- 本金 100、权益 150：利润 50 不增加冻结；取出 30 利润后本金及锁定 Pass 仍为 100。
- 提款先扣可提款利润，剩余部分退出本金容量，并按 1:1 解冻。原始本金 100、利润已取完，再取本金 30，剩余本金和冻结均为 70。
- 亏损不释放 Pass。本金 100、资产 60 时仍冻结 100。协议仓位清零后完整关闭，退还剩余资产，清零本金和容量，返还全部剩余 Pass。
- 协议已记账非 USDC 仓位阻止本金提款，必须先结算。`close()` 本身不会凭空清算资产；当前合约要求调用前已无已记账仓位。未来结算器须单独实现和验证。
- 协议本金、锁定 Pass、总权益与协议仓位是不同概念。未估值的仓位不能伪装成 USDC，也不能把钱包直接转入的余额当作利润。
- 未记账 token／原生 dust 不计本金、权益、PnL 或容量，不阻止关闭；关闭后 Owner 指定单个资产 rescue，不枚举任意 token。

## 链上代码核对

现有 `contracts/src/AlphaForgeVault.sol`、`PassLocker.sol` 承担上述资金权限与容量规则；相关 custody、accounting、boundaries、rescue 和 invariant 测试保留。此次没有修改 Solidity、ABI 或部署身份。

现有钱包交互读取 AF-USDC/PASS 授权并按金额准备有限额度授权；提款、关闭和 rescue 使用 owner-bound prepared action 与逐笔确认，索引投影绑定链上证据。缺少受审查部署配置时写操作保持禁用。

当前 checkout 没有已安装的锁定 Foundry 工具链，本轮 Solidity 执行验收为 NOT_RUN，源码核对不能替代合约测试。没有部署、签名、广播或更改网络权限。钱包创建 Vault 的完整发布流程、真实 testnet 验收不在本轮已完成声明内。量化模拟器的交易/PnL 不是链上 MVP 已支持真实策略运行的证据。

## 本轮 local/mock 参考模型

新增 `passLock.version=1` 是本地 TEST_ONLY 参考模型，不能产生任何链上资产权益。它用于验证资金规则和演示交互，不是链上账本缓存。旧 schema、协议标识和历史 receipt 保留。

新模拟 Vault 请求 `passPolicy: principal-v1` 后启用。既有 Vault 通过 owner 命令 `enablePassLocking` 显式启用；只允许已停止、无仓位/订单/待提款/费用、没有历史已付款且原始存款不超过已有 Pass 容量的账本。拒绝从含历史提款的旧数据猜测本金或补写冻结。旧调用方未指定策略时仍按原历史模式工作；页面明确区分。

内部 `principal` 与每笔待提款的利润/本金划分使用 6 位容量基础单位。API `passAccounting` 的 `totalPassRaw`、`freePassRaw`、`lockedPassRaw` 明确为 18 位，`passDecimals=18`、`capacityDecimals=6`。模拟持有 Pass 由既有测试 fixture 提供，不宣称真实钱包余额。

模拟提款：申请时预留闲置现金和利润/本金划分，冻结直到确认付款；取消恢复闲置，不释放 Pass。并发请求不能重复占用利润。确认再次检查持仓，丢失响应后原 ID 重试不会重复付款或解冻。Bot 现金回到 Vault 闲置不退出本金容量。`closeVault` 仅在停止且无仓位、挂单、待提款和费用时退还全部模拟现金、释放全部冻结，关闭后不再存入。该模拟确认不是实际链上签名流程。

新增测试覆盖上述边界、账户隔离、SQLite 重启幂等、精度和溢出。真实浏览器验收暂被内置浏览器的 data 错误页 URL 策略阻止，未宣称截图验收通过。最终工程结果以源码 C、生成清单 R、快照 S 和最终命令退出码为准；同一作者技术自查不是独立批准。

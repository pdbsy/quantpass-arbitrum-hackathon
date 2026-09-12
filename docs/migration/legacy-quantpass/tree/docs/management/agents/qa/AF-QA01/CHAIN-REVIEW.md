# AF-QA01 Chain 独立验证

> 历史专项记录：以下“开放/未交付/BLOCKED/NOT RUN”均描述本报告所列旧阶段。最终组合已经重新验证，当前结论与F01–F05关闭见 [INTEGRATED-REVIEW](INTEGRATED-REVIEW.md)。原始SHA/失败/限制保留。

Agent: Macbeth05 · Task: AF-QA01。QA 状态：**READY FOR REVIEW**。整体集成建议：**BLOCKED**。

## 输入与独立性

- 候选：PR #10，`673a33bbb53c0894db622ee0a626b09c27e51fbe`；base `0a813de422a02a2b3f0ade7eee693f0d2491ec33`。
- 冻结接口：`73230c43e464cd1b579fa16a6425756291ef9e8e`。
- [作者公开交付](https://github.com/pdbsy/quantpass/pull/10#issuecomment-5646552346) 是待验证输入，作者 PASS 没有直接转为 QA PASS。
- 2026-09-12 在 Macbeth05 自有 git archive 快照完成；macOS 26.6.2 / arm64 / CPython 3.12.9。未进入其他 Worker 工作区，未修改候选源码或其测试预期。
- 相对 base 只有 18 个新增文件，位于 contracts、docs/contracts 和任务计划；没有根配置/CI、共享类型、后端或 UI 改动。候选全部 122 个发布文件在执行前后逐 Git blob 一致；交付列出的 8 个文件 SHA-256 均匹配。

## 实际运行结果

| 检查 | QA 实际结果 | 证据与限制 |
| --- | --- | --- |
| Forge/OZ 发布摘要 | PASSED | 官方 npm 对应版本 SRI 与锁一致；下载包 SHA-256/SHA-512 均验证，安装文件与包逐字节比较 |
| solc 完整性 | PASSED | 官方 solc-bin 索引一致；完整 35,738,976 字节 SHA-256 `f5a243d6b2dd8fba307e36c5fefa2d8eb3ae74ba81036d1c17c971b5d346ade9` |
| Python wheel 锁 | PASSED | 全部 47 个 SHA-256 与对应官方 PyPI release metadata 匹配；实际 pip require-hashes/binary-only 安装完成，47 包安装版本核对 |
| 工具运行版本 | PASSED | Forge 1.5.1-v1.5.1，commit b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2；solc 0.8.31+commit.fd3a2265.Darwin.appleclang；Slither 0.11.3 / crytic-compile 0.3.11 |
| forge fmt --check | PASSED / exit 0 | check-local.sh 内实际执行 |
| forge build --offline | PASSED / exit 0 | 12 个 Solidity 文件；Paris，optimizer/viaIR 关闭；本地编译器且 auto detection 关闭 |
| forge test --offline | PASSED / exit 0 | **17 passed / 0 failed / 0 skipped**；13 fuzz × 256，固定 seed 0x04 |
| 独立摘要 / ABI 检查 | PASSED / exit 0 | eth-account 重新计算、标准 14-word ABI 编码对照、编译 ABI 字段及可调用表面核对；见下方完整 QA 脚本 |
| pip check | PASSED / exit 0 | No broken requirements found；不是依赖漏洞审计 |
| 项目 Slither | 分析完成；**严格门禁 FAILED / exit 255** | success=true；1 Informational pragma；未改 fail-pedantic |
| 包含依赖 Slither | 分析完成；**严格门禁 FAILED / exit 255** | success=true；45 条：1 High / 9 Medium / 35 Informational；未过滤这些提示 |

两种扫描的 detector、impact、confidence、description 完整多重集合均与作者发布记录相等；顺序差异不影响比较，重复记录没有删除。`check-local.sh` 整体 exit 255，因此不是全绿。

第一次 solc 普通下载超时，未执行残缺文件。QA 使用同一官方 URL 分段下载，核对每段 Content-Range、长度及完整 SHA-256 后交回原 bootstrap。随后 pip 下载超时退出；原脚本重试复用自己的缓存成功。额外 Python HTTPS 元数据读取发生 TLS EOF，改用保留 TLS 验证的 curl 完成 47 项官方元数据核对。没有改摘要、关闭 TLS 或放宽测试。

完整新环境的“一次运行 bootstrap 无干预成功”没有取得：下载恢复需上述处理。通过的是最终锁定工具与本地验证结果，网络可靠性限制保留。

## EIP-712 / ABI

源码 `contracts/src/VaultIntentPreview.sol:9-51` 的 Intent 有 13 个字段：6 个 string、uint8 decimals、5 个 uint256、bytes32 policyHash。字符串先分别 keccak256；TYPEHASH 与 13 个字段形成固定 14 × 32 字节。固定数组的 abi.encode 没有动态长度或偏移，随后进入 OZ typed-data domain hash。该顺序与 [EIP-712 编码规定](https://eips.ethereum.org/EIPS/eip-712) 一致。

13 个 fuzz 测试逐一改变各字段；另外验证当前 chainId 改变、不同 verifyingContract、固定参考向量、普通 ETH 转入拒绝。QA 另行核对编译 ABI：只有 `preview(Intent)`、继承的 `eip712Domain()` 两个 view 函数；preview tuple 的 13 个名称/类型/顺序完全一致，返回 bytes32，无 receive/fallback。

QA 重新计算的向量摘要：`0x807302018c381c7cadedd9affb05b2e32b74cdd1577037bfa136710ba72d858a`。域为 AlphaForgeVaultFoundationPreview / 0.1、测试 chainId 31337 和地址 0x1001。QA 使用同一锁定 eth-account 库重新计算，并补充 eth_abi 固定数组对照；不是另一套独立密码实现。没有签名、钱包或真实链调用。

32 字节域名走 OZ ShortStrings 的 storage fallback；3 字节版本走短字符串。静态审阅包含构造及继承的 domain inspection，没有把这些代码误写为全部不可达。eth-account 向量测试本身不覆盖所有 domain inspection 运行路径。

## 冻结接口和产品边界

- ownerId → strategyId → vaultId 保持 string；commandId 对应 Command.id，expectedRevision 是本地 revision 的 ABI 表达。没有隐式地址转换、注册表映射或更改公开 JSON 金额类型。
- TEST_ONLY_USDT_UNIT / 6 decimals、whole Pass 与金额单位、stopped/running/stopping、pending 终态留 audit、Page/cursor/default50/max100、闭合公共错误与原请求幂等语义在规格中保持。未来链错误、stateVersion、receipt finality 明确为待冻结提案。
- 预览器不验证 ID 正则、金额正值、command 白名单、owner、deadline、nonce；任何输入可计算摘要。这是已声明的预览范围，不是实现了授权验证。
- Vault/Adapter 文档将托管、token/Pass 标准、费率、容量、退出流动性、guardian、EOA/ERC1271、nonce 消费、重组与真实链兼容性留待决策和后续实现；没有把本地模拟或测试摘要写成真实收益/链上执行。
- 普通 ETH 调用拒绝不等于无法强制转入。17 项摘要测试不证明托管、授权或资金安全。

## 已提供扫描提示的静态适用性

[CHAIN-TRIAGE.md](CHAIN-TRIAGE.md) 对 **46 个输入逐条保留结论**：1 条项目提示 + 45 条包含依赖提示，重复 pragma 不去重。46 not_actionable（只对本候选预览器），0 confirmed，0 needs_review；这是静态适用性结论，不是修复记录或门禁豁免。

Math.mulDiv/invMod 不在构造、preview 或继承 domain inspection 调用路径；XOR 是 modular inverse seed，不能按扫描提示改为幂运算。对实际可达的 ShortStrings.toString、StorageSlot.getStringSlot(string storage)、MessageHashUtils.toTypedDataHash 汇编分别核对固定输入/指针、写入范围和后续用途。版本提示中的 20 个具名历史问题在官方对应版本 bugs.json 中均已于 0.8.23 或更早修复。

未发现适用 SECURITY.md；采用 README、实现和冻结 TEST_ONLY 边界作为补充依据，保留此政策缺口。静态分诊在运行功能验证前独立完成；没有漏洞复现。完整依赖/许可证审计、独立构建来源验证仍 NOT RUN。

## 可复现命令与 QA 补充脚本

在准确 candidate 的 `contracts/` 内，先按锁安装工具，再运行：

```sh
python3.12 script/bootstrap.py
bash script/check-local.sh
```

第二条在当前锁定结果下返回 255，必须保存原始日志。完整扫描使用相同干净环境、相同 Foundry out 目录，只移除 exclude-dependencies 参数：

```sh
slither . --compile-force-framework foundry --fail-pedantic --foundry-out-directory ../.checks/af-chain01/out --json -
```

实际运行以 env -i 等价的干净环境指定本地工具 PATH、FOUNDRY_PROFILE=default、SVM_HOME/FOUNDRY_DIR 为自有缓存目录。下方脚本由 QA 编写，在 `contracts/` 用锁定 venv Python 执行，未修改原作者源码/测试：

```python
from pathlib import Path
import json,subprocess,hashlib
from eth_account.messages import encode_typed_data
from eth_utils import keccak
from eth_abi import encode
root=Path.cwd()
x=json.loads((root/'test/intent-vector.json').read_text());d=x['typedData'];v=encode_typed_data(full_message=d)
digest='0x'+keccak(b'\x19'+v.version+v.header+v.body).hex();assert digest==x['digest']
fields=d['types']['Intent'];m=d['message'];type_string='Intent('+','.join(f["type"]+' '+f['name'] for f in fields)+')'
words=[keccak(text=type_string)]
for f in fields:
 value=m[f['name']];t=f['type']
 if t=='string': words.append(keccak(text=value))
 elif t=='bytes32':words.append(bytes.fromhex(value.removeprefix('0x')))
 else:words.append(int(value).to_bytes(32,'big'))
assert len(words)==14
assert keccak(encode(['bytes32[14]'],[words]))==v.body
print('PASS typed-data digest:',digest)
print('PASS independent standard 14-word ABI encoding == typed-data struct hash')
abi=json.loads(subprocess.check_output(['../.checks/af-chain01/toolchain/bin/forge','inspect','VaultIntentPreview','abi','--json','--offline'],text=True))
functions=[a for a in abi if a['type']=='function']
assert sorted(a['name'] for a in functions)==['eip712Domain','preview']
assert all(a['stateMutability']=='view' for a in functions)
p=next(a for a in functions if a['name']=='preview');assert len(p['inputs'])==1
assert [(a['name'],a['type']) for a in p['inputs'][0]['components']]==[(a['name'],a['type']) for a in fields]
assert [a['type'] for a in p['outputs']]==['bytes32']
assert not [a for a in abi if a['type'] in ('fallback','receive')]
print('PASS compiled ABI: exact 13-field tuple; only preview/eip712Domain view functions; no receive/fallback')
(root/'../.checks/af-chain01/evidence/qa-abi.json').write_text(json.dumps(abi,indent=2))
```

## 证据摘要

日志在 Macbeth05 自有忽略目录，路径相对其工作树。以下哈希固定本次实际结果；大体积原始 Slither JSON 未放入产品目录。

| 文件 | SHA-256 |
| --- | --- |
| `.checks/af-qa01/chain-check-local.log` | `1d10b6a563b259c7ccf22a4a02a34da383891e2e94346d59b9d4f671b9c01b2a` |
| `.checks/af-qa01/chain-bootstrap.log` | `d30a05273a102ef63ecc979f0cad291f56e71c7143e297a383a4f2ffb87ef190` |
| `.checks/af-qa01/chain-bootstrap-resumed.log` | `f1dbab13da5e55bbf2cfc66a63154c8834fe941400877df629bbf0f4011b9d1a` |
| `.checks/af-qa01/chain-bootstrap-retry.log` | `9dbebd68c2e860cb7cf65b033e83227ef5b06fafe39098d589c8ad59b175ba6a` |
| `.checks/af-qa01/chain-publisher-metadata.json` | `8cdf26477f196f2aed6aab6b43df26781c552ea01da9396904193c724e0dde83` |
| `.checks/af-qa01/chain-wheel-publisher-metadata.json` | `bb30a437467035ab86be90c48f76fe331ec149707c208b3fcb24ceefcb54dc1e` |
| `.checks/af-qa01/candidates/673a33bbb53c0894db622ee0a626b09c27e51fbe/.checks/af-chain01/evidence/slither.json` | `0312f3c75945e1555ccc02208c345bf5f9da2e83552a68a81d6a31fd0d26d9fc` |
| `.checks/af-qa01/candidates/673a33bbb53c0894db622ee0a626b09c27e51fbe/.checks/af-chain01/evidence/slither-including-dependencies.log` | `b19aa6a00635e15578e75542129c69dc0efab4742590359f9a415771c5c8df9c` |
| `.checks/af-qa01/candidates/673a33bbb53c0894db622ee0a626b09c27e51fbe/.checks/af-chain01/evidence/qa-abi.json` | `79c431e7e121529ee0e8183dd293bfd6189106d6dc54e48a783e033c30411fa8` |
| `.checks/af-qa01/candidates/673a33bbb53c0894db622ee0a626b09c27e51fbe/.checks/af-chain01/evidence/independent-qa.log` | `839c7cb1b5242333aff36211f46372a00db0bf036a7c2f00e7855b4183f75e46` |
| `.checks/af-qa01/candidates/673a33bbb53c0894db622ee0a626b09c27e51fbe/.checks/af-chain01/evidence/qa-exit-codes.json` | `a36ae3c9b41a62d048bd1b8a4643a0f0e937b1e8f7d4ef76b0a960b4a6a2d045` |
| `.checks/af-qa01/chain-triage.json` | `dff57e0a86f2345777933294350b7068930637f3a2afe239f7c560e752f91c48` |

## AF-M01 集成接受决定

[AF-M01 公开接受决定](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646714929)：Chain `673a33bbb53c0894db622ee0a626b09c27e51fbe` 的项目 Informational pragma 在该 TEST_ONLY 摘要预览范围内为 **ACCEPTED AS NON-BLOCKING**。CHAIN-04 保持 FAILED / exit 255，扫描提示、46 项分诊和限制保留；它不再是集成阻塞项。该决定不延伸到未来托管、验签、nonce、授权、退出、部署或其他链实现。

## 未执行与交接

Browser verification: **NOT RUN**。UI 验收、完整跨层安全范围、根工程完整 check/gates、最终组合 SHA 套件尚未由本轮完成；作者报告的根 57 tests 不计为本次 QA PASS。其他平台、provenance/reproducible build、完整传递依赖漏洞/license 审核和真实链兼容性 NOT RUN。

本轮没有新增已确认安全 Finding，也没有修业务实现。F01–F03 的 Backend 修复结论仍只绑定 f66faa10，详见 REVALIDATION.md。当前预览器范围已完成独立复核；严格门禁的信息提示失败已由 AF-M01 接受为非阻塞。Wave 1 仍因 UI/Browser/完整安全/最终组合证据未完成而 **BLOCKED**，不能从不同候选的专项 PASS 拼出集成批准。Draft 保留，不 self-merge。

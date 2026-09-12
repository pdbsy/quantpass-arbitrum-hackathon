# AF-QA01 exact combined-candidate verification

Agent: Macbeth05 · Task: AF-QA01 · 2026-09-12 UTC。

**READY FOR INTEGRATION — 仅限当前 TEST_ONLY Wave 1。** 最终应用组合 `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` 已在 QA 自有 detached 工作树重新完成必要回归；不是拼接各 Worker 的 PASS。F01–F05 全部 RESOLVED。严格 Slither FAILED / exit 255 原样保留，依据经理公开决定仅对本预览器接受为非阻塞。

## Exact inputs and binding

| 输入 | Exact SHA | 最终组合核对 |
| --- | --- | --- |
| Base | `0a813de422a02a2b3f0ade7eee693f0d2491ec33` | 原工作基准 |
| Frozen contract | `73230c43e464cd1b579fa16a6425756291ef9e8e` | 最终文件仅前3行行末 Markdown 双空格被格式化，资源/金额/状态/错误/分页内容未变 |
| Backend #7 | `f66faa10c2a22f56048b04416cd83a2e8e9dd481` | apps/server、packages/domain 与组合无差异 |
| Chain #10 | `673a33bbb53c0894db622ee0a626b09c27e51fbe` | contracts 与组合无差异，仍重新构建/测试/扫描 |
| UI original #9 | `3caf8dd4c12a6b5da38ee3664b44683b69affcd2` | 历史 F04/F05 失败；旧结果见 UI-REVIEW |
| UI fix #9 | `039496859dd238f8bc18824d9a39bca9f9031ea3` | apps/web、importer/browser harness 与组合无差异 |
| **Tested application** | **`c22cfdf59ee120d7d8c5a75edc79ce97418435c7`** | 所有最终 Node/API/Browser/Chain 运行绑定它 |
| Manager record | `84b477d45d8133d806d8760bcdac71a72141e6ea` | 比组合只改 AF-M01-INTEGRATION.md；没有把此记录提交冒充实测 SHA |

经理通过本地任务交接准确对象；QA 从自己仓库 Git 对象创建 `.checks/af-qa01/integrated-c22cfdf` detached worktree，没有访问其他 Worker 私有目录。执行后 **158 个 tracked blobs** 与准确应用 SHA 完全一致，`git status --porcelain` 为空。对经理本轮记录仅作只读交接证据。

Environment：macOS 26.6.2 arm64；Node24.21.0 / npm11.19.1；Chrome152.0.7977.83 / QA Playwright-core1.63.0；Forge1.5.1-v1.5.1 / solc0.8.31+fd3a2265 / Slither0.11.3；CPython3.12.9。应用 lock SHA256 `478a21705706a2ba36d1e9d7d78ea0df89b0cfdb57a59bfe2965198e87da8292` 未变。工具包/47 wheels 的原始发布摘要核验见 CHAIN-REVIEW；组合 check-local 又校验了安装版本、Forge/solc/OZ 包与文件。

## Final actual commands

在准确组合 cwd 通过 `fnm exec --using v24.21.0 -- …` 运行；QA 脚本在自己的主工作树中运行，所有目标路径改指组合。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| `npm ci --offline --cache <QA cache>` | exit0；192 packages | [install](integrated-evidence/npm-ci.log)，未改变 lock |
| `npm run check`，最终重跑 | **exit0；109/109**, 0 fail/skip | [完整日志](integrated-evidence/check-final.log)：typecheck、lint、format、test、secret baseline、build |
| `npm run verify:gates` | exit0；既有6类 synthetic gate 拒绝结果 | [日志](integrated-evidence/gates.log) |
| QA F01–F03 + Q01 | exit0；5组 | [日志](integrated-evidence/backend-qa.log) |
| QA 普通 amount/form boundaries | exit0；10拒绝+1 atomic-unit 合法对照 | [日志](integrated-evidence/form-boundaries.log)；失败不改金额/revision/audit |
| QA F04/F05 最小合法响应 + 对照 | **4项均 PASSED**, exit0 | [日志](integrated-evidence/contract-check.log)；同一原 QA 输入只替换目标模块路径 |
| QA 精确 tracked + built 文本补扫 | exit0；158文件/156文本 + 构建4文本 | [日志](integrated-evidence/secret-check.log)，仅既有有限模式 |
| 原 reviewed Chrome harness，对当前组合 | exit0；10组 | [canonical](integrated-evidence/canonical-result.json) |
| 当前组合 UI + 原 base legacy 后端 | exit0；10组 | [legacy](integrated-evidence/legacy-result.json)，单独兼容范围 |
| QA 自编 extra / navigation Chrome | exit0 / exit0；6+3组 | [extra](integrated-evidence/extra-result.json)、[navigation](integrated-evidence/navigation-result.json) |
| `bash contracts/script/check-local.sh`（实际 cwd contracts） | **exit255**，其中版本/fmt/build/17tests PASSED，最后项目 Slither严格门禁FAILED | [原日志](integrated-evidence/chain-check-local.log)、[退出码](integrated-evidence/chain-exits.json) |
| dependency-inclusive Slither，同一配置/源码 | **exit255 / success=true** | [原始结果摘要与46项明细](integrated-evidence/static-summary.json)，未抑制规则 |
| QA compiled ABI / EIP-712 | exit0 | [日志](integrated-evidence/chain-abi.log)，固定摘要和14-word/13-field检查 |

首次 `npm run check`：109tests 已通过，但 secret baseline 遇到 QA 自己的 `node_modules` 符号链接，读取目录导致 **EISDIR / exit1**；[原失败日志](integrated-evidence/check-initial.log)保留。QA 只删除自己建立的链接，按原 lock 离线安装真实目录后完整重跑；没有改产品 gate 或删除测试。最终秘密基线实际覆盖158 tracked/unignored文件。早期原 UI 归档0文件问题见历史报告，未挪作最终 PASS。

最终 [build-manifest](integrated-evidence/build-manifest.json)确实记录 c22cfdf 与 dirty=false；这是 LOCAL_TOOLING_ONLY 记录，仍不是独立生产构建 provenance。

## Fix delta review / revalidation

UI 修复增加 ClientVault 作为控制器实际使用的兼容投影类型，canonical 完整数据仍留唯一 adapter；没有用类型断言补假字段。多 Vault 测试改经 ProductAdapter 与登记 satellite 策略访问 canonical 全集，保留跨 Vault retry 拒绝、原 pending 文本、两个独立余额断言；不是取消失败覆盖。

F04：资产从 `balances.asset` 读取，校验固定 TEST_ONLY_USDT_UNIT / 6。原 QA 最小 Vault（无顶层 asset）现在接受。F05：null relation 被接受并达到 EMPTY；非 null 仍校验 owner/strategy。新增作者两项回归在109套件中实际运行；QA 自己两组合法输入/对照也在组合独立执行。

| Finding | Original SHA | Fix SHA | 实际复验对象 / 结果 |
| --- | --- | --- | --- |
| F01–F03 | `708ab59181fe7b372c89f866125a1ffa26cef5be` | `f66faa10c2a22f56048b04416cd83a2e8e9dd481` | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7`，产品API+5QA组 **PASS** |
| F04–F05 | `3caf8dd4c12a6b5da38ee3664b44683b69affcd2` | `039496859dd238f8bc18824d9a39bca9f9031ea3` | 同一组合，最小契约+新增回归 **PASS** |

Open findings **0** / Resolved **5**。Fix SHA 本身没有被冒称为另一次独立完整组合运行；检查的是包含该 fix 且对应文件相同的精确应用组合。

## Browser / UI / truthfulness

真实浏览器覆盖与历史 reviewed harness 的具体动作相同，但本节结果全部来自最终重跑：五类页面、全部13命令、测试 Pass 1000但资金0、stop等待结算、1600模拟提款精确余额、持久化/reload、Alice/Bob及core/satellite隔离、服务器已提交但响应丢失后的 exact恢复、revision冲突、离线与普通金额错误。canonical与legacy两次 page/CSP errors均0；desktop1440×1000、mobile390×844无水平溢出。

QA 自编脚本再次用不同PID真实重启同SQLite服务，旧session失效时清除私有视图，显式登录恢复同一vault/revision/idle与唯一deposit回执。再次观察LOADING/PENDING、浏览器前进后退、五路由reload、目录筛选空态、处理中切换BUSY及未决请求跨身份隔离、坏/不可读存储恢复后0自动command POST。具体字符串和值在已发布脚本和JSON中；429到期为注入时钟的单元验证，未伪称浏览器等待60秒。

原用户HTML仍285969bytes逐字节一致；CSS与机械JS一致；固定原六fixture/样式/导航受保护。已查看最终 [mobile workspace](integrated-evidence/mobile-workspace.png) 与 [PENDING](integrated-evidence/pending.png) 原始截图；原设计全面比对记录见 UI-REVIEW。实际页面仍标注 TEST_ONLY / LOCAL SIMULATION / MOCK-FIXTURE，API与原浏览器模拟账本分离。没有 live/真实收益/已部署声明。

## Scoped security and Chain result

逐项复核 [UI-SECURITY-REVIEW](UI-SECURITY-REVIEW.md) 的 SEC-01–10 防御路径与组合差异：Backend错误/owner/Origin/CSP代码未变，UI fix只收紧资产元数据并按契约接受null/调整类型；未增加新HTML sink、storage字段、URL凭据、依赖或门禁豁免。最终实际CSP/HttpOnly/no-referrer、普通账号流程与文本基线另行重跑。未做全仓安全扫描或漏洞复现。

Chain 在组合实际重新编译、17/17tests（13fuzz×256），独立摘要 `0x807302018c381c7cadedd9affb05b2e32b74cdd1577037bfa136710ba72d858a` 与ABI通过。项目1 Informational、依赖包含45（1High/9Medium/35Informational），两个 success=true，四字段完整多重集合与作者明细/此前QA相同。源码及锁相同，故46项已完成的静态适用性结论仍成立；没有把扫描严重级别改低或从输出删除。

**严格 FAILED/255 保留**。依据 [AF-M01 公开接受决定](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646714929)，仅本 TEST_ONLY 摘要预览器 **ACCEPTED AS NON-BLOCKING**。未来托管、验签、nonce、授权、退出、部署需新任务与新审查。不是完整依赖/生产资金安全批准。

## Limits

本轮必要矩阵55PASSED/1FAILED（已接受非阻塞）/0NOT RUN；矩阵PASSED只表示各行明确方法/场景通过，不是所有可能状态穷尽证明。范围外仍NOT RUN：全仓/传递依赖漏洞与许可证审计、独立生产provenance、其他OS/浏览器、完整无障碍与性能/硬件测量。真实链部署、真实资金/生产身份、钱包签名/私钥流程均未执行且不在授权范围；既有security-model单元测试只使用内存临时密钥及合成permit，不是生产交易签名。

No blocking dependency remains for this exact TEST_ONLY candidate。后续实现提交需按差异重新验收。QA PR保持Draft；未合并、部署或修改其他作者业务实现。

[最终执行的完整 QA 脚本](INTEGRATED-QA-SCRIPTS.md)。

## Published artifact SHA256

| 文件 | SHA256 |
| --- | --- |
| `integrated-evidence/backend-qa.log` | `6f5b10b828b123362749829cb9640f298709983f1c0717f4f7b58806e6dda6d2` |
| `integrated-evidence/browser-extra-exits.json` | `8abcddb535ba798b34c2e65d82806511559d5f21f519e042dec9f69e42175a88` |
| `integrated-evidence/build-manifest.json` | `f98d788ecb7f656c5a543b5a4a285c054931c7d3ec6f8f69df6bb5c40a406ca3` |
| `integrated-evidence/canonical-result.json` | `c122093e7d1a5a7dd9786142248f63fb510d31e325e8a0ff70b055c89cdb8b2a` |
| `integrated-evidence/chain-abi.log` | `839c7cb1b5242333aff36211f46372a00db0bf036a7c2f00e7855b4183f75e46` |
| `integrated-evidence/chain-check-local.log` | `36cdcd061d991d63eb35f4296cfc597ecdffd0e2a29e718cbdaf2bc922c72b98` |
| `integrated-evidence/chain-exits.json` | `b0ee284d94dea70d5c1d92631adbc4c2e993ea07616a886bb6e0fe5010d7d1e7` |
| `integrated-evidence/check-final.log` | `88cac1a04bb616e360a44f9bf1e6c9a22a5ec15979f3adf623e3d5fb2da506f5` |
| `integrated-evidence/check-initial.log` | `b2c6c843265127fe86e6fcd45f458fd6f444b481c3d54557ff8b239d019e59f6` |
| `integrated-evidence/contract-check.log` | `60959c7a345504be7756055e36a0eb6a522428d99ec519f580c206531ae4c857` |
| `integrated-evidence/extra-result.json` | `d50f02291206f543461cc64b6c4321e85b630f9bfdf7b8932e62f085b4a9a20e` |
| `integrated-evidence/form-boundaries.log` | `f6b15b4c96b34d887fb89cbf39fc22854ccae518ec3d530fef94cf8b2275b7f6` |
| `integrated-evidence/gates.log` | `cda0579b845d3927cb60e59e6a969dd07838360bd48a323337621527dcd667fd` |
| `integrated-evidence/legacy-result.json` | `b328750e0bdcf02de9c4b50a40c4905df79f187b144eff01355d5e863d459bdd` |
| `integrated-evidence/mobile-workspace.png` | `7ca80eb8ce7fb7d10c0466c0998e1849a2a0373459bb80c60bad59157ffbd2eb` |
| `integrated-evidence/navigation-result.json` | `a8ee0367a5fa99e7dfd79135426e542f03ffa8a2e47e9e0b31fd928321cb5bad` |
| `integrated-evidence/npm-ci.log` | `1a5ceb4ff3d5171aa500fd17ebeec26258607236ba5f72c4736cbc98606c4532` |
| `integrated-evidence/pending.png` | `d5508414ff527f9d2ecb53ccc0fbae650983b100ee4822e669226be673d78d1a` |
| `integrated-evidence/secret-check.log` | `bc15578dbade79c163c74213ae7a4867af8fcc826a98beac11004629d194192a` |
| `integrated-evidence/static-summary.json` | `c957b90eced1088ad704f353a29a6d3780a91cdfcb9d5109569126add3e80ff2` |

JSON证据只按仓库格式要求补末尾换行，解析值逐项保持相等；截图与日志原字节不变，以上SHA256记录已发布文件。

# Wave 1 Acceptance Matrix

Agent: Macbeth05 · Task: AF-QA01

本矩阵已在准确最终应用组合 `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` 完成所列方法/场景：**55 PASSED / 1 FAILED / 0 NOT RUN**。CHAIN-04 FAILED保持exit255并已接受为非阻塞。F01–F05全部复验关闭。PASSED不表示全量安全审计或穷尽测试；每行证据与范围见 [INTEGRATED-REVIEW](INTEGRATED-REVIEW.md)。

[AF-M01 公开接受决定](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646714929)：Chain `673a33bbb53c0894db622ee0a626b09c27e51fbe` 的项目 Informational pragma 在该 TEST_ONLY 摘要预览范围内为 **ACCEPTED AS NON-BLOCKING**。CHAIN-04 保持 FAILED / exit 255，扫描提示、46 项分诊和限制保留；它不再是集成阻塞项。该决定不延伸到未来托管、验签、nonce、授权、退出、部署或其他链实现。

UI 行的 loading、empty、error、pending、retry、account switch、refresh 与 responsive 检查适用于五个页面的实际相关流程；如某状态不适用，须在准确契约和场景证据支持下逐项说明，不能静默跳过。

最终组合纳入 Backend f66faa10、Chain673a33bb、UI03949685；冻结契约语义不变。所有本轮运行均绑定完整SHA `c22cfdf59ee120d7d8c5a75edc79ce97418435c7`，经理84b477d4只是后续文档记录。

每次执行必须补充：base/head SHA、环境/工具版本、命令或浏览器动作、虚构测试数据前提、预期/实际、退出码或截图、时间和限制。新提交使受影响结果待复验。

## UI

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| UI-01 | Homepage | 实际浏览器检查用户获准首页、导航和响应式基准；保留页面截图。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-02 | Marketplace | 列表、筛选、空态与详情跳转使用同一策略目录。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-03 | Strategy Detail | 详情与所选 strategyId 一致；返回及直接刷新不丢路由。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-04 | Account | 身份、passes、vaults 与精确余额显示一致，切换账户清理旧视图。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-05 | Strategy Workspace | 所选账户/策略/vault 关系与动作、余额及状态一致。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-06 | Navigation | 五页往返、浏览器前进/后退、直接访问保持正确实体上下文。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-07 | Loading / Empty | 以作者提供的本地场景检查加载与空态；不呈现旧账户数据或伪造余额。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-08 | Error / Retry | 展示稳定错误和可执行的重试；恢复后结果与已确认状态一致。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-09 | Pending | 待处理动作有清晰状态；重复点击不产生重复经济状态。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-10 | Account switch | 在请求未完成时切换测试账户；只渲染当前身份的响应。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-11 | Refresh | 刷新五页保留合法上下文并以服务端状态恢复。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-12 | Responsive basics | 桌面与窄屏检查关键导航、可读性、溢出和操作可达性，记录实际 viewport。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| UI-13 | UI protection | 逐文件比较获准设计基准；未经明确授权的大范围视觉/布局重做阻塞集成。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |

## BE

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| BE-01 | Amount validation | 普通边界测试覆盖零、负值、精度和范围；金额解析失败不改变账本。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-02 | Idempotency / Duplicate request | 在自有虚构数据中重复同一业务请求，检查持久回执和经济状态只发生一次。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-03 | Stale revision | 旧版本业务请求被契约拒绝；重新读取状态后按约定恢复。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-04 | Account isolation | 审核身份绑定并用正常账户流程验证各自视图，Alice 与 Bob 的数据分开。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-05 | Strategy isolation | 两个登记测试策略的 owner → strategyId → vaultId 关联一致；重复 claim 不重置余额。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-06 | Malformed payload | 常规 schema 类型/必填项错误返回约定错误，无状态变化；不制作利用载荷。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-07 | Restart | 关闭自己启动的服务并用相同自有数据重启，读取一致状态和回执。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-08 | Persistence | 写入后关闭/重开 store，核对金额、revision、history 与已确认回执。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-09 | Backup / Restore | 使用自有虚构数据备份并在新的自有目录恢复，旧版本数据语义兼容。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-10 | Corrupted-state behavior | 审阅 fail-closed 路径及作者已有防御测试的覆盖证据；不生成漏洞复现。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-11 | Pagination / Bounded reads | canonical /api/v1 返回 Page<T>，opaque cursor、默认 50、limit 1..100；正常续页无重复/遗漏；legacy /api 单独核对旧兼容语义（Q01 已决策）。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |
| BE-12 | Fixtures / Compatibility | NORMAL、EMPTY、PENDING、ERROR、RUNNING、STOPPED 示例对应契约；旧接口兼容性有明确证据。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：完整109含产品API/HTTP重启、5QA组、10表单边界及浏览器进程重启 |

## SEC

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | Secret exposure | 静态审阅新增源码、配置引用、构建资源与脱敏日志处理；证据只记录位置，不公开秘密值。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-02 | Raw stack leakage | 静态追踪服务端错误序列化，确认对外消息不包含原始 stack。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-03 | SQL / Path leakage | 静态核对错误边界及固定公共消息，内部 SQL、路径、对象不直出。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-04 | Cross-user request | 静态追踪已发布差异中的身份到数据作用域绑定；只记录防御证据与修复建议。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-05 | Cross-origin handling | 静态核对 origin/CORS/凭据策略和写操作边界，不运行跨源攻击复现。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-06 | Unsafe HTML | 静态检查不可信字符串的 HTML/DOM 渲染路径与转义。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-07 | Sensitive localStorage | 静态检查新增本地存储字段、生命周期和账户切换清理。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-08 | CSP | 核对应用实际配置的 CSP 与内联脚本、动态资源需求；无浏览器运行时不宣称执行验证。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-09 | URL credential handling | 静态检查凭据来源、URL 构造、日志及 referrer，避免敏感数据进入 URL。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |
| SEC-10 | Gate integrity | 检查测试/断言/CI/安全 gate 差异，删除覆盖或关闭门禁不能作为通过依据。 | PASSED（限定静态/普通流程） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终增量/实际证据](INTEGRATED-REVIEW.md)；[逐项防御路径](UI-SECURITY-REVIEW.md)，非全仓扫描 |

## CHAIN

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| CHAIN-01 | Tool versions | 记录源码 SHA、锁定 Foundry/编译器/分析器版本及实际本地版本。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合重跑](INTEGRATED-REVIEW.md)：版本/包校验、fmt/build、17tests及ABI摘要 |
| CHAIN-02 | forge build | 仅在作者提供准确可复现环境时独立构建，保存真实退出码和日志。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合重跑](INTEGRATED-REVIEW.md)：版本/包校验、fmt/build、17tests及ABI摘要 |
| CHAIN-03 | forge test | 仅本地运行已审阅的功能与回归测试，记录 case 数与限制，不广播交易。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合重跑](INTEGRATED-REVIEW.md)：版本/包校验、fmt/build、17tests及ABI摘要 |
| CHAIN-04 | Static analysis | 对固定源码使用既有防御性静态分析配置，记录规则、结果和未覆盖范围。 | FAILED（严格门禁，已接受非阻塞） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终原始结果](INTEGRATED-REVIEW.md)：两次255，1项目/45含依赖，46项分诊与非阻塞决定保留 |

## BR

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| BR-01 | Happy Path | 真实浏览器 Homepage → Marketplace → Strategy → Account → Trading Workspace，截图和正常动作证据。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-02 | Error Path | 通过作者提供的本地失败场景确认可理解错误，不以源码审阅替代。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-03 | Pending Path | 通过本地可控延迟场景观察动作待处理及完成状态。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-04 | Retry | 本地失败恢复后真实点击重试，确认无重复操作及正确最终状态。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-05 | Account Switch | 真实切换两名虚构用户，在导航和未完成请求下核对当前身份。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-06 | Refresh | 在五页及待处理状态刷新，记录恢复后的实际表现。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-07 | Server Restart | 只停止/重启自己启动的本地服务，确认浏览器恢复与持久状态一致。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BR-08 | Responsive observation | 真实设置桌面/窄屏 viewport 并检查截图；记录浏览器版本和窗口尺寸。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |

## BOUND

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| BOUND-01 | IDs / Ownership | 冻结契约中的 owner、strategyId、vaultId 与每层消费者字段一致。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [F01–F05已关闭](FINDINGS.md)；最终最小契约与金额/关联断言通过 |
| BOUND-02 | Money | integer base units + decimal metadata + string serialization；大整数读写与显示保持精确。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [F01–F05已关闭](FINDINGS.md)；最终最小契约与金额/关联断言通过 |
| BOUND-03 | Status | UI/Backend/Contract 的状态词汇、转换、unknown fallback 及 pending 语义一致。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BOUND-04 | Retry contract | 冻结 error 闭集、status 恢复、revision 刷新及原样幂等策略对齐；额外 code/message/retryable 非必需。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BOUND-05 | Contract boundary | 明确本地接口与未部署合约的边界，链 ID/地址等未知信息不伪装为已上线。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| BOUND-06 | Integrated candidate | 固定集成 candidate SHA 和纳入的各 PR SHA 后运行整套必要回归；不能拼接不同版本的 PASS。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终组合](INTEGRATED-REVIEW.md)：109tests/check/gates、真实浏览器、Chain重跑；无未决阻塞 |

## TRUTH

| ID | 验收项 | 方法与预期 | 执行结果 | 目标 SHA | 依赖/证据 |
| --- | --- | --- | --- | --- | --- |
| TRUTH-01 | Simulation / Fixture disclosure | local simulation、fixture、mock strategy 在实际 UI 与契约中清晰标识为测试。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| TRUTH-02 | Manual price / Yield | 手工价格和模拟收益不被描述为真实价格、真实交易或真实收益。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |
| TRUTH-03 | Live execution claims | 测试通过、构建成功、未部署合约均不被描述为 live on-chain execution。 | PASSED（已列场景） | `c22cfdf59ee120d7d8c5a75edc79ce97418435c7` | [最终真实浏览器/边界证据](INTEGRATED-REVIEW.md)；状态/筛选/导航/重启/存储，TEST_ONLY限定 |

总计：56个验收项；**PASSED55 / FAILED1 / NOT RUN0**。FAILED为CHAIN-04严格门禁（已接受非阻塞），不是归零或被改写的失败。矩阵外未运行范围另见最终报告。

Browser verification: **PASSED（准确组合及所列场景）**

Integration recommendation: **READY FOR INTEGRATION — TEST_ONLY**

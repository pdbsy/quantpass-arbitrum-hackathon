# AF-QA01 scoped defensive security review

> 历史专项记录：以下“开放/未交付/BLOCKED/NOT RUN”均描述本报告所列旧阶段。最终组合已经重新验证，当前结论与F01–F05关闭见 [INTEGRATED-REVIEW](INTEGRATED-REVIEW.md)。原始SHA/失败/限制保留。

Agent: Macbeth05 · Task: AF-QA01。UI `3caf8dd4c12a6b5da38ee3664b44683b69affcd2` + Backend `f66faa10c2a22f56048b04416cd83a2e8e9dd481`；限定已发布差异与相关防御路径。此为矩阵指定的静态审阅和普通本地行为核对，**不是全量 Codex Security 扫描、漏洞复现或生产安全批准**。

| ID | 证据与结论 | 方法 / 限制 |
| --- | --- | --- |
| SEC-01 | 新源码/配置引用未发现真实凭据；UI 123/121 文本、Backend 117/117、构建 4 文本经显式准确清单补扫，无既有基线匹配。 | PASSED（限定基线/静态）。原 git 归档扫描 0 files 不算扫描成功；未覆盖二进制、忽略本地环境、完整凭据发现。 |
| SEC-02 | backend app.ts L98–109 的异常边界对外只发固定代码；未知异常转 LOCAL_OPERATION_FAILED。api-errors.ts 不序列化原 Error。 | PASSED（静态）；普通 schema 错误也实际得到闭合 `{error}`。 |
| SEC-03 | 同一边界不直接拼接 SQL、堆栈、路径或内部对象；logger:false。 | PASSED（静态）；不是穷尽错误路径运行验证。 |
| SEC-04 | session owner 注入 routes/store；owned/forStrategy 及 get/execute 使用 owner 约束和参数化查询，audit 先校验同 owner vault。UI owner/vault/revision 校验及 generation 阻止旧身份更新；Alice/Bob 普通浏览器隔离通过。 | PASSED（静态/正常流程）。没有第三方目标或跨用户攻击复现。 |
| SEC-05 | app.ts L80–95 检查 configured Host、存在时的 Origin、Sec-Fetch-Site 和写操作 demo header；客户端 fetch 同源 credentials。 | PASSED（静态）；未运行跨源攻击场景，无生产认证声称。 |
| SEC-06 | product-ui.ts esc 覆盖 &<>双/单引号，API 名称/描述/ID/回执/错误先转义再拼 HTML；路由 ID encodeURIComponent。原型 note/post/comment/profile/form 字段沿 AF.ui.esc，正文仅在转义后插固定 br。hydrate 仅白名单 CSS 属性/值，拒绝 url/expression/var。 | PASSED（相关 sink 静态）；未做注入载荷或整个原型穷尽安全审计。 |
| SEC-07 | 新本地存储为必要 pending-command 和 retry-after；保留 owner/vault/原命令以防不确定重复；不含 session token/密码/私钥。切换清理可见私有数据，其他 owner pending 留存但不可见/自动重放。原 fixture 保存笔记/档案/模拟交易。 | PASSED（静态及正常浏览器键/切换/故障恢复）；浏览器本地 demo 数据并非生产秘密存储方案。 |
| SEC-08 | 实际 document CSP 为 default/script/style/connect self，img self/data，object none、base-uri none、frame-ancestors none；原 inline style/script 被外置或受限 hydration，无 unsafe-inline/unsafe-eval。 | PASSED（源码及真实 canonical/legacy Chrome），两套 page/CSP errors 0。 |
| SEC-09 | API 相对 `/api` URL，session 用 HttpOnly/SameSite strict cookie；业务 owner/vault/strategy 是测试标识而非认证秘密；URL 无 token 参数，新 transport 没有敏感日志。实际 no-referrer。 | PASSED（静态/普通配置读取）；未读取用户真实 cookies 或私密存储。 |
| SEC-10 | UI diff 只增加三个测试入口、import/build 命令和前端实现；依赖/lock/CI/已有 tests/lint/format exclusions 未改。独立重跑35测试与 synthetic gates，无删除断言/下调门禁。 | PASSED（差异审阅/限定执行）；Chain fail-pedantic 仍 FAILED，不掩盖。 |

[实际运行证据及范围](UI-REVIEW.md)。F04/F05 为两个功能契约发现，仍 OPEN；没有把 scoped review 中未发现额外可行动问题解释为“没有任何漏洞”。完整安全扫描、依赖/许可证/构建 provenance 审计与最终集成安全回归 NOT RUN。

# ADR-0002 — 本地模拟的持久存储与应用边界

日期：2026-09-06。状态：采纳用于 M03 TEST_ONLY，不是生产数据库或链上托管选型。

延续 ADR-0001：一个 React + Vite Web、一个 Fastify 应用和可独立测试的领域核心。不是按 M00–M16 建 17 个服务。Indexer、执行、统计提供应用内端口，M03 实现仅投影本地事件、手动模拟执行和账本余额，不伪造行情、净值曲线或链上最终性。

本地使用 Node 24 内置 SQLite：无另开数据库服务器、无数据库网络口，方便个人开发者逐步验收。SQLite API 当前运行时仍有 ExperimentalWarning；因此该适配器不进入生产。未来数据库实现可替换，但精确金额、唯一请求、事务和所有权约束必须保留。

资金用规范十进制整数字符串，领域运算用 BigInt。vault snapshot、请求回执与审计事件在同一 BEGIN IMMEDIATE 事务内提交，使用 revision 条件更新防丢更新。WAL + synchronous FULL 用于已确认写入的本地进程故障恢复；不等于多机容灾、硬件故障保障或独立不可篡改审计。

策略列表只有自有固定样例，领取固定 1,000 测试 Pass 为幂等初始化，不是真实发行、购买或选择正式 token standard。市场价格标记待定。全量结算使用 M02 明示的零费用测试夹具，不确认 D2/D5。

身份为自由切换 Alice/Bob。随机 HttpOnly/SameSite=Strict 会话、对象权限检查和 Origin/Host/header 校验用于避免本地跨站误操作及验证对象边界，**不证明用户真实身份**。同一电脑上的其他进程、知道演示接口的人可选择任意测试身份。HTTP Cookie 不设 Secure 仅因 loopback HTTP；不可公网托管、代理转发、放入真实数据。

SQLite 及备份位于 .data/，忽略 Git。SHA-256 用于发现意外快照损坏，不抵抗拥有文件写权限的攻击者。在线 backup API 创建排他的新文件，副本须重开并验证；不能只复制活跃 .sqlite 文件而漏掉 WAL。当前工作区在 OneDrive 下，.gitignore 不阻止 OneDrive 同步；因此只准存虚构数据，未来真实部署必须迁出个人同步目录并设计加密与备份策略。

浏览器 localStorage 只存当前设备待重试请求，不存账本权威余额；超时保留原 id/payload，刷新后可原样重放。清除浏览器数据会丢该请求信封；服务端回执和审计仍在，正式客户端需账户级未决请求恢复和跨设备协调。

参考：[Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[Node SQLite](https://nodejs.org/api/sqlite.html)、[SQLite atomic commit](https://sqlite.org/atomiccommit.html)。M03 的证据以项目实际测试为准。

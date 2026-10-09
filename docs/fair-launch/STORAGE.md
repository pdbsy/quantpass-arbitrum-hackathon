# Fair Launch 私有存储的离线备份与恢复

工具 `tools/launch-market/storage-snapshot.ts` 只复制本轮资金服务的存储；不迁移旧 mock / access / wallet-auth DB，不写入旧链资产或领取数据。真实服务器操作尚未执行，以下是审核后由运维执行的步骤。

## 一致性与资格保留

`market.sqlite` 保存 Google subject / verified email 的私有账户映射、opaque accountKey、钱包关联、所有 claim voucher / nonce / 状态和交易；`market-events.sqlite` 保存 canonical 日志、cursor 和 watch 地址。链公开账户 key 不能反推私有身份，重建 indexer 无法替代账户备份。

目录为同一批准服务用户拥有的 0700，文件为 0600 普通单链接文件，路径不含 symlink。`.server.lock` 为互斥租约；服务运行或留下未核验的旧 lock 时工具会拒绝，工具不自动破锁。先正常停止新资金服务，确认进程退出 / SSE 关闭、lock 正常释放，再复制；不要停止不相关服务。

读取并审核现有 `network-identity.json` 的 `digest`，与原 origin / manifest / chain46630 配置一致后，作为显式 CLI 参数传入。工具锁住 source，source DB 以只读事务打开，通过 SQLite backup 包含已提交 WAL；同时验证应用 ID、schema、已知表 / 字段 / 索引、完整数据内容摘要、表数量和 integrity。目标必须是不存在的新路径，保持原 namespace bytes，复制后逐表摘要相等才输出 verified report。

```bash
node tools/launch-market/storage-snapshot.ts backup /absolute/private/market-data /absolute/private/new-backup-directory 0xVERIFIED_64_HEX_DIGEST
node tools/launch-market/storage-snapshot.ts restore /absolute/private/verified-backup-directory /absolute/private/new-restored-directory 0xVERIFIED_64_HEX_DIGEST
```

`0xVERIFIED_64_HEX_DIGEST` 为说明占位，必须替换为审核的真实摘要。工具拒绝覆盖、重叠目录、未知文件、错误 network 身份、错误 application ID / schema、损坏或被修改的快照。restore 额外要求已有 `storage-snapshot.json` 的完整摘要匹配，不能从任意数据目录假称恢复。失败时新复制目录保留供检查，source 数据保留，不删除历史或领取记录。

快照 report 只输出 table count / 内容摘要和 namespace，不打印邮箱、cookie、voucher 签名或密钥。快照目录本身含账户个人数据，必须以同等私有权限保存，不提交 Git、不放 public static、不上传 PR。Quote / claim 私钥及外部数据凭证存于目录外，工具不会备份、输出或重设它们。

## 恢复后启用

1. 保留原目录、原 release 和原配置，审核快照时间、完整表摘要、network digest、原 schema 及 pending voucher / 操作，确认没有丢失已签未确认记录。
2. 将新 service 配置的数据目录指向核验过的恢复目录，origin / manifest 必须保持既有身份；不能复制别的发行 namespace 或随意重写 sidecar。
3. 启动会核验 schema、namespace 和原锁，indexer 按真实 canonical 链同步并处理重组。确认账户 UUID / accountKey、领取 nonce、原交易与资格一致；账户映射无法恢复时保持 claim 停用。
4. 单独检查原 quote / claim signer 与链上 epoch，检查原用户 pending 交易 / receipt。只观察和恢复，不自动 rebroadcast 钱包交易，不把数据库状态设为成功替代链确认。
5. 只有核验通过后批准入口切换。服务器回切不撤销链上交易，仍保留最新账户库；不得使用空库或旧的遗漏凭证备份继续签 claim。

公链出现已领取记录但本地 count 或私有映射不完整时，claim quote 分别报告 `CLAIM_RECONCILIATION_REQUIRED` / `CLAIM_IDENTITY_RECOVERY_REQUIRED`，其他交易继续按实际流动性判断。guard 不能证明丢失的未上链凭证不存在，因此完整私有 registry 与 pending voucher 备份是恢复前提。

## 已执行的隔离验证

五个必要测试覆盖：账户 / accountKey / 原 claim nonce / 完成状态 / canonical 事件经 backup 和 restore 保留；已提交 WAL 原始 bytes 保留；活跃锁、已有目标、foreign DB、namespace 偏差、symlink 和被修改的领取快照拒绝；完整 canonical sqlite_schema 摘要拒绝同字段但不同 CHECK / UNIQUE 谓词的数据库；新目标使用 write-capable / query_only handle 检出真实违反 CHECK 的数据，source只读且bytes不变。它们不操作线上数据。

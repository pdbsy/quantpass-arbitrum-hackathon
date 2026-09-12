# 开发工具链实施状态

更新：2026-09-12。执行者：Macbeth（单人实施及技术自审）。

用户本次明确要求“把这个规范同步到 github 以及本项目，然后按照规范对齐项目”，据此分配 ENV-01 至 ENV-05。原始 [规范](DEVELOPMENT-TOOLCHAIN.md) 保留编制时的 PROPOSED、UNASSIGNED 和历史基线；这些不是本轮任务分工，也不是已经运行的结果。原件 SHA-256 为 `fcb90e69b558dc40a788e251052dbae870c4e80f158e6ba90124a4fdeb65457e`。

实施基线：master `5f223039b84f941d8f5c34d245f87c85c676b02a`；实际源分支 `macbeth/env-01-toolchain`。共享文件串行维护，Darwin 的历史成果、作者和记录不变。本项目指该远程仓库的独立 clone；其他 QuantPass 仓库不在本次修改范围。

## 当前验收边界

| 事项 | 状态 |
| --- | --- |
| ENV-01 至 ENV-05 | IN_PROGRESS；源码、测试和真实 CI 证据仍须完成 |
| Node 24.21.0 / npm 11.19.1 | 候选资格审查；未获得跨平台验收前不是批准基线 |
| 正式 macOS fnm 环境 | BLOCKED：尚未安装 fnm；机器安装及 shell 配置须用户明确授权 |
| 永久 checkout 位置 | 待用户决定；临时资格审查 clone 不冒充正式工作环境 |
| verify-macos required status | 待实现及真实运行，再提交精确保护规则变更供用户批准 |
| 新工具链 PR merge | 待实际 CI、用户审阅和本次合并授权；不继承上一轮已结束的合并授权 |
| ENV-06 / 合约及容器 | NOT_RUN；未来独立任务 |
| SUPPLY-001 / GOV-001 外部独立治理 | 维持原有阻塞，不因环境自检而关闭 |

环境报告采用独立 schema，默认仅输出脱敏诊断；显式报告保存到忽略路径 `.checks/environment/report.json`。不作为管理看板的新 PASS 来源。管理证据仍遵守 source C → manifest-only R → snapshot-only S。

## 候选安全资格依据

Node 24.12.0 仅保留为历史复现版本，不恢复发布资格。Node 官方 2026-01-13、2026-03-24、2026-06-18 的安全公告涉及 Node 24 运行时；项目 npm audit 无法覆盖这些运行时组件。24.21.0 为同一 LTS 线后续累积版本，发布记录含 OpenSSL 3.5.8 和 Undici 7.29.1。项目使用 HTTP 服务、URL/网络相关标准库和开发工具，运行时安全补丁具有实际维护意义；没有把公告里的每个问题断言为本应用可利用漏洞，也没有执行漏洞复现或外部探测。

npm 11.19.1 独立评估，其发布记录包含安装工具内部的 Undici、ip-address、brace-expansion 和 tar 更新。这些是包管理器本身的依赖，不等同于项目 217 个锁定包的升级。项目直接依赖保持不变；lock 根 engines 和生成式 SPDX 需随新构建输入同步。

下载只从 Node 官方发行地址及现有供应链策略指定的 npm registry 获取精确资产；校验 SHA-256 / SHA-512 后才执行。首次 Node 下载截断且摘要不符，被拒绝，未执行。随后有界分段下载的完整 52,909,993 字节归档通过官方 SHA-256：`bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`。npm 包通过 registry SHA-512 校验；实际执行版本为 Node 24.21.0 / npm 11.19.1。`npm ci --ignore-scripts` 成功，安装 193 个本平台包，217 个锁定包的图保持不变。冻结源 978d8e1 的管理采集为 11 PASS、0 FAIL、4 NOT_RUN，其固定 unit 子集为 224/224；新增环境回归随后接入同一 unit 注册表，需重新采集准确源证据；环境准入的正式 fnm 条件仍为 BLOCKED，不能把临时工具链工程测试等同机器准入。

官方来源（核验日期 2026-09-12）：

- [Node 24.21.0 发布](https://nodejs.org/en/blog/release/v24.21.0)
- [2026-01-13 安全发布](https://nodejs.org/en/blog/vulnerability/december-2025-security-releases)
- [2026-03 安全发布](https://nodejs.org/en/blog/vulnerability/march-2026-security-releases)
- [2026-06 安全发布](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases)
- [npm 11.19.1 发布](https://github.com/npm/cli/releases/tag/v11.19.1)
- [GitHub 原生 runner 标签与架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

版本化 runner 标签仍对应可变托管镜像；记录实际 ImageVersion，不承诺跨 OS 安装目录或构建字节相同。Apple Silicon 与 Intel 是两个真实 CI job。

自审还核对了 npm 实际 PATH、安装后的原生包平台声明、Git include/filter 和替换历史。检查命令只运行固定参数；报告不携带原始 Git/npm 输出。默认诊断不写文件；显式报告使用固定目录、独占临时文件、原子替换及父目录身份复核。此控制假设独立 checkout，不宣称能隔离同一操作系统账号下的恶意并发写入者。


首次 GitHub 验收：PR #9 / head ea3fbfb 的 Engineering run 34683842948 失败，Linux/macOS 在 Git 配置准入停止，Windows 在精确 npm 引导停止；dependency review 成功。没有修改失败状态或执行 merge。修复将只读 Git 探针隔离于宿主 global/system 配置，并在探针前拒绝仓库本地 include/filter；这不修改机器 Git 设置，也不放行仓库可执行 filter。Windows npm 引导明确安装到 setup-node 提供的当前临时 Node 前缀，并继续核对实际执行路径和版本。新增数据目录回归拒绝 SQLite 硬链接和嵌套符号链接。更新后必须重采集 C/R/S 并重新运行真实 CI。

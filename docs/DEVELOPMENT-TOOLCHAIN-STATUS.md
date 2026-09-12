# 开发工具链实施状态

更新：2026-09-12。执行者：Macbeth（单人实施及技术自审）。

用户本次明确要求“把这个规范同步到 github 以及本项目，然后按照规范对齐项目”，据此分配 ENV-01 至 ENV-05。原始 [规范](DEVELOPMENT-TOOLCHAIN.md) 保留编制时的 PROPOSED、UNASSIGNED 和历史基线；这些不是本轮任务分工，也不是已经运行的结果。原件 SHA-256 为 `fcb90e69b558dc40a788e251052dbae870c4e80f158e6ba90124a4fdeb65457e`。

实施基线：master `5f223039b84f941d8f5c34d245f87c85c676b02a`；实际源分支 `macbeth/env-01-toolchain`。共享文件串行维护，Darwin 的历史成果、作者和记录不变。本项目指该远程仓库的独立 clone；其他 QuantPass 仓库不在本次修改范围。

## 当前验收边界

| 事项 | 状态 |
| --- | --- |
| ENV-01 至 ENV-05 | IN_PROGRESS；正式环境与源码验证通过，当前新头 CI 和合并后验收待完成 |
| Node 24.21.0 / npm 11.19.1 | 5c624516 三平台资格审查通过；用户已批准实施；名称更新后的准确头须重新验证 |
| 正式 macOS fnm 环境 | PASS：用户批准后通过 Homebrew 安装 fnm 1.39.0；精确 Node/npm 原生 arm64 准入退出 0；未修改 shell 启动文件 |
| 永久 checkout 位置 | 已按授权创建独立 AlphaForge checkout；依赖与运行数据不共享 |
| verify-macos required status | 已按授权加入 ruleset 22507334，integration 15368；完整回读确认其他条件不变 |
| 新工具链 PR merge | 用户已明确批准；等待最新准确头的门禁，通过后正常合并并验证实际 master |
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

版本化 runner 标签仍对应可变托管镜像；记录实际 ImageVersion，不承诺跨 OS 安装目录或构建字节相同。当前平台范围以本页最新用户决定为准。

自审还核对了 npm 实际 PATH、安装后的原生包平台声明、Git include/filter 和替换历史。检查命令只运行固定参数；报告不携带原始 Git/npm 输出。默认诊断不写文件；显式报告使用固定目录、独占临时文件、原子替换及父目录身份复核。此控制假设独立 checkout，不宣称能隔离同一操作系统账号下的恶意并发写入者。


首次 GitHub 验收：PR #9 / head ea3fbfb 的 Engineering run 34683842948 失败，Linux/macOS 在 Git 配置准入停止，Windows 在精确 npm 引导停止；dependency review 成功。没有修改失败状态或执行 merge。修复将只读 Git 探针隔离于宿主 global/system 配置，并在探针前拒绝仓库本地 include/filter；这不修改机器 Git 设置，也不放行仓库可执行 filter。Windows npm 引导明确安装到 setup-node 提供的当前临时 Node 前缀，并继续核对实际执行路径和版本。新增数据目录回归拒绝 SQLite 硬链接和嵌套符号链接。更新后必须重采集 C/R/S 并重新运行真实 CI。


第二轮 PR 验收：head 03ea6aa / Engineering run 34684270426 的 Linux 与 arm64 macOS 完整通过；Windows 的 npm 引导通过，随后 Git 返回 128。Windows 针对性修复改用 Git 自身支持的 `/dev/null` 语义，保留空全局配置和禁用 hooks；依据：[Git Windows 空设备实现](https://github.com/git/git/blob/master/compat/mingw.c)。

## 用户更新的平台范围

用户随后明确：“不会有 intel mac，只会 arm mac 和 windows”。本次实现据此只支持 Apple Silicon macOS 和 Windows 开发；Linux 保留既有 CI 与独立依赖审计职责。移除 verify-macos-intel job 及供应链 profile，macOS x64 不再属于准入支持范围。原始规范的 Intel 目标表保留为历史提案，由本段当前用户决定覆盖；不再等待或要求 Intel 验收。

当前目标 CI：verify / ubuntu-24.04 / x64；verify-windows / windows-2025 / x64；verify-macos / macos-15 / arm64。三个 job 都必须实际验证当前准确头。原来的 Intel 失败如实保留为历史运行，不改为 PASS，也不作为新范围的阻塞。

## 当前用户批准与名称

用户已批准 fnm 安装、正式独立 checkout、添加 verify-macos 必需门禁及按门禁合并后验证，并明确正式产品名为 AlphaForge，本仓库为 Hackathon 版本。此前“等待授权”记录保留为历史；这些操作现已授权，实施结果仍以实际回读为准。当前显示名、包名、工作目录使用 AlphaForge；原始规范与历史证据、现有 GitHub 地址及兼容性协议/存储标识保留原值。源 5c624516 的本地 245/245、Linux/Windows/ARM Mac CI、CodeQL 和依赖审查均通过；本次名称更新后的准确头必须重新验证。

正式环境验收源 a7180aec：fnm 1.39.0；Node 二进制逐字匹配已核验官方归档；npm 11.19.1 安装到 fnm 用户目录；干净 npm ci 与环境准入成功。管理全量采集 11 PASS / 0 FAIL / 4 NOT_RUN。首次 npm 引导未结束时的 engine 拒绝与新 clone 缺少本地作者配置的 BLOCKED 均保留为失败历史，完成初始化后重新验证通过。新命名源的完整 CI 和实际合并结果在 PR #9 更新，未用旧基线绿灯签收新头。

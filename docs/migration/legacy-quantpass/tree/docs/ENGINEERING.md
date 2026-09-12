# 本地工程与验收

技术总基调见 [ADR-0001](adr/0001-project-foundation.md)。当前有参考核心、规格、领域账本、HTML 进度工具，以及 React/Fastify/SQLite 本地模拟应用。没有真实交易 API、生产认证、Solidity 合约或保密运行环境。

## 安装与统一检查

使用 Node 24.12.0 与 npm 11.6.2（兼容范围见 package.json），在仓库根目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm run verify:gates
npm run audit:dependencies
```

`check` 串行执行类型、lint、格式、全部单测、secret 基线、HTML 生成及制品记录，任何一步失败即停止。修改代码后可先运行 `npm run format`；Markdown/模板不参与机械格式化。依赖检查需连接 npm，失败时不得标为通过。

锁文件不可手改；依赖变更通过 npm install 更新并审核 diff。默认忽略安装脚本；需要执行某个依赖的脚本时单独审核，不用取消全部保护解决安装错误。

## 配置验证（不是服务器）

```sh
node --env-file=.env.example tools/check-config.ts
```

只有显式 local/mock 会成功。缺少模式、真实 Adapter、testnet、production，以及 NODE_ENV=production 配合 mock 都拒绝。没有“已批准=true”就放开生产的开关。M03 API 构建和备份入口均接入该检查；这不构成未来真实服务的上线审批。

`.env.example` 不含真实密钥。复制到本机 `.env` 后自行配置，不提交或上传。secret 基线扫描不覆盖被忽略文件、二进制秘密和完整 Git 历史，也不保证检测任意密钥或助记词。

## 故障注入与干净复现

`npm run verify:gates` 从已登记 fixture 创建 `.checks/gates-*`，实际启动编译器、测试器和配置命令，要求看到预期拒绝原因；注入内容不会改坏正常源码。合成 token 只用于扫描器检测，不含真实凭据。

`npm run verify:clean` 把 Git 跟踪和未忽略的普通文件复制到全新 `.checks/clean-*`，不复制 node_modules、私有 .env 或原仓库 Git 元数据；建立仅用于验证的 Git 快照，再运行 npm ci、check 和 verify:gates。它不提交到原仓库、不推送、不部署。临时目录保留用于检查，可能占用磁盘，不会自动删除用户目录。

## CI 与产物

本地应用：`npm run demo` 构建 Web 并绑定 127.0.0.1:4180，只服务 Web 的 dist 和 API，不服务仓库。`npm run demo:backup` 创建唯一副本并重新打开核验，不覆盖当前库。详细操作、数据路径、真实 HTTP 故障测试及浏览器待验收见 [M03](../modules/M03/README.md)。

GitHub Actions 对 push/PR 执行相同检查与依赖查询，使用只读仓库权限，不注入生产凭据、不部署、不发市场通知。Actions 按核验的 SHA 锁定。

`.artifacts/build-manifest.json` 记录源提交、工作区是否有改动、Node 版本、锁文件/配置/HTML 的 SHA-256。它是本地工具制品记录，不是可上线业务系统的完整软件物料清单或审计证明。GitHub 实际运行状态须另行核对，不能由本地通过推导远端通过。

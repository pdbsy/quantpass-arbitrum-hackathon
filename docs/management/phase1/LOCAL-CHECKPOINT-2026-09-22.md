# 当前收口 — 2026-09-22 Public 与本地候选复验

06已完成且经理回读核验：远程旧头3a78e34的Engineering run35499025043/attempt3（2026-09-22 09:27:29 UTC）9/9 SUCCESS，包含7/7 required；标准Linux/Windows/macOS。运行链接：https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/35499025043/attempts/3 。该结果仅对应远程旧头；本地修复b9283da及后续候选未发布，不能继承。

用户重新确认仓库 Public；经理实时回读验证 PUBLIC、master 为默认分支、PR22 OPEN/Draft、远程 head `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`。用户明确要求06恢复测试，已向06派发原有CI门禁核验；当前本地新代码尚未发布，旧远程头的检查不能证明新代码通过。

最近完整候选 `979f4aa9f1169eedcf4252d67e952e71ee26c76f`（tree `c6be18cae3091ee42fed9e50ef8d9afea42c6d5d`）通过844/844、完整check、M3/扩展旧界面/管理看板/方法资格五类功能流程、151条LOCAL身份、Semgrep与Gitleaks。C/R/S为ef3480a/bb32896/979f4aa，真实管理采集11 PASS/0 FAIL/4 NOT_RUN。覆盖率行89.64%、语句86.69%、函数90.28%、分支80.96%；完整分母和2个不完整生命周期保留，阈值未达，正式方法准入仍PENDING。

后续AUDIT-001已由经理独立复现并按失败回归修复：未验证的不同身份观察不占用最终交易归属；对账后的交易仍唯一，原operation身份不可改绑。迁移保留所有原始记录，版本6备份继续只读精确验证/恢复；核心124/124和typecheck通过，准确新候选仍需全量重跑。AUDIT-002/003已登记待校准，不能用旧测试通过关闭新发现。详见[AUDIT-CALIBRATION](AUDIT-CALIBRATION-2026-09-22.md)。

NOT_READY_TO_MERGE。01继续集成、覆盖率、C/R/S和交付；06负责实际托管门禁。外部安全/治理/适格review、本轮merge授权和Testnet分别保留原状态；未merge、部署、签名或广播。

## 历史检查点

# Latest measured local checkpoint: c0dfe08

C `e25231910007d75cf4274621dd186ab8926d125a`; R `6c39f69`; S `c0dfe0884894076bc2f5f5bf5077b53ec22aa9cf` / tree `146627240318fb410cdc345f193a6f92497cc725`. Full check 835/835 and all five functional workflows PASS; LOCAL identity 139 (101 imported, 38 manager). Coverage report `report-6c537cff-16d5-4ae4-9dbe-710147e58077.json` SHA-256 `67e80364e1bf7af85120f5718558575df29187c1572047b4281453d8594d3f3b`: lines 87.91%, statements 82.73%, functions 85.87%, branches 76.32%; 134 source entries, two incomplete npm-check lifecycles retained. Chain-store lines 96.39%, functions 100%, statements 94.65%, branches 91.91%.

At this exact S: source-policy, OSV 2.6.0, Gitleaks 8.30.1 and native contract entrypoint PASS. Gitleaks retains its raw FAIL for exactly the existing approved GITLEAKS-FP-001 proof; no additional finding was waived. Contracts: 134 Solidity tests, 25 Python tests, ABI/artifact equality, Slither and 2 offline deployment rehearsal tests passed.

Semgrep 1.177.0 scanned 138 files with 22 rules/44 fixtures and found `af.js-weak-hash` in `tools/local-ci/runner.mjs:71`. Manager remediation reads raw Git blobs and compares bytes, with no rule exception or history change. Exact original failure and regression RED/GREEN logs are preserved. Executor regressions: 21/21 PASS; fresh candidate scan/full verification remains required.

Read-only GitHub observation on 2026-09-22: visibility PRIVATE, PR22 OPEN/Draft at 3a78e34. Prior user authorization to restore normal PR validation remains; private hosted availability/cost is unconfirmed, not inferred. No remote write, merge, rule change or chain transaction occurred. See FINAL-EVIDENCE-INDEX.md for bounded evidence and remaining acceptance.

## Earlier checkpoints

# PR22 current checkpoint — child evidence and recovery

Manager: Macbeth01. Status: NOT_READY_TO_MERGE. Earlier checkpoint details below remain historical.

- Exact source C `77e925c20930fa06d990e4e2c9ec28d27ded7df2`, manifest R `5b45375`, snapshot S `3965df91e53282f0144efe57b2ddadb50b5fce38`.
- S full check: 833 tests passed; all three real local/mock browser workflows passed. Main report `report-abb404e2-7ce4-444f-ac9c-c4d8b28a9575.json`, SHA-256 `bcec2753bf17867a130e1b71718f7aa1e6187e604b8eac2ff98874d3208f7254`.
- Additional assertion-bearing preparation/Node/browser qualification on the same S produced `report-4942e2cd-f11d-4f57-adbc-38e826e459fe.json`: lines 10806/12289 (87.93%), statements 12398/14987 (82.72%), functions 2001/2330 (85.87%), branches 8111/10625 (76.33%). Five workflows PASS; two incomplete npm-check lifecycles remain zero contributors. No denominator was removed. Threshold interpretation remains awaiting user clarification; conservatively all four dimensions are evaluated against 90% meanwhile.
- Macbeth05 independently reviewed C child binding: 6 existing and 13 independent negative tests PASS; actual legacy and management child replay at S PASS. Source equivalence was checked; this is bounded functional review, not whole-candidate security or independent external approval. Review logs SHA-256: `cd7969f3566e57dbc24f58b5ffdd33c6e1c1d63588b2693a267f99a2f13b4140` and `895f6534acdd3c944f487ba62ab4aa437999a1b16f5b38cac1f7b5f6ee79d535`. Exact review and raw scripts are retained in ignored local evidence.
- Manager commit `0ed6bd5` makes qualification collection part of the versioned entrypoint. Subsequent original Macbeth03 commit `379d9cc9a8f10c5b57b5552bbe11313d52fe2c28` adds only two transaction lease-loss rollback tests; normal merge `f67e26e47a9291ba80d686c254f59e7445844c25` preserves authors/history. Manager rerun: chain-store 55/55 PASS. Production/schema/package unchanged by that worker commit.
- Actual local environment at f67e26e: Node 24.21.0, npm 11.19.1, Apple arm64, fnm activation and admission PASS/eligibleForEvidence=true. The first direct-PATH attempt lacked active fnm and returned BLOCKED; its raw result is retained. Neither result claims native Windows/Linux or contract admission.
- Current source/manifest updates still require a fresh C/R/S and full run; these measured S results are not inherited by a later candidate. Public history disposition, final coverage/method/security/governance/review/merge authorization and Testnet acceptance remain open separately.

## Earlier completed checkpoint

# PR22 local checkpoint — 2026-09-22

Manager: Macbeth01. Repository: pdbsy/quantpass-arbitrum-hackathon. Status: NOT_READY_TO_MERGE.

## Exact completed checkpoint

- Source C: `3005b4007509cb5c0f40b42a6a0936c8f13e2320`.
- Manifest-only R: `2dd51c8e4f64aac7e47665936ba9861990151021`.
- Snapshot-only S: `5dc6da79b4a669cc1daa94b371c0482dac46195c`.
- Node 24.21.0 / npm 11.19.1. Current candidate full `npm run check` passed, including 827 tests, privacy, consistency and build. The collector recorded 11 PASS, 0 FAIL and 4 unregistered NOT_RUN; separate contract evidence is not inserted as fabricated collector PASS.
- The bounded M3, legacy and management browser workflows all passed at S. The earlier C workflow's `RECORDED_GIT_GRAPH_MISMATCH` failure is retained; actual C/R/S regeneration resolved it.
- Canonical whole-source lower bound at S: lines 84.13%, statements 79.32%, functions 84.03%, branches 75.51%. None reaches the conservative 90% threshold. Method admission remains PENDING_INDEPENDENT_REVIEW; critical semantic acceptance is not inferred from these percentages.

Report file: `report-c7942f8d-a313-4d63-b44f-090a3777e8ac.json`. SHA-256: `f02b4c710e6acef795a16247624de0fac57fe55916c7f33461bf1a5dae5a15cb`. Raw workflows remain in the ignored local coverage output for this run. This checkpoint is not inherited by subsequent code or evidence changes.

## Browser method repairs and independent review

`28013f86f84325b2bd8ed6799133197fe1568d9b` preserves independent full Git history in runtime copies, rejects dirty or mismatched source and excludes ignored private files. Its six Git isolation regressions passed.

Macbeth05 independently retested that exact commit with qualified tools on 2026-09-22: 11/11 browser qualification tests passed, including location/reload incomplete intervals and hash/history preservation. `M3-05-P1-BROWSER-NAV-01` passed within those four specified scenarios. Its relevant source is unchanged at S. The review's browser log SHA-256 is `c36cfe2727ca6ee16316c325e0d85b038a9f4316e731968b00dbc03f906b9117`; tool verification log SHA-256 is `b1e331187c1b26288625bea92047fdf6247ef58c4651d62343bd7ffc4f8ffc7d`. This is independent functional review, not independent GitHub identity or security approval.

The next manager change binds legacy/management Node child counters, logs, process exit and exact driver identity into report replay. These previously collected child hits were omitted conservatively. Child artifact mutation, missing completion, wrong workflow/candidate/command and killed processes have explicit failure regressions. New code requires fresh C/R/S and whole-workflow verification; the S percentages above remain a historical measured checkpoint.

## Active boundaries and remaining work

- 03 continues only necessary chain/recovery behavioral gaps; 04 expands real product interactions; 06 verifies available native environment evidence. Questions return to 01.
- Public repository status restores normal PR validation; final-head hosted checks are still pending publication. Old remote-head success does not admit this local candidate.
- Unpublished QA history contains operational machine paths and an earlier PNG. Current-tree sanitization preserves that history and does not remove its publication implications. An exact outgoing-history disposition is required before publishing; no rewrite or force push is authorized.
- Final coverage, independent functional/method review, final security disposition, external governance, eligible review and applicable merge authorization remain distinct.
- Local/mock/NOT_DEPLOYED. No new chain writes, deployment, signature, broadcast, service, credential or rule change.

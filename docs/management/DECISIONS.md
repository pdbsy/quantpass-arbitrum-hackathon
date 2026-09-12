# Decision log

## DEC-007 — 本轮 Macbeth 单人全 PR 整改与阶段合并

- Date: 2026-09-12. Authorization: 用户本轮明确覆盖旧分工和逐次 merge 请求要求。
- Decision: Macbeth 亲自实施、技术自审、串行维护共享文件、核实最新 head 后普通 fast-forward 更新同仓库非保护源分支；每次正常 PR merge 后验收准确 master，再处理下一项。
- Scope: 启动时所有状态 PR #1–#7；Darwin 暂不参与，不启动替代 worker，不冒充独立审批。
- Preserve: 历史成果和作者、技术与测试门禁、关闭的放弃升级；真实并发写入暂停冲突部分，不覆盖新提交。
- Boundaries: 无强推、历史重写、分支删除、保护修改、风险豁免、部署、链上或真实资金操作。回滚需用户另批。
- Supersession: 以下旧协作、等待 Darwin、Worker B 不可合并及 force-with-lease 计划仅属历史。本轮正常 FF 及阶段合并以本决策和用户指令为准。独立外部治理/正式发布验收并未获豁免。
- Compatibility: 在真实 Windows CI 上验收文件身份检查；保留 POSIX O_NOFOLLOW，平台无法证实稳定句柄身份时仍失败关闭。

## Historical decisions before this round


## DEC-006 — Rebuild evidence on the existing GitHub Linux runner

- Date: 2026-09-12. Level: 2, AUTO_EXECUTED / REVERSIBLE.
- Context: Windows does not provide the O_NOFOLLOW capability required by the existing public-metadata gate; no running local Linux container is available.
- Decision: use a temporary validation branch with read-only repository permission to run the unchanged full management checks on the exact clean source commit. Upload only a Git bundle containing the report-only and snapshot-only follow-up commits for local review and normal fast-forward publication.
- Alternative: record unsupported-platform failures as failures; changing or skipping the privacy gate is unnecessary and would not establish its result.
- Boundaries: the temporary workflow never pushes, signs, deploys, merges or changes repository settings. Its workflow file is excluded from the final dashboard lineage. Existing checks and evidence provenance rules remain intact.
- Verification: inspect the returned commit range, report and generated source health, then publish to the named dashboard branch and read back its own GitHub checks.

## DEC-005 — Synchronize local records to the latest Macbeth dashboard

- Date: 2026-09-12.
- Authorization: the user requested that all local work be updated into the latest GitHub dashboard and explicitly identified Macbeth's version.
- Destination: pdbsy/quantpass-arbitrum-hackathon, macbeth/dashboard, existing draft PR #7.
- Scope: import Manager/Darwin records, normalize them to the existing Markdown schema, add later PR and presentation delivery evidence, and regenerate the dashboard through its existing pipeline.
- Preserve: Macbeth's implementation and work history; canonical roadmap task acceptance/status, protocol identifiers and runtime behavior.
- Reconciliation: older DEC-003 restricted edits while Worker B was active; this explicit synchronization request authorizes additive management records and generated data on the named branch. It does not authorize merging PRs or rewriting history.
- Historical facts: the Wave 1 assessment remains bound to bbb3e4b7b40cfd3aa23253866876875f8d98a1fc; latest PR #7 readback uses 05c50ee508b0334f4c16c1f178cf2fa87ae201db. Their checks and findings must not be conflated.
- Product name: AlphaForge remains the user's confirmed name under DEC-004; broad display rebranding is still a separate delivery, not falsely marked complete here.
- Result boundary: publishing management records is not accepting a security finding, closing a release gate, or implementing missing on-chain functionality.

## Historical decisions (2026-09-09)

## DEC-004 — Official project name: AlphaForge

- Level: 1 (user-directed naming).
- Context: user explicitly renamed the project to AlphaForge on 2026-09-09.
- Decision: update current product-facing names on a separate darwin/rebrand-alphaforge branch after the audit checkpoint. Preserve historical evidence, repository URL, npm package identity, database/session/local-storage and protocol identifiers for compatibility.
- Alternatives: rename every identifier and the GitHub repository; leave inconsistent current branding.
- Why: fulfill the official-name change without invalidating evidence, links or persisted local state.
- Security impact: no change to chain 46630, local/mock restrictions, signing, custody or permissions.
- Architecture impact: display/content only; no migrations or dependency updates.
- Affected tasks: DARWIN-BRAND-001; current UI, project metadata, public docs and generated board.
- Affected worker: Darwin owns current naming sources. Worker B applies the new display name to its own dashboard only after its active handoff and coordination; no remote-branch edits by Darwin.
- Affected files: README.md, apps/web display content, planning display metadata, generated docs, management records; exact branch scope before edits.
- Reversibility: REVERSIBLE through normal commits.
- Status: USER_DIRECTED / REVERSIBLE; name decided, implementation pending separate branch.

## DEC-001 — Audit the fixed PR #6 candidate

- Level: 2.
- Context: master 202e625 lacks PR #6 fixes; candidate bbb3e4b has successful prior Windows/Linux CI and independent focused review, but PR #6 remains open.
- Decision: use bbb3e4b7b40cfd3aa23253866876875f8d98a1fc as immutable Wave 1 source baseline; create darwin/project-reality-audit. Keep master and candidate explicitly separate.
- Alternatives: audit old master and duplicate known defects; wait for merge and delay read-only work.
- Why: review current fixes while preserving honest integration status and a narrow document-only diff.
- Security impact: no gate change, deployment, transaction or risk acceptance.
- Architecture impact: none; no runtime files changed.
- Affected tasks: DARWIN-A1..A8, SUPPLY-001, GOV-001.
- Affected worker: Darwin; Worker B only needs the eventual reviewed integration base.
- Affected files: docs/management/**.
- Reversibility: REVERSIBLE; ordinary follow-up commits/reviewed integration, no force push.
- Status: AUTO_EXECUTED / REVERSIBLE.
- Integration: draft audit PR initially stacks on PR #6's branch; final target master only after prerequisite review/merge.

## DEC-002 — Keep audited state separate from planned state

- Level: 2.
- Context: roadmap has six done tasks, but global DoD includes coverage and independent verification that a status field cannot establish.
- Decision: retain planning/roadmap.json unchanged; publish all 41 audited verdicts in PROJECT-REALITY-AUDIT.md with evidence and explicit gaps. Pending review is not VERIFIED_DONE.
- Alternatives: silently downgrade roadmap; accept all existing done values; introduce incompatible enum values into canonical planning.
- Why: preserve canonical plan and validator semantics while showing actual assurance.
- Security impact: prevents false release approval; unknown checks remain unknown.
- Architecture impact: dashboard remains a consumer, never a source of authority.
- Affected tasks: DARWIN-A2, A3, A5, A8 and Worker B dashboard.
- Affected worker: Darwin produces records; Worker B displays them.
- Affected files: docs/management/PROJECT-REALITY-AUDIT.md, CURRENT-STATUS.md.
- Reversibility: REVERSIBLE; later documented roadmap changes require regenerated artifacts and passing consistency gates.
- Status: AUTO_EXECUTED / REVERSIBLE.

## DEC-003 — Preserve active Worker B scope and shared-file ownership

- Level: 1.
- Context: observed remote macbeth/dashboard [superseded Worker B checkpoint] has B8 IN_PROGRESS. Its historical log records a user-authorized branch name. It overlaps PR #6 in README.md, package.json and test/governance.test.mjs.
- Decision: do not rename, checkout, edit or merge Worker B's branch. Darwin owns new management records and future canonical planning changes; Worker B retains dashboard and its own append-only history. No new task starts before B8 handoff.
- Alternatives: force a new branch name, edit its active tree, or immediately merge.
- Why: avoid overwriting active work and preserve review boundaries.
- Security impact: independent checks and integration gate remain mandatory.
- Architecture impact: no shared working tree, SSH or SMB collaboration.
- Affected tasks: DARWIN-A6, dashboard B8 and later integration.
- Affected worker: Darwin and Worker B (Macbeth).
- Affected files: docs/management/**; shared files below.
- Reversibility: REVERSIBLE through explicit coordination.
- Status: AUTO_EXECUTED / REVERSIBLE.

## SHARED FILE COORDINATION — Wave 1

Darwin owns README.md, package.json, package-lock.json, planning/roadmap.json, planning/security-boundary.json, CURRENT-STATUS.md and DECISIONS.md for new Wave 1 changes. This audit branch does not change the first five files.

Existing Worker B changes predate this assignment and are not a scope violation merely because they overlap. Preserve them at [superseded Worker B checkpoint]. Review its fixture timestamp fix against bbb3e4b's production path and regression changes. Integration order: PR #6 candidate -> Darwin audit records -> reviewed Worker B result -> integration checks. No ours/theirs resolution. Final immutable integration base is not yet selected.

## Pending Level 3 decisions

No Critical decision is approved by this log. Deployment, chain transactions, custody/authorization changes, private-key handling and acceptance of Critical/High risk require the user's explicit approval. Any cleanup of pre-existing host SSH access is outside this repository audit and must be separately scoped.

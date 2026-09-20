# Task Intake — M3-05-PHASE1-ACCEPTANCE

Recorded: 2026-09-20 (Asia/Shanghai)

## Identity and checkout

| Field                         | Value                                             |
| ----------------------------- | ------------------------------------------------- |
| Agent                         | `Macbeth05`                                       |
| Task                          | `M3-05-PHASE1-ACCEPTANCE`                         |
| Repository                    | `pdbsy/quantpass-arbitrum-hackathon`              |
| Worktree                      | `/private/tmp/AlphaForge-M3-05-PHASE1-ACCEPTANCE` |
| Branch                        | `macbeth05/m3-phase1-acceptance`                  |
| Default branch                | `master`                                          |
| BASE_SHA                      | `18f5352070910a867b9729b031aa2e3951785e01`        |
| Intake checkout               | `18f5352070910a867b9729b031aa2e3951785e01`        |
| Clean before intake           | Yes                                               |
| Registration commit read      | `48cccb8743d2e77ec8001187c00e95044a3d2f40`        |
| Registration commit inherited | No; ancestry check returned false                 |

The previous Macbeth05 task remains preserved in its original clean worktree and branch. No reset, clean, history rewrite, force push, merge, or cherry-pick was used to create this task.

## Environment

| Component        | Observed value                               |
| ---------------- | -------------------------------------------- |
| Host             | Darwin 25.6.0, arm64                         |
| Node.js          | `24.21.0` through `fnm exec --using=24.21.0` |
| npm              | `11.19.1`                                    |
| Git              | `2.50.1 (Apple Git-155)`                     |
| GitHub CLI       | `2.97.0`                                     |
| Runtime boundary | Local / Mock / NOT_DEPLOYED                  |

The versions match `package.json` and the development-toolchain records read before this intake. Dependencies have not yet been installed in this isolated worktree; the initial dependency result is therefore `NOT_RUN`.

## Goal and expected files

Macbeth05 will:

1. maintain a Phase 1 requirement-to-test-to-evidence matrix;
2. independently rerun ordinary functional acceptance across contract, adapter/API, product/browser, and recovery boundaries;
3. measure actual overall coverage and critical authorization/accounting branch coverage without substituting test counts;
4. map historical findings to the exact versions they tested and retest applicable findings on later candidates;
5. record each defect with reproduction, impact, owner, fix SHA, and retest evidence;
6. produce domain-specific `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` conclusions on the exact unified candidate supplied by Macbeth01.

Expected versioned files are limited to `docs/management/agents/qa/M3-05-PHASE1-ACCEPTANCE/**`. Isolated temporary evidence may be generated outside the repository. Any proposed new functional QA test file must be reported to Macbeth01 before creation.

## Protected files and permissions

Business implementation, contracts, adapters, API, product UI, shared package files, workflows, scanner policy, repository rules, generated PASS evidence, and other workers' records are protected from this task. Macbeth05 has no authority here to deploy, sign, broadcast, enable a chain write plane, purchase services, add secrets, expand permissions, merge a PR, or weaken a gate.

Ordinary local/mock functional tests, read-only GitHub inspection, QA documentation, coverage measurement, and isolated evidence collection are authorized. Testnet writes remain unauthorized.

## Frozen scope

Phase 1 includes fixed-supply Pass initial allocation and ordinary 18-decimal Pass transfer, then the supported Vault operation path. Paid initial sales, real Buy/Sell or a secondary market, and strategy execution are outside this phase. Existing exposed surfaces still require risk-aware regression within their actual callable scope.

Binding rules include:

- AF-USDC uses 6 decimals and Pass uses 18 decimals; capacity conversion is exact at `10^12`, while ordinary Pass transfer keeps full 18-decimal precision.
- Vault creation requires an explicit, nonzero, immutable Owner; deployer, factory administrator, and application account state do not gain Owner authority.
- withdrawal is profit-first; profit does not consume or release Pass capacity; principal withdrawal releases matching capacity; loss does not auto-unlock Pass.
- full close releases remaining locked Pass under the frozen accounting rule; recorded positions must settle; unrelated dust must not block close.
- close and post-close Owner rescue are separate; rescue failure must not undo close.
- transaction receipt, index completion, and product readiness are distinct; default `softReadyDepth=3` and `reorgSearchLimit=128` are recovery settings rather than finality claims.
- degraded APIs/indexers must not present stale state as ready and must not remove a verifiable Owner exit path.

## Dependencies and risks

- The current base is the matrix and base-regression target, not the final unified candidate. Final approval waits for Macbeth01 to supply one exact candidate containing accepted Phase 1 changes.
- Historical final security review was limited by a service restriction. The current assignment explicitly prohibits retrying it through renaming, changing tools, or changing workers. Macbeth05 will preserve the actual limitation and will not claim the review passed.
- Historical reports prove only their recorded source versions and scopes. They cannot endorse this base or a future candidate without applicable retest.
- Actual 90% overall coverage and 100% critical authorization/accounting branch coverage are targets requiring measurement. Existing test totals and selected-file diagnostics are not substitutes.
- Hosted CI, repository review requirements, governance/supply-chain acceptance, and real Testnet acceptance are separate states.

## Acceptance criteria

- Every conclusion binds the source SHA, candidate SHA/tree, checkout, environment, command, time, result, and evidence.
- Failures and unrun work remain visible; no previous evidence is edited into a new PASS.
- Findings identify requirement, severity, minimum reproduction, expected/actual behavior, impact, owner, fix SHA, retest, and blocker class.
- The final report separates implementation, local acceptance, hosted CI, QA/security, review, merge, Testnet, and Phase 1 status.
- The task ends at `READY_FOR_REVIEW`; Macbeth05 does not self-merge.

## Initial questions and blockers

No question blocks intake, matrix construction, dependency setup, base regression, or coverage investigation. The final-candidate conclusion is pending the exact candidate SHA and accepted source composition from Macbeth01. The historical security service limitation and external approval requirements remain explicit blockers only for the acceptance dimensions they govern.

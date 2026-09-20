# Phase 1 base coverage gaps

Source base: `18f5352070910a867b9729b031aa2e3951785e01`

Recorded: 2026-09-20 (Asia/Shanghai)

The effective rule is versioned in `docs/TASK-BOARD.md` on this base: line 108 requires 100% branch coverage for critical authorization and accounting paths, and line 109 sets the overall automated coverage target at no less than 90%. This report does not reinterpret test count as either threshold.

## Extension-based candidate inventory

The initial static inventory selected every regular `.ts`, `.tsx`, `.mjs`, and `.js` file below `apps/server/src`, `apps/web/src`, `packages`, `src`, and `tools`. It excluded `.d.ts`, CSS, HTML, JSON, YAML, lock data, tests, generated outputs, dependencies, and Solidity, which has a separate Forge report.

This produces 98 extension-based candidate files. Node's test coverage report contains 77, leaving 21 candidate files unrepresented. The earlier 99/22 checkpoint was an off-by-one error: `apps/web/src/vite-env.d.ts` remained in the inventory even though the written method excluded declaration files. No test result changes.

The 98-file list is not an exact executable-code denominator. Static follow-up established that `packages/chain-adapter/src/reconciliation.ts` contains only type imports and interface/type declarations; locked TypeScript 6.0.3 emits only the module marker `export {};`, with no product runtime behavior. Conversely, the tracked `apps/web/prototype/AlphaForge_v3_EN.html` contains the 603-line first-party product script that is deterministically emitted as `user-ui.js`, but the extension filter omitted it. A full executable-line/function/branch denominator therefore remains `NOT_MEASURED` rather than 98 files.

Historical 98-file candidate list: `/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/first-party-executable-98.txt`, SHA-256 `ccffd7aefa1c4075883bbdee1c04934a18a2fe90682dbf9a6e3b3dc82734a9d8`. The filename predates this classification correction and is retained as evidence, not as a current denominator claim.

The 21 unrepresented candidate files in the test-only probe are:

```text
apps/server/src/m3-main.ts
apps/server/src/main.ts
apps/web/src/App.tsx
apps/web/src/main.tsx
apps/web/src/product-ui.ts
apps/web/src/webmcp.ts
packages/chain-adapter/src/index.ts
packages/chain-adapter/src/reconciliation.ts
tools/agent-forum-app.js
tools/agent-integration-identity.mjs
tools/backup-demo.ts
tools/bootstrap-ci-npm.mjs
tools/check-agent-identity.mjs
tools/check-config.ts
tools/check-environment.mjs
tools/check-secrets.mjs
tools/ci/check-osv.mjs
tools/ci/check-semgrep.mjs
tools/run-management-checks.mjs
tools/verify-management-browser.mjs
tools/verify-ui-browser.mjs
```

Missing-list evidence: `/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/coverage-unrepresented-21.txt`, SHA-256 `af4bbc5763c6f7ebbe4d292fba34aff9b496d5b338ed75168dcb542f9e7811d2`. This retained artifact is an extension-candidate comparison, not an executable-code denominator.

## Reproduction command and limits

Node 24.21.0 was invoked with the exact 57 test paths in `package.json` `scripts.test`, placing these arguments before `--test` and the unchanged file list:

```text
--experimental-test-coverage
--test-coverage-include=apps/server/src/**/*.ts
--test-coverage-include=apps/web/src/**/*.ts
--test-coverage-include=apps/web/src/**/*.tsx
--test-coverage-include=packages/**/*.ts
--test-coverage-include=src/**/*.ts
--test-coverage-include=tools/**/*.ts
--test-coverage-include=tools/**/*.mjs
--test-coverage-include=tools/**/*.js
--test-coverage-exclude=**/*.d.ts
--test-reporter=spec
--test-reporter-destination=/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/coverage-detailed-tests.log
--test-reporter=lcov
--test-reporter-destination=/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/coverage-detailed.lcov
--test <the exact 57 paths from package.json scripts.test>
```

The complete executable, Node version, working directory, include/exclude patterns, 57 test paths, and final argument vector are preserved in `/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/coverage-command.json`, SHA-256 `515bf1f81aa76f3949402cc88abc91001aa81bcf28912b41d206661356a866f6`.

The permitted local run passed all 591 tests. Its spec log SHA-256 is `f98bb57f09ae8197db21af035c0baa8e71a7b23057d47921068578e14a129ae5`; LCOV SHA-256 is `e7e91c1f68ea725fdc108a6497ac7a7d798ed2a5e013cabc9ea37b8deedc4207`.

Node's include patterns filter loaded modules; they do not synthesize zero-coverage records for files that no test loads. Therefore the reported 91.67% lines, 84.66–84.67% branches across repeat runs, and 94.30% functions are loaded-file values. The LCOV branch records give a source line and count but no semantic branch label; more than one branch record can map to one source line. Neither test count nor the loaded-file percentage establishes actual overall coverage.

## Critical JS/TS uncovered branches

The detailed LCOV has the following zero-count branch source lines. The complete machine-readable list includes source text and branch-record counts at `/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/js-ts-critical-branch-gaps.json`, SHA-256 `a5a7c77cd73d72ae98c1751d6a82c64111086be86f077c63ee3570f350915dc8`.

| File                                      | Covered branches | Zero-count branch source lines                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/chain-store.ts`          | 270/339 (79.65%) | 110, 159, 195, 220, 225, 259, 268, 271, 326, 410, 531, 603, 605, 650, 662, 665, 671, 689, 697, 733, 737, 766, 772, 774, 813, 828, 830, 838, 877, 898, 996, 1005, 1022, 1039, 1051, 1069, 1106, 1115, 1123, 1129, 1148, 1150, 1196, 1232, 1260, 1269, 1272, 1274, 1291, 1295, 1319, 1321, 1371, 1388, 1392, 1401, 1404, 1414, 1423, 1428, 1517, 1521, 1528, 1531–1533, 1551, 1561, 1623 |
| `apps/server/src/chain-sync.ts`           | 113/139 (81.29%) | 55, 61, 106, 126, 157, 216, 219, 242, 249, 250, 252, 253, 262, 274, 278, 284, 331, 337, 343, 347, 359, 375, 401, 402, 444, 456                                                                                                                                                                                                                                                         |
| `apps/server/src/m3-vault-integration.ts` |   37/46 (80.43%) | 119, 127, 132, 135, 142, 145, 236, 244, 246                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/chain-wallet.ts`            |   74/96 (77.08%) | 84, 89, 112, 169, 172, 179, 182, 197, 213, 223, 231, 237, 260, 292, 301, 318, 321, 340, 342, 343, 372, 396                                                                                                                                                                                                                                                                             |
| `apps/web/src/m3-browser-runtime.ts`      | 105/138 (76.09%) | 82, 84, 96, 158, 184, 197, 213, 219, 221, 236, 263, 267, 275, 280, 337, 353, 385, 389, 395, 396, 401, 404, 411, 413, 473, 489, 505, 545, 548, 566, 588, 602, 613                                                                                                                                                                                                                       |
| `apps/web/src/m3-chain-action-flow.ts`    |   16/21 (76.19%) | 14, 44, 46, 52, 62                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/m3-vault-allowance.ts`      |   36/50 (72.00%) | 33, 36, 43, 74, 152, 162, 171, 175, 179, 194, 196, 203, 238, 240                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/m3-vault-client.ts`         |   62/77 (80.52%) | 85, 105, 111, 161, 225, 232, 242, 286, 324, 325, 364, 382, 385, 405, 408                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/m3-vault-live-reader.ts`    |   18/21 (85.71%) | 30, 36, 47                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/chain-adapter/src/rpc.ts`       |   49/93 (52.69%) | 108–110, 117, 127, 150, 151, 161, 164, 170, 176, 182, 187, 194, 198, 212, 219, 228, 235, 238, 241, 248, 249, 252, 268, 275, 277, 283, 300, 301, 305, 308, 321, 324, 330, 337, 348, 357, 364, 373, 376, 383                                                                                                                                                                             |
| `packages/chain-adapter/src/vault-abi.ts` |   67/83 (80.72%) | 83, 88, 94, 109, 134, 142, 149, 177, 184, 214, 228, 242, 251, 256, 265, 274                                                                                                                                                                                                                                                                                                            |
| `packages/domain/src/money.ts`            |   24/26 (92.31%) | 16, 32                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/domain/src/vault.ts`            |   80/81 (98.77%) | 193                                                                                                                                                                                                                                                                                                                                                                                    |

High-priority semantic groups for new tests are:

- authority/session: `chain-wallet.ts` 260, 301, 318, 321, 340, 342, 343; `m3-chain-action-flow.ts` 44, 46, 62; `m3-vault-allowance.ts` 171, 179, 194, 203; `m3-browser-runtime.ts` 184 and 505;
- amount/precision/ABI: `money.ts` 16 and 32; `m3-vault-allowance.ts` 43; `m3-vault-integration.ts` 142 and 145; `vault-abi.ts` 83, 88, 94, 109, 149;
- settlement/recovery identity: `m3-vault-integration.ts` 236, 244, 246; `chain-store.ts` 1051, 1196, 1260, 1269, 1272, 1274, 1291, 1295, 1319; `chain-sync.ts` 216, 274, 331, 359, 375, 401, 402;
- RPC receipt/finality: `rpc.ts` 219, 235, 241, 249, 300, 301, 305, 308, 321; `m3-vault-client.ts` 324 and 325.

### `packages/domain/src/vault.ts:193` criticality judgment

The sole zero-count branch in this file is `Array.isArray(value)` inside private fingerprint serializer `canonical()`. It is reached only from line 235 with `{ actor, command, policyId }`:

- the `Actor` and `Command` unions contain string, number, and object fields but no arrays;
- the public command routes use a closed `oneOf` schema whose every shape has `additionalProperties: false`; none permits an array;
- the actor comes from the authenticated session/simulation boundary, and `policyId` is a validated string or `null`;
- the whole ledger is marked `scope: TEST_ONLY`; Phase 1 onchain Vault accounting uses the separate contract and M3 chain modules.

On this evidence, line 193 is not a reachable branch of a valid public command and is not a critical Phase 1 authorization or accounting decision. A synthetic extra array property would be rejected at the HTTP schema boundary, while a direct type-unsafe call would be outside the accepted interface. Macbeth05 therefore does not recommend adding a meaningless array input merely to increment coverage.

The branch remains visible in the module and overall metrics: `vault.ts` is 80 / 81 branches, not 100%. This exclusion applies only to the explicit critical authorization/accounting inventory; it does not turn the entire module or overall coverage into 100%, and it does not close `M3-05-P1-001` while the other recorded critical gaps remain.

## Solidity uncovered branches

The exact locked Forge 1.5.1 / solc 0.8.31 environment ran `forge coverage --offline --report lcov` and passed 121 / 121 tests. LCOV SHA-256: `cc174b349cad013a5045bd8ce1e58cdb7f6a498eaf914776e174728fc0716ab0`.

| Source                          | Uncovered branch lines                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| `src/AlphaForgeSwapAdapter.sol` | 44, 47, 87                                                              |
| `src/AlphaForgeTestAsset.sol`   | none                                                                    |
| `src/AlphaForgeTestVenue.sol`   | 49, 52, 103, 156, 164, 178                                              |
| `src/AlphaForgeVault.sol`       | 43, 88, 108, 110, 166, 183, 205, 212, 218, 238, 249, 257, 261, 283, 294 |
| `src/PassLocker.sol`            | 35, 47                                                                  |
| `src/StrategyPass.sol`          | none                                                                    |
| `src/VaultIntentPreview.sol`    | none                                                                    |

The complete source-text mapping is `/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/solidity-branch-gaps.json`, SHA-256 `3f3c41de9102f19a384b2ace436c4b27c660a9d6db7dd0c4acb2c4dfaf134bba`.

Priority contract gaps are:

- amount/principal: Vault lines 88 (deposit overflow), 108 (zero withdrawal), 110 (withdrawal above tracked funds), 183 (zero native rescue), 238 and 249 (exact transfer deltas), 257 (tracked deficit);
- capacity/close: Vault lines 43 (closed mutation), 205 (closed withdrawable amount), 212 (tracked investment reserve), 218 (zero-token excess query), 261 (unsupported tracked asset); PassLocker lines 35 (zero constructor identity) and 47 (escrow accounting deficit);
- settlement: SwapAdapter line 87 (venue return below minimum), Vault lines 238/249/257 (custody settlement mismatch/deficit), and Vault line 283 (StrategyPass identity call failure).

The direct Owner authorization branch at Vault line 38 and the PassLocker controller authorization branch at line 72 are covered in this report. That does not satisfy the broader 100% critical authorization/accounting target while the listed session, amount, capacity, settlement, and recovery branches remain uncovered.

## Local integration candidate update

At candidate `639ffd8f85a89ee9266112c6d80e90e9428381a2`, tree
`7a6b8cc6ae06d8424674669727b06cf0f923c4ba`, the candidate contract source is identical to the PR
#24 evidence source whose three core contracts independently reached 100% lines, statements,
branches and functions. The exact candidate's complete 705-test list also ran against the 13
explicitly included critical Chain/API sources and reported 97.37% lines, 95.40% branches and
98.56% functions.

Every concrete frozen critical zero-hit from the earlier Chain/API checkpoint remains closed. The
raw residual records are `chain-sync.ts:242`, the closing brace of an executed `finally`, and
`rpc.ts:325`, the retry-loop closing brace before an unreachable fallback. They remain in the raw
denominator. The concrete critical subset is `PASS_AT_639_LOCAL_CANDIDATE`; overall JS/TS coverage
remains `NOT_MEASURED` because this targeted population is not a complete homogeneous denominator
for all Node and production-browser first-party source.

Exact-candidate artifacts are recorded in [Execution Log](EXECUTION-LOG.md). The critical log,
LCOV and branch-gap JSON SHA-256 values are respectively
`bc59d41daf49b98d37a743e034022500daf0f66acfddef43f535ff949ec4c8b1`,
`ad7248f05f9ba092d07dd88df571e3ccee004d693a01dd3ac13575b355f88e20` and
`e938e3fe48bf701bb3031ed002440397a5ee62ad8fa82f0945a7e2a2a9c956e3`.

## Refreshed candidate `3a78e34...`

Candidate `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8` does not change the contract,
Chain/API or product functional source from `639ffd8...`. Macbeth05 nevertheless reran the complete
711-test list with the 13 critical Chain/API sources explicitly included. All tests pass; coverage
is 97.37% lines, 95.40% branches and 98.56% functions. The only adjacent residual V8 records remain
`chain-sync.ts:242`, an executed `finally` closing brace, and `rpc.ts:325`, the retry-loop closing
brace before a fallback that cannot be reached because the final attempt returns or throws. The
frozen concrete critical subset is `PASS_AT_3A78_LOCAL_CANDIDATE`; raw coverage is retained without
rewriting the percentage.

The manager's new canonical counter probe demonstrates that one original TypeScript AST count graph
can conservatively merge a Node positive branch and a browser-minified negative branch from the
same source: `[[1,0]] + [[0,1]]` becomes `[[1,1]]`, while an uncalled function, type-only source and
an unimported file remain in the denominator at zero. This is useful method evidence, but it is not
yet an admitted repository-wide measurement. Full syntax and prototype coverage, mixed callbacks,
subprocess propagation and incomplete-process handling remain unqualified. A prior V8 Node/Vite
union duplicated the branch denominator and is retained as a counterexample rather than reported as
coverage. The production browser build with hidden source maps produced the same JavaScript and CSS
bytes as the ordinary build, but byte equality alone does not solve the semantic branch mapping.

An independent tracked-file recount at `3a78e34...` finds 112 non-test `.js`, `.mjs`, `.ts` and
`.tsx` paths, including the sole declaration `apps/web/src/vite-env.d.ts`; 111 remain after excluding
that declaration. Five executable tracked paths sit outside the old source globs:

- `apps/web/vite.config.ts`;
- `docs/management/dashboard/agent-forum-app.js`;
- `docs/management/dashboard/app.js`;
- `docs/task-board.js`;
- `eslint.config.mjs`.

`docs/management/dashboard/agent-forum-app.js` and `tools/agent-forum-app.js` are byte-identical at
SHA-256 `2788e38b53c585297ffa53aecee58115f72ac58d796dcb5bb60976ef35b5d68b`; the build tool copies the
latter to the former and its check mode enforces equality. They may share one semantic denominator
only while that exact generation relationship is proved. The other four paths have distinct bytes
and executable behavior and must be included unless the acceptance scope explicitly excludes their
runtime class. The tracked prototype inline script is additional executable source outside the
extension inventory. Therefore neither the old 98-file list nor a naive 112-file count is the final
semantic denominator; the admitted counter must inventory all tracked executable source, exclude
declarations by proof and deduplicate only exact generated copies.

For a process intentionally terminated by `SIGKILL`, missing or incomplete coverage output may be
treated only as zero hits on the complete canonical denominator. If the conservative union still
exceeds 90%, it can establish a mathematical lower bound; it cannot claim that the killed lifecycle
was completely observed. The crash-recovery behavior remains proved by its functional test, and
coverage hits must come from separately traceable executions. Until the complete method qualifies
and produces a candidate-bound report, overall JS/TS coverage remains `NOT_MEASURED`.

| Critical coverage artifact                      | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `run-integration-3a78e34-critical-coverage.mjs` | `aaefa45a9c1eb8b26a93695bec27fb755ad3c8293fce0d25072264e545215591` |
| `integration-3a78e34-critical-coverage.log`     | `2f7f11c8964dd1def6e29e31ad699d62550d73365f41dd6c511c8592c3383a9b` |
| `integration-3a78e34-critical-coverage.lcov`    | `d3227b94ed7ae3d07ea3ca03847ba5db149e67b0497b0b367aa7ad524664f3d3` |
| `summarize-integration-3a78e34-branches.mjs`    | `c0dfc8da70b861c90a821d790cfd1fbcb095c1750584b002c26403d677a13998` |
| `integration-3a78e34-critical-branch-gaps.json` | `e1bb666812d4c031679185a633e99f9002d12e5f35fcfe4e16d9d82bf6745a34` |

# Complete coverage collection method

Source base: `18f5352070910a867b9729b031aa2e3951785e01`

Recorded: 2026-09-20 (Asia/Shanghai)

## Decision

The locked toolchain can collect and merge source coverage for Node processes that actually execute, including npm-launched child processes. It cannot, with the currently admitted dependencies, produce a complete source-level percentage for unexecuted files or production browser modules.

The complete Phase 1 report must therefore keep six populations separate:

1. `MEASURED_NODE_SOURCE`: first-party source files observed while an admitted real Node workflow executes;
2. `NOT_EXECUTED_NODE_SOURCE`: files with Node runtime behavior that an accepted workflow did not execute;
3. `NOT_MEASURED_BROWSER_SOURCE`: browser code that cannot be reliably mapped back to its tracked source by the admitted tools;
4. `MIXED_NODE_BROWSER_SOURCE`: Node-driven browser verifiers whose driver statements and renderer callbacks execute in different V8 processes and must be reported separately;
5. `NO_EXECUTABLE_CODE`: type/declaration-only source that emits no product runtime behavior;
6. `MEASURED_SOLIDITY_SOURCE`: the separate locked Forge coverage result.

The loaded-file Node percentages must not be presented as actual overall coverage. Under the current toolchain, the actual combined JS/TS overall line, branch, and function percentages remain `NOT_MEASURED` until every relevant runtime can be mapped to the same source denominator.

## Reproducible Node method

Use the exact locked Node 24.21.0 binary and a new raw directory for one candidate SHA. Run real accepted workflows with `NODE_V8_COVERAGE` pointing to that directory:

```bash
export NODE_V8_COVERAGE=/private/tmp/<candidate-specific-directory>/raw
npm run check
# Run each additional admitted CLI or server lifecycle not covered by that gate.
```

`NODE_V8_COVERAGE` is inherited by npm child processes unless a command deliberately clears its environment. The base probe produced separate raw files for the npm parent and the real Node child when `npm run config:check` ran with `QP_MODE=local` and `QP_ADAPTER=mock`. Its merged source report contained both `tools/check-config.ts` and `packages/config/src/index.ts`. This demonstrates execution collection; it does not authorize import-only probes.

Each command must:

- run from the exact candidate worktree and record candidate SHA, tree, working directory, Node/npm versions, command arguments, and the bounded environment;
- exercise a real accepted workflow rather than import a module solely to make it appear in coverage;
- inherit the same candidate-specific raw directory, or use a separately recorded raw directory that is merged only after candidate identity is verified;
- terminate normally or through the workflow's documented graceful shutdown so V8 writes its coverage artifact;
- retain its actual exit status. A failing gate may show which code executed, but its coverage is not evidence that the gate passed.

Node 24.21.0's built-in test coverage implementation can merge the raw `coverage-*.json` files and apply source maps. The verified probe used `TestCoverage` from `internal/test_runner/coverage`, with the same eight include globs and `**/*.d.ts` exclusion recorded in [Coverage Gaps](COVERAGE-GAPS.md). The summarizer must run with the exact Node 24.21.0 binary and `NODE_V8_COVERAGE` removed from its own environment so it does not add itself to the raw set.

This `--expose-internals` interface is private and Node-version-specific. It is acceptable here only as a pinned evidence reader for Node 24.21.0; it is not a project dependency or a stable product API. A Node version change invalidates the method and requires a new toolchain review.

## Static-inventory reconciliation

After merging, normalize every reported absolute path relative to the candidate root and compare that set with the versioned 98-file extension inventory:

- present in the runtime report: `MEASURED_NODE_SOURCE`;
- present in the inventory but absent from the runtime report: classify as `NOT_EXECUTED_NODE_SOURCE`, `NOT_MEASURED_BROWSER_SOURCE`, `MIXED_NODE_BROWSER_SOURCE`, or `NO_EXECUTABLE_CODE` from source and real-entrypoint evidence;
- absent from the extension inventory but containing first-party executable logic: add it to the applicable source population rather than ignoring it.

The 98-file list is an extension-based candidate inventory, not an exact executable denominator. It includes `packages/chain-adapter/src/reconciliation.ts`, which has only type imports and declarations; locked TypeScript 6.0.3 transpiles it to the non-behavioral module marker `export {};`. It omits the tracked inline product script in `apps/web/prototype/AlphaForge_v3_EN.html` because that source has an `.html` extension.

Node's include globs filter runtime records; they do not create zero-coverage records for source files that never execute. V8 emits no ranges for an unexecuted file, so the existing tool cannot derive a comparable executable-line, function, or branch denominator for that file. Assigning zero runtime counts without such a denominator, importing the file just to obtain ranges, deleting it, excluding it, or treating all files as equal units would manufacture an overall percentage. The correct value for the combined overall percentage is `NOT_MEASURED`, accompanied by the measured, unexecuted, browser, mixed-runtime, and no-executable-code classifications.

## Base method probe

The exact base was probed with Node 24.21.0 by setting one raw directory around the real `npm run check` command in local/mock mode. The command executed 591 passing tests and subsequent checks; its log then ended at the already-recorded `management:check` branch/evidence mismatch. This remains a failed gate, not a pass. It produced 136 raw coverage artifacts.

The merged runtime population contained 78 of the 98 extension candidates. Loaded-file values were 92.5551% lines (19,543 / 21,115), 85.2028% branches (5,021 / 5,893), and 95.0746% functions (1,274 / 1,340). These values describe only the 78 files with Node runtime records; they are not the repository-wide result. Twenty inventory candidates still had no Node runtime record:

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
tools/ci/check-osv.mjs
tools/ci/check-semgrep.mjs
tools/run-management-checks.mjs
tools/verify-management-browser.mjs
tools/verify-ui-browser.mjs
```

The earlier test-only run had 77 represented extension candidates. The real `npm run check` probe added `tools/check-secrets.mjs`; `tools/check-config.ts` was separately proven by its real CLI command but was not merged into this probe directory. Final-candidate collection should run all applicable admitted workflows into one candidate-specific union and then regenerate the inventory comparison and semantic classifications.

Probe evidence:

| Artifact                                                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `/private/tmp/af-cov-check-union/check.log`                 | `7eca4ba98147790a6cc23358fe64321a3d5405f068bbf0cdca9b310c9e441c7e` |
| `/private/tmp/af-cov-check-union/summarize.cjs`             | `99ee4aaa38fd07e5f986092c59874189ab38aa9e0a2c8edf034a8f88adf16763` |
| `/private/tmp/af-cov-check-union/summary-node-24.21.0.json` | `7e061a19a64c4b3127ae2957f25fa930e0a723e439146cd87ad01b18252384d7` |
| `/private/tmp/af-cov-check-union/result-node-24.21.0.json`  | `cd78273a58f6a6cbd69af76c1a1f9ffadc3b60e9b578b3ba6a58570fcaf45f02` |
| `/private/tmp/af-cov-check-union/represented-78.txt`        | `590586fc418117a70fbe4cda40ac7536852cdcb563c87d39ce07e5b083bc2fd7` |
| `/private/tmp/af-cov-check-union/unrepresented-20.txt`      | `bb8096687f546e906b5433f696f7be3e43d13bec4c659854049ce256ea94f04d` |
| `/private/tmp/af-cov-check-union/raw-sha256-manifest.txt`   | `b28d4a75aaea468c688552ba99417ce6e38fa497fa604daf7b962dd154af4c7a` |

This was a collection-method probe on the base, not a final-candidate acceptance run.

## Browser boundary

`NODE_V8_COVERAGE` measures the Node build/server/test processes, not JavaScript executing in Chrome's renderer. The repository's browser verifiers expect optional `playwright-core` outside project dependencies, but neither that package nor Playwright, Puppeteer, c8, nyc, Istanbul, or `v8-to-istanbul` is installed in this isolated worktree. The production Vite configuration also sets `build.sourcemap: false`.

`tools/verify-ui-browser.mjs` and `tools/verify-management-browser.mjs` are mixed-runtime Node drivers. Their server setup, Playwright calls, assertions, and teardown execute in Node and can be measured with `NODE_V8_COVERAGE` when the real verifier runs. Functions passed to `page.evaluate()` execute in Chrome's renderer and are outside that Node report. The files must not be classified wholly as browser source or credited wholly from the Node driver report.

`tools/agent-forum-app.js` is a browser IIFE beginning with direct `document` access, not a long-running Node server. It belongs to the browser-source population.

The actual product UI also executes `user-ui.js`. Its tracked source is the single inline script in `apps/web/prototype/AlphaForge_v3_EN.html`, not a tracked generated `.js` file. The importer extracts that script and makes only 17 mechanical `style=` to `data-user-style=` replacements. The tracked prototype is 285,969 bytes, SHA-256 `949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45`; the raw inline script is 156,555 bytes / 603 lines, SHA-256 `a18b2d21531df88461570a971440df42c5715a0085223cf8911e64f1a08925c5`; both `build/ui-import/user-ui.js` and the production `apps/web/dist/user-ui.js` equal the 156,725-byte normalized output, SHA-256 `83a84d03fb0178d980e9dc85ca59379efef0f150ea7099b14c8fbe40d690d844`. Generated-output exclusion does not remove this first-party product logic from the browser-source population.

Classification evidence: `/private/tmp/AlphaForge-M3-05-PHASE1-EVIDENCE/coverage-classification-correction.json`, SHA-256 `a9c6f7cf91fd7a7b109418f2ad83a2e11085dc7f94822686eeef40ebe2a240b2`. It records Node 24.21.0, TypeScript 6.0.3, the type-only transpilation result, product-script provenance and hashes, and the corrected runtime classes.

Chrome DevTools Protocol can return precise offsets for the generated production bundle, but the admitted environment has no source map plus mapping tool capable of converting those offsets into the TypeScript/TSX line, function, and branch denominator used by the Node report. Bundle-byte coverage must not be merged with source coverage. Running the Vite development server would measure a different transformed development runtime and would not establish production-bundle source coverage.

Accordingly:

- retain the existing production browser journeys as functional acceptance evidence;
- report actual production browser source coverage, including the tracked inline script emitted as `user-ui.js`, as `NOT_MEASURED`;
- do not count a successful Vite build as runtime execution of `App.tsx`, `main.tsx`, `product-ui.ts`, or `webmcp.ts`;
- report Node-driver and renderer portions of the browser verifiers separately;
- do not install an unreviewed mapping dependency or enable a new artifact mode within this QA task.

## Remaining entrypoint treatment

For the final candidate, the remaining files should be classified by observable execution rather than forced into a percentage:

| Population                                                                                  | Treatment                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node CLI checks such as config, environment, identity, management, OSV, and Semgrep         | Run the real admitted command with inherited raw coverage. If its prerequisites are unavailable, record `NOT_RUN` or `NOT_EXECUTED_NODE_SOURCE` and the exact blocker. |
| Long-running Node server entrypoints such as `main.ts` and `m3-main.ts`                     | Use an existing real lifecycle with readiness, accepted local/mock interaction, and graceful shutdown. Otherwise retain `NOT_EXECUTED_NODE_SOURCE`.                    |
| One-shot `tools/backup-demo.ts` CLI                                                         | Run only through its real isolated local database backup/restore workflow; it exits normally and is not a server. Otherwise retain `NOT_EXECUTED_NODE_SOURCE`.         |
| Bootstrap/install entrypoints                                                               | Measure only when the authorized locked bootstrap workflow actually runs. Do not execute them merely for coverage.                                                     |
| Runtime re-export barrels such as `packages/chain-adapter/src/index.ts`                     | Count only when a real adapter workflow loads them. Import-only execution is invalid.                                                                                  |
| Type-only `reconciliation.ts`                                                               | Record `NO_EXECUTABLE_CODE`; do not import it merely to create a runtime record. `index.ts` remains a runtime re-export barrel and requires a real consumer workflow.  |
| Browser source including `agent-forum-app.js`, web entrypoints, and normalized `user-ui.js` | Functional browser evidence remains separate; source coverage is `NOT_MEASURED_BROWSER_SOURCE` under the present admitted tools.                                       |
| Node-driven browser verifiers                                                               | Measure the actual Node driver when its admitted prerequisites exist; keep renderer callbacks and page source in the browser population.                               |

This method makes runtime execution auditable without turning file discovery, imports, builds, or test counts into coverage claims.

## Candidate inventory correction at `3a78e34...`

The complete tracked extension population is broader than the original eight include globs. At
`3a78e34...`, `git ls-files` yields 112 non-test `.js`, `.mjs`, `.ts` and `.tsx` paths. Excluding the
one declaration leaves 111 paths. Five are outside the old globs: `apps/web/vite.config.ts`,
`docs/management/dashboard/agent-forum-app.js`, `docs/management/dashboard/app.js`,
`docs/task-board.js` and `eslint.config.mjs`.

The dashboard copy of `agent-forum-app.js` is byte-identical to `tools/agent-forum-app.js`, and
`tools/build-agent-forum.mjs` proves the latter is its generator input and rejects a stale output.
That pair may be counted once as one semantic source while those proofs hold. The other four omitted
files are distinct executable source and belong in a complete denominator unless an explicit scope
decision excludes their runtime class. The HTML prototype's inline script is also executable source
despite having no JavaScript extension. Inventory construction must therefore start from all tracked
source and explicit embedded-code extraction, then classify declarations and proven generated
duplicates; a path-glob union alone is not complete.

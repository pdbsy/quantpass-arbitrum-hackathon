# AlphaForge PR22 backend reachable-branch handoff

Task: `M3-03-PHASE1-RECOVERY`; author: Macbeth03. Scope: Robinhood Chain Testnet / Hackathon; local/mock only. XLayer remains paused. No publication or merge was performed.

## Candidate and measurement

Baseline: `f966dd2e0772f6953e7315816b52aa53316c7eae`. Measured code candidate: `f220f5098daa9987f9bdd64a11f6b5d3383b45c7`. Implementation commits: `b9ba92c378440b692eb0a2ad78d04eeeb1e9b3ed` and `f220f5098daa9987f9bdd64a11f6b5d3383b45c7`.

All 86 original rows remain: **74 observed with unchanged source digest and branch map; 5 recovery rows reverified on a changed source graph; 7 bounded inactivity proofs submitted for independent review**. The five changed rows are not counted as old-graph closure. Missing hits alone were never used as a proof. No full-project coverage percentage is claimed.

Only `tools/chain-recovery.ts` changes production bytes. Its new graph measures 58/58 lines, 64/64 statements, 6/6 functions and 29/29 branches in this diagnostic. Instrumentation validates copied locked-tool bytes and original Git source; descriptor SHA-256: `380b1ba55eb71082f9b76cb6e7cc577d0c4a4d68fdd60a216d5342619357cbc0`.

Later handoff edits add documentation and strengthen the existing custom-policy assertion: a supplied depth of four keeps a three-confirmation operation CONFIRMING. This assertion passed a focused run; it does not change production bytes or retroactively change the measured candidate. The final integrated HEAD still requires manager-owned acceptance.

## Defect and fix

The retained failing test creates a real SQLite CHECK violation. On pinned Node 24.21.0, a read-only handle returned `ok` for that row; the original recovery CLI therefore reported HEALTHY for a damaged copy. The copy is now opened with a write-capable handle and immediately made SQL query-only before any validation. The input database stays read-only. Failed validation removes the owned copy; denied cleanup reports an AggregateError with both original and cleanup errors rather than claiming success.

Regression assertions cover exact original database and live WAL bytes, validated retry, copied-content tampering, an externally aborted transaction, and an actual directory permission error during unlink. These are isolated fixtures; no user database, production constraint, or global permission is relaxed. The separate projection-corruption fixture briefly relaxes its own DDL with defensive mode disabled, then restores the exact DDL before application reads.

## Validation and evidence

Pinned toolchain: fnm 1.39.0 / Node 24.21.0 / npm 11.19.1; independent full-history clone and independent dependencies/data. Initial `npm run env:check` exited 1 for manager-owned listeners on 4180/4181. That remains an admission failure for that run; tests use app injection or private random loopback ports. Formal environment admission belongs to the final integration run.

Commands below use `fnm exec --using=24.21.0 --` unless noted. Logs are under ignored `outputs/pr22-ready-macbeth03/`; raw records are retained locally and not rewritten.

| Check | Actual result | Log |
|---|---|---|
| `node --test` on the ten modified test files | 220/220, exit 0 before two later test additions | `targeted-regression.log` |
| Targeted real projection damage and WAL tests | 2/2, exit 0 | `projection-wal-retry.log` |
| Targeted future-version and cleanup tests | 2/2, exit 0 | `final-gaps.log` |
| `node outputs/pr22-ready-macbeth03/diagnose-final.mjs` (same ten files, instrumented) | 222/222, workflow PASS, exit 0 at measured candidate | `diagnostic-final.log` and immutable workflow logs |
| `node --test --test-name-pattern=single-runtime test/chain-startup.test.ts` | 1/1, exit 0; later assertion only | `policy-assertion.log` |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 | `typecheck-final.log`, `final-gaps-typecheck.log`, `handoff-typecheck.log` |
| ESLint on modified files with `--max-warnings=0` | exit 0 | `lint.log`, `final-gaps-lint.log`, `handoff-lint.log` |
| Prettier on modified files; `git diff --check` | exit 0 | format logs; command receipt |
| Original integrity regression | exit 1, preserved RED | `recovery-initial.log` |
| Corrected integrity regression | 3/3, exit 0 | `recovery-fixed.log` |

Exact generated report: `outputs/pr22-ready-macbeth03/coverage/2026-09-22T22-59-31.526Z-05a2a467-444e-4efe-90af-bf617d4190cc/report-6593d3d0-22b3-4280-a2e6-babc99316659.json`. SHA-256: `dad3ecdebd55eda36b01e95c259d3f5837952577c335a8558e8539d9f9437724`. Original full-report SHA-256: `a64e205c9344a4666902f5d1e1abc55527a8fcf9d3595828a9583e7947b06adc`. Machine-readable annotated rows: ignored `outputs/pr22-ready-macbeth03/gap-ledger.json`.

All ten test files were already registered in package.json: server, product-api, chain-store, chain-sync, chain-startup, chain-vault-integration, chain-lifecycle, domain, robinhood-chain, and m3-deployment-template. No shared scripts, workflows or required checks were changed.

Fault injection is explicit: SQLite triggers/UDFs exercise transaction failures; an integration callback exercises dependency failure; child preload fixtures alter only the external backup completion boundary or template file read. Actual production branches, SQLite copies, validation, HTTP envelopes and cleanup execute from committed production bytes. These tests do not substitute successful coverage events or edit generated evidence.

## Original branch ledger

`V` = observed on identical digest/map with behavior assertions. `C` = changed source, separately reverified; not old-graph closure. `I` = inactivity proof below, still awaiting independent review. IDs are original Istanbul branch ID and arm index, not Git branches. Empty arm locations are resolved through the original enclosing branch map.

| Original source | ID:arm | Class | Test / proof |
|---|---|---|---|
| `apps/server/src/api-errors.ts` | `1:1` | V | `test/server.test.ts:58` — unknown error codes |
| `apps/server/src/api-errors.ts` | `4:1` | V | `test/server.test.ts:58` — unknown error codes |
| `apps/server/src/app.ts` | `19:1` | I | See exact ID proof below |
| `apps/server/src/app.ts` | `20:0` | V | `test/server.test.ts:72` — session capacity |
| `apps/server/src/app.ts` | `22:0` | V | `test/server.test.ts:72` — session capacity |
| `apps/server/src/app.ts` | `27:0` | V | `test/server.test.ts:93` — unknown strategy vault |
| `apps/server/src/app.ts` | `29:0` | I | See exact ID proof below |
| `apps/server/src/app.ts` | `31:1` | V | `test/product-api.test.ts:72` — read failures after SQLite |
| `apps/server/src/chain-store.ts` | `20:1` | V | `test/chain-store.test.ts:123` — missing reconciliation failure reason |
| `apps/server/src/chain-store.ts` | `38:1` | V | `test/chain-store.test.ts:153` — unsubmitted operation checkpoint |
| `apps/server/src/chain-store.ts` | `53:0` | V | `test/chain-store.test.ts:100` — recognized chain tables with a future |
| `apps/server/src/chain-store.ts` | `58:1` | I | See exact ID proof below |
| `apps/server/src/chain-store.ts` | `60:1` | V | `test/chain-store.test.ts:336` — chain backup invalid parent |
| `apps/server/src/chain-store.ts` | `67:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `85:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `90:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `93:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `116:1` | I | See exact ID proof below |
| `apps/server/src/chain-store.ts` | `126:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `139:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `140:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `152:0` | V | `test/chain-store.test.ts:153` — unsubmitted operation checkpoint |
| `apps/server/src/chain-store.ts` | `159:1` | V | `test/chain-store.test.ts:153` — unsubmitted operation checkpoint |
| `apps/server/src/chain-store.ts` | `166:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `180:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-store.ts` | `194:0` | V | `test/chain-store.test.ts:32` — a physically damaged projection row |
| `apps/server/src/chain-store.ts` | `221:0` | V | `test/chain-store.test.ts:296` — evidence read errors |
| `apps/server/src/chain-store.ts` | `221:1` | V | `test/chain-store.test.ts:296` — evidence read errors |
| `apps/server/src/chain-store.ts` | `224:1` | V | `test/chain-store.test.ts:195` — automatic SQLite rollbacks |
| `apps/server/src/chain-sync.ts` | `39:0` | V | `test/chain-sync.test.ts:324` — a refused healthy checkpoint |
| `apps/server/src/chain-sync.ts` | `45:0` | V | `test/chain-sync.test.ts:346` — projection failure cannot rewind |
| `apps/server/src/chain-sync.ts` | `47:0` | V | `test/chain-sync.test.ts:383` — a superseded projection error |
| `apps/server/src/chain-sync.ts` | `72:1` | V | `test/chain-sync.test.ts:410` — repeated reconciliation mismatch |
| `apps/server/src/m3-app.ts` | `5:0` | V | `test/chain-startup.test.ts:412` — single-runtime M3 app |
| `apps/server/src/m3-app.ts` | `6:1` | V | `test/chain-startup.test.ts:412` — single-runtime M3 app |
| `apps/server/src/m3-chain-runtime.ts` | `48:1` | V | `test/chain-startup.test.ts:412` — single-runtime M3 app |
| `apps/server/src/m3-startup.ts` | `8:0` | V | `test/chain-startup.test.ts:505` — default deployed timer |
| `apps/server/src/m3-startup.ts` | `9:1` | V | `test/chain-startup.test.ts:466` — startup listens only |
| `apps/server/src/m3-startup.ts` | `20:0` | V | `test/chain-startup.test.ts:505` — default deployed timer |
| `apps/server/src/m3-startup.ts` | `21:0` | V | `test/chain-startup.test.ts:466` — startup listens only |
| `apps/server/src/m3-startup.ts` | `22:0` | V | `test/chain-startup.test.ts:466` — startup listens only |
| `apps/server/src/m3-startup.ts` | `23:0` | V | `test/chain-startup.test.ts:533` — scheduled sync recurs |
| `apps/server/src/m3-startup.ts` | `25:0` | V | `test/chain-startup.test.ts:533` — scheduled sync recurs |
| `apps/server/src/m3-startup.ts` | `25:1` | V | `test/chain-startup.test.ts:533` — scheduled sync recurs |
| `apps/server/src/m3-startup.ts` | `27:0` | V | `test/chain-startup.test.ts:533` — scheduled sync recurs |
| `apps/server/src/m3-vault-integration.ts` | `12:1` | V | `test/chain-vault-integration.test.ts:632` — withdraw, close and rescue reject |
| `apps/server/src/m3-vault-integration.ts` | `13:1` | V | `test/chain-vault-integration.test.ts:632` — withdraw, close and rescue reject |
| `apps/server/src/m3-vault-integration.ts` | `16:0` | V | `test/chain-vault-integration.test.ts:632` — withdraw, close and rescue reject |
| `apps/server/src/m3-vault-integration.ts` | `18:0` | V | `test/chain-vault-integration.test.ts:632` — withdraw, close and rescue reject |
| `apps/server/src/m3-vault-integration.ts` | `20:0` | V | `test/chain-vault-integration.test.ts:632` — withdraw, close and rescue reject |
| `apps/server/src/product-routes.ts` | `2:0` | V | `test/product-api.test.ts:30` — snapshot refuses excess persisted |
| `apps/server/src/product-routes.ts` | `3:0` | V | `test/product-api.test.ts:48` — snapshot rejects overflowing |
| `apps/server/src/product-routes.ts` | `4:0` | V | `test/product-api.test.ts:30` — snapshot refuses excess persisted |
| `apps/server/src/product-routes.ts` | `4:1` | V | `test/product-api.test.ts:72` — read failures after SQLite |
| `apps/server/src/product-routes.ts` | `9:0` | V | `test/product-api.test.ts:72` — read failures after SQLite |
| `apps/server/src/product-routes.ts` | `14:0` | V | `test/product-api.test.ts:6` — versioned account pagination |
| `apps/server/src/product-routes.ts` | `17:0` | V | `test/product-api.test.ts:6` — versioned account pagination |
| `apps/server/src/product-routes.ts` | `18:0` | V | `test/product-api.test.ts:6` — versioned account pagination |
| `apps/server/src/product-routes.ts` | `19:1` | V | `test/product-api.test.ts:72` — read failures after SQLite |
| `apps/server/src/store.ts` | `1:0` | V | `test/server.test.ts:104` — ledger refuses unknown |
| `apps/server/src/store.ts` | `2:0` | V | `test/server.test.ts:104` — ledger refuses unknown |
| `apps/server/src/store.ts` | `4:0` | V | `test/server.test.ts:123` — validly hashed but mismatched |
| `apps/server/src/store.ts` | `13:0` | V | `test/server.test.ts:144` — claim rollback faults |
| `apps/server/src/store.ts` | `13:1` | V | `test/server.test.ts:144` — claim rollback faults |
| `apps/server/src/store.ts` | `15:0` | V | `test/server.test.ts:163` — ignored writes and SQLite automatic |
| `apps/server/src/store.ts` | `16:1` | V | `test/server.test.ts:163` — ignored writes and SQLite automatic |
| `apps/server/src/store.ts` | `19:1` | V | `test/server.test.ts:195` — backup invalid parent |
| `packages/chain-adapter/src/lifecycle.ts` | `12:0` | V | `test/chain-lifecycle.test.ts:29` — negative reverted block |
| `packages/domain/src/money.ts` | `11:0` | I | See exact ID proof below |
| `packages/domain/src/vault.ts` | `8:0` | V | `test/domain.test.ts:63` — direct domain callers |
| `packages/robinhood-chain/src/network.ts` | `0:0` | V | `test/robinhood-chain.test.ts:36` — missing endpoints |
| `tools/backup-demo.ts` | `0:0` | V | `test/server.test.ts:16` — demo backup CLI |
| `tools/backup-demo.ts` | `0:1` | V | `test/server.test.ts:16` — demo backup CLI |
| `tools/chain-recovery.ts` | `5:0` | C | `test/chain-store.test.ts:1509` — chain recovery rejects invalid usage |
| `tools/chain-recovery.ts` | `6:0` | C | `test/chain-store.test.ts:1509` — chain recovery rejects invalid usage |
| `tools/chain-recovery.ts` | `9:1` | C | `test/chain-store.test.ts:1509` — chain recovery rejects invalid usage |
| `tools/chain-recovery.ts` | `10:0` | C | `test/chain-store.test.ts:1549` — recovery cleans up real copied data |
| `tools/chain-recovery.ts` | `11:1` | C | `test/chain-store.test.ts:1549` — recovery cleans up real copied data |
| `tools/check-m3-deployment-template.mjs` | `6:1` | V | `test/m3-deployment-template.test.mjs:20` — M3 template rejects missing |
| `tools/check-m3-deployment-template.mjs` | `7:1` | V | `test/m3-deployment-template.test.mjs:20` — M3 template rejects missing |
| `tools/check-m3-deployment-template.mjs` | `10:1` | V | `test/m3-deployment-template.test.mjs:20` — M3 template rejects missing |
| `tools/check-m3-deployment-template.mjs` | `13:1` | I | See exact ID proof below |
| `tools/check-m3-deployment-template.mjs` | `14:1` | V | `test/m3-deployment-template.test.mjs:34` — optional empty evidence |
| `tools/check-m3-deployment-template.mjs` | `15:0` | V | `test/m3-deployment-template.test.mjs:45` — deployment checker CLI |
| `tools/check-m3-deployment-template.mjs` | `17:0` | V | `test/m3-deployment-template.test.mjs:45` — deployment checker CLI |
| `tools/check-m3-deployment-template.mjs` | `17:1` | I | See exact ID proof below |

## Bounded inactivity proofs

- `apps/server/src/app.ts::19::1`: Current routes do not produce validation errors without a status. Pinned Fastify lib/validation.js assigns statusCode || 400 before handing validation errors to the handler. Other application errors are DomainError (handled first) or ordinary Error without validation. The fallback is defensive for future/custom producers, not reachable through the present route/input contract.
- `apps/server/src/app.ts::29::0`: Legacy /api/vaults always supplies one strategyId (default core-flow-demo or one schema-validated string). UNIQUE(owner_id,strategy_id) permits at most one row and limit >= 1, so listPage cannot produce a next cursor. Existing mixed-account legacy API tests assert the core binding. This proof assumes the declared schema; no constraint is removed in production.
- `apps/server/src/chain-store.ts::58::1`: PRAGMA user_version returns one signed 32-bit header integer on a successfully opened SQLite connection. Every possible value is a JavaScript safe integer. A query/closed-handle failure throws into the catch and does not enter this ternary. The null fallback cannot result from an intact SQLite result contract.
- `apps/server/src/chain-store.ts::116::1`: The immediately preceding branch rejects current && (block.number !== current.blockNumber + 1 || parent mismatch). If it does not reject, either current is absent or the new height equals current + 1. Both satisfy the following insertion condition (!current || block.number > current.blockNumber), leaving its final else impossible. Heights are validated bigint values.
- `packages/domain/src/money.ts::11::0`: The primitive-string and decimal-regex checks require at least one digit before split. String.split returns that first component, so the whole-component default can never apply to accepted input. The separate fractional default remains reachable. No prototype mutation or non-string substitute is admitted.
- `tools/check-m3-deployment-template.mjs::13::1`: For serialized/plain JSON input, the earlier ordered vaultConfig key assertion rejects null/undefined/missing vaultConfig. No intervening code changes it, so the later nullish fallback cannot run. Stateful getters/proxies are not deployment-template JSON.
- `tools/check-m3-deployment-template.mjs::17::1`: The actual CLI reads filesystem text, JSON.parse parses plain data, and validation throws Error. Native read failures, JSON syntax failures and malformed structures also throw Error subclasses. JSON cannot inject code/getters that throw primitive values. The non-Error catch arm is reserved for future/custom producers.

These proofs apply to the current source, pinned dependencies, serialized input contracts and SQLite result contract. Future route producers, schema changes or arbitrary JavaScript object/prototype manipulation require re-evaluation. Independent review is PENDING; these rows are not silently removed from any denominator.

## Integration limits

Macbeth01 coordinates Macbeth05 review and final C/R/S, complete regression, scanners, source identity, formal environment admission and hosted CI. This handoff is not an independent approval, hosted CI result, merge authorization, deployment evidence, signing or broadcast.

## Independent review follow-up: permission fixture portability

Macbeth05 identified that the directory-chmod cleanup fault assumes POSIX permissions. It is now a separate explicitly named test, with Windows `SKIP` and a `NOT_RUN` reason. Tampering, transaction abort, original database/live-WAL byte checks and ordinary retry remain unconditional tests on Windows. No production code or prior generated coverage report is changed.

This boundary follows [Node chmod semantics](https://nodejs.org/docs/latest-v24.x/api/fs.html#fschmodpath-mode-callback) and [Microsoft's directory read-only attribute semantics](https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants). It is not evidence of a Windows execution on this macOS host. POSIX coverage of this fixture must not be reported as Windows coverage; final platform receipts retain their own counts and skipped cases.

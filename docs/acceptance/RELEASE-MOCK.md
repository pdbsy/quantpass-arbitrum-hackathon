# AlphaForge isolated current-release mock acceptance

This test-only composition uses current production `buildPublicTestnetApp`, `WalletAuthStore`, `TradingChainRuntime`, `ServerBackups`, `OrderJournal`, owner-action ABI/forms and the built Testnet page. It has no signer, real RPC broadcast or shared D1 client. A separate `buildApp` instance exercises the built demo/research site and automata paths. Six specimens and EMA/RWA results are simulation evidence, never external Testnet fills.

## Reproduction

Use a full-history clone at an immutable candidate and approved fnm Node24.21.0/npm11.19.1. Install root dependencies with `npm ci --ignore-scripts`. Preserve the root manifest/lock and existing CI checks. The W4 code adds no dependencies.

Install only the previously reviewed `playwright-core1.62.1` archive from `planning/coverage-toolchain.lock.json` in the clone's ignored `.checks/release-browser-tools/package`. Verify archive SHA256 `954be1e183d0ddb9748fe0d2d08b0b66a9210c74dd75c397aeb70303b9f08a00`, SHA512 and3070300-byte size before extraction, then verify all111 installed files with `verifyInstallation` from `tools/coverage/toolchain.mjs` against `descriptor.browser.installedFiles`. The browser driver repeats installed-file verification before each context. Do not download latest browser tools or copy a writable installation from another checkout. Use already installed Chrome, or set `CHROMIUM_PATH` to a locally qualified executable. `AF_RELEASE_BROWSER_TOOL` can select another independent exact verified package directory.

```sh
fnm exec --using=24.21.0 node tools/testing/alphaforge-release-mock/run.mjs --expected-source=IMMUTABLE_40_HEX_COMMIT
```

The runner refuses dirty source by default and checks Node/npm, complete history, expected HEAD, tree and lock. It builds the current web bundle and executes three independent phases: API/recovery/evidence tests, an actual loopback child lifecycle test, and actual built browser tests. A failure is propagated; required skipped tests cannot qualify a phase. Each run creates new source-C, manifest-R, snapshot-S and digest inventory files under `.checks/release-mock/acceptance-*`. These are diagnostic release artifacts, separate from the repository's shared management C/R/S workflow, which W5 owns.

For iteration `--diagnostic` permits dirty code, but cannot produce PASS. `--api-only` leaves browser NOT_RUN and returns nonzero for full acceptance. Preserve both initial errors and later retries; never add a retry as a new unique test.

## Isolation and transports

Each session owns its auth/chain/evidence/order databases and WAL/SHM under a unique session/data directory, with private storage, A/B owners, a deterministic clock, immutable deployment/inventory fixture identity and RPC method log. A is the configured fixture Vault owner; B is separately authenticated and has an empty Vault list. B cannot see A's projection, intent or controls. The mock login material is a deterministic digest, deliberately not a valid Ethereum signature; only the dedicated composition's injected verifier accepts it. No private key exists.

Every browser case creates a fresh Chrome context, its own storage, downloads and page. A visible MOCK banner is injected by test setup. A closed EIP1193 provider supplies synthetic account/chain/login-digest/hash/cancel/unknown/timeout responses. Calls never delegate to an installed wallet. Browser routes allow only the fixture origin and fulfill from the actual Fastify apps; other request origins are rejected. The public page keeps its production secure-origin/Host/Origin/cookie checks. HTTPS interception exercises browser application logic and secure cookies; it does not qualify a deployed TLS certificate/proxy.

The standalone `serve.mjs` is a test entry with an ephemeral127.0.0.1 listener and `x-release-mock` marker. Its HTTP transport injects into the real public app. It is not selectable from production CLIs. SIGTERM closes the owned listener and DB handles; same-session process restart retains submitted intents. It sends no stop/liquidation transactions. The process test checks that the stopped port is unavailable and restart does not turn an unknown hash into a fill.

Logs omit opaque cookies and login material. All owner/manifest/transaction information is explicitly synthetic. Request/response records, fixture/RPC traces, screenshots, downloaded JSON and local pending-intent storage are retained per session; no data from another checkout is used.

## Acceptance matrix

| Path                     | Evidence                                  | Required outcome                                                                                                                                          |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public challenge/session | API tests + browser login                 | valid only; expired/replay/wrong owner/signature/domain/chain rejected; logout/expiry/restart durable                                                     |
| public ingress           | API tests                                 | wrong Host/Origin/protocol/cross-site rejected; no demo/mock/sign/executor routes                                                                         |
| owner isolation          | API + browser                             | B gets no A Vault/operation/preview; account/chain change clears personal view                                                                            |
| nine owner actions       | API decoded ABI + built browser previews  | unsigned exact6/18 units, PASS=USDCraw×10^12, finite grant, zero ETH value, chain46630                                                                    |
| mock wallet outcomes     | built browser                             | cancellation clears pending; unknown/timeout/hash persists across reload; no repeat; actual double click sends once                                       |
| observed transactions    | API/recovery                              | wrong sender/chain/target/calldata/value rejected; unknown stays SUBMITTED; reverted stays failure; canonical event+exact envelope required for CONFIRMED |
| projection/refresh       | recovery tests                            | confirmed receipt/snapshot/performance agree after close/reopen; no unverified fill or personal NAV                                                       |
| outage/chain/reorg       | recovery + browser                        | degraded publication suppressed; orphaned raw history retained; corrected canonical events append; stale healthy browser controls fail gate               |
| private nonce            | OrderJournal/recovery                     | reservation blocks executor across restart and independent restored copy                                                                                  |
| backup/restore           | production ServerBackups                  | independent digest/table/replay verification, tamper/rate/schema rejection, original bytes preserved                                                      |
| process lifecycle        | actual loopback child                     | SIGTERM exit0, listener stopped, database/submitted-intent restart consistency                                                                            |
| demo export              | actual browser download                   | parse actual JSON; AlphaForge/LOCAL_PROTOTYPE_ONLY, saved trend bookmark, ledgers and pass market present                                                 |
| six demo specimens       | browser screenshot+tooltip                | trend/factor/mean/rotate/breakout/pairs chart routes, actual mouse hover and exact close price                                                            |
| external JSON            | browser-origin actual API+UI              | UI creates isolated run; documented JSON contract creates two fills once; UI stop/deallocate/close releases PASS                                          |
| EMA                      | production pinned adapter+current browser | 120-frame synthetic cycle, two buys/two sells, zero positions, current research UI displays completed run                                                 |
| account/mobile           | browser                                   | all listed account subroutes remove M3 diagnosis; closed menu accessible label says Expand/Open; viewport bounds                                          |

External JSON has a documented API contract but no JSON textarea/submit control in the baseline research page. The external test submits real JSON from the browser origin through that documented API and checks the resulting visible UI. It does not claim a native JSON-input UI was present. EMA runs through the production local reference adapter and is observed in the built research page; a dedicated EMA launch control is not present in the baseline page.

Timeout fixtures inject transport timeout failures; the current browser fetch uses its production10-second abort deadline. A timeout fixture proves the failure path and no-resend state, not external RPC latency characteristics. Sustained24h is WAIVED_BY_USER. External wallet/chain, real TLS/proxy, deployed executor/mainnet and real shared D1 remain NOT_RUN.

## Evidence and integration boundaries

The first source is pinned base3cb9caa810e34d8ff9f9a6c68b5ef674f489689e/tree66edd0027fd2ae564a3a485e6ea5c5bc577fea5c. W4 raw baseline/iteration logs are kept in `.checks/release-mock`, including sandbox Chrome/HTTP failures, locator/option/timing corrections, JSON/hover/stop-state assertion corrections, genuine production failures and later same-case retries. Harness errors are distinguished from production regressions in the task report.

API tests, actual HTTP lifecycle, browser cases and historical baseline tests are separate counts. Do not sum them into1783/1775 historical results, and do not reuse published Sites/prototype observations as this release's PASS.

W5 must register the new test paths/entry after reviewing the exact worker commit and supply a frozen integrated source. W4 reruns on its own checkout after fetching the immutable candidate; W1 route/action matrix, W2 readiness contracts and W3 Linux image/digest remain integration inputs. W4 changes no root script or production module. Rollback preserves this branch and all fixture evidence; no onchain state is changed or reverted.

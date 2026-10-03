# AlphaForge isolated release mock implementation plan

> **For agentic workers:** Execute inline using executing-plans; the current human assignment forbids children/reviewers. Each task has verification checkpoints.

**Goal:** A repeatable isolated current-source public Testnet API/browser and demo/research acceptance harness, preserving faults and evidence.

**Architecture:** Dedicated test-only composition imports buildPublicTestnetApp, WalletAuthStore, TradingChainRuntime and existing tradingRpcFixture. Per-run disk databases, clock, in-memory mock signature/wallet/readonly RPC and fresh browser contexts are owned by W4. Separate production buildApp hosts demo/research paths. Browser requests are intercepted only at test transport and run through real Fastify injection; all external requests are rejected, no real signing/broadcast exists.

**Tech stack:** Approved Node24.21.0/npm11.19.1; locked Fastify/ethers/Vite; repository descriptor playwright-core1.62.1 verified by full installed-file inventory; local Chrome.

**Spec:** release-source-spec.md and task-4-brief.md in manager coordination directory.

## Global constraints

- Fixed base3cb9caa810e34d8ff9f9a6c68b5ef674f489689e/tree66edd0027fd2ae564a3a485e6ea5c5bc577fea5c, full clone and independent dependencies/storage.
- Only new tools/testing/alphaforge-release-mock, test/release-_.test._, test/fixtures/release-mock and subsystem acceptance docs. No root scripts/production/existing tests modifications.
- No credentials, real signer, network broadcast, shared D1 writes, mainnet, deployment, master merge or child workers.
- No generated PASS editing. Current API/browser runs distinct; preserve failures and skips; sustained24h WAIVED_BY_USER.

### Task1: isolated composition and safety tests

Files: tools/testing/alphaforge-release-mock/session.mjs; test/fixtures/release-mock/scenario.mjs; test/release-mock-api.test.mjs.
Interfaces: createReleaseSession({directory?, webRoot?, now?}) -> session with origin, headers, app, auth, runtime, fixture, request, login, advance, restart, close. mockSignature(message,owner) -> deterministic hex fixture bytes (not cryptographic signature).

- [x] Add fixture test importing createReleaseSession; assert distinct directory/DB per run, MOCK metadata, no production mock routes, A/B access isolation and injected verifier only.
- [x] Run `fnm exec --using=24.21.0 node --test --test-reporter=tap test/release-mock-api.test.mjs`; retain failing import as RED evidence (harness absent).
- [x] Implement disk-backed auth/chain/evidence/orders under unique .checks/release-mock/session-*, challenge verifier from deterministic fixture digest, readonly RPC from existing fixture, canonical seeded deposit/allocation/three fill events. Never create wallet keys.
- [x] Run tests; inspect HTTP bodies and databases, assert no cookie/RPC/raw tx in evidence logs.

### Task2: real API lifecycle/fault acceptance

Files: test/release-mock-api.test.mjs; test/release-mock-recovery.test.mjs.

- [x] Valid login via challenge/verify, invalid/expired/replayed/wrong-owner/domain challenges; logout/expiry and opaque-cookie persistence.
- [x] Owner list and typed previews APPROVE_USDC/PASS, DEPOSIT, ALLOCATE, DEALLOCATE, AUTHORIZE, STOP, REVOKE, WITHDRAW; decode ABI and assert6/18 unit mapping, exact finite budgets, reject extra/chain/mainnet fields.
- [x] Mock transaction envelopes/receipts only; unknown stays pending, wrong-envelope/revert/reorg do not publish success. Restart retains intent and nonce reservation; no auto resend.
- [x] Production ServerBackups over chain/evidence/orders; independent verify/copy restore, retained unknown lock and tamper rejection. Fault storage/chain/read-only/timeouts and verify evidence unchanged.
- [x] Run focused API/recovery; retain every log and report production defects to manager.

### Task3: actual built browser journeys

Files: tools/testing/alphaforge-release-mock/browser.mjs; test/release-mock-browser.test.mjs.

- [x] Build current `npm run build:web`, preserve full output.
- [x] Validate repository browser descriptor archive/inventory; use local Chrome with fresh context. Test public source through intercept-to-Fastify route and injected mock wallet; visible MOCK banner added only by harness transport.
- [x] Login/logout/owner-switch/wrong-chain/cancel/timeout/duplicate/reload/unknown, all action previews and finite grant; verify browser local pending storage and API logs. Do not clear ambiguous state to resume.
- [x] Separate demo buildApp/browser: obtain real JSON download/content; six strategies/hover; external JSON and EMA complete run; mobile menu/account subroutes and responsive bounds. Fail assertions preserve screenshot/network/pageerror artifact.
- [x] Keep API/browser counts separate; unsupported path explicit NOT_RUN, production defect FAIL and owner request.

### Task4: immutable evidence and integration

Files: tools/testing/alphaforge-release-mock/run.mjs; docs/acceptance/RELEASE-MOCK.md; manager task-4-report.md.

- [x] Runner writes unique evidence directory, command/exitcode/log digests/HEAD/tree/lock/fixture/tool identity; refuses dirty source for formal acceptance. No PASS based only on fixture success.
- [x] Local typecheck/lint/format for new files and focused tests, commit harness, rerun same commit for evidence. Record baseline tests separately.
- [ ] Report exact W5 root script request and immutable candidate inputs. Await W5 candidate/ref and W1 route matrix/W2 contract/W3 image; rerun API/browser against integrated source without editing peer checkout.
- [ ] Final report source/head/tree/commit/commands/counts/rawlogs/digests/failures/skips/notrun/boundaries/rollback/remaining inputs. No24h execution.

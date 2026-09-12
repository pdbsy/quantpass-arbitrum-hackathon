# AF-UI01 Existing UI Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Preserve the supplied English AlphaForge v3 UI and complete a real local-backend access, funding, simulation and withdrawal journey.

**Architecture:** Extract the supplied self-contained HTML into unchanged shell, external CSS and external classic JS so the server's existing CSP remains enforced. A separate typed client controller owns backend session, catalogue, vault and command state; a DOM adapter uses the prototype's existing page functions, dialogs and CSS classes. The six original strategies/charts remain explicitly MOCK / FIXTURE. The actual API strategy core-flow-demo has its own visible entry and associated vault; no aliasing six strategies to one vault.

**Tech Stack:** TypeScript, Vite, native DOM, existing Fastify/SQLite API, Node 24.12.0/npm 11.6.2, existing user HTML/CSS/JS.

**Spec:** docs/management/ui/AF-UI01/SPEC.md; source UI supplied at <HOME>/Downloads/AlphaForge_v3_EN.html and companion README/JSX.

## Global Constraints

- AGENT_NAME = Macbeth02; TASK_ID = AF-UI01; branch macbeth02/AF-UI01-ui-adaptation.
- Preserve all six user pages, navigation, warm-paper palette, Doodle styling, original charts, bookmarks and local notes. No redesign or product-wide formatting.
- No wallet custody, real funds, mainnet, testnet broadcast, other worker branch changes, Git identity changes, or self-merge.
- API money is integer micro-units encoded as strings; never convert backend balances through floating-point arithmetic.
- Preserve command ID, exact pending retry payload, expectedRevision, revision conflicts, account/vault isolation and SQLite persistence. An uncertain network result is never success.
- Handle LOADING, EMPTY, READY, ERROR, PENDING, STALE, DISCONNECTED.
- Consume frozen Wave 1 contract 73230c43e464cd1b579fa16a6425756291ef9e8e through one canonical adapter. Read public contract copy <TEMP_PATH> Add no backend capability or fabricated performance. Keep fixture Pass exchange separated from backend vault funds.
- Work only at <SOURCE_ROOT>. Runtime PATH uses its .checks/runtime/node_modules/.bin. All commits include [Macbeth02] and exactly Agent-ID: Macbeth02 / Task-ID: AF-UI01.

### Task 1: Typed backend session and command controller

**Files:** Create apps/web/src/product-client.ts; test/ui-product-client.test.ts; wire test script in package.json.

**Interfaces:** Export ProductClient with injected api request and Storage subset for deterministic tests. Public snapshot contains phase, user, strategies, vaults, selectedVaultId, audit, pending, error and notice. Methods refresh(), selectIdentity('alice'|'bob'), selectVault(id), claim(strategyId), command(type, fields), retry(), dismissRejected(); subscribe(listener) emits state. Keep exact pending payload durable before sending. Use existing api.ts, Vault/Audit types and money.ts.

- [x] Write tests using a real buildApp with SQLite and injectable transport. Simulate a response lost after commit, retry and assert only one deposit occurred. Assert revision conflict does not silently create another request. Assert selecting Bob never replays Alice's pending command or shows Alice balances. Assert command storage failure prevents sending. Assert duplicate concurrent sends are prevented and successful writes followed by failed readback remain uncertain.
- [x] Run test/ui-product-client.test.ts and record expected missing-behavior failures.
- [x] Implement minimal controller to pass tests. Separate definitive 4xx rejection from uncertain 5xx/transport failures. A stale retained draft requires refresh/review before a fresh command. Clear private state on session loss. Expose a bounded timeout through existing api.
- [x] Run tests and typecheck. Record results. Commit controller and tests.

### Task 2: Preserve prototype and connect product pages

**Files:** Create apps/web/prototype/AlphaForge_v3_EN.html (exact user input), tools/import-user-ui.mjs, generated build/ui-import/user-ui.css and user-ui.js, apps/web/src/product-ui.ts, apps/web/src/product-adapter.ts, test/ui-product-adapter.test.ts, test/ui-import.test.mjs, docs/management/ui/AF-UI01/README.md. Update apps/web/index.html, package.json and apps/web/vite.config.ts. Existing build-output exclusions apply; add no lint/format exceptions. Keep old React demo source available but stop rendering it as the main UI.

**Interfaces:** Consume ProductClient from Task 1 and window.AF from the user script. ProductClient intentionally retains legacy transport internally; Task 2 owns the SOLE canonical adapter (ownerId/strategyId/vaultId/passBalance/balances/pendingOperations/AuditEvent). Normalize existing available fields only, never fabricate missing deposits/PnL/fee fields. Extend through confirmed canonical backend endpoints when available; no alias IDs or assumed pagination completeness. Read .checks/AF-UI01/browser-acceptance-spec.md and tools/verify-ui-browser.mjs for browser selectors and exact acceptance journey; preserve its behavior expectations. Request backend endpoint contract via public PR #9 questions; do not modify backend. Preserve AF.pages, AF.app.openDialog, AF.app.render and AF.homeHtml. User shell is built from the exact original file with style/script bodies externalized; do not enable unsafe-inline for scripts or weaken CSP. Original CSS is byte-preserved; original JS only mechanically converts whitespace-prefixed style= attributes to data-user-style= for trusted whitelisted CSSOM hydration, preserving data-price-style and font-style. Add tests proving source payload normalization and actual style preservation. Original input HTML is byte-preserved and excluded from mass formatting.

- [x] Write import tests that run the actual extraction into a temporary directory and check exact style/script payload preservation, removal of inline scripts/styles and unchanged body/page shell. Run failing tests before adding importer.
- [x] Import the original page without JSX iframe, preserving all original routes and original fixture interactions. Keep existing backend funds independent from prototype DEMO balances.
- [x] Add API status/identity controls using existing UI classes; render an API catalogue section with search/status/environment filters and explicit fixture labels for original strategies. Add a real core-flow-demo detail/workspace route using existing terminal/receipt/balance classes, no invented chart or performance values. Wire trial access, account Pass/vault balances, audit and withdrawal queue to ProductClient.
- [x] Use existing dialogs for review/confirmation and pending retry. Add all thirteen required commands: deposit, allocate, deallocate, start, stop, reserveBuy, fillBuy, cancelOrder, markPosition, settlePosition, requestWithdrawal, confirmWithdrawal, cancelWithdrawal. Snapshot expectedRevision at review, never silently update a reviewed payload. Disable new command submissions until uncertain request resolved. Scope every operation to selected owner/vault.
- [x] Preserve original account trades/bookmarks/notes/settings pages; show backend funds/Passes distinctly, label retained prototype exchange and browser balances as FIXTURE. Preserve six original strategy detail pages and their independent sample charts.
- [x] Run importer tests, controller tests and full npm run check; fix discovered defects. Commit the adaptation.

### Task 3: Browser acceptance and review

**Files:** docs/management/ui/AF-UI01/VERIFICATION.md; browser acceptance script under test or tools if tooling available.

**Interfaces:** Serve built apps/web/dist with existing local server using isolated .data state and loopback origin. Use real browser and API; no external accounts or transactions.

- [x] Execute home → marketplace → backend strategy detail → claim test Pass → account → workspace → deposit → allocate → start/reserve/fill/mark/settle/stop/deallocate → withdrawal request/confirmation. Verify cancellation paths, reload persistence, Bob isolation, stale/pending/error behavior, original six routes and mobile layout.
- [x] Record exact real results, screenshots where useful, and any Browser validation: NOT RUN limits if browser unavailable.
- [x] Run targeted regression tests plus required check/gates; publish commits with correct metadata, retain Draft PR. Get independent code review and resolve important findings.
- [x] Update PR work log, adaptation map, fixture dependencies and retrospective. End READY FOR REVIEW; no self-merge.

# AF-UI01 supplied UI adaptation

Worker Macbeth02 · Task AF-UI01 · TEST_ONLY.

The supplied English six-page workshop remains the application shell. Home, Marketplace, Rankings, Forum, Account and Trade keep their original page builders, charts, bookmarks, notes and local ledgers. React demo source is retained but is no longer the rendered entry point.

## Reproduce the import

```sh
npm run import:ui
npm run build:web
npm run check
```

`apps/web/prototype/AlphaForge_v3_EN.html` is the exact 285969-byte supplied file, including its Doodle CSS MIT license. SHA256: `949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45`.

The importer externalizes the single CSS and classic script bodies. CSS bytes are unchanged (SHA256 `8b0996e01403be0d0fbf555e03151973cdfe1118ad20f4423324538a32e4aff6`). The sole script/shell normalization replaces whitespace-prefixed `style=` with `data-user-style=`; it preserves escaped JSON strings, `data-price-style`, SVG `font-style` and all other source text. The shell adds the external stylesheet/script references and the typed adapter module entry.

Generated CSS/JS live in `build/ui-import`, covered by the repository's existing generated-output rules, and Vite's `publicDir` copies them to dist. No lint or format exclusions were added. Authored importer, adapter, hydration and tests remain linted. The root build regenerates assets; do not hand-edit generated files.

`product-ui.ts` applies only known marked properties (`position`, `width`, `height`, `overflow`, `--cover`, `--s-ink`, `background`, `color`, `display`, `margin-top`) via CSSOM, including newly rendered fixture markup. It rejects URL/expression/variable declarations. Server CSP is unchanged; no inline-script permission or inline-style policy exception is used.

## API boundary

`ProductAdapter` in `product-adapter.ts` is the sole canonical gateway. It injects legacy-shaped internal transport into the reviewed `ProductClient`, while exposing `CanonicalSnapshot`, `StrategySummary`, `StrategyDetail`, `AccountSummary`, `ProductVault`, `PendingOperation` and `AuditEvent` to page builders. All rendering escapes backend text.

The initial `/api/v1/strategies` probe enables v1. Only a 404 on that initial request permits explicit legacy compatibility. Authentication failures, malformed data, later-page 404s and server errors fail closed. Strategies, all-owner vaults and audit consume every opaque `nextCursor`, with cycle/page/item bounds. AccountSummary and every registered StrategyDetail are read from real endpoints; optional account vault pages are also consumed. Vault association uses authenticated ownerId, strategyId and vaultId. Executor receipts retain `local-simulator` for the server's six executor types, including historical payFees; owner receipts require the authenticated owner.

Canonical fields are retained, including full balances and pending operations. Legacy balances missing deposits, PnL or fee history display **Unavailable**. Monetary inputs use six-decimal `parseUnits` and integer strings; displays never pass balances through floating point. A zero mark or settlement is valid; amount operations require positive amounts. API state is distinct from simulation vault status: LOADING, EMPTY, READY, ERROR, PENDING, STALE and DISCONNECTED do not invent economic status.

The catalogue automatically displays the server's distinct `core-flow-demo` and `satellite-flow-demo` entries when available. No fixture ID is mapped to either. Filters cover text, association status and environment. Detail/workspace contains test access, exact balances, pending operations and audit; it has no fabricated market/performance chart.

The thirteen visible commands are deposit, allocate, deallocate, start, stop, reserveBuy, fillBuy, cancelOrder, markPosition, settlePosition, requestWithdrawal, confirmWithdrawal and cancelWithdrawal. Review captures owner, vault and revision before confirmation. Operation IDs are visible and selected from the current vault's pending operations; new orders get a distinct ID. Stop remains stopping while obligations exist.

ProductClient retains the original `quantpass.local.pending-command.v1` envelope and exact reviewed command for uncertain outcomes and reload. New financial writes are disabled until resolution. Rejected drafts require refresh, explicit dismissal, then refresh/review. `Retry-After` metadata is additive in `api.ts`; a separate `quantpass.local.retry-after.v1` deadline survives reload and blocks early retry. No background retry is scheduled. A timer only updates the displayed countdown.

## Visible browser controls

- `data-product-state`, `data-product-login="alice|bob"`, `data-product-refresh`.
- `data-product-strategy="server strategy ID"`, `data-product-claim="server strategy ID"`.
- `data-product-search`, `data-product-status-filter`, `data-product-environment-filter`, `data-product-catalogue`.
- `data-product-command="commandType"`; review dialogs use `name="amount|value|proceeds|orderId|withdrawalId"`, `data-product-review`, `data-product-confirm` and the original `data-close`.
- `data-product-retry`, `data-product-dismiss`, `data-product-dialog-error`.

Backend pages use `#/trade/<server strategyId>` and the API account section is shown on the original `#/account/*` routes. Original six strategy routes and account trades/saved/notes/settings remain intact.

## Fixtures and evidence

The six original strategies (`trend`, `factor`, `mean`, `rotate`, `breakout`, `pairs`), their charts and rankings, Pass trading exchange and browser trial ledger remain explicitly MOCK / FIXTURE. They are independent of the API test Pass allowance and funds. Original local forum content and notes remain browser-only. Prototype reset/export acts on original fixture storage, not the API ledger or unresolved API request.

Adapter tests use normalized public fixtures from backend commit `f66faa10c2a22f56048b04416cd83a2e8e9dd481`, `docs/api/fixtures/AF-BE01.json`. Legacy aliases are removed in the test fixture to prove canonical field consumption. Tests cover exact importer bytes/idempotence, owner isolation, missing legacy fields, opaque pagination, fail-closed fallback, money validation, server executor actor semantics and reload-safe retry timing. The coordinating worker owns browser integration evidence and final screenshots; unit/build success alone is not browser acceptance.

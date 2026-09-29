# AlphaForge Hackathon quantitative infrastructure closeout

The user selected option A on 2026-09-29: extend the existing core, adapt the fixed-source LEAN EMA example as a local/mock test strategy, and begin reproducibility, streaming simulation and cost-model research. This is not authorization for real orders, mainnet, additional workers, a toolchain upgrade or an unconditional merge.

Deliverables:
- A traceable 15/30-period EMA adapter with the source/license preserved. Synthetic periods are explicitly not daily bars. The original long/flat transition rules and entry tolerance are retained; fixed-point arithmetic, multiple eligible assets and budget weights are documented adaptations.
- Strategy context includes only the already-observed bounded fixture prefix. This lets a stateless indicator rebuild after restart without fetching future prices. Existing dataset hashes remain unchanged; a new rise/fall fixture exercises both crossings.
- An external strategy client can select targets from current context, and persist an uncertain request in a separate SQLite outbox before transmission. A restart retries the same immutable envelope before a new decision. Session cookies are never persisted there.
- `npm run demo:ema` builds/serves the UI on loopback with a dedicated SQLite ledger, provisions one idempotent test run, and drives it through the normal authenticated JSON routes. A completed run stays available to inspect; restart resumes its existing state. The strategy never overrides user pause/stop or risk decisions. Existing generic demo data is preserved.
- `npm run research:quant` emits an immutable-input report with manifest hashes, closed-observation/next-event ordering, replay/resume equivalence, cost decomposition and stress cases. It is a synthetic research harness, not production historical backtesting or live market connectivity. Real paper feeds await chain/token/venue selection.
- Source-bound local acceptance, C/R/S evidence and reviewable commits. Public push/PR/CI remains dependent on the previously requested explicit publication authorization. Self-review is not independent approval.

No change to real signing, broadcasting, production credentials, legacy engine/storage identifiers, dependency versions or existing evidence. One controller owns demo stepping. Already accepted signals must not create duplicate fills on uncertain-response retries. Cash-only withdrawal and latched whole-portfolio liquidation remain shared engine responsibilities.
